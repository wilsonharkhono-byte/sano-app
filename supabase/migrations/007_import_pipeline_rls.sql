-- SAN Contractor — Phase 2d: Baseline import pipeline RLS
-- The baseline import UI writes to import_sessions, import_staging_rows, and
-- import_anomalies using the authenticated office user. These tables need
-- explicit RLS policies for assigned office users.

ALTER TABLE IF EXISTS import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS import_staging_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS import_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_sessions_assigned_select" ON import_sessions;
DROP POLICY IF EXISTS "import_sessions_office_insert" ON import_sessions;
DROP POLICY IF EXISTS "import_sessions_office_update" ON import_sessions;

CREATE POLICY "import_sessions_assigned_select" ON import_sessions
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "import_sessions_office_insert" ON import_sessions
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND project_id IN (
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

CREATE POLICY "import_sessions_office_update" ON import_sessions
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

DROP POLICY IF EXISTS "import_staging_rows_assigned_select" ON import_staging_rows;
DROP POLICY IF EXISTS "import_staging_rows_office_insert" ON import_staging_rows;
DROP POLICY IF EXISTS "import_staging_rows_office_update" ON import_staging_rows;

CREATE POLICY "import_staging_rows_assigned_select" ON import_staging_rows
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      WHERE s.id = import_staging_rows.session_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "import_staging_rows_office_insert" ON import_staging_rows
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_staging_rows.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "import_staging_rows_office_update" ON import_staging_rows
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_staging_rows.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_staging_rows.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "import_anomalies_assigned_select" ON import_anomalies;
DROP POLICY IF EXISTS "import_anomalies_office_insert" ON import_anomalies;
DROP POLICY IF EXISTS "import_anomalies_office_update" ON import_anomalies;

CREATE POLICY "import_anomalies_assigned_select" ON import_anomalies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      WHERE s.id = import_anomalies.session_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "import_anomalies_office_insert" ON import_anomalies
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_anomalies.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "import_anomalies_office_update" ON import_anomalies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_anomalies.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_sessions s
      JOIN project_assignments pa ON pa.project_id = s.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE s.id = import_anomalies.session_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );
