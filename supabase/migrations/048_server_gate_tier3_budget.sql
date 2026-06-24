-- 048 — Server gate: Tier-3 budget envelope + Tier-4 passthrough.
-- Brings the server-side enforcement (033) in line with the TS budget gate
-- (tools/budgetGate.ts: evaluateTier3Budget / evaluateTier4Untracked).
-- Idempotent. Apply via Dashboard SQL Editor. Depends on 047 (v_material_budget_status,
-- material_request_lines.actual_unit_price).

-- compute_tier3_flag gains a 4th param (the line's actual unit price override).
-- Adding a parameter requires dropping the old 3-arg signature first
-- (CREATE OR REPLACE cannot change the argument list).
DROP FUNCTION IF EXISTS compute_tier3_flag(UUID, UUID, NUMERIC);
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
  IF p_material_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'WARNING';  -- cannot evaluate budget without material/project
  END IF;

  -- Rupiah budget envelope for this material (mirrors evaluateTier3Budget over
  -- v_material_budget_status). committed_rupiah already excludes the row being
  -- inserted on BEFORE INSERT, same as compute_tier2_flag adds p_requested_qty.
  SELECT benchmark_unit_price, budget_total_rupiah, committed_rupiah
    INTO v_benchmark, v_budget_total, v_committed
  FROM v_material_budget_status
  WHERE project_id = p_project_id AND material_id = p_material_id;
  v_found := FOUND;

  -- No price-book row / no benchmark → cannot evaluate → block (never silent pass).
  IF NOT v_found OR v_benchmark IS NULL THEN
    RETURN 'WARNING';
  END IF;

  -- Planned quantity 0 → no budget total → block.
  IF v_budget_total IS NULL OR v_budget_total <= 0 THEN
    RETURN 'WARNING';
  END IF;

  v_effective := COALESCE(p_actual_unit_price, v_benchmark);
  v_burn_pct := ((COALESCE(v_committed, 0) + p_requested_qty * v_effective) / v_budget_total) * 100;

  IF v_burn_pct > 120 THEN RETURN 'CRITICAL'; END IF;
  IF v_burn_pct > 100 THEN RETURN 'HIGH'; END IF;
  IF v_burn_pct > 80  THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50  THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- Dispatcher: pass the line's actual_unit_price to Tier 3; add a Tier-4 passthrough.
-- The Tier-1 block is copied verbatim from migration 033 (unchanged behavior).
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
      v_alloc_id UUID;
      v_alloc_boq UUID;
      v_alloc_qty NUMERIC;
    BEGIN
      SELECT id, boq_item_id, allocated_quantity
        INTO v_alloc_id, v_alloc_boq, v_alloc_qty
      FROM material_request_line_allocations
      WHERE request_line_id = line_row.id
        AND allocation_basis = 'DIRECT'
      ORDER BY id
      LIMIT 1;

      IF v_alloc_boq IS NULL THEN
        RETURN 'WARNING';  -- placeholder until allocation arrives
      END IF;

      -- Pass v_alloc_id so compute_tier1_flag excludes the current row from
      -- 'already_ordered' (otherwise we'd double-count the line's own request).
      RETURN compute_tier1_flag(v_alloc_boq, v_alloc_qty, v_alloc_id);
    END;
  END IF;
  RETURN 'OK';
END;
$$;
