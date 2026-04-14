-- Allow principals (and admins) to hard-delete projects they are assigned to.
-- Mirrors the UPDATE policy from 023 — uses the existing helper function
-- is_project_assignment_manager() so any user whose profile.role is
-- 'admin' or 'principal' AND who has a matching project_assignments row
-- for the target project can DELETE.
--
-- All foreign keys that reference projects(id) are declared ON DELETE
-- CASCADE (see 001_core_tables.sql and baseline_tables.sql), so a single
-- DELETE from projects cleans up boq_items, ahs_versions, ahs_lines,
-- envelopes, import_sessions, milestones, project_assignments, and every
-- other descendant in one shot.

DROP POLICY IF EXISTS "projects_delete_assigned" ON projects;

CREATE POLICY "projects_delete_assigned" ON projects
  FOR DELETE USING (is_project_assignment_manager(projects.id));
