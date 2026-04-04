-- SAN Contractor — Phase 2g: Baseline publish RLS
-- The baseline publish flow writes AHS versions/lines and generated project
-- material master data using the authenticated office user. These tables need
-- explicit RLS policies for assigned office users.

ALTER TABLE IF EXISTS ahs_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ahs_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS project_material_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS project_material_master_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ahs_versions_assigned_select" ON ahs_versions;
DROP POLICY IF EXISTS "ahs_versions_office_insert" ON ahs_versions;
DROP POLICY IF EXISTS "ahs_versions_office_update" ON ahs_versions;

CREATE POLICY "ahs_versions_assigned_select" ON ahs_versions
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "ahs_versions_office_insert" ON ahs_versions
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
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "ahs_versions_office_update" ON ahs_versions
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  )
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
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "ahs_lines_assigned_select" ON ahs_lines;
DROP POLICY IF EXISTS "ahs_lines_office_insert" ON ahs_lines;
DROP POLICY IF EXISTS "ahs_lines_office_update" ON ahs_lines;

CREATE POLICY "ahs_lines_assigned_select" ON ahs_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ahs_versions av
      JOIN project_assignments pa ON pa.project_id = av.project_id
      WHERE av.id = ahs_lines.ahs_version_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "ahs_lines_office_insert" ON ahs_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ahs_versions av
      JOIN project_assignments pa ON pa.project_id = av.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE av.id = ahs_lines.ahs_version_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "ahs_lines_office_update" ON ahs_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM ahs_versions av
      JOIN project_assignments pa ON pa.project_id = av.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE av.id = ahs_lines.ahs_version_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ahs_versions av
      JOIN project_assignments pa ON pa.project_id = av.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE av.id = ahs_lines.ahs_version_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "project_material_master_assigned_select" ON project_material_master;
DROP POLICY IF EXISTS "project_material_master_office_insert" ON project_material_master;
DROP POLICY IF EXISTS "project_material_master_office_update" ON project_material_master;

CREATE POLICY "project_material_master_assigned_select" ON project_material_master
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "project_material_master_office_insert" ON project_material_master
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM ahs_versions av
      WHERE av.id = project_material_master.ahs_version_id
        AND av.project_id = project_material_master.project_id
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "project_material_master_office_update" ON project_material_master
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM ahs_versions av
      WHERE av.id = project_material_master.ahs_version_id
        AND av.project_id = project_material_master.project_id
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "project_material_master_lines_assigned_select" ON project_material_master_lines;
DROP POLICY IF EXISTS "project_material_master_lines_office_insert" ON project_material_master_lines;
DROP POLICY IF EXISTS "project_material_master_lines_office_update" ON project_material_master_lines;

CREATE POLICY "project_material_master_lines_assigned_select" ON project_material_master_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM project_material_master pm
      JOIN project_assignments pa ON pa.project_id = pm.project_id
      WHERE pm.id = project_material_master_lines.master_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "project_material_master_lines_office_insert" ON project_material_master_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_material_master pm
      JOIN project_assignments pa ON pa.project_id = pm.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pm.id = project_material_master_lines.master_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "project_material_master_lines_office_update" ON project_material_master_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM project_material_master pm
      JOIN project_assignments pa ON pa.project_id = pm.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pm.id = project_material_master_lines.master_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM project_material_master pm
      JOIN project_assignments pa ON pa.project_id = pm.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pm.id = project_material_master_lines.master_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );
