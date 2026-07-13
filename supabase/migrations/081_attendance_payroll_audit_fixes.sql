-- Migration 081: Attendance → Payroll Audit Remediation (SQL side)
--
-- Fixes from docs/audits/2026-07-11-attendance-payroll-flow-ui-audit.md:
--
--   F1  Recording window is server-UTC today/yesterday only. Widen to the
--       intended −14/+7 day window, evaluated in Asia/Jakarta (WIB).
--   F7  approve_opname re-derives gross from live attendance after verify
--       (PAID ≠ VERIFIED). Freeze gross at verify; refuse approve if it drifts.
--       recompute_harian_opname was callable on APPROVED/PAID headers.
--   F8  No reversal path for a mis-approved opname. Add void_opname (harian v1).
--   F9  Borongan prior_paid branch lacked a payment_type filter → campuran
--       cross-contamination. Add the filter.
--   F10 018's approve_opname dropped 014's kasbon auto-settlement, and the
--       GREATEST clamp silently lost kasbon carryover beyond one week.
--       Reinstate ledger settlement with PARTIAL settlement + carryover.
--   F13 All date logic must evaluate in Asia/Jakarta (owner rule R20). Add
--       sano_wib_today() and use it for recording windows + column defaults.
--
-- This migration deliberately does NOT reuse 020's bulk-INSERT batch (its
-- phantom created_by/updated_at columns and INNER JOIN rate-drop, F18). It
-- rebuilds the batch on 017's loop-over-single-RPC design so a rate-less
-- worker RAISEs loudly instead of being silently skipped.
--
-- Apply by pasting into Supabase Dashboard SQL Editor; safe to re-paste.
-- Every statement is idempotent (CREATE OR REPLACE for functions, ADD COLUMN
-- IF NOT EXISTS for columns, dynamic drop-by-name before constraint re-add).
-- The live function bodies are assumed to be 011/014/017/018/019/021-era
-- (NOT 020 — 020 was never applied to production).

-- ============================================================================
-- 0. WIB DATE HELPER (F1 / F13)
-- ============================================================================
-- Supabase runs the server clock in UTC. Every payroll date decision must be
-- made against "today in Jakarta" instead. STABLE so it is legal as a column
-- DEFAULT and cheap inside per-row guards.

CREATE OR REPLACE FUNCTION sano_wib_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date;
$$;

GRANT EXECUTE ON FUNCTION sano_wib_today() TO authenticated;

-- ============================================================================
-- 1. OPNAME HEADER COLUMNS: verified-gross freeze + void metadata (F7 / F8)
-- ============================================================================

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS verified_gross_total NUMERIC;

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS void_note TEXT;

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES profiles(id);

ALTER TABLE opname_headers
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

COMMENT ON COLUMN opname_headers.verified_gross_total IS
  'Gross frozen at verify time (F7). approve_opname refuses if live gross drifts from this. NULL for headers verified before migration 068 (drift check skipped).';
COMMENT ON COLUMN opname_headers.void_note IS
  'Mandatory reason recorded when an approved/paid opname is voided (F8).';

-- Status domain must allow 'VOID'. The original constraint (008) is an inline,
-- auto-named column CHECK, so discover + drop it by definition (name-agnostic)
-- and re-add under a stable name including VOID. Re-paste-safe: the loop also
-- catches the re-added constraint and the IF NOT EXISTS re-creates it.
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'opname_headers'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) ILIKE '%DRAFT%'
      AND pg_get_constraintdef(con.oid) ILIKE '%PAID%'
  LOOP
    EXECUTE format('ALTER TABLE public.opname_headers DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opname_headers_status_check'
      AND conrelid = 'public.opname_headers'::regclass
  ) THEN
    ALTER TABLE public.opname_headers
      ADD CONSTRAINT opname_headers_status_check
      CHECK (status IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'PAID', 'VOID'));
  END IF;
END $$;

-- ============================================================================
-- 2. KASBON PARTIAL-SETTLEMENT SCHEMA (F10)
-- ============================================================================
-- 014's mandor_kasbon is all-or-nothing (status APPROVED → SETTLED, one
-- settled_in_opname_id). Partial recovery + per-header reversal (for void)
-- need two additions:
--   * settled_amount  — running recovered total on the advance. Outstanding =
--     amount − settled_amount. status stays APPROVED until fully recovered.
--   * kasbon_settlements — one row per (advance, opname header) recovery event,
--     the attribution ledger void_opname reverses against.

ALTER TABLE mandor_kasbon
  ADD COLUMN IF NOT EXISTS settled_amount NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN mandor_kasbon.settled_amount IS
  'Cumulative amount recovered against this advance (F10). Outstanding = amount − settled_amount; advance stays APPROVED until settled_amount ≥ amount, then SETTLED.';

-- Backfill the invariant "SETTLED ⇒ settled_amount ≥ amount" for advances that
-- 014 settled before this column existed. Idempotent: new rows settled by 068
-- already carry settled_amount ≥ amount, so they never re-match.
UPDATE mandor_kasbon
SET settled_amount = amount
WHERE status = 'SETTLED'
  AND settled_amount = 0
  AND amount > 0;

CREATE TABLE IF NOT EXISTS kasbon_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kasbon_id         UUID NOT NULL REFERENCES mandor_kasbon(id) ON DELETE CASCADE,
  opname_header_id  UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  contract_id       UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  amount            NUMERIC NOT NULL CHECK (amount > 0),
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kasbon_settlements IS
  'Per-(advance, opname header) kasbon recovery events (F10). Sum per advance = mandor_kasbon.settled_amount. void_opname reverts the rows attributed to the voided header.';

CREATE INDEX IF NOT EXISTS idx_kasbon_settlements_header
  ON kasbon_settlements (opname_header_id);

CREATE INDEX IF NOT EXISTS idx_kasbon_settlements_kasbon
  ON kasbon_settlements (kasbon_id);

ALTER TABLE kasbon_settlements ENABLE ROW LEVEL SECURITY;

-- Read-only to project members; all writes go through SECURITY DEFINER RPCs
-- (approve_opname / void_opname), which bypass RLS. No write policy on purpose.
DROP POLICY IF EXISTS kasbon_settlements_select ON kasbon_settlements;
CREATE POLICY kasbon_settlements_select ON kasbon_settlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM mandor_contracts mc
      JOIN project_assignments pa ON pa.project_id = mc.project_id
      WHERE mc.id = kasbon_settlements.contract_id
        AND pa.user_id = auth.uid()
    )
  );

GRANT SELECT ON kasbon_settlements TO authenticated;

-- ============================================================================
-- 3. WIB DATE DEFAULTS (F13)
-- ============================================================================
-- Rates/rules/kasbon created 00:00–07:00 WIB were being stamped a day early
-- under UTC CURRENT_DATE. Re-point their defaults at Jakarta today. Guarded so
-- a re-paste against a DB missing any column is a no-op rather than an error.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'worker_rates'
               AND column_name = 'effective_from') THEN
    ALTER TABLE worker_rates ALTER COLUMN effective_from SET DEFAULT sano_wib_today();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'mandor_overtime_rules'
               AND column_name = 'effective_from') THEN
    ALTER TABLE mandor_overtime_rules ALTER COLUMN effective_from SET DEFAULT sano_wib_today();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'worker_overtime_rules'
               AND column_name = 'effective_from') THEN
    ALTER TABLE worker_overtime_rules ALTER COLUMN effective_from SET DEFAULT sano_wib_today();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'mandor_kasbon'
               AND column_name = 'kasbon_date') THEN
    ALTER TABLE mandor_kasbon ALTER COLUMN kasbon_date SET DEFAULT sano_wib_today();
  END IF;
END $$;

-- ============================================================================
-- 4. record_worker_attendance — WIB −14/+7 window (F1 / F13)
-- ============================================================================
-- Base: 019 (per-worker OT rules, recorded_by = auth.uid(), DRAFT-only upsert).
-- Only the date guard changes: today/yesterday-UTC → WIB −14/+7. Still RAISEs
-- loudly on a worker with no active rate or no OT rules — never a silent skip.

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

  -- Verify worker exists and belongs to contract; also get project.
  SELECT mc.project_id
  INTO v_project_id
  FROM mandor_workers mw
  JOIN mandor_contracts mc ON mc.id = mw.contract_id
  WHERE mw.id = p_worker_id
    AND mw.contract_id = p_contract_id
    AND mw.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pekerja tidak ditemukan atau tidak aktif dalam kontrak ini';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- F1/F13: recording window is −14/+7 days, evaluated in Jakarta time.
  IF p_attendance_date < sano_wib_today() - 14
     OR p_attendance_date > sano_wib_today() + 7 THEN
    RAISE EXCEPTION 'Tanggal di luar jendela pencatatan (maks 14 hari ke belakang, 7 hari ke depan)';
  END IF;

  -- Active daily rate (frozen snapshot). No rate = loud failure, never silent.
  SELECT wr.daily_rate, wr.effective_from
  INTO v_worker_rate
  FROM worker_rates wr
  WHERE wr.worker_id = p_worker_id
    AND wr.effective_from <= p_attendance_date
    AND (wr.effective_to IS NULL OR wr.effective_to > p_attendance_date)
  ORDER BY wr.effective_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarif harian aktif belum diset untuk pekerja ini';
  END IF;

  -- Per-worker OT rules with contract fallback.
  SELECT * INTO v_ot_rules
  FROM get_worker_overtime_rules(p_worker_id, p_contract_id, p_attendance_date);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aturan lembur belum dikonfigurasi untuk kontrak atau pekerja ini';
  END IF;

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
    7,  -- normal_hours is always 7 (contract convention, R4)
    v_ot_rules.tier2_threshold_hours,
    'DRAFT', v_user_id
  )
  ON CONFLICT (worker_id, attendance_date)
  DO UPDATE SET
    is_present               = EXCLUDED.is_present,
    overtime_hours           = EXCLUDED.overtime_hours,
    project_id               = EXCLUDED.project_id,
    work_description         = EXCLUDED.work_description,
    daily_rate_snapshot      = EXCLUDED.daily_rate_snapshot,
    tier1_rate_snapshot      = EXCLUDED.tier1_rate_snapshot,
    tier2_rate_snapshot      = EXCLUDED.tier2_rate_snapshot,
    tier1_threshold_snapshot = EXCLUDED.tier1_threshold_snapshot,
    tier2_threshold_snapshot = EXCLUDED.tier2_threshold_snapshot,
    recorded_by              = EXCLUDED.recorded_by
  WHERE worker_attendance_entries.status = 'DRAFT'  -- never overwrite confirmed/settled
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION record_worker_attendance TO authenticated;

-- ============================================================================
-- 5. record_worker_attendance_batch — loop over single RPC, WIB window (F1)
-- ============================================================================
-- Base: 017 (loop delegating to record_worker_attendance). Signature is the
-- live/017 one — same params the app (tools/workerAttendance.ts) already calls.
-- Because it delegates, it inherits the WIB window + the loud no-rate RAISE:
-- a rate-less worker aborts the whole batch instead of being silently dropped
-- (the F18 hazard 020 would have introduced).

CREATE OR REPLACE FUNCTION record_worker_attendance_batch(
  p_contract_id UUID,
  p_attendance_date DATE,
  p_entries JSONB
  -- Expected: [{"worker_id":"...","is_present":true,"overtime_hours":2,"work_description":"..."}, ...]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_entry JSONB;
  v_count INT := 0;
BEGIN
  SELECT mc.project_id INTO v_project_id
  FROM mandor_contracts mc WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- F1/F13: same −14/+7 WIB window as the single-entry RPC (fail fast).
  IF p_attendance_date < sano_wib_today() - 14
     OR p_attendance_date > sano_wib_today() + 7 THEN
    RAISE EXCEPTION 'Tanggal di luar jendela pencatatan (maks 14 hari ke belakang, 7 hari ke depan)';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    PERFORM record_worker_attendance(
      p_contract_id,
      (v_entry->>'worker_id')::UUID,
      p_attendance_date,
      COALESCE((v_entry->>'is_present')::BOOLEAN, true),
      GREATEST(0, COALESCE((v_entry->>'overtime_hours')::NUMERIC, 0)),
      v_entry->>'work_description'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION record_worker_attendance_batch TO authenticated;

-- ============================================================================
-- 6. recompute_opname_header_totals — borongan payment_type isolation (F9)
-- ============================================================================
-- Base: 018 (harian/borongan branch). Only change: the BORONGAN prior_paid sum
-- now filters payment_type='borongan' (COALESCE for pre-018 rows) so a campuran
-- contract's prior harian weeks are not deducted from a borongan week. The
-- harian branch already filtered payment_type='harian'.

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

    v_retention_amount := 0;
    v_net_to_date := v_gross_total;
    v_harian_total := v_gross_total;

    -- prior_paid for harian is isolated to prior harian weeks.
    SELECT COALESCE(SUM(net_this_week), 0)
    INTO v_prior_paid
    FROM opname_headers
    WHERE contract_id = v_contract_id
      AND payment_type = 'harian'
      AND week_number < v_week_number
      AND status IN ('APPROVED', 'PAID');

  ELSE
    -- ============================================================
    -- BORONGAN: progress-based, with retention waterfall
    -- ============================================================
    SELECT COALESCE(SUM(cumulative_amount) FILTER (WHERE NOT is_tdk_acc), 0)
    INTO v_gross_total
    FROM opname_lines
    WHERE header_id = p_header_id;

    -- F9: isolate borongan prior_paid to prior BORONGAN weeks only.
    SELECT COALESCE(SUM(net_to_date), 0)
    INTO v_prior_paid
    FROM opname_headers
    WHERE contract_id = v_contract_id
      AND week_number < v_week_number
      AND status IN ('APPROVED', 'PAID')
      AND COALESCE(payment_type, 'borongan') = 'borongan';

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

GRANT EXECUTE ON FUNCTION recompute_opname_header_totals TO authenticated;

-- ============================================================================
-- 7. verify_opname — freeze the verified gross (F7)
-- ============================================================================
-- Base: 021 (harian allocation gate). Adds one thing: after the final
-- recompute, store the recomputed gross into verified_gross_total so
-- approve_opname can detect any post-verify drift. Signature unchanged.

CREATE OR REPLACE FUNCTION verify_opname(
  p_header_id UUID,
  p_notes TEXT DEFAULT NULL
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

  PERFORM assert_project_role(v_header.project_id, ARRAY['estimator', 'admin', 'principal']);

  -- Re-verification from VERIFIED is allowed: approve_opname refuses to pay
  -- when gross drifted after verify and instructs "lakukan verifikasi ulang",
  -- which re-runs this function to re-freeze verified_gross_total.
  IF v_header.status NOT IN ('SUBMITTED', 'VERIFIED') THEN
    RAISE EXCEPTION 'Hanya opname SUBMITTED atau VERIFIED yang bisa diverifikasi';
  END IF;

  IF v_header.payment_type = 'harian' THEN
    PERFORM recompute_opname_header_totals(p_header_id);
    PERFORM assert_harian_allocation_ready(p_header_id);
  END IF;

  UPDATE opname_headers
  SET status = 'VERIFIED',
      verified_by = auth.uid(),
      verified_at = now(),
      verifier_notes = p_notes
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  PERFORM promote_verified_pct(p_header_id);
  PERFORM recompute_opname_header_totals(p_header_id);

  -- F7: freeze the gross that was just verified. approve_opname compares
  -- against this and refuses if live attendance/progress shifted it.
  UPDATE opname_headers
  SET verified_gross_total = gross_total
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  RETURN v_header;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_opname TO authenticated;

-- ============================================================================
-- 8. settle_kasbon_ledger_for_opname — partial, oldest-first (F10 helper)
-- ============================================================================
-- Recovers outstanding APPROVED advances against a bounded budget
-- (p_recoverable), oldest first. A partially recovered advance stays APPROVED
-- with its settled_amount bumped, so the remainder carries into a later week
-- instead of being clamped away. Returns the total actually recovered, which
-- approve_opname writes to header.kasbon. Each recovery event is logged in
-- kasbon_settlements for void reversal.

CREATE OR REPLACE FUNCTION settle_kasbon_ledger_for_opname(
  p_header_id UUID,
  p_contract_id UUID,
  p_recoverable NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := GREATEST(0, COALESCE(p_recoverable, 0));
  v_total_settled NUMERIC := 0;
  v_outstanding NUMERIC;
  v_take NUMERIC;
  v_adv RECORD;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_adv IN
    SELECT id, amount, COALESCE(settled_amount, 0) AS settled_amount
    FROM mandor_kasbon
    WHERE contract_id = p_contract_id
      AND status = 'APPROVED'
    ORDER BY kasbon_date ASC, created_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_outstanding := GREATEST(0, v_adv.amount - v_adv.settled_amount);
    IF v_outstanding <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_outstanding, v_remaining);
    IF v_take <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO kasbon_settlements (kasbon_id, opname_header_id, contract_id, amount, created_by)
    VALUES (v_adv.id, p_header_id, p_contract_id, v_take, auth.uid());

    UPDATE mandor_kasbon
    SET settled_amount = COALESCE(settled_amount, 0) + v_take,
        status = CASE WHEN COALESCE(settled_amount, 0) + v_take >= amount
                      THEN 'SETTLED' ELSE 'APPROVED' END,
        settled_in_opname_id = CASE WHEN COALESCE(settled_amount, 0) + v_take >= amount
                      THEN p_header_id ELSE settled_in_opname_id END,
        settled_at = CASE WHEN COALESCE(settled_amount, 0) + v_take >= amount
                      THEN now() ELSE settled_at END
    WHERE id = v_adv.id;

    v_total_settled := v_total_settled + v_take;
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN v_total_settled;
END;
$$;

GRANT EXECUTE ON FUNCTION settle_kasbon_ledger_for_opname TO authenticated;

-- ============================================================================
-- 9. approve_opname — gross drift guard + kasbon ledger settlement (F7 / F10)
-- ============================================================================
-- Base: 018 (settles worker attendance for harian). Signature unchanged
-- (p_header_id, p_kasbon). New behavior, in order:
--   1. recompute FIRST (fresh gross / net_to_date / prior_paid).
--   2. F7: if verified_gross_total is set and live gross drifted > 0.01, RAISE.
--   3. F10 kasbon:
--        - p_kasbon > 0  → honor the explicit manual value (current behavior);
--          the estimator has taken over kasbon accounting for this week, so the
--          ledger is left untouched.
--        - otherwise      → auto-settle the ledger, oldest-first, bounded by
--          recoverable = GREATEST(0, net_to_date − prior_paid). header.kasbon
--          becomes the total actually recovered; the unrecovered remainder of
--          any advance stays APPROVED and carries into a later week.
--   4. existing tail: status flip, harian/legacy attendance settlement, final
--      recompute (folds kasbon into net_this_week), refresh future weeks.

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
  v_gross NUMERIC;
  v_verified_gross NUMERIC;
  v_net_to_date NUMERIC;
  v_prior_paid NUMERIC;
  v_recoverable NUMERIC;
  v_kasbon_final NUMERIC;
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

  -- 1. Recompute FIRST so the drift check + recoverable budget use live totals.
  PERFORM recompute_opname_header_totals(p_header_id);

  SELECT gross_total, verified_gross_total, net_to_date, prior_paid
  INTO v_gross, v_verified_gross, v_net_to_date, v_prior_paid
  FROM opname_headers
  WHERE id = p_header_id;

  -- 2. F7: refuse to pay a gross that drifted since verification.
  IF v_verified_gross IS NOT NULL AND ABS(v_gross - v_verified_gross) > 0.01 THEN
    RAISE EXCEPTION 'Gross berubah sejak verifikasi — lakukan verifikasi ulang';
  END IF;

  -- 3. F10: honor an explicit manual kasbon, else auto-settle the ledger.
  IF COALESCE(p_kasbon, 0) > 0 THEN
    v_kasbon_final := p_kasbon;
  ELSE
    v_recoverable := GREATEST(0, COALESCE(v_net_to_date, 0) - COALESCE(v_prior_paid, 0));
    v_kasbon_final := settle_kasbon_ledger_for_opname(
      p_header_id, v_header.contract_id, v_recoverable
    );
  END IF;

  UPDATE opname_headers
  SET status = 'APPROVED',
      approved_by = auth.uid(),
      approved_at = now(),
      kasbon = COALESCE(v_kasbon_final, 0)
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  -- 4. Existing settlement tail.
  IF v_header.payment_type = 'harian'
     AND v_header.week_start IS NOT NULL
     AND v_header.week_end IS NOT NULL THEN
    PERFORM settle_worker_attendance_for_opname(
      p_header_id,
      v_header.week_start,
      v_header.week_end
    );
  END IF;

  -- Legacy headcount attendance (015 table); no-op when empty.
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

GRANT EXECUTE ON FUNCTION approve_opname TO authenticated;

-- ============================================================================
-- 10. recompute_harian_opname — status gate (F7)
-- ============================================================================
-- Base: 018. Adds a gate so an already-decided week's paid totals can no longer
-- be recomputed out from under the approval.

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

  -- F7: never recompute a decided/voided week.
  IF v_header.status IN ('APPROVED', 'PAID', 'VOID') THEN
    RAISE EXCEPTION 'Opname sudah disetujui — tidak bisa dihitung ulang';
  END IF;

  PERFORM assert_project_role(v_header.project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  PERFORM recompute_opname_header_totals(p_header_id);

  SELECT * INTO v_header FROM opname_headers WHERE id = p_header_id;

  RETURN v_header;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_harian_opname TO authenticated;

-- ============================================================================
-- 11. void_opname — audited reversal of a mis-approved week (F8)
-- ============================================================================
-- v1 supports harian only (borongan carries cumulative-progress chains across
-- weeks whose unwind is out of scope). Reverses attendance settlement and
-- kasbon recovery attributed to this header, then marks the header VOID.
--
-- prior_paid computations exclude VOID for free: both branches of
-- recompute_opname_header_totals filter status IN ('APPROVED','PAID'), and VOID
-- is neither — so a voided week stops counting toward later weeks' prior_paid.

CREATE OR REPLACE FUNCTION void_opname(
  p_header_id UUID,
  p_note TEXT
)
RETURNS VOID
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

  IF COALESCE(TRIM(p_note), '') = '' THEN
    RAISE EXCEPTION 'Catatan pembatalan wajib diisi';
  END IF;

  IF v_header.status NOT IN ('APPROVED', 'PAID') THEN
    RAISE EXCEPTION 'Hanya opname APPROVED atau PAID yang bisa dibatalkan';
  END IF;

  IF v_header.payment_type <> 'harian' THEN
    RAISE EXCEPTION 'Void untuk opname borongan belum didukung';
  END IF;

  -- 1. Un-settle this header's attendance (SETTLED → CONFIRMED).
  UPDATE worker_attendance_entries
  SET status = 'CONFIRMED',
      settled_in_opname_id = NULL,
      settled_at = NULL
  WHERE settled_in_opname_id = p_header_id
    AND status = 'SETTLED';

  -- 2. Revert kasbon recovery attributed to this header. Derive status purely
  --    from the restored settled_amount: still fully covered ⇒ stays SETTLED
  --    (with its original linkage); otherwise reopen to APPROVED and clear the
  --    settlement linkage. Handles partial recoveries carried across weeks.
  UPDATE mandor_kasbon mk
  SET settled_amount = GREATEST(0, COALESCE(mk.settled_amount, 0) - s.total),
      status = CASE WHEN GREATEST(0, COALESCE(mk.settled_amount, 0) - s.total) >= mk.amount
                    THEN 'SETTLED' ELSE 'APPROVED' END,
      settled_in_opname_id = CASE WHEN GREATEST(0, COALESCE(mk.settled_amount, 0) - s.total) >= mk.amount
                    THEN mk.settled_in_opname_id ELSE NULL END,
      settled_at = CASE WHEN GREATEST(0, COALESCE(mk.settled_amount, 0) - s.total) >= mk.amount
                    THEN mk.settled_at ELSE NULL END
  FROM (
    SELECT kasbon_id, SUM(amount) AS total
    FROM kasbon_settlements
    WHERE opname_header_id = p_header_id
    GROUP BY kasbon_id
  ) s
  WHERE mk.id = s.kasbon_id;

  DELETE FROM kasbon_settlements WHERE opname_header_id = p_header_id;

  -- 3. Mark the header VOID.
  UPDATE opname_headers
  SET status = 'VOID',
      void_note = p_note,
      voided_by = auth.uid(),
      voided_at = now()
  WHERE id = p_header_id;

  -- 4. Later weeks no longer see this week as prior_paid.
  PERFORM refresh_opname_headers_for_contract(v_header.contract_id, v_header.week_number + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION void_opname TO authenticated;
