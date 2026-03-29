-- supabase/migrations/010_opname_rebuild.sql
-- SANO — Opname Architecture Rebuild
-- Integrates mandor payment with Gate 4 progress and Gate 5 reconciliation.
-- Moves all payment computation into Postgres RPCs with role enforcement.
--
-- Run AFTER 008_labor_opname.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. AUDIT TABLE: opname_line_revisions
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_line_id UUID NOT NULL REFERENCES opname_lines(id) ON DELETE CASCADE,
  header_id UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  -- Cascades intentional: revisions are operational audit data, deleted with their parent header.
  changed_by UUID NOT NULL REFERENCES profiles(id),
  field_name TEXT NOT NULL,
  old_value NUMERIC,
  new_value NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_line
  ON opname_line_revisions(opname_line_id);
CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_header
  ON opname_line_revisions(header_id);

-- RLS: same access as opname_lines (project-assigned users)
ALTER TABLE opname_line_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opname_line_revisions_select" ON opname_line_revisions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM opname_headers oh
    JOIN project_assignments pa ON pa.project_id = oh.project_id
    WHERE oh.id = opname_line_revisions.header_id AND pa.user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MISSING INDEXES on ahs_lines
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ahs_lines_trade_category
  ON ahs_lines(trade_category)
  WHERE trade_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ahs_lines_line_type_trade
  ON ahs_lines(line_type, trade_category)
  WHERE line_type = 'labor';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. BATCH TRADE CATEGORY RPC (replaces serial JS loop)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_detected_trade_categories(
  p_updates JSONB  -- array of {"id": "uuid", "trade_category": "text"}
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item JSONB;
BEGIN
  -- Validate input is a JSON array
  IF p_updates IS NULL OR jsonb_typeof(p_updates) != 'array' THEN
    RAISE EXCEPTION 'apply_detected_trade_categories: p_updates must be a non-null JSON array';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    -- Skip items missing required fields rather than crashing
    CONTINUE WHEN item->>'id' IS NULL OR item->>'trade_category' IS NULL;

    UPDATE ahs_lines
    SET trade_category = item->>'trade_category'
    WHERE id = (item->>'id')::UUID
      AND (trade_confirmed = false OR trade_confirmed IS NULL);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION apply_detected_trade_categories(JSONB) IS
'Batch update ahs_lines trade_category from detected values.
Input: JSONB array of {id: uuid, trade_category: text}.
Only updates lines where trade_confirmed is false or null.
Runs SECURITY DEFINER to bypass per-row RLS on ahs_lines.
Items with missing id or trade_category are silently skipped.';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. VIEW: v_opname_progress_reconciliation
--    Cross-references opname claimed % against Gate 4 field progress.
--    Flags lines where mandor claim diverges significantly from
--    field-verified installed progress.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_opname_progress_reconciliation AS
SELECT
  ol.id AS line_id,
  ol.header_id,
  oh.project_id,
  oh.contract_id,
  oh.week_number,
  ol.boq_item_id,
  bi.code AS boq_code,
  bi.label AS boq_label,
  bi.unit,
  bi.planned AS budget_volume,
  -- Mandor's claimed progress
  COALESCE(ol.verified_pct, ol.cumulative_pct) AS claimed_progress_pct,
  -- Field-verified progress from Gate 4 progress_entries
  CASE
    WHEN bi.planned > 0
    THEN ROUND((bi.installed / bi.planned) * 100, 1)
    ELSE 0
  END AS field_progress_pct,
  -- Variance: positive = mandor claims MORE than field shows
  COALESCE(ol.verified_pct, ol.cumulative_pct)
    - CASE
        WHEN bi.planned > 0
        THEN ROUND((bi.installed / bi.planned) * 100, 1)
        ELSE 0
      END AS variance_pct,
  -- Flag
  CASE
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 20 THEN 'HIGH'
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 10 THEN 'WARNING'
    ELSE 'OK'
  END AS variance_flag
FROM opname_lines ol
JOIN opname_headers oh ON oh.id = ol.header_id
JOIN boq_items bi ON bi.id = ol.boq_item_id;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. TRIGGER: Auto-recompute opname_header totals on line changes
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_recompute_opname_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_header_id UUID;
  v_gross NUMERIC;
  v_ret_pct NUMERIC;
  v_retention NUMERIC;
  v_net_to_date NUMERIC;
  v_prior_paid NUMERIC;
  v_kasbon NUMERIC;
BEGIN
  v_header_id := COALESCE(NEW.header_id, OLD.header_id);

  -- Sum gross from non-rejected lines
  SELECT COALESCE(SUM(cumulative_amount), 0)
  INTO v_gross
  FROM opname_lines
  WHERE header_id = v_header_id
    AND is_tdk_acc = false;

  -- Get header payment params
  SELECT retention_pct, prior_paid, kasbon
  INTO v_ret_pct, v_prior_paid, v_kasbon
  FROM opname_headers
  WHERE id = v_header_id;

  v_retention := v_gross * (v_ret_pct / 100);
  v_net_to_date := v_gross - v_retention;

  UPDATE opname_headers SET
    gross_total = v_gross,
    retention_amount = v_retention,
    net_to_date = v_net_to_date,
    net_this_week = GREATEST(0, v_net_to_date - v_prior_paid - v_kasbon)
  WHERE id = v_header_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_opname_totals ON opname_lines;
CREATE TRIGGER trg_recompute_opname_totals
  AFTER INSERT OR UPDATE OR DELETE ON opname_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_recompute_opname_totals();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. RPC: update_opname_line_progress
--    Updates a line's progress %, recomputes amounts, logs revisions.
--    The trigger on opname_lines will auto-recompute header totals.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_opname_line_progress(
  p_line_id UUID,
  p_cumulative_pct NUMERIC DEFAULT NULL,
  p_verified_pct NUMERIC DEFAULT NULL,
  p_is_tdk_acc BOOLEAN DEFAULT NULL,
  p_tdk_acc_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line opname_lines%ROWTYPE;
  v_effective_pct NUMERIC;
  v_prev_pct NUMERIC;
  v_this_week_pct NUMERIC;
  v_header_id UUID;
BEGIN
  SELECT * INTO v_line FROM opname_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname line not found: %', p_line_id;
  END IF;

  -- Validate percentage bounds
  IF p_cumulative_pct IS NOT NULL AND (p_cumulative_pct < 0 OR p_cumulative_pct > 100) THEN
    RAISE EXCEPTION 'cumulative_pct must be between 0 and 100, got %', p_cumulative_pct;
  END IF;
  IF p_verified_pct IS NOT NULL AND (p_verified_pct < 0 OR p_verified_pct > 100) THEN
    RAISE EXCEPTION 'verified_pct must be between 0 and 100, got %', p_verified_pct;
  END IF;

  v_header_id := v_line.header_id;

  -- Log revision if verified_pct is being changed
  IF p_verified_pct IS NOT NULL AND p_verified_pct IS DISTINCT FROM v_line.verified_pct THEN
    INSERT INTO opname_line_revisions (opname_line_id, header_id, changed_by, field_name, old_value, new_value, reason)
    VALUES (p_line_id, v_header_id, auth.uid(), 'verified_pct',
            v_line.verified_pct, p_verified_pct, p_notes);
  END IF;

  -- Log revision if cumulative_pct is being changed
  IF p_cumulative_pct IS NOT NULL AND p_cumulative_pct IS DISTINCT FROM v_line.cumulative_pct THEN
    INSERT INTO opname_line_revisions (opname_line_id, header_id, changed_by, field_name, old_value, new_value, reason)
    VALUES (p_line_id, v_header_id, auth.uid(), 'cumulative_pct',
            v_line.cumulative_pct, p_cumulative_pct, p_notes);
  END IF;

  -- Compute amounts
  v_effective_pct := COALESCE(p_verified_pct, p_cumulative_pct, v_line.verified_pct, v_line.cumulative_pct, 0) / 100;
  v_prev_pct := COALESCE(v_line.prev_cumulative_pct, 0) / 100;
  v_this_week_pct := GREATEST(0, v_effective_pct - v_prev_pct);

  UPDATE opname_lines SET
    cumulative_pct = COALESCE(p_cumulative_pct, cumulative_pct),
    verified_pct = CASE WHEN p_verified_pct IS NOT NULL THEN p_verified_pct ELSE verified_pct END,
    is_tdk_acc = COALESCE(p_is_tdk_acc, is_tdk_acc),
    tdk_acc_reason = CASE WHEN p_tdk_acc_reason IS NOT NULL THEN p_tdk_acc_reason ELSE tdk_acc_reason END,
    notes = CASE WHEN p_notes IS NOT NULL THEN p_notes ELSE notes END,
    cumulative_amount = v_line.budget_volume * v_line.contracted_rate * v_effective_pct,
    this_week_amount = v_line.budget_volume * v_line.contracted_rate * v_this_week_pct
  WHERE id = p_line_id;
  -- Trigger will auto-recompute header totals
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. RPC: submit_opname (any project-assigned user)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_opname(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id
  FROM opname_headers WHERE id = p_header_id AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in DRAFT status';
  END IF;

  -- Verify user is assigned to this project
  IF NOT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = v_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User not assigned to this project';
  END IF;

  UPDATE opname_headers SET
    status = 'SUBMITTED',
    submitted_by = auth.uid(),
    submitted_at = now()
  WHERE id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RPC: verify_opname (estimator, admin, principal only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION verify_opname(p_header_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id UUID;
  v_role TEXT;
BEGIN
  SELECT project_id INTO v_project_id
  FROM opname_headers WHERE id = p_header_id AND status = 'SUBMITTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in SUBMITTED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('estimator', 'admin', 'principal') THEN
    RAISE EXCEPTION 'Only estimator, admin, or principal can verify opname';
  END IF;

  UPDATE opname_headers SET
    status = 'VERIFIED',
    verified_by = auth.uid(),
    verified_at = now(),
    verifier_notes = COALESCE(p_notes, verifier_notes)
  WHERE id = p_header_id;

  -- Promote verified_pct: lock in the verified values for next week
  PERFORM promote_verified_pct(p_header_id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RPC: approve_opname (admin, principal only)
--    Refreshes prior_paid before computing final net_this_week.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION approve_opname(p_header_id UUID, p_kasbon NUMERIC DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
  v_role TEXT;
  v_fresh_prior_paid NUMERIC;
BEGIN
  SELECT * INTO v_header
  FROM opname_headers WHERE id = p_header_id AND status = 'VERIFIED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in VERIFIED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'principal') THEN
    RAISE EXCEPTION 'Only admin or principal can approve opname';
  END IF;

  -- Refresh prior_paid with latest approved data (not frozen at creation)
  SELECT COALESCE(SUM(net_to_date), 0) INTO v_fresh_prior_paid
  FROM opname_headers
  WHERE contract_id = v_header.contract_id
    AND week_number < v_header.week_number
    AND status IN ('APPROVED', 'PAID');

  UPDATE opname_headers SET
    status = 'APPROVED',
    approved_by = auth.uid(),
    approved_at = now(),
    kasbon = p_kasbon,
    prior_paid = v_fresh_prior_paid,
    net_this_week = GREATEST(0, COALESCE(net_to_date, 0) - v_fresh_prior_paid - COALESCE(p_kasbon, 0))
  WHERE id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. RPC: mark_opname_paid (admin, principal only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION mark_opname_paid(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opname_headers WHERE id = p_header_id AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Opname not found or not in APPROVED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'principal') THEN
    RAISE EXCEPTION 'Only admin or principal can mark opname as paid';
  END IF;

  UPDATE opname_headers SET status = 'PAID' WHERE id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. RPC: promote_verified_pct
--    After verification, lock in the effective % so next week's
--    initOpnameLines uses the correct prev_cumulative_pct.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_verified_pct(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- For lines where estimator set verified_pct, that becomes canonical.
  -- For lines without verified_pct, cumulative_pct is already canonical.
  -- The get_prev_line_pct function already uses COALESCE(verified_pct, cumulative_pct).
  -- We recompute amounts to ensure consistency after any estimator adjustments.
  UPDATE opname_lines SET
    cumulative_amount = budget_volume * contracted_rate
      * (COALESCE(verified_pct, cumulative_pct, 0) / 100),
    this_week_amount = budget_volume * contracted_rate
      * GREATEST(0, (COALESCE(verified_pct, cumulative_pct, 0) - COALESCE(prev_cumulative_pct, 0)) / 100)
  WHERE header_id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. RPC: refresh_prior_paid
--    Recalculates prior_paid for an opname header from current approved data.
--    Called by approve_opname, but also available standalone.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_prior_paid(p_header_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contract_id UUID;
  v_week INT;
  v_prior NUMERIC;
BEGIN
  SELECT contract_id, week_number INTO v_contract_id, v_week
  FROM opname_headers WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname header not found: %', p_header_id;
  END IF;

  SELECT COALESCE(SUM(net_to_date), 0) INTO v_prior
  FROM opname_headers
  WHERE contract_id = v_contract_id
    AND week_number < v_week
    AND status IN ('APPROVED', 'PAID');

  UPDATE opname_headers SET prior_paid = v_prior WHERE id = p_header_id;
  RETURN v_prior;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. VIEW: v_labor_payment_summary
--     Aggregates opname data per project for Gate 5 reconciliation.
--     Shows total labor cost vs BoQ budget per mandor and overall.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_labor_payment_summary AS
SELECT
  oh.project_id,
  mc.id AS contract_id,
  mc.mandor_name,
  mc.trade_categories,
  -- Payment totals across all opnames for this mandor
  COUNT(oh.id) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS approved_opname_count,
  COALESCE(SUM(oh.gross_total) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_gross,
  COALESCE(SUM(oh.retention_amount) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_retention,
  COALESCE(SUM(oh.net_this_week) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_paid,
  COALESCE(SUM(oh.kasbon) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_kasbon,
  -- Budget comparison: sum of (budget_volume * boq_labor_rate) across all contract rates
  COALESCE(budget.total_boq_labor_budget, 0) AS total_boq_labor_budget,
  COALESCE(budget.total_contracted_budget, 0) AS total_contracted_budget,
  -- Variance
  CASE
    WHEN COALESCE(budget.total_boq_labor_budget, 0) > 0
    THEN ROUND(
      ((COALESCE(budget.total_contracted_budget, 0) - budget.total_boq_labor_budget)
       / budget.total_boq_labor_budget) * 100, 1
    )
    ELSE 0
  END AS contract_vs_boq_variance_pct,
  -- Latest opname info
  MAX(oh.week_number) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS latest_approved_week,
  MAX(oh.opname_date) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS latest_approved_date
FROM mandor_contracts mc
LEFT JOIN opname_headers oh ON oh.contract_id = mc.id
LEFT JOIN LATERAL (
  SELECT
    SUM(cr.budget_volume_calc * cr.boq_labor_rate) AS total_boq_labor_budget,
    SUM(cr.budget_volume_calc * cr.contracted_rate) AS total_contracted_budget
  FROM (
    SELECT
      mcr.boq_labor_rate,
      mcr.contracted_rate,
      COALESCE(bi.planned, 0) AS budget_volume_calc
    FROM mandor_contract_rates mcr
    JOIN boq_items bi ON bi.id = mcr.boq_item_id
    WHERE mcr.contract_id = mc.id
  ) cr
) budget ON true
WHERE mc.is_active = true
GROUP BY oh.project_id, mc.id, mc.mandor_name, mc.trade_categories,
         budget.total_boq_labor_budget, budget.total_contracted_budget;