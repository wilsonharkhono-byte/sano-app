-- SANO — Client Progress Report (Blueprint)
-- Daily Site Log capture tables + issued client_progress_reports table.
-- Idempotent: safe to re-run (pasted into the Dashboard SQL Editor).
-- Depends on: 001_core_tables (projects, profiles, project_assignments, is_project_member),
--             002_baseline_tables (boq_items).

-- 1. daily_site_logs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_site_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date          DATE NOT NULL,
  weather           TEXT,
  crew_total        INTEGER,
  crew_breakdown    TEXT,
  safety_incidents  INTEGER NOT NULL DEFAULT 0,
  author_id         UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_site_logs_project_date ON daily_site_logs (project_id, log_date);

-- 2. daily_log_highlights ----------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_log_highlights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id       UUID NOT NULL REFERENCES daily_site_logs(id) ON DELETE CASCADE,
  area         TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  boq_item_id  UUID REFERENCES boq_items(id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_log_highlights_log ON daily_log_highlights (log_id);

-- 3. daily_log_photos --------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_log_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        UUID NOT NULL REFERENCES daily_site_logs(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  caption       TEXT,
  is_featured   BOOLEAN NOT NULL DEFAULT false,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_log_photos_log ON daily_log_photos (log_id);

-- 4. client_progress_reports -------------------------------------------------
CREATE TABLE IF NOT EXISTS client_progress_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_no        INTEGER NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1,
  kind             TEXT NOT NULL CHECK (kind IN ('harian','mingguan')),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  status_label     TEXT,
  weather          TEXT,
  crew_total       INTEGER,
  crew_breakdown   TEXT,
  safety_incidents INTEGER NOT NULL DEFAULT 0,
  next_plan        TEXT,
  snapshot         JSONB,
  issued_at        TIMESTAMPTZ,
  issued_by        UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_progress_reports_project ON client_progress_reports (project_id, report_no);

-- 5. updated_at trigger for daily_site_logs ----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE $fn$
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $body$;
    $fn$;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_daily_site_logs_updated ON daily_site_logs;
CREATE TRIGGER trg_daily_site_logs_updated BEFORE UPDATE ON daily_site_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. RLS ---------------------------------------------------------------------
ALTER TABLE daily_site_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_highlights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_progress_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_site_logs_member_read ON daily_site_logs;
CREATE POLICY daily_site_logs_member_read ON daily_site_logs
  FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS daily_site_logs_member_write ON daily_site_logs;
CREATE POLICY daily_site_logs_member_write ON daily_site_logs
  FOR ALL USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS daily_log_highlights_member ON daily_log_highlights;
CREATE POLICY daily_log_highlights_member ON daily_log_highlights
  FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS daily_log_photos_member ON daily_log_photos;
CREATE POLICY daily_log_photos_member ON daily_log_photos
  FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS client_progress_reports_member_read ON client_progress_reports;
CREATE POLICY client_progress_reports_member_read ON client_progress_reports
  FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS client_progress_reports_write ON client_progress_reports;
CREATE POLICY client_progress_reports_write ON client_progress_reports
  FOR ALL USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
