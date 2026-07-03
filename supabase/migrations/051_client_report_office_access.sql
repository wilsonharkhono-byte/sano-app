-- SANO — Client Progress Report: office-role RLS access
-- Migration 050 gated the daily-log + client_progress_reports tables on
-- is_project_member() only. Office roles (admin / principal / estimator) get
-- GLOBAL project access via is_office_role() (migration 036), NOT via
-- project_assignments — so they were blocked from reading/issuing client
-- reports. This broadens those policies to: project member OR office role.
-- Supervisors keep their project-member access unchanged.
--
-- Idempotent + self-contained: inlines is_project_member + is_office_role
-- (CREATE OR REPLACE) in case migration 035 was never applied on the remote.

-- Helpers (verbatim from 035) --------------------------------------------------
CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

-- Broadened policies: project member OR office role -----------------------------
DROP POLICY IF EXISTS daily_site_logs_member_write ON daily_site_logs;
CREATE POLICY daily_site_logs_member_write ON daily_site_logs
  FOR ALL
  USING (is_project_member(project_id) OR is_office_role())
  WITH CHECK (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS daily_log_highlights_member ON daily_log_highlights;
CREATE POLICY daily_log_highlights_member ON daily_log_highlights
  FOR ALL
  USING (is_office_role() OR EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (is_office_role() OR EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS daily_log_photos_member ON daily_log_photos;
CREATE POLICY daily_log_photos_member ON daily_log_photos
  FOR ALL
  USING (is_office_role() OR EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)))
  WITH CHECK (is_office_role() OR EXISTS (SELECT 1 FROM daily_site_logs l WHERE l.id = log_id AND is_project_member(l.project_id)));

DROP POLICY IF EXISTS client_progress_reports_write ON client_progress_reports;
CREATE POLICY client_progress_reports_write ON client_progress_reports
  FOR ALL
  USING (is_project_member(project_id) OR is_office_role())
  WITH CHECK (is_project_member(project_id) OR is_office_role());
