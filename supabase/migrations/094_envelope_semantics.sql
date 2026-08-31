-- 094 — Envelope semantics: one meaning per column name
--
-- Paste order: AFTER 093 (latest written migration). Apply via the Dashboard SQL
--   Editor (remote migration history diverged, `supabase db push` is broken —
--   see project memory "Migration history divergence"). Idempotent /
--   re-paste-safe throughout: CREATE OR REPLACE VIEW, CREATE OR REPLACE
--   FUNCTION, DROP FUNCTION IF EXISTS + CREATE, GRANTs re-issued.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE INCIDENT (2026-08-31)
-- ═══════════════════════════════════════════════════════════════════════════
-- On SBY-001, Besi D8, the same material read ~9x apart depending on which role
-- was looking:
--
--   • The estimator's approval panel (MaterialUsagePanel, "Sisa untuk di-PO")
--     shows v_material_envelope_status.remaining_to_order = planned − ORDERED.
--     Requests already sitting in the approval queue are NOT subtracted, so the
--     estimator sees head-room that is already spoken for and approves against
--     it. Approve enough of those and the plan is blown before a single PO is
--     cut — the number was never lying about what it computed, it was answering
--     a question ("how much may still be turned into a PO, ignoring demand in
--     flight") nobody was asking.
--
--   • The supervisor's request gate (compute_tier2_flag, 088:1021-1027) and the
--     BoQ-first work-group screens (get_workgroup_material_envelopes, 086) both
--     burn on ordered + open-requests, so they saw the material as nearly spent.
--
-- Two further defects fed the divergence, both fixed here:
--
--   1. v_material_envelope_status.total_requested (072:411-419) has NO
--      fulfilled-line exclusion, unlike compute_tier2_flag (088:1021-1027) and
--      get_workgroup_material_envelopes (086:100-107). It sums every non-rejected
--      request line, including lines an admin has ALREADY turned into a PO. That
--      is a no-op only while purchase_order_lines.request_line_id is unpopulated;
--      the moment those links start being written, one fulfilled request counts
--      TWICE — once as a request and once as the PO — and every surface reading
--      total_requested over-states demand. Fixed in §1.
--
--   2. get_workgroup_envelope (live body 061:229-299) is semantically rotten: the
--      column it calls `total_ordered` actually holds REQUEST allocations
--      (061:269-278) and its `remaining_to_order` is planned − REQUESTS
--      (061:285) — the SAME column names as the project view carrying the
--      OPPOSITE meaning. Any reader who trusts the name is wrong at one grain or
--      the other. Rebuilt honestly in §3.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION CHANGES
-- ═══════════════════════════════════════════════════════════════════════════
--   §1 v_material_envelope_status
--        (a) total_requested gains the fulfilled-line exclusion (the 088 /
--            086 / 069 definition — a line linked to a NON-CANCELLED PO is
--            already counted as ordered).
--        (b) NEW APPENDED column remaining_free =
--              GREATEST(0, total_planned − total_ordered − total_requested)
--            — the honest "what is still unspoken-for" figure the estimator
--            panel needs. remaining_to_order keeps its meaning and its raw,
--            possibly-negative value (see the DELIBERATELY-NOT-CHANGED note).
--   §2 get_workgroup_material_envelopes (086) gains the is_asset filter that
--      084 added to v_material_envelopes and 086 never inherited.
--   §3 get_workgroup_envelope rebuilt: ordered/requested SPLIT, honest
--      remaining_to_order, new remaining_free, latest-master `id DESC`
--      tiebreaker, is_asset filter. total_installed / material_name / unit /
--      boq_item_count keep their exact meaning.
--   §4 Documents one KNOWN-DEFERRED defect (069:73-80). Not fixed here.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DELIBERATELY NOT CHANGED — remaining_to_order stays raw (can go negative)
-- ═══════════════════════════════════════════════════════════════════════════
-- The obvious-looking fix is GREATEST(0, planned − ordered). It is NOT applied.
-- The column is not vague, it is the HARD-GATE headroom, and the sign carries
-- information:
--
--   • tools/envelopeMath.ts is the canonical TS home of the two "sisa"
--     meanings. Its remainingToOrder() is planned − ordered and documents "May
--     be NEGATIVE when a material is already over-ordered … Negative is
--     information — it is returned as-is". Its remainingFree() is the floored
--     max(0, planned − ordered − requested) twin. Flooring the VIEW column would
--     make the server disagree with the module every screen now reads.
--   • The server gates compute the same unfloored difference themselves:
--     071_po_quantity_gate.sql:197,206 (create_purchase_order) and 088:671
--     (guard_po_line_quantity_gate).
--   • tools/poQuantityGate.ts is their pure TS twin; its MaterialBreach
--     .remaining is explicitly "can be negative if already over-ordered", and a
--     floored input would silently stop it detecting an existing over-order.
--
-- So: remaining_to_order = planned − ordered, RAW (unchanged formula, unchanged
-- sign behavior) — the answer to "how much may still become a PO", where a PO
-- FULFILS a request and subtracting requests too would double-block the very
-- order the request asked for. The uncommitted figure is the NEW remaining_free
-- column: no existing consumer reads it, so it is free to be clamped at 0, and
-- it is the exact server-side twin of envelopeMath.remainingFree().
--
-- ⚠ Column ORDER (the rule 068:37-40 states): CREATE OR REPLACE VIEW requires
--   every existing column to keep its name, type AND position, and consumers may
--   read positionally. remaining_free is APPENDED after total_requested — the
--   only safe shape change.
--
-- ⚠ security_invoker (MANDATORY, the trap 068/072 both call out): 061 flipped
--   this view to security_invoker. CREATE OR REPLACE VIEW *resets reloptions*,
--   so the flag MUST be restated below or the cross-tenant leak 061 closed
--   silently reopens.

-- ═══════════════════════════════════════════════════════════════════════════
-- §1. v_material_envelope_status
--     Body copied VERBATIM from 072:361-431 (the live definition). Exactly two
--     changes, both marked ★ below: the fulfilled-line exclusion on the
--     `requested` lateral, and the appended remaining_free column.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_material_envelope_status
WITH (security_invoker = on) AS
SELECT
  env.material_id,
  env.project_id,
  env.material_code,
  env.material_name,
  env.tier,
  env.unit,
  env.total_planned,
  env.boq_item_count,
  COALESCE(ordered.total_ordered, 0) AS total_ordered,
  COALESCE(received.total_received, 0) AS total_received,
  -- UNCHANGED formula (see DELIBERATELY NOT CHANGED above): planned − ordered,
  -- raw. Negative = already over-ordered, and MaterialUsagePanel shows it.
  env.total_planned - COALESCE(ordered.total_ordered, 0) AS remaining_to_order,
  CASE
    WHEN env.total_planned > 0
    THEN ROUND((COALESCE(ordered.total_ordered, 0) / env.total_planned) * 100, 1)
    ELSE 0
  END AS burn_pct,
  COALESCE(requested.total_requested, 0) AS total_requested,
  -- ★ APPENDED (094): what is genuinely still unspoken-for — plan minus what is
  --   on a live PO minus what is in flight as an unfulfilled request. Clamped at
  --   0: "free" head-room is never negative, and unlike remaining_to_order this
  --   column has no consumer that uses the negative as an over-order signal.
  --   This is the figure an approver should be shown.
  GREATEST(
    0,
    env.total_planned
      - COALESCE(ordered.total_ordered, 0)
      - COALESCE(requested.total_requested, 0)
  ) AS remaining_free
FROM v_material_envelopes env
LEFT JOIN LATERAL (
  -- ORDERED = SANO purchase order lines. CANCELLED POs excluded. For a
  -- CLOSED_SHORT PO the line's ordered contribution is capped at what THAT LINE
  -- actually received (per-line, Task 2.7 — was per-PO in 068), so a short-closed
  -- order stops inflating the total the moment it is short-closed.
  -- COPIED VERBATIM FROM 072 — do not edit without re-reading 072's header.
  SELECT SUM(
    CASE
      WHEN po.status = 'CLOSED_SHORT' THEN
        LEAST(
          pol.quantity,
          COALESCE((
            SELECT SUM(rl2.quantity_actual)
            FROM receipt_lines rl2
            JOIN receipts r2 ON r2.id = rl2.receipt_id
            WHERE r2.po_id = po.id
              AND (
                rl2.po_line_id = pol.id
                OR (rl2.po_line_id IS NULL AND rl2.material_id = pol.material_id)
              )
          ), 0)
        )
      ELSE pol.quantity
    END
  ) AS total_ordered
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.po_id
  WHERE po.project_id = env.project_id
    AND pol.material_id = env.material_id
    AND po.status <> 'CANCELLED'
) ordered ON true
LEFT JOIN LATERAL (
  -- REQUESTED = non-REJECTED material request lines that are NOT already
  -- fulfilled by a live PO.
  --
  -- ★ CHANGED (094): the NOT IN (...) exclusion below is new. 072:411-419 summed
  --   every non-rejected line, so an APPROVED request that an admin has already
  --   turned into a PO was counted BOTH here and in `ordered` above — the
  --   double count the Task 2.3 reviewer flagged and 069's header defines away.
  --   The exclusion is byte-for-byte the one compute_tier2_flag uses
  --   (088:1021-1027) and the same predicate get_workgroup_material_envelopes
  --   uses (086:100-107), so the project view, the server gate and the
  --   work-group RPCs now share ONE definition of "open request".
  --
  --   A line linked to a LATER-CANCELLED PO is NOT fulfilled and returns to the
  --   burn (073 Task 2.9). CLOSED_SHORT stays excluded (genuinely ordered).
  --
  --   ⚠ This is a no-op on data where purchase_order_lines.request_line_id is
  --   still NULL, and self-corrects as admins link POs — the same
  --   self-improving property 069/086 document. It is NOT cosmetic: the moment
  --   those links are written, the un-excluded version double-counts.
  --
  --   ⚠ This exclusion is ALSO what makes total_requested usable as the
  --   `requested` leg of tools/envelopeMath.ts EnvelopeLegs. That module's
  --   header states the contract — "`requested` must be the OUTSTANDING request
  --   demand … v_material_envelope_status.total_requested is NOT that number"
  --   — and warns that remainingFree / burnPct('committed') therefore read
  --   PESSIMISTICALLY off the raw column. After this change the column IS that
  --   number wherever request→PO links exist, so those helpers become exact.
  --   That note in envelopeMath.ts should be revisited (not silently deleted)
  --   once link coverage is confirmed on live data.
  SELECT SUM(mrl.quantity) AS total_requested
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = env.project_id
    AND mrl.material_id = env.material_id
    AND mrh.overall_status NOT IN ('REJECTED')
    AND mrl.id NOT IN (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id IS NOT NULL
        AND po.status <> 'CANCELLED'
    )
) requested ON true
LEFT JOIN LATERAL (
  -- RECEIVED — copied verbatim from 072/068/055 (id link preferred, name fallback).
  SELECT SUM(rl.quantity_actual) AS total_received
  FROM receipt_lines rl
  JOIN receipts r ON r.id = rl.receipt_id
  JOIN material_catalog mc2 ON mc2.id = env.material_id
  WHERE r.project_id = env.project_id
    AND (
      rl.material_id = env.material_id
      OR (rl.material_id IS NULL AND rl.material_name = mc2.name)
    )
) received ON true;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2. get_workgroup_material_envelopes — inherit 084's is_asset routing.
--
--     084 §6(a) put `mc.is_asset IS DISTINCT FROM true` on v_material_envelopes,
--     THE chokepoint for the project-grain envelope / budget / PO-gate surfaces.
--     086 (written later) reads project_material_master_lines DIRECTLY and never
--     passes through that view, so scaffolding and other company-owned equipment
--     can still surface as orderable demand on the BoQ-first work-group screens.
--     Latent today only because no asset has landed in a published master yet —
--     it is a live hole the moment one does (project memory "Equipment asset
--     pool": is_asset must be routed out of ALL consumable surfaces).
--
--     Same signature and same RETURNS TABLE as 086, so CREATE OR REPLACE works
--     and no caller (tools/envelopes.ts getWorkGroupMaterialEnvelopes,
--     PermintaanScreen) needs to change. Body is 086:64-124 verbatim except the
--     ★ filter on the final SELECT.
--
--     Filter form: NOT EXISTS(asset), not a JOIN to material_catalog. Logically
--     identical to `is_asset IS DISTINCT FROM true` for every material that HAS
--     a catalog row (all of them, by FK), and strictly safer than an inner join
--     if one ever does not — an unjoinable material would silently vanish from
--     the demand list under a JOIN, and silent omission is the failure mode this
--     repo refuses (CLAUDE.md §1.1).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_workgroup_material_envelopes(
  p_project_id UUID,
  p_boq_item_ids UUID[]
)
RETURNS TABLE (
  material_id UUID,
  planned NUMERIC,
  ordered NUMERIC,
  requested NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  WITH planned_rows AS (
    SELECT
      pmml.material_id            AS mat_id,
      SUM(pmml.planned_quantity)  AS qty
    FROM project_material_master_lines pmml
    WHERE pmml.master_id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
      AND pmml.boq_item_id = ANY(p_boq_item_ids)
      AND pmml.material_id IS NOT NULL
    GROUP BY pmml.material_id
  ),
  allocation_rows AS (
    -- Every non-rejected allocation on the group's rows, split by whether its
    -- request line is already fulfilled by a live PO. The two FILTERed sums add
    -- back up to the group's total non-rejected demand.
    SELECT
      l.material_id AS mat_id,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NOT NULL), 0) AS ordered_qty,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NULL), 0)     AS requested_qty
    FROM material_request_line_allocations a
    JOIN material_request_lines   l ON l.id = a.request_line_id
    JOIN material_request_headers h ON h.id = l.request_header_id
    LEFT JOIN LATERAL (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id = l.id
        AND po.status <> 'CANCELLED'
      LIMIT 1
    ) po_link ON true
    WHERE h.project_id = p_project_id
      AND l.material_id IS NOT NULL
      AND a.boq_item_id = ANY(p_boq_item_ids)
      AND h.overall_status NOT IN ('REJECTED')
    GROUP BY l.material_id
  )
  -- FULL OUTER JOIN, not an inner join: a material ordered beyond (or outside)
  -- the current plan must still surface with planned = 0 rather than vanish.
  SELECT
    COALESCE(p.mat_id, x.mat_id)  AS material_id,
    COALESCE(p.qty, 0)            AS planned,
    COALESCE(x.ordered_qty, 0)    AS ordered,
    COALESCE(x.requested_qty, 0)  AS requested
  FROM planned_rows p
  FULL OUTER JOIN allocation_rows x ON x.mat_id = p.mat_id
  -- ★ 094: route company-owned assets out (084 §6(a) parity).
  WHERE NOT EXISTS (
    SELECT 1 FROM material_catalog mc
    WHERE mc.id = COALESCE(p.mat_id, x.mat_id)
      AND mc.is_asset IS TRUE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes(UUID, UUID[])
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- §3. get_workgroup_envelope — rebuilt honestly.
--
--     The return SHAPE changes (ordered/requested split + remaining_free), so
--     CREATE OR REPLACE is impossible: a RETURNS TABLE column list is part of
--     the function's result type. DROP + CREATE.
--
--     WHY THIS IS SAFE IN EITHER DEPLOY ORDER (the coupling question):
--       The RPC has exactly ONE production caller — tools/envelopes.ts
--       getWorkGroupEnvelope (verified by grep across *.ts/*.tsx: the only other
--       hits are two service-role trial tests, publishBreakdownTrial.test.ts:96
--       and materialLinkTrial.test.ts:124, both of which read only total_planned
--       / material_name / boq_item_count).
--
--       That caller has been re-pointed in the SAME change: it now takes the
--       planned / ordered / requested legs from get_workgroup_material_envelopes
--       (§2 — already live, already split, already honest) and reads from THIS
--       function ONLY the four columns whose meaning is IDENTICAL before and
--       after this migration: material_name, unit, total_installed,
--       boq_item_count. It never reads total_ordered / remaining_to_order /
--       burn_pct from here again.
--
--       Consequently neither deploy order can mix rotten data with fresh code:
--       paste-then-deploy and deploy-then-paste both work, because the only
--       columns crossing the boundary are the ones this migration does not
--       touch. The rebuild below is DB hygiene — it stops the next reader from
--       being lied to by a column name.
--
--     CHANGES vs the live 061:229-299 body:
--       1. ★ total_ordered now means PO-ordered (allocations whose request line
--          is linked to a non-CANCELLED PO), matching the project view and 086.
--       2. ★ total_requested (NEW) carries the rest — non-rejected allocations
--          not yet on a live PO. ordered + requested = the OLD total_ordered
--          exactly, so no burn number moves; only the name-to-meaning mapping
--          is repaired.
--       3. ★ remaining_to_order = planned − ordered (was planned − REQUESTS at
--          061:285). Raw, may go negative — same convention as the project view.
--       4. ★ remaining_free (NEW) = GREATEST(0, planned − ordered − requested).
--       5. ★ burn_pct keeps its numeric meaning — (ordered + requested) / planned
--          — i.e. total non-rejected demand, exactly what 061 computed. It is
--          NOT re-pointed to the PO leg alone: that would silently HALVE a live
--          gate input while looking like a rename.
--       6. ★ latest-master subquery gains the `id DESC` tiebreaker (054:55-60,
--          carried by 086) so "latest" is a single deterministic row when two
--          project_material_master headers share a created_at second. 086 named
--          this as the row to fix; this is that fix.
--       7. ★ is_asset filter (084 §6(a) parity), same NOT EXISTS form as §2.
--       8. UNCHANGED: material_name, unit, total_installed (same formula),
--          boq_item_count, the assert_project_access guard, SECURITY INVOKER,
--          STABLE.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_workgroup_envelope(UUID, UUID, UUID[]);

CREATE FUNCTION get_workgroup_envelope(
  p_project_id UUID,
  p_material_id UUID,
  p_boq_item_ids UUID[]
)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  unit TEXT,
  total_planned NUMERIC,
  total_ordered NUMERIC,
  total_requested NUMERIC,
  total_installed NUMERIC,
  remaining_to_order NUMERIC,
  remaining_free NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  -- Assets are never work-group consumable demand (084 §6(a) parity). Return
  -- NOTHING rather than a zero row: a zero row would read as "planned 0" and
  -- the client would render a soft "no baseline" heads-up for a material that
  -- has no business being on a request at all.
  IF EXISTS (
    SELECT 1 FROM material_catalog mc
    WHERE mc.id = p_material_id AND mc.is_asset IS TRUE
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH planned AS (
    SELECT
      SUM(pmml.planned_quantity)        AS qty,
      SUM(pmml.planned_quantity * CASE WHEN bi.planned > 0
            THEN LEAST(bi.installed / bi.planned, 1) ELSE 0 END) AS installed_qty,
      MAX(pmml.unit)                    AS unit,
      COUNT(DISTINCT pmml.boq_item_id)  AS cnt
    FROM project_material_master_lines pmml
    JOIN boq_items bi ON bi.id = pmml.boq_item_id
    WHERE pmml.master_id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      -- ★ 094: `id DESC` tiebreaker (054:55-60 / 086) — deterministic "latest".
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
      AND pmml.material_id = p_material_id
      AND pmml.boq_item_id = ANY(p_boq_item_ids)
  ),
  -- ★ 094: the single `ordered` CTE of 061:269-278 (which lumped EVERY
  --   non-rejected allocation under the name "ordered") is split on the same
  --   live-PO predicate 086 uses. The LIMIT 1 on the LATERAL is load-bearing:
  --   without it a request line split across two PO lines would fan the
  --   allocation row out and count it twice.
  demand AS (
    SELECT
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NOT NULL), 0) AS ordered_qty,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NULL), 0)     AS requested_qty
    FROM material_request_line_allocations a
    JOIN material_request_lines   l ON l.id = a.request_line_id
    JOIN material_request_headers h ON h.id = l.request_header_id
    LEFT JOIN LATERAL (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id = l.id
        AND po.status <> 'CANCELLED'
      LIMIT 1
    ) po_link ON true
    WHERE h.project_id = p_project_id
      AND l.material_id = p_material_id
      AND a.boq_item_id = ANY(p_boq_item_ids)
      AND h.overall_status NOT IN ('REJECTED')
  )
  SELECT
    p_material_id                                            AS material_id,
    mc.name                                                  AS material_name,
    COALESCE(planned.unit, mc.unit)                          AS unit,
    COALESCE(planned.qty, 0)                                 AS total_planned,
    COALESCE(demand.ordered_qty, 0)                          AS total_ordered,
    COALESCE(demand.requested_qty, 0)                        AS total_requested,
    COALESCE(planned.installed_qty, 0)                       AS total_installed,
    COALESCE(planned.qty, 0) - COALESCE(demand.ordered_qty, 0)
                                                             AS remaining_to_order,
    GREATEST(
      0,
      COALESCE(planned.qty, 0)
        - COALESCE(demand.ordered_qty, 0)
        - COALESCE(demand.requested_qty, 0)
    )                                                        AS remaining_free,
    CASE
      WHEN COALESCE(planned.qty, 0) > 0
      THEN ROUND(
        ((COALESCE(demand.ordered_qty, 0) + COALESCE(demand.requested_qty, 0))
          / planned.qty) * 100, 1)
      ELSE 0
    END                                                      AS burn_pct,
    COALESCE(planned.cnt, 0)                                 AS boq_item_count
  FROM planned
  CROSS JOIN demand
  CROSS JOIN material_catalog mc
  WHERE mc.id = p_material_id;
END;
$$;

-- 039/041/061 never issued an explicit GRANT (the function relied on the default
-- PUBLIC EXECUTE that CREATE FUNCTION hands out). Stated explicitly here so a
-- future REVOKE ... FROM PUBLIC hardening pass cannot silently break the app.
GRANT EXECUTE ON FUNCTION get_workgroup_envelope(UUID, UUID, UUID[]) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4. KNOWN-DEFERRED — NOT fixed here (recorded so it is not re-discovered as
--     new, and not silently "fixed" by a partial edit).
--
--     069:73-80 — the OLD-quantity self-count. On BEFORE UPDATE OF quantity
--     (Trigger 1, 033:253) the request line already exists in
--     material_request_lines carrying its OLD quantity, and a BEFORE trigger's
--     SELECT still sees that pre-update row. So compute_tier1_workgroup_flag /
--     compute_tier2_flag count the line's own OLD quantity a second time inside
--     "other open requests", alongside p_requested_qty (the NEW value). The
--     result is a conservative OVER-count on edit — a heads-up that fires
--     slightly early, never a missed one.
--
--     Why deferred and not folded in here: fixing it requires those functions to
--     accept and exclude the current line's id — a SIGNATURE change, which must
--     move in lockstep with their TS twins (tools/requestOverage.ts,
--     workflows/gates/gate1.ts) and with dispatch_line_flag's call sites. That
--     is a separate, larger change; bundling it into a semantics migration would
--     make both harder to review and harder to roll back.
--
--     ⚠ Note the interaction with §1: this migration does NOT change the
--     compute_tier*_flag bodies at all. Their "other open requests" leg already
--     carried the fulfilled-line exclusion (088:1021-1027); §1 brings the VIEW
--     up to their definition, not the other way around.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (part of done — run in the Dashboard SQL Editor after pasting)
--
-- Run each under the AUTHENTICATED role where noted, NEVER only the service role
-- — a service-role pass proves nothing about RLS (the failure that hid the
-- material_aliases gap until migration 040).
--
-- 1. The view still has security_invoker ON (the CREATE OR REPLACE reloptions
--    trap). EXPECTED: one row, reloptions containing security_invoker=true.
--
--      SELECT c.relname, c.reloptions
--      FROM pg_class c
--      WHERE c.relname = 'v_material_envelope_status';
--
-- 2. Column order is unchanged and remaining_free is LAST.
--    EXPECTED: remaining_free at the highest attnum; every other column at the
--    position it held before.
--
--      SELECT ordinal_position, column_name
--      FROM information_schema.columns
--      WHERE table_name = 'v_material_envelope_status'
--      ORDER BY ordinal_position;
--
-- 3. The fulfilled-line exclusion actually bites. Pick a project where at least
--    one request line is linked to a live PO:
--
--      SELECT count(*) AS linked_lines
--      FROM purchase_order_lines pol
--      JOIN purchase_orders po ON po.id = pol.po_id
--      WHERE pol.request_line_id IS NOT NULL AND po.status <> 'CANCELLED';
--
--    ⚠ If this is 0, test 4 passes VACUOUSLY — the exclusion cannot change any
--    number yet. Require > 0 before reading test 4 as evidence of anything.
--
-- 4. The view and the server gate now agree on "open requests". For a project
--    with linked lines, this must return ZERO rows:
--
--      SELECT v.material_id, v.total_requested AS view_open, g.gate_open
--      FROM v_material_envelope_status v
--      JOIN LATERAL (
--        SELECT COALESCE(SUM(mrl.quantity), 0) AS gate_open
--        FROM material_request_lines mrl
--        JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
--        WHERE mrh.project_id = v.project_id
--          AND mrl.material_id = v.material_id
--          AND mrh.overall_status IN
--              ('PENDING','UNDER_REVIEW','AUTO_HOLD','APPROVED','RETURNED')
--          AND mrl.id NOT IN (
--            SELECT pol.request_line_id
--            FROM purchase_order_lines pol
--            JOIN purchase_orders po ON po.id = pol.po_id
--            WHERE pol.request_line_id IS NOT NULL AND po.status <> 'CANCELLED'
--          )
--      ) g ON true
--      WHERE v.project_id = '<PROJECT_UUID>'::uuid
--        AND ROUND(v.total_requested, 6) IS DISTINCT FROM ROUND(g.gate_open, 6);
--
--    (The status lists differ only in wording: NOT IN ('REJECTED') vs the five
--    positive statuses — 002:214 plus 088's RETURNED make those the same set.
--    A row here means they have genuinely drifted apart.)
--
-- 5. remaining_free is never negative and never exceeds remaining_to_order.
--    EXPECTED: ZERO rows.
--
--      SELECT material_id, total_planned, total_ordered, total_requested,
--             remaining_to_order, remaining_free
--      FROM v_material_envelope_status
--      WHERE remaining_free < 0
--         OR remaining_free > GREATEST(remaining_to_order, 0) + 1e-9;
--
-- 6. §3's split preserves the old total. For one project + one work group, the
--    rebuilt RPC's ordered + requested must equal what 086 reports for the same
--    material, and its planned must match. EXPECTED: ZERO rows.
--
--    ⚠ PRECONDITION (the 086 trap, restated): confirm the scope is non-empty
--    first, or a 0-row result is vacuous. On a pre-064 project, boq_items.chapter
--    is NULL and the equality filter matches nothing.
--
--      WITH ids AS (
--        SELECT ARRAY(
--          SELECT id FROM boq_items
--          WHERE project_id = '<PROJECT_UUID>'::uuid
--            AND superseded_at IS NULL
--            AND chapter = '<CHAPTER OF ONE WORK GROUP>'
--        ) AS boq_ids
--      )
--      SELECT count(*) FROM ids,
--        LATERAL get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, ids.boq_ids) m;
--      -- REQUIRE > 0 before trusting the query below.
--
--      WITH ids AS (
--        SELECT ARRAY(
--          SELECT id FROM boq_items
--          WHERE project_id = '<PROJECT_UUID>'::uuid
--            AND superseded_at IS NULL
--            AND chapter = '<CHAPTER OF ONE WORK GROUP>'
--        ) AS boq_ids
--      ),
--      many AS (
--        SELECT m.* FROM ids,
--          LATERAL get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, ids.boq_ids) m
--      ),
--      one AS (
--        SELECT many.material_id, w.total_planned, w.total_ordered, w.total_requested
--        FROM many, ids,
--          LATERAL get_workgroup_envelope('<PROJECT_UUID>'::uuid, many.material_id, ids.boq_ids) w
--      )
--      SELECT many.material_id, many.planned, one.total_planned,
--             many.ordered, one.total_ordered, many.requested, one.total_requested
--      FROM many JOIN one ON one.material_id = many.material_id
--      WHERE ROUND(many.planned, 6)   IS DISTINCT FROM ROUND(one.total_planned, 6)
--         OR ROUND(many.ordered, 6)   IS DISTINCT FROM ROUND(one.total_ordered, 6)
--         OR ROUND(many.requested, 6) IS DISTINCT FROM ROUND(one.total_requested, 6);
--
-- 7. Assets are routed out of BOTH work-group RPCs. With <ASSET_MATERIAL_UUID>
--    an is_asset catalog row that appears in a published master:
--    EXPECTED: no row from either call.
--
--      SELECT * FROM get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, '{<BOQ_UUIDS>}'::uuid[])
--      WHERE material_id = '<ASSET_MATERIAL_UUID>'::uuid;
--
--      SELECT * FROM get_workgroup_envelope(
--        '<PROJECT_UUID>'::uuid, '<ASSET_MATERIAL_UUID>'::uuid, '{<BOQ_UUIDS>}'::uuid[]);
--
-- 8. Under the AUTHENTICATED role, a user NOT assigned to the project still gets
--    an exception (not an empty set) from both RPCs — assert_project_access is
--    intact after the DROP/CREATE in §3.
-- ═══════════════════════════════════════════════════════════════════════════
