-- Migration 018: Opname Harian Extension
--
-- Extends opname_headers with payment_type and harian_total columns.
-- Modifies recompute_opname_header_totals to branch on payment_type
-- (harian: sum from worker_attendance_entries, no retention).
-- Modifies approve_opname to settle worker attendance when harian.
-- Modifies submit_opname to allow harian opnames without opname_lines.
--
-- See docs/harian_payment_architecture.md §2.5 and §4.

-- ============================================================================
-- 1. ADD payment_type AND harian_total TO opname_headers
-- ============================================================================

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'borongan'
  CHECK (payment_type IN ('borongan', 'harian'));

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS harian_total NUMERIC NOT NULL DEFAULT 0;

-- Week start/end for date-range based attendance queries
ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS week_start DATE;

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS week_end DATE;

COMMENT ON COLUMN opname_headers.payment_type IS 'borongan=progress-based, harian=attendance-based (per-week choice for campuran)';
COMMENT ON COLUMN opname_headers.harian_total IS 'Sum of worker day_total for harian opnames (= gross_total for clarity in reports)';
COMMENT ON COLUMN opname_headers.week_start IS 'Monday of the attendance week (harian only)';
COMMENT ON COLUMN opname_headers.week_end IS 'Saturday of the attendance week (harian only)';

-- ============================================================================
-- 2. REPLACE recompute_opname_header_totals (branch on payment_type)
-- ============================================================================

CREATE OR REPLACE FUNCTION recompute_opname_header_totals(
  p_header_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
  v_week_number INT;
  v_retention_pct NUMERIC;
  v_kasbon NUMERIC;
  v_payment_type TEXT;
  v_week_start DATE;
  v_week_end DATE;
  v_gross_total NUMERIC;
  v_prior_paid NUMERIC;
  v_retention_amount NUMERIC;
  v_net_to_date NUMERIC;
  v_harian_total NUMERIC := 0;
BEGIN
  SELECT contract_id, week_number, retention_pct, kasbon, payment_type, week_start, week_end
  INTO v_contract_id, v_week_number, v_retention_pct, v_kasbon, v_payment_type, v_week_start, v_week_end
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_payment_type = 'harian' THEN
    -- ============================================================
    -- HARIAN: sum worker attendance entries for this week's range
    -- ============================================================

    SELECT COALESCE(SUM(wae.day_total), 0)
    INTO v_gross_total
    FROM worker_attendance_entries wae
    WHERE wae.contract_id = v_contract_id
      AND wae.attendance_date BETWEEN v_week_start AND v_week_end
      AND wae.status IN ('SUBMITTED', 'CONFIRMED', 'OVERRIDDEN', 'SETTLED');

    -- No retention for harian
    v_retention_amount := 0;
    v_net_to_date := v_gross_total;
    v_harian_total := v_gross_total;

    -- prior_paid for harian is isolated from borongan
    -- Sum net_this_week (not net_to_date) from prior harian opnames
    -- because harian has no cumulative retention waterfall
    SELECT COALESCE(SUM(net_this_week), 0)
    INTO v_prior_paid
    FROM opname_headers
    WHERE contract_id = v_contract_id
      AND payment_type = 'harian'
      AND week_number < v_week_number
      AND status IN ('APPROVED', 'PAID');

  ELSE
    -- ============================================================
    -- BORONGAN: existing logic unchanged
    -- ============================================================

    SELECT COALESCE(SUM(cumulative_amount) FILTER (WHERE NOT is_tdk_acc), 0)
    INTO v_gross_total
    FROM opname_lines
    WHERE header_id = p_header_id;

    SELECT COALESCE(SUM(net_to_date), 0)
    INTO v_prior_paid
    FROM opname_headers
    WHERE contract_id = v_contract_id
      AND week_number < v_week_number
      AND status IN ('APPROVED', 'PAID');

    v_retention_amount := v_gross_total * (COALESCE(v_retention_pct, 0) / 100.0);
    v_net_to_date := v_gross_total - v_retention_amount;
    v_harian_total := 0;

  END IF;

  UPDATE opname_headers
  SET gross_total = v_gross_total,
      retention_amount = v_retention_amount,
      net_to_date = v_net_to_date,
      prior_paid = v_prior_paid,
      net_this_week = GREATEST(0, v_net_to_date - v_prior_paid - COALESCE(v_kasbon, 0)),
      harian_total = v_harian_total
  WHERE id = p_header_id;
END;
$$;

-- ============================================================================
-- 3. REPLACE submit_opname (allow harian opnames without opname_lines)
-- ============================================================================

CREATE OR REPLACE FUNCTION submit_opname(
  p_header_id UUID
)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
  v_line_count INT;
  v_attendance_count INT;
BEGIN
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_header.project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  IF v_header.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Hanya opname DRAFT yang bisa diajukan';
  END IF;

  IF v_header.payment_type = 'harian' THEN
    -- Harian: check that there are attendance entries for the week
    SELECT COUNT(*)
    INTO v_attendance_count
    FROM worker_attendance_entries wae
    WHERE wae.contract_id = v_header.contract_id
      AND wae.attendance_date BETWEEN v_header.week_start AND v_header.week_end
      AND wae.status IN ('SUBMITTED', 'CONFIRMED', 'OVERRIDDEN');

    IF v_attendance_count = 0 THEN
      RAISE EXCEPTION 'Tidak ada data kehadiran pekerja yang sudah dikonfirmasi untuk minggu ini';
    END IF;

    -- Recompute totals from attendance before submitting
    PERFORM recompute_opname_header_totals(p_header_id);
  ELSE
    -- Borongan: check that there are opname_lines
    SELECT COUNT(*)
    INTO v_line_count
    FROM opname_lines
    WHERE header_id = p_header_id;

    IF COALESCE(v_line_count, 0) = 0 THEN
      RAISE EXCEPTION 'Opname belum memiliki item pembayaran. Set kontrak mandor terlebih dahulu';
    END IF;
  END IF;

  UPDATE opname_headers
  SET status = 'SUBMITTED',
      submitted_by = auth.uid(),
      submitted_at = now()
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  RETURN v_header;
END;
$$;

-- ============================================================================
-- 4. REPLACE approve_opname (settle worker attendance when harian)
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_opname(
  p_header_id UUID,
  p_kasbon NUMERIC DEFAULT 0
)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
BEGIN
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_header.project_id, ARRAY['admin', 'principal']);

  IF v_header.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Hanya opname VERIFIED yang bisa disetujui';
  END IF;

  UPDATE opname_headers
  SET status = 'APPROVED',
      approved_by = auth.uid(),
      approved_at = now(),
      kasbon = COALESCE(p_kasbon, 0)
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  -- Settle worker attendance entries for harian opnames
  IF v_header.payment_type = 'harian'
     AND v_header.week_start IS NOT NULL
     AND v_header.week_end IS NOT NULL THEN
    PERFORM settle_worker_attendance_for_opname(
      p_header_id,
      v_header.week_start,
      v_header.week_end
    );
  END IF;

  -- Also settle old-style mandor_attendance if applicable (015 table)
  PERFORM settle_attendance_for_opname(p_header_id);

  PERFORM recompute_opname_header_totals(p_header_id);
  PERFORM refresh_opname_headers_for_contract(v_header.contract_id, v_header.week_number + 1);

  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  RETURN v_header;
END;
$$;

-- ============================================================================
-- 5. RPC: create_harian_opname (convenience for creating harian opname headers)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_harian_opname(
  p_contract_id UUID,
  p_week_number INT,
  p_opname_date DATE,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_contract_payment_mode TEXT;
  v_new_header opname_headers;
BEGIN
  -- Get contract info
  SELECT mc.project_id, mc.payment_mode
  INTO v_project_id, v_contract_payment_mode
  FROM mandor_contracts mc
  WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  -- Only harian/campuran contracts can create harian opnames
  IF v_contract_payment_mode = 'borongan' THEN
    RAISE EXCEPTION 'Kontrak borongan tidak bisa membuat opname harian';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Check no duplicate week
  IF EXISTS (
    SELECT 1 FROM opname_headers
    WHERE contract_id = p_contract_id
      AND week_number = p_week_number
  ) THEN
    RAISE EXCEPTION 'Opname untuk minggu % sudah ada', p_week_number;
  END IF;

  INSERT INTO opname_headers (
    project_id, contract_id, week_number, opname_date,
    payment_type, retention_pct, week_start, week_end
  )
  VALUES (
    v_project_id, p_contract_id, p_week_number, p_opname_date,
    'harian', 0, p_week_start, p_week_end
  )
  RETURNING * INTO v_new_header;

  -- Recompute totals immediately (will pull from attendance entries)
  PERFORM recompute_opname_header_totals(v_new_header.id);

  SELECT * INTO v_new_header FROM opname_headers WHERE id = v_new_header.id;

  RETURN v_new_header;
END;
$$;

-- ============================================================================
-- 6. RPC: recompute_harian_opname (manual refresh of attendance totals)
-- ============================================================================

CREATE OR REPLACE FUNCTION recompute_harian_opname(p_header_id UUID)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers;
BEGIN
  SELECT * INTO v_header FROM opname_headers WHERE id = p_header_id;

  IF v_header.id IS NULL THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  IF v_header.payment_type <> 'harian' THEN
    RAISE EXCEPTION 'Fungsi ini hanya untuk opname harian';
  END IF;

  PERFORM assert_project_role(v_header.project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  PERFORM recompute_opname_header_totals(p_header_id);

  SELECT * INTO v_header FROM opname_headers WHERE id = p_header_id;

  RETURN v_header;
END;
$$;

-- ============================================================================
-- 7. VIEW: harian opname summary with attendance breakdown
-- ============================================================================

CREATE OR REPLACE VIEW v_harian_opname_summary AS
SELECT
  oh.id AS opname_id,
  oh.project_id,
  oh.contract_id,
  mc.mandor_name,
  oh.week_number,
  oh.opname_date,
  oh.week_start,
  oh.week_end,
  oh.status,
  oh.gross_total,
  oh.harian_total,
  oh.kasbon,
  oh.net_this_week,
  oh.prior_paid,
  -- Attendance breakdown
  COUNT(DISTINCT wae.worker_id) FILTER (WHERE wae.is_present) AS total_workers,
  COUNT(wae.id) FILTER (WHERE wae.is_present) AS total_work_days,
  COALESCE(SUM(wae.regular_pay), 0) AS total_regular_pay,
  COALESCE(SUM(wae.overtime_pay), 0) AS total_overtime_pay,
  COALESCE(SUM(wae.overtime_hours) FILTER (WHERE wae.is_present), 0) AS total_overtime_hours,
  COUNT(wae.id) FILTER (WHERE wae.status = 'SETTLED') AS settled_entries,
  COUNT(wae.id) AS total_entries
FROM opname_headers oh
JOIN mandor_contracts mc ON mc.id = oh.contract_id
LEFT JOIN worker_attendance_entries wae
  ON wae.contract_id = oh.contract_id
  AND wae.attendance_date BETWEEN oh.week_start AND oh.week_end
WHERE oh.payment_type = 'harian'
GROUP BY
  oh.id, oh.project_id, oh.contract_id, mc.mandor_name,
  oh.week_number, oh.opname_date, oh.week_start, oh.week_end,
  oh.status, oh.gross_total, oh.harian_total, oh.kasbon,
  oh.net_this_week, oh.prior_paid;

-- ============================================================================
-- 8. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION create_harian_opname TO authenticated;
GRANT EXECUTE ON FUNCTION recompute_harian_opname TO authenticated;
