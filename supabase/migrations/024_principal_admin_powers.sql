-- 024_principal_admin_powers.sql
-- Allow admin/principal to update the role (and basic profile fields)
-- of users who are assigned to the same project.

-- Admin/principal can update role + basic info of team members on their projects
DROP POLICY IF EXISTS "profiles_update_managers" ON profiles;
CREATE POLICY "profiles_update_managers" ON profiles
  FOR UPDATE USING (
    -- can always update own profile
    id = auth.uid()
    OR
    -- admin/principal can update profiles of users on shared projects
    (
      EXISTS (
        SELECT 1 FROM profiles AS me
        WHERE me.id = auth.uid()
          AND me.role IN ('admin', 'principal')
      )
      AND EXISTS (
        SELECT 1
        FROM project_assignments pa_them
        JOIN project_assignments pa_me
          ON pa_me.project_id = pa_them.project_id
         AND pa_me.user_id = auth.uid()
        WHERE pa_them.user_id = profiles.id
      )
    )
  );
