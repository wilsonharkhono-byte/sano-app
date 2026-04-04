-- SAN Contractor — Phase 2e: delete draft baseline import sessions
-- Allow assigned office users to delete import sessions that have not yet been
-- published into the live project baseline.

DROP POLICY IF EXISTS "import_sessions_office_delete" ON import_sessions;

CREATE POLICY "import_sessions_office_delete" ON import_sessions
  FOR DELETE
  USING (
    status <> 'PUBLISHED'
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
