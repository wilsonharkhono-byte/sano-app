-- Migration 019: Per-Worker Overtime Rules
--
-- Introduces `worker_overtime_rules` table to allow per-worker overtime rate
-- configuration instead of a single contract-wide rule.
--
-- Pattern: Same as `worker_rates` (effective_from/effective_to, worker_id + contract_id).
-- Fallback: If a worker has no active rule, contract-level rules apply.
-- Integration: `record_worker_attendance` uses new `get_worker_overtime_rules` function
-- for per-worker lookup with contract fallback.

-- ============================================================================
-- 1. CREATE TABLE: worker_overtime_rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_overtime_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id             UUID NOT NULL REFERENCES mandor_workers(id) ON DELETE CASCADE,
  contract_id           UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  tier1_hourly_rate     NUMERIC NOT NULL CHECK (tier1_hourly_rate >= 0),
  tier2_threshold_hours NUMERIC NOT NULL DEFAULT 10 CHECK (tier2_threshold_hours > 0),
  tier2_hourly_rate     NUMERIC NOT NULL CHECK (tier2_hourly_rate >= 0),
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to          DATE,  -- NULL = currently active
  notes                 TEXT,
  set_by                UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_worker_ot_rules_worker
  ON worker_overtime_rules (worker_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_worker_ot_rules_contract
  ON worker_overtime_rules (contract_id);

COMMENT ON TABLE worker_overtime_rules IS 'Per-worker overtime rate configuration (fallback to contract level if not set)';
COMMENT ON COLUMN worker_overtime_rules.tier2_threshold_hours IS 'Hours at which tier2 rate kicks in (tier1 rate applies 0 to this value)';

-- ============================================================================
-- 2. RLS POLICIES FOR worker_overtime_rules
-- ============================================================================

ALTER TABLE worker_overtime_rules ENABLE ROW LEVEL SECURITY;

-- SELECT: accessible to users on the project via project_assignments
DROP POLICY IF EXISTS "worker_ot_rules_select" ON worker_overtime_rules;
CREATE POLICY "worker_ot_rules_select" ON worker_overtime_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN mandor_contracts mc ON mc.id = mw.contract_id
      JOIN projects p ON p.id = mc.project_id
      JOIN project_assignments pa ON pa.project_id = p.id
      WHERE mw.id = worker_overtime_rules.worker_id
        AND pa.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE: accessible to estimator, admin, principal on the project
DROP POLICY IF EXISTS "worker_ot_rules_write" ON worker_overtime_rules;
CREATE POLICY "worker_ot_rules_write" ON worker_overtime_rules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN mandor_contracts mc ON mc.id = mw.contract_id
      JOIN projects p ON p.id = mc.project_id
      JOIN project_assignments pa ON pa.project_id = p.id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mw.id = worker_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS "worker_ot_rules_update" ON worker_overtime_rules;
CREATE POLICY "worker_ot_rules_update" ON worker_overtime_rules
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN mandor_contracts mc ON mc.id = mw.contract_id
      JOIN projects p ON p.id = mc.project_id
      JOIN project_assignments pa ON pa.project_id = p.id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mw.id = worker_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

-- ============================================================================
-- 3. NEW FUNCTION: get_worker_overtime_rules (worker-first fallback)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_worker_overtime_rules(
  p_worker_id UUID,
  p_contract_id UUID,
  p_date DATE
)
RETURNS TABLE(
  tier1_hourly_rate NUMERIC,
  tier2_threshold_hours NUMERIC,
  tier2_hourly_rate NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH worker_rule AS (
    SELECT
      wor.tier1_hourly_rate,
      wor.tier2_threshold_hours,
      wor.tier2_hourly_rate
    FROM worker_overtime_rules wor
    WHERE wor.worker_id = p_worker_id
      AND wor.effective_from <= p_date
      AND (wor.effective_to IS NULL OR wor.effective_to > p_date)
    ORDER BY wor.effective_from DESC
    LIMIT 1
  ),
  contract_rule AS (
    SELECT
      mor.tier1_hourly_rate,
      mor.tier2_threshold_hours,
      mor.tier2_hourly_rate
    FROM mandor_overtime_rules mor
    WHERE mor.contract_id = p_contract_id
      AND mor.effective_from <= p_date
    ORDER BY mor.effective_from DESC
    LIMIT 1
  )
  SELECT picked.tier1_hourly_rate, picked.tier2_threshold_hours, picked.tier2_hourly_rate
  FROM (
    SELECT worker_rule.*, 1 AS priority FROM worker_rule
    UNION ALL
    SELECT contract_rule.*, 2 AS priority FROM contract_rule
  ) picked
  ORDER BY picked.priority
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_worker_overtime_rules TO authenticated;

-- ============================================================================
-- 4. REPLACE record_worker_attendance (use per-worker OT rules)
-- ============================================================================

CREATE OR REPLACE FUNCTION record_worker_attendance(
  p_contract_id UUID,
  p_worker_id UUID,
  p_attendance_date DATE,
  p_is_present BOOLEAN DEFAULT true,
  p_overtime_hours NUMERIC DEFAULT 0,
  p_work_description TEXT DEFAULT NULL
)
RETURNS worker_attendance_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_rate RECORD;
  v_ot_rules RECORD;
  v_user_id UUID;
  v_project_id UUID;
  v_entry worker_attendance_entries%ROWTYPE;
BEGIN
  SELECT auth.uid() INTO v_user_id;

  -- Verify worker exists and belongs to contract; also get project
  SELECT mc.project_id
  INTO v_project_id
  FROM mandor_workers mw
  JOIN mandor_contracts mc ON mc.id = mw.contract_id
  WHERE mw.id = p_worker_id
    AND mw.contract_id = p_contract_id
    AND mw.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker not found in this contract';
  END IF;

  -- Keep the same project-role guard as the base attendance RPC.
  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Verify date is today or yesterday
  IF p_attendance_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot record future attendance';
  END IF;
  IF p_attendance_date < CURRENT_DATE - INTERVAL '1 day' THEN
    RAISE EXCEPTION 'Can only record today or yesterday';
  END IF;

  -- Get worker's active daily rate
  SELECT wr.daily_rate, wr.effective_from
  INTO v_worker_rate
  FROM worker_rates wr
  WHERE wr.worker_id = p_worker_id
    AND wr.effective_from <= p_attendance_date
    AND (wr.effective_to IS NULL OR wr.effective_to > p_attendance_date)
  ORDER BY wr.effective_from DESC
  LIMIT 1;

  IF v_worker_rate IS NULL THEN
    RAISE EXCEPTION 'Worker has no active daily rate set';
  END IF;

  -- Get per-worker OT rules (with contract fallback)
  SELECT * INTO v_ot_rules
  FROM get_worker_overtime_rules(p_worker_id, p_contract_id, p_attendance_date);

  IF v_ot_rules IS NULL THEN
    RAISE EXCEPTION 'No overtime rules configured for this contract or worker';
  END IF;

  -- Upsert attendance entry with snapshots frozen at record time
  INSERT INTO worker_attendance_entries (
    worker_id, contract_id, project_id, attendance_date,
    is_present, overtime_hours, work_description,
    daily_rate_snapshot,
    tier1_rate_snapshot,
    tier2_rate_snapshot,
    tier1_threshold_snapshot,
    tier2_threshold_snapshot,
    status, recorded_by
  )
  VALUES (
    p_worker_id, p_contract_id, v_project_id, p_attendance_date,
    p_is_present, GREATEST(0, p_overtime_hours), p_work_description,
    v_worker_rate.daily_rate,
    v_ot_rules.tier1_hourly_rate,
    v_ot_rules.tier2_hourly_rate,
    7,  -- normal_hours is always 7 (contract convention)
    v_ot_rules.tier2_threshold_hours,
    'DRAFT', v_user_id
  )
  ON CONFLICT (worker_id, attendance_date)
  DO UPDATE SET
    is_present = EXCLUDED.is_present,
    overtime_hours = EXCLUDED.overtime_hours,
    project_id = EXCLUDED.project_id,
    work_description = EXCLUDED.work_description,
    daily_rate_snapshot = EXCLUDED.daily_rate_snapshot,
    tier1_rate_snapshot = EXCLUDED.tier1_rate_snapshot,
    tier2_rate_snapshot = EXCLUDED.tier2_rate_snapshot,
    tier1_threshold_snapshot = EXCLUDED.tier1_threshold_snapshot,
    tier2_threshold_snapshot = EXCLUDED.tier2_threshold_snapshot,
    recorded_by = EXCLUDED.recorded_by
  WHERE worker_attendance_entries.status = 'DRAFT'
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

-- ============================================================================
-- 5. GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON worker_overtime_rules TO authenticated;
