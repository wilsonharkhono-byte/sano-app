-- Migration: 014_kasbon_ledger.sql
-- Purpose: Add mandor kasbon (contractor advance payment) tracking system
-- Created: 2026-03-31

-- ============================================================================
-- 1. Create mandor_kasbon table
-- ============================================================================

CREATE TABLE IF NOT EXISTS mandor_kasbon (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  kasbon_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'APPROVED', 'SETTLED')),
  requested_by UUID NOT NULL REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  settled_in_opname_id UUID REFERENCES opname_headers(id),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mandor_kasbon_contract
  ON mandor_kasbon(contract_id, status);

CREATE INDEX IF NOT EXISTS idx_mandor_kasbon_project
  ON mandor_kasbon(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mandor_kasbon_settlement
  ON mandor_kasbon(settled_in_opname_id)
  WHERE settled_in_opname_id IS NOT NULL;

-- ============================================================================
-- 3. Enable RLS on mandor_kasbon
-- ============================================================================

ALTER TABLE mandor_kasbon ENABLE ROW LEVEL SECURITY;

-- Policy: SELECT - users can view kasbon for their assigned projects
DROP POLICY IF EXISTS kasbon_select_policy ON mandor_kasbon;
CREATE POLICY kasbon_select_policy ON mandor_kasbon FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_kasbon.project_id
    )
  );

-- Policy: INSERT - users can request kasbon for their assigned projects
DROP POLICY IF EXISTS kasbon_insert_policy ON mandor_kasbon;
CREATE POLICY kasbon_insert_policy ON mandor_kasbon FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_kasbon.project_id
    )
  );

-- Policy: UPDATE - disabled (only through RPCs)
-- Note: Updates happen exclusively through RPCs for audit trail

-- ============================================================================
-- 4. RPC: request_kasbon
-- ============================================================================

CREATE OR REPLACE FUNCTION request_kasbon(
  p_contract_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_kasbon_date DATE DEFAULT CURRENT_DATE
)
RETURNS mandor_kasbon
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_contract_value NUMERIC;
  v_unsettled_total NUMERIC;
  v_max_allowed NUMERIC;
  v_new_kasbon mandor_kasbon%ROWTYPE;
BEGIN
  -- Get project_id from contract
  SELECT project_id INTO v_project_id
  FROM mandor_contracts
  WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  -- Check role
  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Calculate contract value: SUM(contracted_rate * planned) from boq_items
  SELECT COALESCE(SUM(mcr.contracted_rate * bi.planned), 0)
  INTO v_contract_value
  FROM mandor_contract_rates mcr
  JOIN boq_items bi ON bi.id = mcr.boq_item_id
  WHERE mcr.contract_id = p_contract_id;

  -- Get current unsettled kasbon total
  SELECT COALESCE(SUM(amount), 0)
  INTO v_unsettled_total
  FROM mandor_kasbon
  WHERE contract_id = p_contract_id
    AND status IN ('REQUESTED', 'APPROVED');

  -- Max allowed: 30% of contract value
  v_max_allowed := v_contract_value * 0.30;

  -- Check ceiling
  IF (v_unsettled_total + p_amount) > v_max_allowed THEN
    RAISE EXCEPTION 'Total kasbon melebihi 30%% nilai kontrak. Max: %, Current + New: %',
      v_max_allowed, (v_unsettled_total + p_amount);
  END IF;

  -- Insert new kasbon request
  INSERT INTO mandor_kasbon (
    project_id,
    contract_id,
    amount,
    kasbon_date,
    reason,
    status,
    requested_by
  ) VALUES (
    v_project_id,
    p_contract_id,
    p_amount,
    p_kasbon_date,
    p_reason,
    'REQUESTED',
    auth.uid()
  )
  RETURNING * INTO v_new_kasbon;

  RETURN v_new_kasbon;
END;
$$;

-- ============================================================================
-- 5. RPC: approve_kasbon
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_kasbon(p_kasbon_id UUID)
RETURNS mandor_kasbon
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kasbon mandor_kasbon%ROWTYPE;
  v_project_id UUID;
BEGIN
  -- Get kasbon record
  SELECT *
  INTO v_kasbon
  FROM mandor_kasbon
  WHERE id = p_kasbon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kasbon tidak ditemukan';
  END IF;

  v_project_id := v_kasbon.project_id;

  -- Check role
  PERFORM assert_project_role(v_project_id, ARRAY['admin', 'principal']);

  -- Must be REQUESTED
  IF v_kasbon.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'Kasbon bukan dalam status REQUESTED';
  END IF;

  -- Update to APPROVED
  UPDATE mandor_kasbon
  SET status = 'APPROVED',
      approved_by = auth.uid(),
      approved_at = now()
  WHERE id = p_kasbon_id
  RETURNING * INTO v_kasbon;

  RETURN v_kasbon;
END;
$$;

-- ============================================================================
-- 6. RPC: settle_kasbon_for_opname
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_kasbon_for_opname(p_opname_header_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
  v_count INTEGER;
BEGIN
  -- Get contract_id from opname header
  SELECT contract_id
  INTO v_contract_id
  FROM opname_headers
  WHERE id = p_opname_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  -- Update all APPROVED kasbon for this contract to SETTLED
  UPDATE mandor_kasbon
  SET status = 'SETTLED',
      settled_in_opname_id = p_opname_header_id,
      settled_at = now()
  WHERE contract_id = v_contract_id
    AND status = 'APPROVED';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 7. RPC: get_unsettled_kasbon_total
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unsettled_kasbon_total(p_contract_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM mandor_kasbon
  WHERE contract_id = p_contract_id
    AND status = 'APPROVED';

  RETURN v_total;
END;
$$;

-- ============================================================================
-- 8. Replace approve_opname to auto-settle kasbon
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
  v_settled_kasbon_total NUMERIC;
BEGIN
  -- Get opname header
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  -- Check role
  PERFORM assert_project_role(v_header.project_id, ARRAY['admin', 'principal']);

  -- Check status
  IF v_header.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Hanya opname VERIFIED yang bisa disetujui';
  END IF;

  -- Auto-settle approved kasbon entries for this contract
  PERFORM settle_kasbon_for_opname(p_header_id);

  -- Calculate total settled kasbon from this opname
  SELECT COALESCE(SUM(amount), 0)
  INTO v_settled_kasbon_total
  FROM mandor_kasbon
  WHERE settled_in_opname_id = p_header_id
    AND status = 'SETTLED';

  -- Update opname header with combined kasbon (manual + settled)
  UPDATE opname_headers
  SET status = 'APPROVED',
      approved_by = auth.uid(),
      approved_at = now(),
      kasbon = COALESCE(p_kasbon, 0) + COALESCE(v_settled_kasbon_total, 0)
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  -- Recompute totals
  PERFORM recompute_opname_header_totals(p_header_id);
  PERFORM refresh_opname_headers_for_contract(v_header.contract_id, v_header.week_number + 1);

  -- Fetch final state
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  RETURN v_header;
END;
$$;

-- ============================================================================
-- 9. Create kasbon_aging view
-- ============================================================================

CREATE OR REPLACE VIEW v_kasbon_aging AS
SELECT
  mk.id,
  mk.project_id,
  mk.contract_id,
  mc.mandor_name,
  mk.amount,
  mk.kasbon_date,
  mk.reason,
  mk.status,
  mk.requested_by,
  mk.approved_by,
  mk.created_at,
  CURRENT_DATE - mk.kasbon_date AS age_days,
  -- Count opname cycles since kasbon
  (SELECT COUNT(*)
   FROM opname_headers oh
   WHERE oh.contract_id = mk.contract_id
     AND oh.status IN ('APPROVED', 'PAID')
     AND oh.approved_at > mk.created_at
  ) AS opname_cycles_since
FROM mandor_kasbon mk
JOIN mandor_contracts mc ON mc.id = mk.contract_id
WHERE mk.status IN ('REQUESTED', 'APPROVED');
