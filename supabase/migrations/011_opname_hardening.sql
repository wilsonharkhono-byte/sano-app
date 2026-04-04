-- SANO — Phase 3b: Labor Opname Hardening
-- Moves critical opname logic into the database, adds audit/reconciliation
-- helpers, and tightens role-based write access.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ahs_lines_labor_trade_lookup
  ON ahs_lines(trade_category, boq_item_id)
  WHERE line_type = 'labor' AND trade_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ahs_lines_labor_project_lookup
  ON ahs_lines(boq_item_id, trade_confirmed)
  WHERE line_type = 'labor';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. OPNAME REVISION LOG
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL REFERENCES opname_lines(id) ON DELETE CASCADE,
  header_id UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES profiles(id),
  change_type TEXT NOT NULL
    CHECK (change_type IN ('verified_pct_adjustment', 'tdk_acc_toggle', 'baseline_refresh')),
  old_cumulative_pct NUMERIC,
  new_cumulative_pct NUMERIC,
  old_verified_pct NUMERIC,
  new_verified_pct NUMERIC,
  old_is_tdk_acc BOOLEAN,
  new_is_tdk_acc BOOLEAN,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_line
  ON opname_line_revisions(line_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_header
  ON opname_line_revisions(header_id, created_at DESC);

ALTER TABLE opname_line_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opname_line_revisions_select" ON opname_line_revisions;
DROP POLICY IF EXISTS "opname_line_revisions_insert" ON opname_line_revisions;
CREATE POLICY "opname_line_revisions_select" ON opname_line_revisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      WHERE oh.id = opname_line_revisions.header_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "opname_line_revisions_insert" ON opname_line_revisions
  FOR INSERT
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      WHERE oh.id = opname_line_revisions.header_id
        AND pa.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION opname_effective_pct(
  p_cumulative_pct NUMERIC,
  p_verified_pct NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, LEAST(100, COALESCE(p_verified_pct, p_cumulative_pct, 0)));
$$;

CREATE OR REPLACE FUNCTION opname_this_week_pct(
  p_cumulative_pct NUMERIC,
  p_verified_pct NUMERIC,
  p_prev_pct NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, opname_effective_pct(p_cumulative_pct, p_verified_pct) - GREATEST(0, LEAST(100, COALESCE(p_prev_pct, 0))));
$$;

CREATE OR REPLACE FUNCTION assert_project_role(
  p_project_id UUID,
  p_allowed_roles TEXT[]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User belum login';
  END IF;

  SELECT pr.role
  INTO v_role
  FROM profiles pr
  JOIN project_assignments pa
    ON pa.user_id = pr.id
   AND pa.project_id = p_project_id
  WHERE pr.id = auth.uid()
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'User tidak ditugaskan ke project ini';
  END IF;

  IF NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'Role % tidak diizinkan untuk aksi ini', v_role;
  END IF;

  RETURN v_role;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SERVER-SIDE PAYMENT WATERFALL
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_opname_line_amounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_effective_pct NUMERIC;
  v_this_week_pct NUMERIC;
BEGIN
  v_effective_pct := opname_effective_pct(NEW.cumulative_pct, NEW.verified_pct);
  v_this_week_pct := opname_this_week_pct(NEW.cumulative_pct, NEW.verified_pct, NEW.prev_cumulative_pct);

  NEW.cumulative_amount := COALESCE(NEW.budget_volume, 0) * COALESCE(NEW.contracted_rate, 0) * (v_effective_pct / 100.0);
  NEW.this_week_amount := COALESCE(NEW.budget_volume, 0) * COALESCE(NEW.contracted_rate, 0) * (v_this_week_pct / 100.0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opname_lines_set_amounts ON opname_lines;
CREATE TRIGGER trg_opname_lines_set_amounts
  BEFORE INSERT OR UPDATE OF cumulative_pct, verified_pct, prev_cumulative_pct, budget_volume, contracted_rate
  ON opname_lines
  FOR EACH ROW
  EXECUTE FUNCTION set_opname_line_amounts();

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
  v_gross_total NUMERIC;
  v_prior_paid NUMERIC;
  v_retention_amount NUMERIC;
  v_net_to_date NUMERIC;
BEGIN
  SELECT contract_id, week_number, retention_pct, kasbon
  INTO v_contract_id, v_week_number, v_retention_pct, v_kasbon
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

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

  UPDATE opname_headers
  SET gross_total = v_gross_total,
      retention_amount = v_retention_amount,
      net_to_date = v_net_to_date,
      prior_paid = v_prior_paid,
      net_this_week = GREATEST(0, v_net_to_date - v_prior_paid - COALESCE(v_kasbon, 0))
  WHERE id = p_header_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_opname_headers_for_contract(
  p_contract_id UUID,
  p_from_week_number INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header RECORD;
  v_count INT := 0;
BEGIN
  FOR v_header IN
    SELECT id
    FROM opname_headers
    WHERE contract_id = p_contract_id
      AND week_number >= p_from_week_number
    ORDER BY week_number
  LOOP
    PERFORM recompute_opname_header_totals(v_header.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_future_opname_line_baselines(
  p_contract_id UUID,
  p_from_week_number INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  UPDATE opname_lines future_line
  SET prev_cumulative_pct = COALESCE((
    SELECT COALESCE(prev_line.verified_pct, prev_line.cumulative_pct)
    FROM opname_lines prev_line
    JOIN opname_headers prev_header ON prev_header.id = prev_line.header_id
    JOIN opname_headers future_header ON future_header.id = future_line.header_id
    WHERE prev_header.contract_id = p_contract_id
      AND prev_line.boq_item_id = future_line.boq_item_id
      AND prev_header.week_number < future_header.week_number
      AND prev_header.status IN ('VERIFIED', 'APPROVED', 'PAID')
    ORDER BY prev_header.week_number DESC
    LIMIT 1
  ), 0)
  FROM opname_headers future_header
  WHERE future_header.id = future_line.header_id
    AND future_header.contract_id = p_contract_id
    AND future_header.week_number >= p_from_week_number;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION after_opname_line_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_header_id UUID;
  v_contract_id UUID;
  v_week_number INT;
  v_status TEXT;
BEGIN
  v_header_id := COALESCE(NEW.header_id, OLD.header_id);

  SELECT contract_id, week_number, status
  INTO v_contract_id, v_week_number, v_status
  FROM opname_headers
  WHERE id = v_header_id;

  IF v_header_id IS NULL OR v_contract_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM recompute_opname_header_totals(v_header_id);

  IF v_status IN ('APPROVED', 'PAID') THEN
    PERFORM refresh_opname_headers_for_contract(v_contract_id, v_week_number + 1);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_opname_lines_recompute_header ON opname_lines;
CREATE TRIGGER trg_opname_lines_recompute_header
  AFTER INSERT OR UPDATE OR DELETE
  ON opname_lines
  FOR EACH ROW
  EXECUTE FUNCTION after_opname_line_change();

CREATE OR REPLACE FUNCTION log_opname_line_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.verified_pct IS DISTINCT FROM OLD.verified_pct THEN
    INSERT INTO opname_line_revisions (
      line_id,
      header_id,
      boq_item_id,
      changed_by,
      change_type,
      old_cumulative_pct,
      new_cumulative_pct,
      old_verified_pct,
      new_verified_pct,
      old_is_tdk_acc,
      new_is_tdk_acc,
      reason
    )
    VALUES (
      NEW.id,
      NEW.header_id,
      NEW.boq_item_id,
      auth.uid(),
      'verified_pct_adjustment',
      OLD.cumulative_pct,
      NEW.cumulative_pct,
      OLD.verified_pct,
      NEW.verified_pct,
      OLD.is_tdk_acc,
      NEW.is_tdk_acc,
      COALESCE(NEW.notes, NEW.tdk_acc_reason, 'Verifier adjustment')
    );
  ELSIF NEW.is_tdk_acc IS DISTINCT FROM OLD.is_tdk_acc
     OR NEW.tdk_acc_reason IS DISTINCT FROM OLD.tdk_acc_reason THEN
    INSERT INTO opname_line_revisions (
      line_id,
      header_id,
      boq_item_id,
      changed_by,
      change_type,
      old_cumulative_pct,
      new_cumulative_pct,
      old_verified_pct,
      new_verified_pct,
      old_is_tdk_acc,
      new_is_tdk_acc,
      reason
    )
    VALUES (
      NEW.id,
      NEW.header_id,
      NEW.boq_item_id,
      auth.uid(),
      'tdk_acc_toggle',
      OLD.cumulative_pct,
      NEW.cumulative_pct,
      OLD.verified_pct,
      NEW.verified_pct,
      OLD.is_tdk_acc,
      NEW.is_tdk_acc,
      COALESCE(NEW.tdk_acc_reason, 'TDK ACC updated')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opname_lines_log_revision ON opname_lines;
CREATE TRIGGER trg_opname_lines_log_revision
  AFTER UPDATE
  ON opname_lines
  FOR EACH ROW
  EXECUTE FUNCTION log_opname_line_revision();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. STATUS / WORKFLOW RPCS
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_verified_pct(
  p_header_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
  v_week_number INT;
  v_project_id UUID;
  v_updated INT := 0;
BEGIN
  SELECT contract_id, week_number, project_id
  INTO v_contract_id, v_week_number, v_project_id
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['estimator', 'admin', 'principal']);

  UPDATE opname_lines
  SET cumulative_pct = COALESCE(verified_pct, cumulative_pct)
  WHERE header_id = p_header_id
    AND verified_pct IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  PERFORM recompute_opname_header_totals(p_header_id);
  PERFORM refresh_future_opname_line_baselines(v_contract_id, v_week_number + 1);
  PERFORM refresh_opname_headers_for_contract(v_contract_id, v_week_number + 1);

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION update_opname_line_progress(
  p_line_id UUID,
  p_cumulative_pct NUMERIC DEFAULT NULL,
  p_verified_pct NUMERIC DEFAULT NULL,
  p_is_tdk_acc BOOLEAN DEFAULT NULL,
  p_tdk_acc_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS opname_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line opname_lines%ROWTYPE;
  v_header opname_headers%ROWTYPE;
BEGIN
  SELECT *
  INTO v_line
  FROM opname_lines
  WHERE id = p_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Line opname tidak ditemukan';
  END IF;

  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = v_line.header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  IF v_header.status = 'DRAFT' THEN
    PERFORM assert_project_role(v_header.project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

    IF p_verified_pct IS NOT NULL OR p_is_tdk_acc IS NOT NULL OR p_tdk_acc_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Draft opname hanya boleh mengubah progress klaim';
    END IF;

    UPDATE opname_lines
    SET cumulative_pct = COALESCE(p_cumulative_pct, cumulative_pct),
        notes = COALESCE(p_notes, notes)
    WHERE id = p_line_id
    RETURNING * INTO v_line;
  ELSIF v_header.status = 'SUBMITTED' THEN
    PERFORM assert_project_role(v_header.project_id, ARRAY['estimator', 'admin', 'principal']);

    IF p_cumulative_pct IS NOT NULL THEN
      RAISE EXCEPTION 'Progress klaim tidak boleh diubah setelah diajukan';
    END IF;

    UPDATE opname_lines
    SET verified_pct = COALESCE(p_verified_pct, verified_pct),
        is_tdk_acc = COALESCE(p_is_tdk_acc, is_tdk_acc),
        tdk_acc_reason = CASE
          WHEN COALESCE(p_is_tdk_acc, is_tdk_acc) = false THEN NULL
          ELSE COALESCE(p_tdk_acc_reason, tdk_acc_reason)
        END,
        notes = COALESCE(p_notes, notes)
    WHERE id = p_line_id
    RETURNING * INTO v_line;
  ELSE
    RAISE EXCEPTION 'Line opname pada status % tidak dapat diedit', v_header.status;
  END IF;

  RETURN v_line;
END;
$$;

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

  SELECT COUNT(*)
  INTO v_line_count
  FROM opname_lines
  WHERE header_id = p_header_id;

  IF COALESCE(v_line_count, 0) = 0 THEN
    RAISE EXCEPTION 'Opname belum memiliki item pembayaran. Set kontrak mandor terlebih dahulu';
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

  IF v_header.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Hanya opname SUBMITTED yang bisa diverifikasi';
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

  RETURN v_header;
END;
$$;

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

  PERFORM recompute_opname_header_totals(p_header_id);
  PERFORM refresh_opname_headers_for_contract(v_header.contract_id, v_header.week_number + 1);

  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  RETURN v_header;
END;
$$;

CREATE OR REPLACE FUNCTION mark_opname_paid(
  p_header_id UUID
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

  IF v_header.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Hanya opname APPROVED yang bisa ditandai PAID';
  END IF;

  UPDATE opname_headers
  SET status = 'PAID'
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  RETURN v_header;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. PROGRESS RECONCILIATION VIEW
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_opname_progress_reconciliation AS
SELECT
  oh.id AS header_id,
  oh.project_id,
  oh.contract_id,
  oh.week_number,
  oh.status,
  ol.id AS line_id,
  ol.boq_item_id,
  bi.code AS boq_code,
  bi.label AS boq_label,
  COALESCE(ol.verified_pct, ol.cumulative_pct) AS claimed_progress_pct,
  COALESCE(bi.progress, 0) AS field_progress_pct,
  COALESCE(ol.verified_pct, ol.cumulative_pct) - COALESCE(bi.progress, 0) AS variance_pct,
  CASE
    WHEN ABS(COALESCE(ol.verified_pct, ol.cumulative_pct) - COALESCE(bi.progress, 0)) >= 15 THEN 'HIGH'
    WHEN ABS(COALESCE(ol.verified_pct, ol.cumulative_pct) - COALESCE(bi.progress, 0)) >= 5 THEN 'WARNING'
    ELSE 'OK'
  END AS variance_flag
FROM opname_lines ol
JOIN opname_headers oh ON oh.id = ol.header_id
JOIN boq_items bi ON bi.id = ol.boq_item_id;

CREATE OR REPLACE VIEW v_gate5_labor_reconciliation AS
SELECT
  oh.project_id,
  oh.id AS opname_id,
  oh.week_number,
  oh.opname_date,
  oh.status,
  mc.id AS contract_id,
  mc.mandor_name,
  mc.trade_categories,
  oh.gross_total,
  oh.retention_pct,
  oh.retention_amount,
  oh.net_to_date,
  oh.prior_paid,
  oh.kasbon,
  oh.net_this_week,
  oh.submitted_at,
  oh.verified_at,
  oh.approved_at,
  COUNT(ol.id) AS line_count,
  COUNT(ol.id) FILTER (WHERE ol.is_tdk_acc) AS tdk_acc_count,
  ROUND(AVG(COALESCE(ol.verified_pct, ol.cumulative_pct)), 1) AS avg_progress_pct
FROM opname_headers oh
JOIN mandor_contracts mc ON mc.id = oh.contract_id
LEFT JOIN opname_lines ol ON ol.header_id = oh.id
GROUP BY
  oh.project_id, oh.id, oh.week_number, oh.opname_date, oh.status,
  mc.id, mc.mandor_name, mc.trade_categories,
  oh.gross_total, oh.retention_pct, oh.retention_amount,
  oh.net_to_date, oh.prior_paid, oh.kasbon, oh.net_this_week,
  oh.submitted_at, oh.verified_at, oh.approved_at;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. BULK LABOR TRADE TAGGING
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_detected_trade_categories(
  p_updates JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_project_id UUID;
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates) = 0 THEN
    RETURN 0;
  END IF;

  SELECT bi.project_id
  INTO v_project_id
  FROM jsonb_to_recordset(p_updates) AS upd(id UUID, trade_category TEXT)
  JOIN ahs_lines al ON al.id = upd.id
  JOIN boq_items bi ON bi.id = al.boq_item_id
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['estimator', 'admin', 'principal']);

  UPDATE ahs_lines al
  SET trade_category = upd.trade_category::TEXT
  FROM jsonb_to_recordset(p_updates) AS upd(id UUID, trade_category TEXT)
  WHERE al.id = upd.id
    AND EXISTS (
      SELECT 1
      FROM boq_items bi
      WHERE bi.id = al.boq_item_id
        AND bi.project_id = v_project_id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RLS TIGHTENING
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "opname_headers_write" ON opname_headers;
DROP POLICY IF EXISTS "opname_lines_write" ON opname_lines;

DROP POLICY IF EXISTS "opname_headers_insert" ON opname_headers;
DROP POLICY IF EXISTS "opname_lines_insert" ON opname_lines;

CREATE POLICY "opname_headers_insert" ON opname_headers
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );

CREATE POLICY "opname_lines_insert" ON opname_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE oh.id = opname_lines.header_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );
