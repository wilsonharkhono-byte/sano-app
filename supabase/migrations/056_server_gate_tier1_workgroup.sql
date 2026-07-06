-- 056_server_gate_tier1_workgroup.sql
--
-- Server-side Tier-1 WORK-GROUP enforcement. Closes the gap where the Tier-1
-- gate is inert on the server: PermintaanScreen writes Tier-1 allocations with
-- allocation_basis = 'WORKGROUP_ENVELOPE' (workflows/screens/PermintaanScreen.tsx),
-- but dispatch_line_flag (033/048) only ever inspected 'DIRECT' allocations and
-- returned a 'WARNING' placeholder for everything else. WARNING never promotes
-- to AUTO_HOLD (that needs HIGH/CRITICAL — 033:296-307), so a modified or old
-- client could push a work-group order past its envelope and the server would
-- not hold it. This migration adds compute_tier1_workgroup_flag and rewires the
-- dispatcher's Tier-1 branch to call it whenever no DIRECT allocation exists.
--
-- TS TWIN (lockstep): workflows/gates/gate1.ts
--   - envelopeBurnFlag (gate1.ts:172-191): burn thresholds
--       > 120 CRITICAL, > 100 HIGH, > 80 WARNING, else OK   (NO > 50 INFO tier)
--   - computeWorkGroupGate1Flag (gate1.ts:200-229): missing / zero-planned
--       baseline for the group → soft INFO (never a fake OK, never a false hold).
--   The RPC those functions read is get_workgroup_envelope
--   (041_workgroup_envelope_installed.sql) — this migration reproduces its
--   planned/ordered aggregation server-side so client and server agree.
--
-- DELIBERATE SCOPE DECISION: the TS side ALSO computes progressPaceFlag
-- (gate1.ts:237-246, an "ordered% running ahead of installed%" advisory). It
-- only ever yields INFO/WARNING, which can never trigger AUTO_HOLD (needs
-- HIGH/CRITICAL), so it is a client-only advisory and the server intentionally
-- enforces ONLY the burn check. Nothing is lost: the pace advisory cannot hold
-- a request, so there is nothing for the server to enforce.
--
-- NO NEW TRIGGERS. This plugs into the existing 033 machinery unchanged:
--   Trigger 1 (033:239-256) BEFORE INSERT/UPDATE on material_request_lines →
--     recompute_line_flag → dispatch_line_flag(NEW).
--   Trigger 2 (033:262-318) AFTER INSERT/UPDATE/DELETE on material_request_lines →
--     recompute_header_flag → aggregate overall_flag + AUTO_HOLD promotion.
--   Trigger 3 (033:322-373) AFTER INSERT/UPDATE/DELETE on
--     material_request_line_allocations → recompute_line_flag_from_allocation →
--     re-enters dispatch_line_flag for Tier-1 lines once allocations land.
--
-- INSERT-ORDER TIMING (why each step lands the right flag):
--   1. Line INSERT (no allocations yet). Trigger 1 → dispatch_line_flag → Tier-1
--      branch → no DIRECT alloc → compute_tier1_workgroup_flag finds no
--      WORKGROUP_ENVELOPE allocations for the line → returns 'WARNING'
--      placeholder. line_flag = WARNING.
--   2. Trigger 2 aggregates: overall_flag = WARNING; WARNING does not promote,
--      status stays PENDING.
--   3. WORKGROUP_ENVELOPE allocations INSERT. Trigger 3 (Tier-1 only) re-enters
--      dispatch_line_flag; now the line's allocations ARE visible, so
--      compute_tier1_workgroup_flag reads the group's BoQ ids, sums the latest
--      master's planned_quantity, sums already-ordered (EXCLUDING this line —
--      the row being written must not double-count its own request), and applies
--      the burn thresholds. line_flag becomes OK/WARNING/HIGH/CRITICAL.
--   4. That line UPDATE fires Trigger 2 again → header re-aggregates; a
--      HIGH/CRITICAL flag promotes overall_status to AUTO_HOLD (when PENDING/
--      AUTO_HOLD). Reviewer statuses (APPROVED/REJECTED/UNDER_REVIEW) stay sticky.
--
-- DEPENDENCIES (must be applied first): 033 (trigger machinery + compute_tier1_flag),
--   041 (get_workgroup_envelope + the latest-master scoping copied below),
--   047 (material_request_lines.actual_unit_price, used by the Tier-3 branch),
--   048 (compute_tier3_flag 4-arg signature + Tier-4 passthrough), 049 (retrigger
--   on actual_unit_price). Apply order in the Dashboard SQL Editor: 053 → 054 →
--   055 → 056. Apply 056 BEFORE deploying the matching app build.
--
-- Idempotent: CREATE OR REPLACE only; safe to re-run. Apply via Dashboard SQL Editor.

-- =========================================================================
-- Tier 1 (work-group): envelope burn over the group's planned material.
-- Mirrors envelopeBurnFlag + computeWorkGroupGate1Flag (workflows/gates/gate1.ts).
-- =========================================================================
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

  -- No allocations yet — the line is inserted before its allocations land
  -- (BEFORE-INSERT Trigger 1). Return the placeholder; Trigger 3 re-enters
  -- dispatch_line_flag after the allocations INSERT and recomputes for real.
  IF v_boq_ids IS NULL OR array_length(v_boq_ids, 1) IS NULL THEN
    RETURN 'WARNING';  -- placeholder until allocations arrive
  END IF;

  -- Group planned demand for THIS material, scoped to the latest master.
  -- Scoping expression copied verbatim from get_workgroup_envelope
  -- (041_workgroup_envelope_installed.sql:38-45) so this server flag reads the
  -- same baseline the TS gate reads through that RPC.
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
  -- computeWorkGroupGate1Flag (gate1.ts:209-215): never a fake OK, never a
  -- false hold — the estimator reviews it manually.
  IF v_planned IS NULL OR v_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  -- Already-ordered against this group's BoQ rows for this material, EXCLUDING
  -- the line being written. On BEFORE-INSERT/UPDATE recompute (and on the
  -- Trigger-3 allocation-insert recompute) the current line's own allocations
  -- are already visible, so we exclude them by p_request_line_id and add
  -- p_requested_qty below — otherwise the line double-counts its own request.
  -- Same self-exclusion convention as compute_tier1_flag's excluded-allocation
  -- id at 048:103-105.
  SELECT COALESCE(SUM(a.allocated_quantity), 0)
    INTO v_ordered
  FROM material_request_line_allocations a
  JOIN material_request_lines   l ON l.id = a.request_line_id
  JOIN material_request_headers h ON h.id = l.request_header_id
  WHERE l.material_id = p_material_id
    AND a.boq_item_id = ANY(v_boq_ids)
    AND h.overall_status NOT IN ('REJECTED')
    AND a.request_line_id <> p_request_line_id;

  -- Envelope burn. Thresholds EXACTLY lockstep with envelopeBurnFlag
  -- (gate1.ts:183-190): > 120 CRITICAL, > 100 HIGH, > 80 WARNING, else OK.
  -- There is deliberately NO > 50 INFO tier here — that INFO tier belongs to
  -- Tier-2's compute_tier2_flag (033:68), not to the work-group gate.
  v_burn := ((v_ordered + p_requested_qty) / v_planned) * 100;

  IF v_burn > 120 THEN RETURN 'CRITICAL'; END IF;
  IF v_burn > 100 THEN RETURN 'HIGH';     END IF;
  IF v_burn > 80  THEN RETURN 'WARNING';  END IF;
  RETURN 'OK';
END;
$$;

-- =========================================================================
-- Dispatcher: FULL self-contained body superseding 048's. Tier 2 / 3 / 4
-- branches are copied UNCHANGED from 048 so this migration stands alone; only
-- the Tier-1 branch changes — it now falls through to the work-group flag when
-- there is no DIRECT allocation.
-- =========================================================================
CREATE OR REPLACE FUNCTION dispatch_line_flag(
  line_row material_request_lines
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id
  FROM material_request_headers
  WHERE id = line_row.request_header_id;

  IF line_row.tier = 2 THEN
    RETURN compute_tier2_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 3 THEN
    RETURN compute_tier3_flag(line_row.material_id, v_project_id, line_row.quantity, line_row.actual_unit_price);
  ELSIF line_row.tier = 4 THEN
    RETURN 'OK';  -- untracked consumable (mirrors evaluateTier4Untracked)
  ELSIF line_row.tier = 1 THEN
    DECLARE
      v_alloc_id  UUID;
      v_alloc_boq UUID;
      v_alloc_qty NUMERIC;
    BEGIN
      -- Legacy DIRECT path (single-BoQ Tier-1 order) — unchanged from 033/048.
      SELECT id, boq_item_id, allocated_quantity
        INTO v_alloc_id, v_alloc_boq, v_alloc_qty
      FROM material_request_line_allocations
      WHERE request_line_id = line_row.id
        AND allocation_basis = 'DIRECT'
      ORDER BY id
      LIMIT 1;

      IF v_alloc_boq IS NOT NULL THEN
        -- Pass v_alloc_id so compute_tier1_flag excludes the current row from
        -- 'already_ordered' (otherwise we'd double-count the line's own request).
        RETURN compute_tier1_flag(v_alloc_boq, v_alloc_qty, v_alloc_id);
      END IF;

      -- No DIRECT allocation → work-group order (PermintaanScreen writes
      -- WORKGROUP_ENVELOPE allocations). compute_tier1_workgroup_flag returns
      -- the 'WARNING' placeholder itself when no allocations exist yet, so the
      -- placeholder → real-flag transition is driven by Trigger 3.
      RETURN compute_tier1_workgroup_flag(
        line_row.id, line_row.material_id, v_project_id, line_row.quantity
      );
    END;
  END IF;
  RETURN 'OK';
END;
$$;
