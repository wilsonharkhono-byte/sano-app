-- Migration 015: Attendance/HOK (Hari Orang Kerja) tracking for mandor contracts
-- Adds payment modes and daily rate tracking, attendance records, and settlement integration

-- ============================================================================
-- 1. Add payment_mode and daily_rate columns to mandor_contracts
-- ============================================================================

ALTER TABLE mandor_contracts
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'borongan'
  CHECK (payment_mode IN ('borongan', 'harian', 'campuran'));

ALTER TABLE mandor_contracts
  ADD COLUMN IF NOT EXISTS daily_rate NUMERIC NOT NULL DEFAULT 0
  CHECK (daily_rate >= 0);

COMMENT ON COLUMN mandor_contracts.payment_mode IS 'borongan=progress-based, harian=attendance-based, campuran=both';
COMMENT ON COLUMN mandor_contracts.daily_rate IS 'Default Rp per worker per day for harian/campuran contracts';

-- ============================================================================
-- 2. Create mandor_attendance table
-- ============================================================================

CREATE TABLE IF NOT EXISTS mandor_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  worker_count INT NOT NULL CHECK (worker_count > 0 AND worker_count <= 500),
  daily_rate NUMERIC NOT NULL CHECK (daily_rate > 0),
  line_total NUMERIC GENERATED ALWAYS AS (worker_count * daily_rate) STORED,
  work_description TEXT,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'VERIFIED', 'SETTLED')),
  settled_in_opname_id UUID REFERENCES opname_headers(id),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, attendance_date)
);

-- ============================================================================
-- 3. Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mandor_attendance_contract
  ON mandor_attendance (contract_id, status);

CREATE INDEX IF NOT EXISTS idx_mandor_attendance_project
  ON mandor_attendance (project_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_mandor_attendance_settlement
  ON mandor_attendance (settled_in_opname_id)
  WHERE settled_in_opname_id IS NOT NULL;

-- ============================================================================
-- 4. Enable RLS and create policies
-- ============================================================================

ALTER TABLE mandor_attendance ENABLE ROW LEVEL SECURITY;

-- SELECT: user must have project assignment
DROP POLICY IF EXISTS mandor_attendance_select ON mandor_attendance;
CREATE POLICY mandor_attendance_select ON mandor_attendance
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_attendance.project_id
    )
  );

-- INSERT: recorded_by must be current user and must have project assignment
DROP POLICY IF EXISTS mandor_attendance_insert ON mandor_attendance;
CREATE POLICY mandor_attendance_insert ON mandor_attendance
  FOR INSERT
  WITH CHECK (
    recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_attendance.project_id
    )
  );

-- UPDATE: only allow updates to verified_by, verified_at, status by those with permission
DROP POLICY IF EXISTS mandor_attendance_update ON mandor_attendance;
CREATE POLICY mandor_attendance_update ON mandor_attendance
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_attendance.project_id
    )
  );

-- ============================================================================
-- 5. Helper function to check anomalies
-- ============================================================================

CREATE OR REPLACE FUNCTION check_attendance_anomaly(
  p_contract_id UUID,
  p_worker_count INT
)
RETURNS TABLE(is_anomaly BOOLEAN, avg_7day NUMERIC, threshold INT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_avg NUMERIC;
  v_threshold INT;
BEGIN
  SELECT COALESCE(AVG(ma.worker_count), 0)
  INTO v_avg
  FROM mandor_attendance ma
  WHERE ma.contract_id = p_contract_id
    AND ma.attendance_date >= CURRENT_DATE - 7;

  v_threshold := GREATEST(CEIL(v_avg * 1.5), 10); -- 150% of avg or at least 10

  RETURN QUERY SELECT
    p_worker_count > v_threshold,
    ROUND(v_avg, 1),
    v_threshold;
END;
$$;

-- ============================================================================
-- 6. RPC: record_attendance
-- ============================================================================

CREATE OR REPLACE FUNCTION record_attendance(
  p_contract_id UUID,
  p_attendance_date DATE,
  p_worker_count INT,
  p_work_description TEXT DEFAULT NULL
)
RETURNS mandor_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_daily_rate NUMERIC;
  v_new_record mandor_attendance;
BEGIN
  -- Get project_id and daily_rate from mandor_contracts
  SELECT mc.project_id, mc.daily_rate
  INTO v_project_id, v_daily_rate
  FROM mandor_contracts mc
  WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Contract not found: %', p_contract_id;
  END IF;

  -- Check user role authorization
  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Date check: attendance date must be today or yesterday
  IF p_attendance_date < CURRENT_DATE - 1 OR p_attendance_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Pencatatan kehadiran hanya boleh untuk hari ini atau kemarin';
  END IF;

  -- Insert new attendance record
  INSERT INTO mandor_attendance (
    project_id, contract_id, attendance_date, worker_count,
    daily_rate, work_description, recorded_by, status
  )
  VALUES (
    v_project_id, p_contract_id, p_attendance_date, p_worker_count,
    v_daily_rate, p_work_description, auth.uid(), 'DRAFT'
  )
  RETURNING * INTO v_new_record;

  RETURN v_new_record;
END;
$$;

-- ============================================================================
-- 7. RPC: verify_attendance
-- ============================================================================

CREATE OR REPLACE FUNCTION verify_attendance(p_attendance_id UUID)
RETURNS mandor_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record mandor_attendance;
  v_project_id UUID;
BEGIN
  -- Get the attendance record (project_id is already on the record)
  SELECT ma.*
  INTO v_record
  FROM mandor_attendance ma
  WHERE ma.id = p_attendance_id;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found: %', p_attendance_id;
  END IF;

  v_project_id := v_record.project_id;

  -- Check user role authorization
  PERFORM assert_project_role(v_project_id, ARRAY['estimator', 'admin', 'principal']);

  -- Must be in DRAFT status
  IF v_record.status != 'DRAFT' THEN
    RAISE EXCEPTION 'Attendance must be in DRAFT status to verify, current status: %', v_record.status;
  END IF;

  -- Update to VERIFIED
  UPDATE mandor_attendance
  SET
    status = 'VERIFIED',
    verified_by = auth.uid(),
    verified_at = now()
  WHERE id = p_attendance_id
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$$;

-- ============================================================================
-- 8. RPC: settle_attendance_for_opname
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_attendance_for_opname(p_opname_header_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
  v_count INT;
BEGIN
  -- Get contract_id from opname header
  SELECT oh.contract_id
  INTO v_contract_id
  FROM opname_headers oh
  WHERE oh.id = p_opname_header_id;

  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'Opname header not found: %', p_opname_header_id;
  END IF;

  -- Update all VERIFIED attendance records for that contract
  UPDATE mandor_attendance
  SET
    status = 'SETTLED',
    settled_in_opname_id = p_opname_header_id,
    settled_at = now()
  WHERE contract_id = v_contract_id
    AND status = 'VERIFIED';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 9. RPC: get_unsettled_attendance_total
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unsettled_attendance_total(p_contract_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(ma.line_total), 0)
  INTO v_total
  FROM mandor_attendance ma
  WHERE ma.contract_id = p_contract_id
    AND ma.status = 'VERIFIED';

  RETURN v_total;
END;
$$;

-- ============================================================================
-- 10. Create attendance weekly summary view
-- ============================================================================

CREATE OR REPLACE VIEW v_attendance_weekly_summary AS
SELECT
  ma.contract_id,
  mc.mandor_name,
  mc.project_id,
  date_trunc('week', ma.attendance_date)::DATE AS week_start,
  COUNT(*) AS work_days,
  SUM(ma.worker_count) AS total_hok,
  SUM(ma.line_total) AS total_amount,
  COUNT(*) FILTER (WHERE ma.status = 'DRAFT') AS draft_count,
  COUNT(*) FILTER (WHERE ma.status = 'VERIFIED') AS verified_count,
  COUNT(*) FILTER (WHERE ma.status = 'SETTLED') AS settled_count
FROM mandor_attendance ma
JOIN mandor_contracts mc ON mc.id = ma.contract_id
GROUP BY ma.contract_id, mc.mandor_name, mc.project_id, date_trunc('week', ma.attendance_date);

-- ============================================================================
-- Add grants for RLS and RPC functions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON mandor_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION record_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION verify_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION settle_attendance_for_opname TO authenticated;
GRANT EXECUTE ON FUNCTION get_unsettled_attendance_total TO authenticated;
GRANT EXECUTE ON FUNCTION check_attendance_anomaly TO authenticated;
