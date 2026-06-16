-- 037_estimator_team_management.sql
-- Let estimators manage project team membership (add/remove members) in-app.
--
-- is_project_assignment_manager() previously allowed only admin/principal. We
-- widen it to include 'estimator' so estimators can add a field supervisor
-- (pengawas lapangan) to a project they are on. No policy statements change:
-- assignments_insert_managers / assignments_delete_managers /
-- assignments_project_managers all call this function and widen automatically.
--
-- SIDE EFFECT (accepted): this same function also gates the projects UPDATE
-- (023) and projects DELETE (028) policies, so estimators assigned to a project
-- additionally gain the ability to edit and delete that project. This was an
-- explicit product decision (chosen over a separate team-only function).
--
-- The caller must still already be assigned to the project (pa.user_id =
-- auth.uid()), so this only affects estimators who are members — which is the
-- case for the estimator who created/imported the project (auto-assigned).

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
      AND pr.role IN ('admin', 'principal', 'estimator')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_project_assignment_manager(UUID) TO authenticated;
