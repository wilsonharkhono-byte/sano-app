-- Migration: Decouple payment confirmation from Excel export
-- Purpose: Add payment tracking fields and update mark_opname_paid function
-- to accept payment reference instead of auto-triggering on export

-- 1. Add payment tracking columns to opname_headers table
ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN opname_headers.payment_reference IS 'Bank transfer number or payment receipt reference';
COMMENT ON COLUMN opname_headers.paid_at IS 'Actual timestamp when payment was confirmed (not export time)';
COMMENT ON COLUMN opname_headers.paid_by IS 'User ID of the person who confirmed payment';

-- 2. Replace mark_opname_paid function to accept payment_reference
-- and properly track payment confirmation time
CREATE OR REPLACE FUNCTION mark_opname_paid(
  p_header_id UUID,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
BEGIN
  -- Fetch the header record
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  -- Check if header exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  -- Verify user has permission to mark as paid
  PERFORM assert_project_role(v_header.project_id, ARRAY['admin', 'principal']);

  -- Check if status is APPROVED (required before marking as PAID)
  IF v_header.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Hanya opname APPROVED yang bisa ditandai PAID';
  END IF;

  -- Update status to PAID and capture payment details
  UPDATE opname_headers
  SET status = 'PAID',
      paid_by = auth.uid(),
      paid_at = now(),
      payment_reference = p_payment_reference
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  RETURN v_header;
END;
$$;
