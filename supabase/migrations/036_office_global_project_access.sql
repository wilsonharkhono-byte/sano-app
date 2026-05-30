-- 036_office_global_project_access.sql
--
-- Goal: office staff (role IN admin / principal / estimator) collaborate on
-- EVERY project, not just the ones they happen to be assigned to. Before this
-- migration a project created by estimator A was invisible to estimator B
-- because every project-scoped table is gated by a project_assignments
-- membership check, and a new project only ever assigns its creator.
--
-- Design — ADDITIVE, not a rewrite:
--   * Existing policies are left untouched. PostgreSQL OR's permissive
--     policies together, so adding an office-access policy WIDENS access
--     without changing the behaviour any other role already has. Site
--     supervisors keep their exact current, assignment-scoped view.
--   * The "supervisor cannot edit BoQ" rule lives in a SEPARATE role gate
--     (role IN admin/estimator/principal) on the write policies. We do not
--     touch that gate, so supervisors stay blocked from BoQ exactly as today.
--   * Whole-project DELETE stays restricted to admin/principal (managers).
--     Estimators get view + edit of project DATA, but cannot delete projects
--     or rename project metadata — matching their current role capabilities.
--
-- Scope decision (confirmed with the user): office users get view + edit of
-- ALL project data, including site-execution + financial tables (kasbon,
-- attendance, opname/payroll). Global catalogs (material_catalog, vendors),
-- per-user tables (notifications, device_tokens, ai_draft_runs) and the
-- service-role message_log are intentionally NOT widened here.

-- ============================================================================
-- 1. Helper functions
-- ============================================================================

-- is_office_role() already exists (035_whatsapp_intelligence.sql). Redefine it
-- here too so this migration is self-contained and order-independent.
CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

-- Managers = admin / principal. Used for project metadata update + delete
-- across all projects (estimators are deliberately excluded — see header).
CREATE OR REPLACE FUNCTION is_office_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_manager() TO authenticated;

-- ============================================================================
-- 2. projects — office can VIEW every project; managers can update/delete any
-- ============================================================================

DROP POLICY IF EXISTS "projects_office_read" ON projects;
CREATE POLICY "projects_office_read" ON projects
  FOR SELECT USING (is_office_role());

-- Managers (admin/principal) can edit metadata of ANY project, not just
-- assigned ones. The existing assignment-scoped update/delete policies remain.
DROP POLICY IF EXISTS "projects_manager_update" ON projects;
CREATE POLICY "projects_manager_update" ON projects
  FOR UPDATE USING (is_office_manager()) WITH CHECK (is_office_manager());

DROP POLICY IF EXISTS "projects_manager_delete" ON projects;
CREATE POLICY "projects_manager_delete" ON projects
  FOR DELETE USING (is_office_manager());

-- project_assignments — office can SEE the team on every project (the team
-- panel / member picker). Write access (add/remove members) is left to the
-- existing manager policies; not widened here.
DROP POLICY IF EXISTS "assignments_office_read" ON project_assignments;
CREATE POLICY "assignments_office_read" ON project_assignments
  FOR SELECT USING (is_office_role());

-- ============================================================================
-- 3. Operational project-scoped tables — office gets full view + edit
-- ============================================================================
-- One permissive "<table>_office_all" FOR ALL policy per table. is_office_role()
-- does not reference project_id, so it works for both project_id-bearing tables
-- and child tables scoped through a parent. to_regclass() guards against any
-- table that doesn't exist in a given environment.

DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    -- core (001 / 002)
    'activity_log', 'boq_items', 'defects', 'defect_photos', 'envelopes',
    'milestones', 'mtn_requests', 'mtn_photos',
    'purchase_orders', 'purchase_order_lines',
    'material_request_headers', 'material_request_lines',
    'receipts', 'receipt_lines', 'receipt_photos',
    'progress_entries', 'progress_photos',
    'vo_entries', 'vo_photos', 'rework_entries', 'rework_photos',
    'price_history', 'weekly_digests', 'report_exports',
    -- request allocations (005)
    'material_request_line_allocations',
    -- import pipeline (007 / 009)
    'import_sessions', 'import_staging_rows', 'import_staging_edits',
    'import_anomalies',
    -- baseline publish (010)
    'ahs_versions', 'ahs_lines',
    'project_material_master', 'project_material_master_lines',
    -- labor / opname (008 / 011)
    'mandor_contracts', 'mandor_contract_rates',
    'opname_headers', 'opname_lines', 'opname_line_revisions',
    -- attendance / workers / kasbon (014 / 015 / 017 / 019 / 021)
    'mandor_kasbon', 'mandor_attendance', 'worker_attendance_entries',
    'mandor_workers', 'worker_rates', 'worker_overtime_rules',
    'mandor_overtime_rules', 'harian_cost_allocations',
    -- site changes (022)
    'site_changes',
    -- whatsapp intelligence project data (035)
    'rooms', 'drawings', 'checklist_items', 'decisions',
    'vendor_decisions', 'reminders'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_office_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (is_office_role()) WITH CHECK (is_office_role())',
        t || '_office_all', t
      );
    END IF;
  END LOOP;
END $$;
