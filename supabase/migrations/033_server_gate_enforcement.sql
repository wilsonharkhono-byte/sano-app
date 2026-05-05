-- 033_server_gate_enforcement.sql
--
-- Server-side Gate 1 enforcement. Three triggers ensure
-- material_request_lines.line_flag and material_request_headers.overall_flag
-- are always server-computed, regardless of what the client sends.
--
-- See: docs/superpowers/specs/2026-05-04-server-gate-enforcement-design.md
--
-- Tier 1 / Tier 3 dispatch branches are stubbed in this migration; later
-- migrations or edits to this file fill them in.

-- =========================================================================
-- Helper functions: tier-specific flag computers
-- =========================================================================

-- Tier 2: envelope burn check. Mirrors gate1.ts:66-100.
CREATE OR REPLACE FUNCTION compute_tier2_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_planned NUMERIC;
  v_total_ordered NUMERIC;
  v_burn_pct NUMERIC;
BEGIN
  IF p_material_id IS NULL THEN
    RETURN 'OK';
  END IF;

  SELECT total_planned, total_ordered
    INTO v_total_planned, v_total_ordered
  FROM v_material_envelope_status
  WHERE project_id = p_project_id AND material_id = p_material_id;

  -- No envelope built yet (no boq link via ahs).
  IF v_total_planned IS NULL OR v_total_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  v_burn_pct := ((COALESCE(v_total_ordered, 0) + p_requested_qty) / v_total_planned) * 100;

  IF v_burn_pct > 120 THEN RETURN 'CRITICAL'; END IF;
  IF v_burn_pct > 100 THEN RETURN 'HIGH'; END IF;
  IF v_burn_pct > 80  THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50  THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- Tier 1 / Tier 3 stubs — filled in by later tasks in this plan.
CREATE OR REPLACE FUNCTION compute_tier1_flag(
  p_boq_item_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Stub: real implementation in Task 4.
  RETURN 'OK';
END $$;

CREATE OR REPLACE FUNCTION compute_tier3_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Stub: real implementation in Task 3.
  RETURN 'OK';
END $$;

-- =========================================================================
-- Dispatcher: routes a line to the correct tier function.
-- =========================================================================
CREATE OR REPLACE FUNCTION dispatch_line_flag(
  line_row material_request_lines
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id UUID;
BEGIN
  -- Look up parent header's project_id.
  SELECT project_id INTO v_project_id
  FROM material_request_headers
  WHERE id = line_row.request_header_id;

  IF line_row.tier = 2 THEN
    RETURN compute_tier2_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 3 THEN
    RETURN compute_tier3_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 1 THEN
    -- Tier 1 dispatch filled in in Task 4.
    RETURN 'WARNING';
  END IF;
  RETURN 'OK';
END;
$$;

-- =========================================================================
-- Trigger 1: BEFORE INSERT/UPDATE on material_request_lines
-- Overwrites NEW.line_flag with server-computed value.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_line_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.line_flag := dispatch_line_flag(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_request_lines_set_flag_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_set_flag_trg
  BEFORE INSERT OR UPDATE OF tier, quantity, material_id
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag();

-- =========================================================================
-- Trigger 2: AFTER INSERT/UPDATE/DELETE on material_request_lines
-- Re-aggregates header.overall_flag and auto-promotes overall_status.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_header_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_header_id UUID;
  v_worst_flag TEXT;
  v_current_status TEXT;
  v_should_promote BOOLEAN;
BEGIN
  v_header_id := COALESCE(NEW.request_header_id, OLD.request_header_id);

  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE line_flag = 'CRITICAL') > 0 THEN 'CRITICAL'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'HIGH')     > 0 THEN 'HIGH'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'WARNING')  > 0 THEN 'WARNING'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'INFO')     > 0 THEN 'INFO'
      ELSE 'OK'
    END INTO v_worst_flag
  FROM material_request_lines
  WHERE request_header_id = v_header_id;

  SELECT overall_status INTO v_current_status
  FROM material_request_headers
  WHERE id = v_header_id;

  -- Header may already be deleted (cascade from project) — nothing to update.
  IF v_current_status IS NULL THEN
    RETURN NULL;
  END IF;

  v_should_promote :=
    v_worst_flag IN ('CRITICAL', 'HIGH')
    AND v_current_status IN ('PENDING', 'AUTO_HOLD');

  UPDATE material_request_headers
  SET
    overall_flag = v_worst_flag,
    overall_status = CASE
      WHEN v_should_promote THEN 'AUTO_HOLD'
      ELSE overall_status
    END
  WHERE id = v_header_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS material_request_lines_aggregate_header_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_aggregate_header_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_header_flag();

-- Trigger 3 added in Task 4.
