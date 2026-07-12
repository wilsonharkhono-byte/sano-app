-- 073 — Transactional material-request submit + folded fulfilled-line lockstep fix
--       (Task 2.9, MED)
--
-- Paste order: AFTER 072 (latest applied migration). Apply via the Dashboard SQL
--   Editor (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe throughout: CREATE OR REPLACE FUNCTION (new stable signatures,
--   no overloads) + GRANT re-issued.
--
-- ── Part A: submit_material_request — the orphan-header fix ─────────────────
--   PermintaanScreen.handleSubmit wrote header → N lines → per-line allocations →
--   activity_log as SEPARATE PostgREST inserts with NO transaction. A failure
--   partway through (a CHECK violation on line 2, an allocation FK miss) left the
--   header — and any already-inserted lines/allocations — orphaned. This is the
--   exact bug class migration 045 fixed for POs (create_purchase_order). This RPC
--   folds every write into one plpgsql body = ONE transaction: any RAISE anywhere
--   rolls back the whole thing, so a request is all-or-nothing.
--
--   Modeled on create_purchase_order (055/071): insert header RETURNING id, then
--   lines, then allocations, then activity_log. Differences from the PO RPC:
--     • Allocations reference their line by ARRAY INDEX. The client cannot know a
--       line's real id before insert, so p_allocations elements carry line_index
--       (0-based into p_lines); the loop below resolves it to the just-inserted
--       line id. Lines are inserted in a FOR…WITH ORDINALITY loop and each line's
--       own allocations are inserted immediately after it — byte-faithfully
--       reproducing the OLD client's per-line interleaving so the 033 triggers
--       fire in the SAME order they did before (see the trigger note below).
--     • SECURITY INVOKER (like 045's transactional PO/receipt): RLS keeps applying
--       to every insert, so the supervisor's own policies gate the write:
--         - material_request_headers → request_headers_assigned_insert (002:903)
--           requires requested_by = auth.uid() AND project in assignments;
--         - material_request_lines   → request_lines_assigned_insert (002:947)
--           requires the line's header's project in assignments (header exists
--           inside the txn, so the check sees it);
--         - material_request_line_allocations → request_allocations_assigned_insert
--           (005:86) requires line→header→project in assignments (visible in-txn);
--         - activity_log → activity_log_assigned (001:464, FOR ALL) requires
--           project in assignments (USING doubles as the INSERT WITH CHECK).
--       Every one composes under the caller's grants, so no SECURITY DEFINER is
--       needed — the same reasoning 045 used. (No-JWT / service-role callers
--       bypass RLS entirely, as elsewhere.)
--
--   ⚠ 033 TRIGGERS STILL FIRE (unchanged): Trigger 1 (BEFORE INSERT on lines)
--     overwrites NEW.line_flag via dispatch_line_flag REGARDLESS of the client's
--     advisory line_flag; Trigger 2 (AFTER on lines) re-aggregates the header's
--     overall_flag and may promote overall_status; Trigger 3 (AFTER on allocations)
--     re-runs dispatch_line_flag for the line whose allocation just landed. These
--     are table triggers — they fire on the RPC's inserts exactly as they did on
--     the old client-side inserts. The per-line insert order preserved below keeps
--     their outcome identical to the pre-073 behavior.
--
--   Guards (mirror 060's compensating in-function checks):
--     • empty p_lines → RAISE (a request with no lines is meaningless);
--     • p_header.requested_by ≠ auth.uid() when auth.uid() is non-NULL → RAISE
--       (anti-spoofing, mirrors 060's p_received_by guard; RLS would also reject
--       it, but failing loud in-function gives a clear message);
--     • an allocation whose line_index is out of range → RAISE (a mis-built
--       payload must fail loud, never silently drop the allocation).
--
-- ── Part B: fulfilled-line exclusion now ignores CANCELLED POs (lockstep) ───
--   Folded in from the Task 2.8 review. Of 069's three request-time gate
--   computers, ONLY compute_tier2_flag carries the fulfilled-line exclusion in
--   its "other open requests" leg. (Tier 1 burns on WORKGROUP_ENVELOPE
--   allocations — no exclusion subquery; tier 3 reads committed_rupiah from
--   v_material_budget_status (047), whose request-lateral has no exclusion at
--   all — a separate pre-existing semantic, unchanged here.) The exclusion
--   drops a request line from the burn once it is linked to a PO:
--       mrl.id NOT IN (SELECT pol.request_line_id FROM purchase_order_lines pol
--                      WHERE pol.request_line_id IS NOT NULL)
--   That subquery has NO PO-status predicate, so a request line linked to a PO
--   that is LATER CANCELLED stays "fulfilled" forever — its open need silently
--   vanishes from every gate even though nothing will ever be delivered. The fix:
--   join purchase_orders and require `po.status <> 'CANCELLED'`, so cancelling a
--   PO re-exposes its linked request lines to the burn. Everything else in the
--   three functions is copied BYTE-FAITHFULLY from 069.
--
--   Why ONLY CANCELLED unfulfills (and CLOSED_SHORT does not): a CLOSED_SHORT PO
--   is a genuine order whose goods partially arrived and was then short-closed —
--   the line WAS ordered, so it should keep counting as fulfilled and stay
--   excluded from the open burn. Only CANCELLED means "this order will never
--   happen", so only CANCELLED returns the line to the open need. (compute_tier3
--   has no exclusion subquery — it burns Rupiah against v_material_budget_status,
--   which is PO/commitment-derived — so it is re-created here UNCHANGED for a
--   single, self-contained lockstep artifact; its body is byte-identical to 069.)
--
--   CLIENT TWIN (change in lockstep — done in the same commit):
--     tools/requestLineLinkCandidates.ts + workflows/screens/Gate2Screen.tsx build
--     linkedRequestLineIds; that set now excludes CANCELLED POs' links the same
--     way, so the "Tautkan ke permintaan" picker re-offers a request line whose PO
--     was cancelled. The exclusion is BUILT in Gate2Screen (the pure helper just
--     receives the set); see the comment on getRequestLineLinkCandidates.

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — submit_material_request
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_material_request(
  p_header      JSONB,
  p_lines       JSONB,
  p_allocations JSONB,
  p_activity    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_header_id     UUID;
  v_requested_by  UUID;
  v_line          JSONB;
  v_ordinality    BIGINT;
  v_line_id       UUID;
  v_line_count    INT;
BEGIN
  -- ── Guards ────────────────────────────────────────────────────────────────
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'submit_material_request: p_lines must contain at least one line';
  END IF;

  v_line_count := jsonb_array_length(p_lines);

  -- Anti-spoofing (mirrors 060): the recorded requester must be the caller when a
  -- JWT is present. Skipped for no-JWT contexts (service-role / Dashboard editor),
  -- consistent with the house style in 057/059/060.
  v_requested_by := NULLIF(p_header->>'requested_by', '')::UUID;
  IF auth.uid() IS NOT NULL AND v_requested_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION
      'submit_material_request: requested_by must equal the calling user';
  END IF;

  -- Every allocation must point at a line that exists in this payload — a
  -- mis-built payload fails loud rather than silently dropping the allocation
  -- (the per-line insert below would otherwise just never match it).
  -- NULL/missing line_index must ALSO raise: with only the two range
  -- comparisons, a NULL index makes both predicates NULL (not true), the
  -- EXISTS never fires, and the per-line WHERE below silently drops the
  -- allocation — exactly the fail-quiet path this guard exists to prevent.
  IF p_allocations IS NOT NULL AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) AS alloc
    WHERE (alloc->>'line_index') IS NULL
       OR (alloc->>'line_index')::INT < 0
       OR (alloc->>'line_index')::INT >= v_line_count
  ) THEN
    RAISE EXCEPTION
      'submit_material_request: allocation line_index missing or out of range (valid 0..%)',
      v_line_count - 1;
  END IF;

  -- ── 1. Header ──────────────────────────────────────────────────────────────
  INSERT INTO material_request_headers (
    project_id, boq_item_id, request_basis, requested_by, target_date,
    urgency, common_note, overall_flag, overall_status
  )
  VALUES (
    NULLIF(p_header->>'project_id', '')::UUID,
    NULLIF(p_header->>'boq_item_id', '')::UUID,
    p_header->>'request_basis',
    v_requested_by,
    (p_header->>'target_date')::DATE,
    p_header->>'urgency',
    p_header->>'common_note',
    COALESCE(p_header->>'overall_flag', 'OK'),
    COALESCE(p_header->>'overall_status', 'PENDING')
  )
  RETURNING id INTO v_header_id;

  -- ── 2. Lines + their allocations, one line at a time ───────────────────────
  -- WITH ORDINALITY gives the 0-based array index (ordinality - 1) so this line's
  -- allocations (line_index = ordinality - 1) go in right after it. Inserting each
  -- line's allocations before the next line keeps the 033 triggers firing in the
  -- same order the old per-line client loop produced.
  FOR v_line, v_ordinality IN
    SELECT elem.line_json, elem.ord
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS elem(line_json, ord)
  LOOP
    INSERT INTO material_request_lines (
      request_header_id, material_id, custom_material_name, tier,
      material_spec_reference, quantity, unit, line_flag, line_check_details,
      overage_reason, overage_note, work_group_label
    )
    VALUES (
      v_header_id,
      NULLIF(v_line->>'material_id', '')::UUID,
      v_line->>'custom_material_name',
      (v_line->>'tier')::SMALLINT,
      v_line->>'material_spec_reference',
      (v_line->>'quantity')::NUMERIC,
      v_line->>'unit',
      -- Advisory only: Trigger 1 (033) overwrites this server-side. Sent for
      -- parity with the old client payload.
      COALESCE(v_line->>'line_flag', 'OK'),
      -- NULLIF folds a JSON `null` (or an absent key) down to SQL NULL so the
      -- column stores NULL, not a JSONB 'null' literal — matching the old
      -- PostgREST insert of line.lineResult when it was null.
      NULLIF(v_line->'line_check_details', 'null'::jsonb),
      v_line->>'overage_reason',
      v_line->>'overage_note',
      v_line->>'work_group_label'
    )
    RETURNING id INTO v_line_id;

    IF p_allocations IS NOT NULL THEN
      INSERT INTO material_request_line_allocations (
        request_line_id, boq_item_id, allocated_quantity, proportion_pct,
        allocation_basis
      )
      SELECT
        v_line_id,
        NULLIF(alloc->>'boq_item_id', '')::UUID,
        (alloc->>'allocated_quantity')::NUMERIC,
        (alloc->>'proportion_pct')::NUMERIC,
        alloc->>'allocation_basis'
      FROM jsonb_array_elements(p_allocations) AS alloc
      WHERE (alloc->>'line_index')::INT = v_ordinality - 1;
    END IF;
  END LOOP;

  -- ── 3. Activity log (optional) ─────────────────────────────────────────────
  IF p_activity IS NOT NULL THEN
    INSERT INTO activity_log (project_id, user_id, type, label, flag)
    VALUES (
      NULLIF(p_activity->>'project_id', '')::UUID,
      NULLIF(p_activity->>'user_id', '')::UUID,
      p_activity->>'type',
      p_activity->>'label',
      p_activity->>'flag'
    );
  END IF;

  RETURN v_header_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_material_request(JSONB, JSONB, JSONB, JSONB)
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — CANCELLED-PO fulfilled-line exclusion (lockstep with the client twin)
--
-- The three functions below are copied VERBATIM from 069_soft_request_gate.sql.
-- The ONLY change is in compute_tier2_flag: its fulfilled-line exclusion
-- subquery now JOINs purchase_orders and adds `AND po.status <> 'CANCELLED'`,
-- so a request line linked to a cancelled PO returns to the "other open
-- requests" burn. compute_tier1_workgroup_flag (burns on WORKGROUP_ENVELOPE
-- allocations) and compute_tier3_flag (burns Rupiah via
-- v_material_budget_status) contain NO exclusion subquery and are re-created
-- byte-identically to 069, so all three tier computers live in one lockstep
-- artifact. Signatures are UNCHANGED, so dispatch_line_flag (056) needs no
-- change.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tier 1 (work-group). Byte-identical to 069 — no exclusion subquery ──
-- ── exists in this function; do NOT "restore" one here.                   ──
CREATE OR REPLACE FUNCTION compute_tier1_workgroup_flag(
  p_request_line_id UUID,
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boq_ids UUID[];
  v_planned NUMERIC;
  v_ordered NUMERIC;
  v_burn    NUMERIC;
BEGIN
  -- The BoQ rows this Tier-1 line spans = its own WORKGROUP_ENVELOPE allocations.
  SELECT ARRAY_AGG(DISTINCT a.boq_item_id)
    INTO v_boq_ids
  FROM material_request_line_allocations a
  WHERE a.request_line_id = p_request_line_id
    AND a.allocation_basis = 'WORKGROUP_ENVELOPE'
    AND a.boq_item_id IS NOT NULL;

  -- No allocations yet (line inserted before its allocations land) — placeholder;
  -- Trigger 3 re-enters dispatch_line_flag after the allocations INSERT.
  IF v_boq_ids IS NULL OR array_length(v_boq_ids, 1) IS NULL THEN
    RETURN 'WARNING';  -- placeholder until allocations arrive
  END IF;

  -- Group planned demand for THIS material, scoped to the latest master.
  SELECT SUM(pmml.planned_quantity)
    INTO v_planned
  FROM project_material_master_lines pmml
  WHERE pmml.master_id = (
    SELECT id FROM project_material_master
    WHERE project_id = p_project_id
    ORDER BY created_at DESC
    LIMIT 1
  )
    AND pmml.material_id = p_material_id
    AND pmml.boq_item_id = ANY(v_boq_ids);

  -- No baseline for this group → cannot evaluate → soft INFO. Lockstep with
  -- computeWorkGroupGate1Flag ("Tidak ada alokasi pembanding" INFO).
  IF v_planned IS NULL OR v_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  -- Already-requested (allocations) against this group's BoQ rows for this
  -- material, EXCLUDING the line being written (self-exclusion, as 056 does).
  -- NOTE: request-based burn is DELIBERATE at Tier-1 grain — POs carry no
  -- work-group dimension (see header). Only the severity cap changed.
  SELECT COALESCE(SUM(a.allocated_quantity), 0)
    INTO v_ordered
  FROM material_request_line_allocations a
  JOIN material_request_lines   l ON l.id = a.request_line_id
  JOIN material_request_headers h ON h.id = l.request_header_id
  WHERE l.material_id = p_material_id
    AND a.boq_item_id = ANY(v_boq_ids)
    AND h.overall_status NOT IN ('REJECTED')
    AND a.request_line_id <> p_request_line_id;

  v_burn := ((v_ordered + p_requested_qty) / v_planned) * 100;

  -- WARNING cap (Task 2.4). Pre-069: > 120 CRITICAL, > 100 HIGH, > 80 WARNING,
  -- else OK (no INFO tier for Tier-1). Post-069: everything above 80 is WARNING.
  IF v_burn > 80 THEN RETURN 'WARNING'; END IF;
  RETURN 'OK';
END;
$$;

-- ── 2. Tier 2 (project envelope). Byte-faithful to 069 except the exclusion ──
--    subquery now joins purchase_orders and excludes CANCELLED POs (Task 2.9).
CREATE OR REPLACE FUNCTION compute_tier2_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_planned NUMERIC;
  v_po_ordered    NUMERIC;
  v_other_open    NUMERIC;
  v_burn_pct      NUMERIC;
BEGIN
  -- NULL material → OK (033 behavior preserved). CAVEAT: a direct REST insert
  -- with tier=2 and material_id NULL slips the gate; the app never does this
  -- (Tier-2 requires a catalog material), and free-text lines get INFO client-side.
  IF p_material_id IS NULL THEN
    RETURN 'OK';
  END IF;

  SELECT total_planned, total_ordered
    INTO v_total_planned, v_po_ordered
  FROM v_material_envelope_status
  WHERE project_id = p_project_id AND material_id = p_material_id;

  -- No envelope built yet (no boq link via ahs) → no baseline → INFO.
  IF v_total_planned IS NULL OR v_total_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  -- Other open requests (see header definition): non-rejected request lines for
  -- this material, excluding lines already fulfilled by a NON-CANCELLED PO. A
  -- line linked to a later-CANCELLED PO is NOT fulfilled — it returns to the burn
  -- (Task 2.9 lockstep fix). CLOSED_SHORT stays excluded (genuinely ordered). The
  -- current line self-excludes at BEFORE INSERT (not yet in the table).
  SELECT COALESCE(SUM(mrl.quantity), 0)
    INTO v_other_open
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = p_project_id
    AND mrl.material_id = p_material_id
    AND mrh.overall_status IN ('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'APPROVED')
    AND mrl.id NOT IN (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id IS NOT NULL
        AND po.status <> 'CANCELLED'
    );

  v_burn_pct := ((COALESCE(v_po_ordered, 0) + v_other_open + p_requested_qty) / v_total_planned) * 100;

  -- WARNING cap (Task 2.4). Pre-069: > 120 CRITICAL, > 100 HIGH, > 80 WARNING,
  -- > 50 INFO, else OK. Post-069: > 80 WARNING, > 50 INFO, else OK.
  IF v_burn_pct > 80 THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50 THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- ── 3. Tier 3 (Rupiah budget). Byte-identical to 069 — no exclusion subquery,
--    re-created only to keep all three tier computers in this one artifact.
CREATE OR REPLACE FUNCTION compute_tier3_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC,
  p_actual_unit_price NUMERIC DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_benchmark    NUMERIC;
  v_budget_total NUMERIC;
  v_committed    NUMERIC;
  v_effective    NUMERIC;
  v_burn_pct     NUMERIC;
  v_found        BOOLEAN;
BEGIN
  -- Can't-evaluate guards (unchanged from 048) — these already sit at or below
  -- WARNING, so the cap is a no-op for them; a missing baseline is a caution,
  -- not an over-total.
  IF p_material_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'WARNING';
  END IF;

  SELECT benchmark_unit_price, budget_total_rupiah, committed_rupiah
    INTO v_benchmark, v_budget_total, v_committed
  FROM v_material_budget_status
  WHERE project_id = p_project_id AND material_id = p_material_id;
  v_found := FOUND;

  IF NOT v_found OR v_benchmark IS NULL THEN
    RETURN 'WARNING';
  END IF;

  IF v_budget_total IS NULL OR v_budget_total <= 0 THEN
    RETURN 'WARNING';
  END IF;

  v_effective := COALESCE(p_actual_unit_price, v_benchmark);
  v_burn_pct := ((COALESCE(v_committed, 0) + p_requested_qty * v_effective) / v_budget_total) * 100;

  -- WARNING cap (Task 2.4). Pre-069: > 120 CRITICAL, > 100 HIGH, > 80 WARNING,
  -- > 50 INFO, else OK. Post-069: > 80 WARNING, > 50 INFO, else OK.
  IF v_burn_pct > 80 THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50 THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;
