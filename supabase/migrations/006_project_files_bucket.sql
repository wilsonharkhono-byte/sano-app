-- SAN Contractor — Phase 2c: Baseline source-file storage bucket
-- Creates a private bucket for uploaded BoQ/AHS Excel files and limits access
-- to assigned office users for the matching project path:
--   imports/<project_id>/<filename>

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'project-files',
  'project-files',
  false,
  52428800,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "project_files_assigned_select" ON storage.objects;
DROP POLICY IF EXISTS "project_files_office_insert" ON storage.objects;
DROP POLICY IF EXISTS "project_files_office_update" ON storage.objects;
DROP POLICY IF EXISTS "project_files_office_delete" ON storage.objects;

CREATE POLICY "project_files_assigned_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND split_part(name, '/', 1) = 'imports'
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "project_files_office_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-files'
    AND split_part(name, '/', 1) = 'imports'
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "project_files_office_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND split_part(name, '/', 1) = 'imports'
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND split_part(name, '/', 1) = 'imports'
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

CREATE POLICY "project_files_office_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND split_part(name, '/', 1) = 'imports'
    AND EXISTS (
      SELECT 1
      FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );
