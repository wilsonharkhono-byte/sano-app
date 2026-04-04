-- 023_project_management_rls.sql
-- Extends RLS to allow admin/principal/estimator to:
--   • Create new projects
--   • Update projects they are assigned to
--   • View + manage team assignments on their projects
-- Also widens profiles SELECT so the user-picker works for team assignment.

-- ============================================================================
-- 1. PROFILES — allow any authenticated user to read other profiles
--    (needed to populate the "add team member" picker)
-- ============================================================================

DROP POLICY IF EXISTS "profiles_any_read" ON profiles;
CREATE POLICY "profiles_any_read" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- 2. PROJECTS — allow admin/principal/estimator to create new projects
-- ============================================================================

CREATE OR REPLACE FUNCTION is_project_assignment_manager(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM project_assignments pa
    JOIN profiles pr ON pr.id = v_uid
    WHERE pa.user_id = v_uid
      AND pa.project_id = p_project_id
      AND pr.role IN ('admin', 'principal')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_project_assignment_manager(UUID) TO authenticated;

DROP POLICY IF EXISTS "projects_insert_privileged" ON projects;
CREATE POLICY "projects_insert_privileged" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'principal', 'estimator')
    )
  );

-- Allow admin/principal to update projects they are assigned to
DROP POLICY IF EXISTS "projects_update_assigned" ON projects;
CREATE POLICY "projects_update_assigned" ON projects
  FOR UPDATE USING (is_project_assignment_manager(projects.id));

-- ============================================================================
-- 3. PROJECT ASSIGNMENTS — widen SELECT + add INSERT/DELETE for managers
-- ============================================================================

-- Widen SELECT: admin/principal can see all members on their projects
DROP POLICY IF EXISTS "assignments_project_managers" ON project_assignments;
CREATE POLICY "assignments_project_managers" ON project_assignments
  FOR SELECT USING (
    -- own assignment (existing rule kept here)
    user_id = auth.uid()
    OR
    -- or: viewer is admin/principal on the same project
    is_project_assignment_manager(project_assignments.project_id)
  );

-- INSERT: admin/principal can add users to projects they are on
DROP POLICY IF EXISTS "assignments_insert_managers" ON project_assignments;
CREATE POLICY "assignments_insert_managers" ON project_assignments
  FOR INSERT WITH CHECK (
    is_project_assignment_manager(project_assignments.project_id)
    OR
    -- also allow inserting one's own assignment when creating a brand-new project
    -- (at creation time there are no existing assignments yet)
    user_id = auth.uid()
  );

-- DELETE: admin/principal can remove users from projects they manage
DROP POLICY IF EXISTS "assignments_delete_managers" ON project_assignments;
CREATE POLICY "assignments_delete_managers" ON project_assignments
  FOR DELETE USING (is_project_assignment_manager(project_assignments.project_id));

-- Drop the old "assignments_self" SELECT-only policy — replaced by the wider one above
DROP POLICY IF EXISTS "assignments_self" ON project_assignments;
