-- Migration 017: Mandor Workers, Rates, Overtime Rules, and Per-Worker Attendance
--
-- Replaces the flat mandor_attendance (headcount model) with per-worker daily
-- entries that support individual rates, overtime tiers, and attendance app
-- integration.  The old mandor_attendance table is kept for historical data
-- but is not used by new harian opname workflows.
--
-- See docs/harian_payment_architecture.md for full design.

-- ============================================================================
-- 1. MANDOR WORKERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS mandor_workers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_name     TEXT NOT NULL,
  skill_level     TEXT NOT NULL DEFAULT 'lainnya'
    CHECK (skill_level IN ('wakil_mandor', 'tukang', 'kenek', 'operator', 'lainnya')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, worker_name)
);

CREATE INDEX IF NOT EXISTS idx_mandor_workers_contract
  ON mandor_workers (contract_id, is_active);

CREATE INDEX IF NOT EXISTS idx_mandor_workers_project
  ON mandor_workers (project_id);

-- ============================================================================
-- 2. WORKER RATES (rate history per worker)
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       UUID NOT NULL REFERENCES mandor_workers(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  daily_rate      NUMERIC NOT NULL CHECK (daily_rate > 0),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,  -- NULL = currently active
  notes           TEXT,
  set_by          UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_rates_worker
  ON worker_rates (worker_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_worker_rates_contract
  ON worker_rates (contract_id);

-- ============================================================================
-- 3. MANDOR OVERTIME RULES (per contract)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mandor_overtime_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id             UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  normal_hours            NUMERIC NOT NULL DEFAULT 7,
    -- net hours per day covered by daily_rate (8am-4pm minus 1hr lunch = 7 hours)
  tier1_threshold_hours   NUMERIC NOT NULL DEFAULT 7,
    -- overtime starts when total worked hours exceed this
  tier1_hourly_rate       NUMERIC NOT NULL DEFAULT 0,
    -- Rp per overtime hour in tier 1
  tier2_threshold_hours   NUMERIC NOT NULL DEFAULT 10,
    -- second tier starts when total worked hours exceed this
  tier2_hourly_rate       NUMERIC NOT NULL DEFAULT 0,
    -- Rp per overtime hour in tier 2
  effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_overtime_rules_contract
  ON mandor_overtime_rules (contract_id, effective_from DESC);

-- ============================================================================
-- 4. WORKER ATTENDANCE ENTRIES (one per worker per day)
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_attendance_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_id           UUID NOT NULL REFERENCES mandor_workers(id) ON DELETE CASCADE,
  attendance_date     DATE NOT NULL,

  -- Presence
  is_present          BOOLEAN NOT NULL DEFAULT true,
  overtime_hours      NUMERIC NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),

  -- Snapshot of rates at time of entry (frozen for audit)
  daily_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier1_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier2_rate_snapshot     NUMERIC NOT NULL DEFAULT 0,
  tier1_threshold_snapshot NUMERIC NOT NULL DEFAULT 7,
  tier2_threshold_snapshot NUMERIC NOT NULL DEFAULT 10,

  -- Computed pay
  regular_pay         NUMERIC NOT NULL DEFAULT 0,
  overtime_pay        NUMERIC NOT NULL DEFAULT 0,
  day_total           NUMERIC NOT NULL DEFAULT 0,

  -- Workflow
  status              TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'OVERRIDDEN', 'SETTLED')),
  work_description    TEXT,

  -- Who did what
  recorded_by             UUID NOT NULL REFERENCES profiles(id),
  confirmed_by            UUID REFERENCES profiles(id),
  confirmed_at            TIMESTAMPTZ,
  override_by             UUID REFERENCES profiles(id),
  override_at             TIMESTAMPTZ,
  override_note           TEXT,
  settled_in_opname_id    UUID REFERENCES opname_headers(id),
  settled_at              TIMESTAMPTZ,

  -- Attendance app integration (future)
  source              TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'attendance_app')),
  app_validated       BOOLEAN NOT NULL DEFAULT false,
  app_validated_at    TIMESTAMPTZ,
  is_locked           BOOLEAN NOT NULL DEFAULT false,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_wae_contract_date
  ON worker_attendance_entries (contract_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_wae_project_date
  ON worker_attendance_entries (project_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_wae_status
  ON worker_attendance_entries (contract_id, status);

CREATE INDEX IF NOT EXISTS idx_wae_settlement
  ON worker_attendance_entries (settled_in_opname_id)
  WHERE settled_in_opname_id IS NOT NULL;

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE mandor_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandor_overtime_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_attendance_entries ENABLE ROW LEVEL SECURITY;

-- mandor_workers: project-assigned users can read
DROP POLICY IF EXISTS mandor_workers_select ON mandor_workers;
CREATE POLICY mandor_workers_select ON mandor_workers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = mandor_workers.project_id
    )
  );

-- mandor_workers: estimator/admin can write
DROP POLICY IF EXISTS mandor_workers_insert ON mandor_workers;
CREATE POLICY mandor_workers_insert ON mandor_workers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_workers.project_id
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS mandor_workers_update ON mandor_workers;
CREATE POLICY mandor_workers_update ON mandor_workers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = mandor_workers.project_id
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

-- worker_rates: project-assigned can read, estimator/admin can write
DROP POLICY IF EXISTS worker_rates_select ON worker_rates;
CREATE POLICY worker_rates_select ON worker_rates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN project_assignments pa ON pa.project_id = mw.project_id
      WHERE mw.id = worker_rates.worker_id AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS worker_rates_insert ON worker_rates;
CREATE POLICY worker_rates_insert ON worker_rates
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN project_assignments pa ON pa.project_id = mw.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mw.id = worker_rates.worker_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS worker_rates_update ON worker_rates;
CREATE POLICY worker_rates_update ON worker_rates
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM mandor_workers mw
      JOIN project_assignments pa ON pa.project_id = mw.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mw.id = worker_rates.worker_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

-- mandor_overtime_rules: same pattern
DROP POLICY IF EXISTS overtime_rules_select ON mandor_overtime_rules;
CREATE POLICY overtime_rules_select ON mandor_overtime_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM mandor_contracts mc
      JOIN project_assignments pa ON pa.project_id = mc.project_id
      WHERE mc.id = mandor_overtime_rules.contract_id AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS overtime_rules_insert ON mandor_overtime_rules;
CREATE POLICY overtime_rules_insert ON mandor_overtime_rules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM mandor_contracts mc
      JOIN project_assignments pa ON pa.project_id = mc.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mc.id = mandor_overtime_rules.contract_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS overtime_rules_update ON mandor_overtime_rules;
CREATE POLICY overtime_rules_update ON mandor_overtime_rules
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM mandor_contracts mc
      JOIN project_assignments pa ON pa.project_id = mc.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE mc.id = mandor_overtime_rules.contract_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('estimator', 'admin', 'principal')
    )
  );

-- worker_attendance_entries: project-assigned can read
DROP POLICY IF EXISTS wae_select ON worker_attendance_entries;
CREATE POLICY wae_select ON worker_attendance_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = worker_attendance_entries.project_id
    )
  );

-- worker_attendance_entries: supervisor+ can insert (recorded_by = current user)
DROP POLICY IF EXISTS wae_insert ON worker_attendance_entries;
CREATE POLICY wae_insert ON worker_attendance_entries
  FOR INSERT WITH CHECK (
    recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = worker_attendance_entries.project_id
    )
  );

-- worker_attendance_entries: project-assigned can update (RPCs handle role checks)
DROP POLICY IF EXISTS wae_update ON worker_attendance_entries;
CREATE POLICY wae_update ON worker_attendance_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = worker_attendance_entries.project_id
    )
  );

-- ============================================================================
-- 6. HELPER: get active worker rate for a date
-- ============================================================================

CREATE OR REPLACE FUNCTION get_worker_daily_rate(
  p_worker_id UUID,
  p_date DATE
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT wr.daily_rate
     FROM worker_rates wr
     WHERE wr.worker_id = p_worker_id
       AND wr.effective_from <= p_date
       AND (wr.effective_to IS NULL OR wr.effective_to > p_date)
     ORDER BY wr.effective_from DESC
     LIMIT 1),
    0
  );
$$;

-- ============================================================================
-- 7. HELPER: get active overtime rules for a contract on a date
-- ============================================================================

CREATE OR REPLACE FUNCTION get_overtime_rules(
  p_contract_id UUID,
  p_date DATE
)
RETURNS TABLE(
  normal_hours NUMERIC,
  tier1_threshold_hours NUMERIC,
  tier1_hourly_rate NUMERIC,
  tier2_threshold_hours NUMERIC,
  tier2_hourly_rate NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    mor.normal_hours,
    mor.tier1_threshold_hours,
    mor.tier1_hourly_rate,
    mor.tier2_threshold_hours,
    mor.tier2_hourly_rate
  FROM mandor_overtime_rules mor
  WHERE mor.contract_id = p_contract_id
    AND mor.effective_from <= p_date
  ORDER BY mor.effective_from DESC
  LIMIT 1;
$$;

-- ============================================================================
-- 8. HELPER: compute overtime pay from hours and tier rules
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_overtime_pay(
  p_overtime_hours NUMERIC,
  p_tier1_threshold NUMERIC,
  p_tier2_threshold NUMERIC,
  p_tier1_rate NUMERIC,
  p_tier2_rate NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    -- tier1 hours: capped at (tier2 - tier1) range
    LEAST(GREATEST(p_overtime_hours, 0), p_tier2_threshold - p_tier1_threshold) * p_tier1_rate
    -- tier2 hours: anything above tier2 threshold relative to tier1
    + GREATEST(p_overtime_hours - (p_tier2_threshold - p_tier1_threshold), 0) * p_tier2_rate;
$$;

-- ============================================================================
-- 9. TRIGGER: compute pay columns before insert/update
-- ============================================================================

CREATE OR REPLACE FUNCTION set_worker_attendance_pay()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_present THEN
    NEW.regular_pay := NEW.daily_rate_snapshot;
    NEW.overtime_pay := compute_overtime_pay(
      NEW.overtime_hours,
      NEW.tier1_threshold_snapshot - NEW.tier1_threshold_snapshot, -- always 0 (OT starts at 0 relative hours)
      NEW.tier2_threshold_snapshot - NEW.tier1_threshold_snapshot,
      NEW.tier1_rate_snapshot,
      NEW.tier2_rate_snapshot
    );
    NEW.day_total := NEW.regular_pay + NEW.overtime_pay;
  ELSE
    NEW.regular_pay := 0;
    NEW.overtime_pay := 0;
    NEW.day_total := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wae_set_pay ON worker_attendance_entries;
CREATE TRIGGER trg_wae_set_pay
  BEFORE INSERT OR UPDATE OF is_present, overtime_hours,
    daily_rate_snapshot, tier1_rate_snapshot, tier2_rate_snapshot,
    tier1_threshold_snapshot, tier2_threshold_snapshot
  ON worker_attendance_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_worker_attendance_pay();

-- ============================================================================
-- 10. RPC: record_worker_attendance (single worker, single day)
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
  v_project_id UUID;
  v_daily_rate NUMERIC;
  v_ot_rules RECORD;
  v_new_entry worker_attendance_entries;
BEGIN
  -- Get project_id from contract
  SELECT mc.project_id INTO v_project_id
  FROM mandor_contracts mc WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan: %', p_contract_id;
  END IF;

  -- Check role
  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Validate worker belongs to this contract
  IF NOT EXISTS (
    SELECT 1 FROM mandor_workers mw
    WHERE mw.id = p_worker_id AND mw.contract_id = p_contract_id AND mw.is_active
  ) THEN
    RAISE EXCEPTION 'Pekerja tidak ditemukan atau tidak aktif dalam kontrak ini';
  END IF;

  -- Date check: today or yesterday only
  IF p_attendance_date < CURRENT_DATE - 1 OR p_attendance_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Pencatatan kehadiran hanya boleh untuk hari ini atau kemarin';
  END IF;

  -- Get worker rate snapshot
  v_daily_rate := get_worker_daily_rate(p_worker_id, p_attendance_date);
  IF v_daily_rate <= 0 THEN
    RAISE EXCEPTION 'Tarif harian belum diset untuk pekerja ini';
  END IF;

  -- Get overtime rule snapshot
  SELECT * INTO v_ot_rules FROM get_overtime_rules(p_contract_id, p_attendance_date);

  -- Insert or update (upsert on worker_id + attendance_date)
  INSERT INTO worker_attendance_entries (
    contract_id, project_id, worker_id, attendance_date,
    is_present, overtime_hours,
    daily_rate_snapshot, tier1_rate_snapshot, tier2_rate_snapshot,
    tier1_threshold_snapshot, tier2_threshold_snapshot,
    work_description, recorded_by, status
  )
  VALUES (
    p_contract_id, v_project_id, p_worker_id, p_attendance_date,
    p_is_present, p_overtime_hours,
    v_daily_rate,
    COALESCE(v_ot_rules.tier1_hourly_rate, 0),
    COALESCE(v_ot_rules.tier2_hourly_rate, 0),
    COALESCE(v_ot_rules.tier1_threshold_hours, 7),
    COALESCE(v_ot_rules.tier2_threshold_hours, 10),
    p_work_description, auth.uid(), 'DRAFT'
  )
  ON CONFLICT (worker_id, attendance_date) DO UPDATE SET
    is_present = EXCLUDED.is_present,
    overtime_hours = EXCLUDED.overtime_hours,
    daily_rate_snapshot = EXCLUDED.daily_rate_snapshot,
    tier1_rate_snapshot = EXCLUDED.tier1_rate_snapshot,
    tier2_rate_snapshot = EXCLUDED.tier2_rate_snapshot,
    tier1_threshold_snapshot = EXCLUDED.tier1_threshold_snapshot,
    tier2_threshold_snapshot = EXCLUDED.tier2_threshold_snapshot,
    work_description = EXCLUDED.work_description
  WHERE worker_attendance_entries.status = 'DRAFT'  -- only allow edit of drafts
  RETURNING * INTO v_new_entry;

  RETURN v_new_entry;
END;
$$;

-- ============================================================================
-- 11. RPC: record_worker_attendance_batch (all workers for one day)
-- ============================================================================

CREATE OR REPLACE FUNCTION record_worker_attendance_batch(
  p_contract_id UUID,
  p_attendance_date DATE,
  p_entries JSONB
  -- Expected format: [{"worker_id": "...", "is_present": true, "overtime_hours": 2}, ...]
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
  -- Get project_id from contract
  SELECT mc.project_id INTO v_project_id
  FROM mandor_contracts mc WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  -- Date check
  IF p_attendance_date < CURRENT_DATE - 1 OR p_attendance_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Pencatatan kehadiran hanya boleh untuk hari ini atau kemarin';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    PERFORM record_worker_attendance(
      p_contract_id,
      (v_entry->>'worker_id')::UUID,
      p_attendance_date,
      COALESCE((v_entry->>'is_present')::BOOLEAN, true),
      COALESCE((v_entry->>'overtime_hours')::NUMERIC, 0),
      v_entry->>'work_description'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 12. RPC: confirm_weekly_attendance (supervisor confirms Mon–Sat)
-- ============================================================================

CREATE OR REPLACE FUNCTION confirm_weekly_attendance(
  p_contract_id UUID,
  p_week_start DATE  -- Monday of the week
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_week_end DATE;
  v_count INT;
BEGIN
  SELECT mc.project_id INTO v_project_id
  FROM mandor_contracts mc WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  v_week_end := p_week_start + 5;  -- Monday + 5 = Saturday

  UPDATE worker_attendance_entries
  SET status = 'SUBMITTED'
  WHERE contract_id = p_contract_id
    AND attendance_date BETWEEN p_week_start AND v_week_end
    AND status = 'DRAFT';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Tidak ada data kehadiran DRAFT untuk minggu ini';
  END IF;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 13. RPC: supervisor_confirm_attendance (supervisor confirms individual entries)
-- ============================================================================

CREATE OR REPLACE FUNCTION supervisor_confirm_attendance(
  p_entry_id UUID
)
RETURNS worker_attendance_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry worker_attendance_entries;
BEGIN
  SELECT * INTO v_entry FROM worker_attendance_entries WHERE id = p_entry_id;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Entry kehadiran tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_entry.project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);

  IF v_entry.status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'Hanya entry DRAFT/SUBMITTED yang bisa dikonfirmasi';
  END IF;

  UPDATE worker_attendance_entries
  SET status = 'CONFIRMED',
      confirmed_by = auth.uid(),
      confirmed_at = now()
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

-- ============================================================================
-- 14. RPC: override_attendance_entry (admin/estimator dispute)
-- ============================================================================

CREATE OR REPLACE FUNCTION override_attendance_entry(
  p_entry_id UUID,
  p_overtime_hours NUMERIC DEFAULT NULL,
  p_is_present BOOLEAN DEFAULT NULL,
  p_override_note TEXT DEFAULT NULL
)
RETURNS worker_attendance_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry worker_attendance_entries;
BEGIN
  SELECT * INTO v_entry FROM worker_attendance_entries WHERE id = p_entry_id;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Entry kehadiran tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_entry.project_id, ARRAY['estimator', 'admin', 'principal']);

  IF v_entry.status NOT IN ('SUBMITTED', 'CONFIRMED') THEN
    RAISE EXCEPTION 'Hanya entry SUBMITTED/CONFIRMED yang bisa di-override';
  END IF;

  UPDATE worker_attendance_entries
  SET overtime_hours = COALESCE(p_overtime_hours, overtime_hours),
      is_present = COALESCE(p_is_present, is_present),
      status = 'OVERRIDDEN',
      override_by = auth.uid(),
      override_at = now(),
      override_note = COALESCE(p_override_note, 'Override oleh admin/estimator')
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

-- ============================================================================
-- 15. RPC: settle_worker_attendance_for_opname
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_worker_attendance_for_opname(
  p_opname_header_id UUID,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_id UUID;
  v_count INT;
BEGIN
  SELECT oh.contract_id INTO v_contract_id
  FROM opname_headers oh WHERE oh.id = p_opname_header_id;

  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  -- Settle all confirmed/overridden entries for this contract's week range
  UPDATE worker_attendance_entries
  SET status = 'SETTLED',
      settled_in_opname_id = p_opname_header_id,
      settled_at = now()
  WHERE contract_id = v_contract_id
    AND attendance_date BETWEEN p_week_start AND p_week_end
    AND status IN ('SUBMITTED', 'CONFIRMED', 'OVERRIDDEN');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 16. RPC: get_unsettled_worker_attendance_total
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unsettled_worker_attendance_total(
  p_contract_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(wae.day_total), 0)
  FROM worker_attendance_entries wae
  WHERE wae.contract_id = p_contract_id
    AND wae.status IN ('SUBMITTED', 'CONFIRMED', 'OVERRIDDEN');
$$;

-- ============================================================================
-- 17. VIEW: weekly worker attendance summary
-- ============================================================================

CREATE OR REPLACE VIEW v_worker_attendance_weekly AS
SELECT
  wae.contract_id,
  mc.mandor_name,
  wae.project_id,
  date_trunc('week', wae.attendance_date)::DATE AS week_start,
  mw.id AS worker_id,
  mw.worker_name,
  mw.skill_level,
  COUNT(*) FILTER (WHERE wae.is_present) AS days_present,
  COUNT(*) FILTER (WHERE NOT wae.is_present) AS days_absent,
  SUM(wae.overtime_hours) FILTER (WHERE wae.is_present) AS total_overtime_hours,
  SUM(wae.regular_pay) AS total_regular_pay,
  SUM(wae.overtime_pay) AS total_overtime_pay,
  SUM(wae.day_total) AS total_pay,
  COUNT(*) FILTER (WHERE wae.status = 'DRAFT') AS draft_count,
  COUNT(*) FILTER (WHERE wae.status = 'SUBMITTED') AS submitted_count,
  COUNT(*) FILTER (WHERE wae.status = 'CONFIRMED') AS confirmed_count,
  COUNT(*) FILTER (WHERE wae.status = 'OVERRIDDEN') AS overridden_count,
  COUNT(*) FILTER (WHERE wae.status = 'SETTLED') AS settled_count
FROM worker_attendance_entries wae
JOIN mandor_workers mw ON mw.id = wae.worker_id
JOIN mandor_contracts mc ON mc.id = wae.contract_id
GROUP BY wae.contract_id, mc.mandor_name, wae.project_id,
         date_trunc('week', wae.attendance_date),
         mw.id, mw.worker_name, mw.skill_level;

-- ============================================================================
-- 18. GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON mandor_workers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON worker_rates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON mandor_overtime_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON worker_attendance_entries TO authenticated;

GRANT EXECUTE ON FUNCTION get_worker_daily_rate TO authenticated;
GRANT EXECUTE ON FUNCTION get_overtime_rules TO authenticated;
GRANT EXECUTE ON FUNCTION compute_overtime_pay TO authenticated;
GRANT EXECUTE ON FUNCTION record_worker_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION record_worker_attendance_batch TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_weekly_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION supervisor_confirm_attendance TO authenticated;
GRANT EXECUTE ON FUNCTION override_attendance_entry TO authenticated;
GRANT EXECUTE ON FUNCTION settle_worker_attendance_for_opname TO authenticated;
GRANT EXECUTE ON FUNCTION get_unsettled_worker_attendance_total TO authenticated;
