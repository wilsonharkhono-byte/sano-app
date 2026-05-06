-- 033_server_gate_enforcement.sql
--
-- Server-side Gate 1 enforcement. Three triggers guarantee that
-- material_request_lines.line_flag and material_request_headers.overall_flag
-- are always server-truth, regardless of what clients send. Bypasses
-- closed: direct REST inserts, old-app versions, logic divergence between
-- builds.
--
-- Hybrid promotion: CRITICAL/HIGH flag auto-promotes overall_status to
-- AUTO_HOLD ONLY when status ∈ {PENDING, AUTO_HOLD}. Reviewer decisions
-- (APPROVED, REJECTED, UNDER_REVIEW) are sticky.
--
-- Deployment:
--   1. Apply this migration to production via Supabase SQL editor (matches
--      the PR #5 deployment pattern). Migration is idempotent — safe to
--      re-apply.
--   2. No app rebuild required. App writes/reads continue unchanged; the
--      stored values are now server-computed.
--   3. Verification post-apply: the integration test suite at
--      tools/__tests__/serverGateEnforcement.test.ts must pass against
--      the deployment target (run with `--runInBand` for stable network
--      timing). A manual curl-based smoke is also recommended.
--
-- Spec: docs/superpowers/specs/2026-05-04-server-gate-enforcement-design.md
-- Plan: docs/superpowers/plans/2026-05-04-server-gate-enforcement.md
--
-- Stay in sync with workflows/gates/gate1.ts (Tier 1/2 thresholds) and
-- tools/envelopes.ts (Tier 3 cap). Future rule changes update both.

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
SET search_path = public
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

-- Tier 1: BoQ direct check. Mirrors gate1.ts:128-138.
--
-- p_excluded_allocation_id: when called from Trigger 3 (AFTER allocation
-- insert/update/delete), the current allocation is already visible in
-- material_request_line_allocations. Pass its id so we don't double-count
-- the line's own request when computing 'already_ordered'. Pass NULL when
-- called from a context where the allocation doesn't yet exist (e.g.,
-- BEFORE INSERT on lines, where the line is being inserted before its
-- allocations land).
--
-- Drop the old 2-parameter signature first; CREATE OR REPLACE alone cannot
-- add a new parameter to an existing function, even with a default.
DROP FUNCTION IF EXISTS compute_tier1_flag(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION compute_tier1_flag(
  p_boq_item_id UUID,
  p_requested_qty NUMERIC,
  p_excluded_allocation_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_planned NUMERIC;
  v_installed NUMERIC;
  v_already_ordered NUMERIC;
  v_remaining NUMERIC;
  v_ratio NUMERIC;
BEGIN
  IF p_boq_item_id IS NULL THEN
    RETURN 'WARNING';
  END IF;

  SELECT planned, installed INTO v_planned, v_installed
  FROM boq_items
  WHERE id = p_boq_item_id;

  IF v_planned IS NULL THEN
    RETURN 'WARNING';
  END IF;

  -- Already-ordered = approved/pending DIRECT allocations against this BoQ,
  -- EXCLUDING the current allocation (if it's already in the table).
  SELECT COALESCE(SUM(a.allocated_quantity), 0)
    INTO v_already_ordered
  FROM material_request_line_allocations a
  JOIN material_request_lines l    ON l.id = a.request_line_id
  JOIN material_request_headers h  ON h.id = l.request_header_id
  WHERE a.boq_item_id = p_boq_item_id
    AND a.allocation_basis = 'DIRECT'
    AND h.overall_status NOT IN ('REJECTED')
    AND (p_excluded_allocation_id IS NULL OR a.id <> p_excluded_allocation_id);

  v_remaining := v_planned - COALESCE(v_installed, 0) - v_already_ordered;

  -- Guard against div-by-zero / negative remaining.
  IF v_remaining <= 0 THEN
    -- All remaining used up; any new request is over-budget.
    RETURN 'CRITICAL';
  END IF;

  v_ratio := p_requested_qty / v_remaining;
  IF v_ratio > 1.3  THEN RETURN 'CRITICAL'; END IF;
  IF v_ratio > 1.15 THEN RETURN 'HIGH';     END IF;
  IF v_ratio > 1.05 THEN RETURN 'WARNING';  END IF;
  IF v_ratio > 0.5  THEN RETURN 'INFO';     END IF;
  RETURN 'OK';
END;
$$;

CREATE OR REPLACE FUNCTION compute_tier3_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit_price NUMERIC;
  v_estimated_spend NUMERIC;
  TIER3_CAP CONSTANT NUMERIC := 5000000;  -- Rp 5 juta
BEGIN
  IF p_material_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'OK';
  END IF;

  -- Median unit_price across ahs_lines for this material in the current
  -- AHS version. Mirrors summarizeAhsBaselinePrices in tools/gate2.ts.
  -- ahs_lines links directly to ahs_versions (no ahs / ahs_blocks tables).
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY al.unit_price)
    INTO v_unit_price
  FROM ahs_lines al
  JOIN ahs_versions av ON av.id = al.ahs_version_id
  WHERE al.material_id = p_material_id
    AND av.project_id = p_project_id
    AND av.is_current = true
    AND al.unit_price IS NOT NULL
    AND al.unit_price > 0;

  IF v_unit_price IS NULL THEN
    RETURN 'OK';  -- no price reference → can't enforce cap
  END IF;

  v_estimated_spend := p_requested_qty * v_unit_price;
  IF v_estimated_spend > TIER3_CAP THEN
    RETURN 'WARNING';
  END IF;
  RETURN 'OK';
END;
$$;

-- =========================================================================
-- Dispatcher: routes a line to the correct tier function.
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
  -- Look up parent header's project_id.
  SELECT project_id INTO v_project_id
  FROM material_request_headers
  WHERE id = line_row.request_header_id;

  IF line_row.tier = 2 THEN
    RETURN compute_tier2_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 3 THEN
    RETURN compute_tier3_flag(line_row.material_id, v_project_id, line_row.quantity);
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

-- =========================================================================
-- Trigger 1: BEFORE INSERT/UPDATE on material_request_lines
-- Overwrites NEW.line_flag with server-computed value.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_line_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
SET search_path = public
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

-- =========================================================================
-- Trigger 3: AFTER INSERT/UPDATE/DELETE on material_request_line_allocations
-- Recomputes parent line's flag (Tier 1 needs the allocation to know
-- which BoQ to check against). UPDATE on line then fires Trigger 2.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_line_flag_from_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_id UUID;
  v_line material_request_lines%ROWTYPE;
  v_new_flag TEXT;
BEGIN
  v_line_id := COALESCE(NEW.request_line_id, OLD.request_line_id);

  SELECT * INTO v_line FROM material_request_lines WHERE id = v_line_id;
  IF v_line.id IS NULL THEN
    -- Line already deleted (cascade) — nothing to do.
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only Tier 1 lines need recomputation when allocations change — Tier 1's
  -- flag depends on the DIRECT allocation's boq_item_id and allocated_quantity.
  -- Tier 2 / Tier 3 flags depend only on line columns, were already correctly
  -- set by Trigger 1 (BEFORE INSERT), and re-running compute_tier2_flag here
  -- would double-count the line itself (the line is now visible in
  -- v_material_envelope_status.total_ordered, plus we'd add its quantity again).
  IF v_line.tier <> 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_flag := dispatch_line_flag(v_line);
  IF v_line.line_flag IS DISTINCT FROM v_new_flag THEN
    UPDATE material_request_lines
    SET line_flag = v_new_flag
    WHERE id = v_line.id;
    -- That UPDATE fires Trigger 2 (header re-aggregate). It does NOT fire
    -- Trigger 1 because line_flag is excluded from Trigger 1's column filter.
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS material_request_line_allocations_recompute_line_trg
  ON material_request_line_allocations;
CREATE TRIGGER material_request_line_allocations_recompute_line_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_line_allocations
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag_from_allocation();
