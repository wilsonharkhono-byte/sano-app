-- 069_soft_request_gate.sql
--
-- Task 2.4 — Request-time soft heads-up (Signal 1). Design authority:
--   docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §3.
--
-- Paste order: AFTER 068 (envelope re-model: total_ordered = PO, add
--   total_requested) and AFTER 056/048/033 (the tier flag machinery this
--   supersedes). Apply via the Dashboard SQL Editor (remote migration history
--   diverged — see project memory). Idempotent: CREATE OR REPLACE only; the tier
--   function signatures are UNCHANGED so dispatch_line_flag (056) needs NO change
--   and is deliberately NOT re-created here.
--
-- WHAT CHANGES (server side of the client/SQL lockstep):
--   The three request-time tier flag computers stop returning HIGH/CRITICAL for
--   quantity/budget overage and CAP at WARNING. Request time never hard-blocks on
--   quantity/budget — approval (estimator) and PO creation (admin, Gate-2) are the
--   control points. Sub-100 bands are UNCHANGED (INFO >50 where it existed; Tier-1
--   still has no INFO tier). The >100 (was HIGH) and >120 (was CRITICAL) bands both
--   collapse to WARNING; the escalating COPY ("melebihi total alokasi" / "jauh
--   melebihi alokasi") is rendered client-side (gate1.ts / PermintaanScreen /
--   tools/requestOverage.ts) — the server only returns the flag.
--
-- ⚠ AUTO_HOLD CONSEQUENCE (designed outcome): 033 Trigger 2 promotes a header to
--   AUTO_HOLD only on a HIGH/CRITICAL line flag. Because these three functions now
--   cap at WARNING, that promotion is UNREACHABLE for quantity/budget flags — a
--   request-time quantity/budget overage can no longer AUTO_HOLD. This is
--   intentional (spec §2.2 / §3): the hard quantity gate lives at PO creation
--   (Gate-2, migration TBD Task 2.5), not at request time.
--   CARVE-OUT: this claim covers only the three functions this migration touches.
--   The legacy compute_tier1_flag (033, single-BoQ DIRECT-allocation path) is NOT
--   one of them — dispatch_line_flag (056:184-196) still calls it whenever a
--   DIRECT allocation exists, and it still returns HIGH/CRITICAL uncapped. So a
--   DIRECT-allocation Tier-1 request (including one written via direct REST
--   insert, bypassing the app's WORKGROUP_ENVELOPE path) CAN still AUTO_HOLD.
--   Left as-is: recapping compute_tier1_flag is out of scope for this migration.
--
-- ⚠ TIER-1 GRAIN SIMPLIFICATION: SANO POs carry no work-group dimension, so at the
--   work-group grain there is no honest way to subtract PO qty. compute_tier1_
--   workgroup_flag therefore KEEPS the request-based burn on WORKGROUP_ENVELOPE
--   allocations exactly as 056 did (planned − already-allocated-requests), only
--   capping severity at WARNING. The PROJECT-grain PO figure that gives the "di-PO"
--   context is surfaced by the CLIENT (PermintaanScreen passes the project envelope
--   to computeWorkGroupGate1Flag; ApprovalsScreen recomputes it live) — not by this
--   function. Moving the work-group burn onto PO allocations is future work (blocked
--   on POs carrying work-group allocations).
--
-- ⚠ EVIDENCE (line_check_details): NOT written here. It stays the supervisor's
--   client-authored submit-time snapshot (spec §3 "audit evidence of what was known
--   then") carrying the running-total components via GateResult.overage. The office
--   ApprovalsScreen panel RECOMPUTES the numbers live from v_material_envelope_status
--   + the request's own lines and never trusts the stored value as current numbers.
--   The enforcement signal (line_flag) IS server-computed by the functions below.
--
-- TS TWINS (change in lockstep):
--   compute_tier1_workgroup_flag ↔ workflows/gates/gate1.ts computeWorkGroupGate1Flag
--   compute_tier2_flag           ↔ gate1.ts buildProjectEnvelopeOverageResult
--                                   (+ PermintaanScreen buildTier2Result)
--   compute_tier3_flag           ↔ tools/budgetGate.ts evaluateTier3Budget +
--                                   evaluateTier3BudgetSoft (the WARNING cap)
--   band mapping                 ↔ tools/requestOverage.ts overageBand
--
-- "other open requests" (binding controller definition, base units):
--   material request lines whose header overall_status IN
--   ('PENDING','UNDER_REVIEW','AUTO_HOLD','APPROVED') — equivalently NOT REJECTED,
--   since those are the only five statuses (002:214) — AND the line is NOT already
--   fulfilled by a PO (its id absent from purchase_order_lines.request_line_id).
--   The fulfilled-line exclusion avoids the APPROVED-request-plus-its-PO double
--   count the Task 2.3 reviewer flagged; request_line_id exists since 055 but is
--   unpopulated until Task 2.8, so the exclusion is a no-op today and self-improves
--   as admins link POs. The current line self-excludes naturally at BEFORE INSERT
--   (it is not yet in material_request_lines); conservative overcount is ACCEPTED
--   (safer for a heads-up).
--   ⚠ PRE-EXISTING DEFECT (inherited from 033/068, not introduced here): on
--   BEFORE UPDATE OF quantity (Trigger 1, 033:253), the line already exists in
--   material_request_lines with its OLD quantity, and a BEFORE trigger's SELECT
--   still sees that pre-update row — so the line's own OLD quantity is counted
--   a second time inside "other open requests" alongside p_requested_qty (the
--   NEW value). Fixing this needs the functions to accept and exclude the
--   current line's id (a signature change across the TS/SQL twin lockstep
--   above), so it is deferred rather than fixed in this migration.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Tier 1 (work-group). Body from 056:68-150 — request-based burn KEPT; only
--    the >100/>120 bands change (HIGH/CRITICAL → WARNING). Signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Tier 2 (project envelope). Re-derived per Signal-1: projected = di-PO
--    (v_material_envelope_status.total_ordered, PO-based since 068) + other open
--    requests + this request, vs total_planned. Capped at WARNING. Signature
--    unchanged (dispatch_line_flag passes material_id/project_id/quantity).
-- ═══════════════════════════════════════════════════════════════════════
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
  -- this material, excluding lines already fulfilled by a PO. The current line
  -- self-excludes at BEFORE INSERT (not yet in the table).
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
      WHERE pol.request_line_id IS NOT NULL
    );

  v_burn_pct := ((COALESCE(v_po_ordered, 0) + v_other_open + p_requested_qty) / v_total_planned) * 100;

  -- WARNING cap (Task 2.4). Pre-069: > 120 CRITICAL, > 100 HIGH, > 80 WARNING,
  -- > 50 INFO, else OK. Post-069: > 80 WARNING, > 50 INFO, else OK.
  IF v_burn_pct > 80 THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50 THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Tier 3 (Rupiah budget). Body from 048:11-61 — the burn % computation and
--    all can't-evaluate guards are UNCHANGED (they stay byte-matched to
--    tools/budgetGate.ts evaluateTier3Budget). Only the over-budget bands change
--    (> 100 HIGH / > 120 CRITICAL → WARNING). Signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════
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
