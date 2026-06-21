-- SECURITY: close a cross-tenant leak in the unsettled-total RPCs.
--
-- get_unsettled_kasbon_total / get_unsettled_attendance_total /
-- get_unsettled_worker_attendance_total are SECURITY DEFINER (they bypass RLS
-- on the underlying ledger tables) and granted to `authenticated`, but they
-- took a caller-supplied p_contract_id with NO authorization check. Any logged-in
-- user could pass any contract_id and read another tenant's unsettled financial
-- total.
--
-- Fix: a shared assert_contract_access() guard that allows the call only when the
-- caller is an office role (admin/principal/estimator — global access, per 036)
-- OR is assigned to the contract's project. Unauthorized callers get an exception
-- (NOT a 0) — returning a fake 0 would both leak "contract exists" and feed a
-- wrong number into the settlement math.

-- ── Reusable guard ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_contract_access(p_contract_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() reflects the request JWT even inside SECURITY DEFINER, so the
  -- membership check is evaluated against the *caller*, not the function owner.
  IF NOT EXISTS (
    SELECT 1
    FROM mandor_contracts mc
    WHERE mc.id = p_contract_id
      AND (
        is_office_role()
        OR mc.project_id IN (
          SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
        )
      )
  ) THEN
    RAISE EXCEPTION 'not authorized for contract %', p_contract_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assert_contract_access(UUID) TO authenticated;

-- ── Kasbon (014) ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_unsettled_kasbon_total(p_contract_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  PERFORM assert_contract_access(p_contract_id);

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM mandor_kasbon
  WHERE contract_id = p_contract_id
    AND status = 'APPROVED';

  RETURN v_total;
END;
$$;

-- ── Mandor attendance (015) ─────────────────────────────────────────────────
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
  PERFORM assert_contract_access(p_contract_id);

  SELECT COALESCE(SUM(ma.line_total), 0)
  INTO v_total
  FROM mandor_attendance ma
  WHERE ma.contract_id = p_contract_id
    AND ma.status = 'VERIFIED';

  RETURN v_total;
END;
$$;

-- ── Worker attendance (017) ─────────────────────────────────────────────────
-- Was LANGUAGE sql; converted to plpgsql so the guard can RAISE.
CREATE OR REPLACE FUNCTION get_unsettled_worker_attendance_total(p_contract_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  PERFORM assert_contract_access(p_contract_id);

  SELECT COALESCE(SUM(wae.day_total), 0)
  INTO v_total
  FROM worker_attendance_entries wae
  WHERE wae.contract_id = p_contract_id
    AND wae.status IN ('SUBMITTED', 'CONFIRMED', 'OVERRIDDEN');

  RETURN v_total;
END;
$$;
