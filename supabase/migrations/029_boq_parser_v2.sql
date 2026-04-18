-- 029_boq_parser_v2.sql
-- Additive schema for BoQ Parser v2. All columns nullable or safely defaulted
-- so the existing v1 path is unaffected. See spec:
-- docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md

-- 1. import_sessions: parser version + validation report + edit lock
ALTER TABLE import_sessions
  ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS validation_report jsonb NULL,
  ADD COLUMN IF NOT EXISTS locked_by uuid NULL REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL;

-- 2. import_staging_rows: v2 classification columns
ALTER TABLE import_staging_rows
  ADD COLUMN IF NOT EXISTS cost_basis text NULL,
  ADD COLUMN IF NOT EXISTS parent_ahs_staging_id uuid NULL
    REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ref_cells jsonb NULL,
  ADD COLUMN IF NOT EXISTS cost_split jsonb NULL;

-- 3. Extend row_type check constraint to accept 'ahs_block'
ALTER TABLE import_staging_rows
  DROP CONSTRAINT IF EXISTS import_staging_rows_row_type_check;
ALTER TABLE import_staging_rows
  ADD CONSTRAINT import_staging_rows_row_type_check
    CHECK (row_type IN ('boq', 'ahs', 'ahs_block', 'material', 'spec', 'price'));

-- 4. Edit history table
CREATE TABLE IF NOT EXISTS import_staging_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_row_id uuid REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  import_session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  edited_by uuid REFERENCES profiles(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  field_path text NOT NULL,
  old_value jsonb,
  new_value jsonb
);
CREATE INDEX IF NOT EXISTS idx_staging_edits_session
  ON import_staging_edits(import_session_id);

ALTER TABLE import_staging_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staging_edits_assigned" ON import_staging_edits;
CREATE POLICY "staging_edits_assigned" ON import_staging_edits
  FOR ALL USING (
    import_session_id IN (
      SELECT id FROM import_sessions
      WHERE project_id IN (
        SELECT project_id FROM project_assignments
        WHERE user_id = auth.uid()
      )
    )
  );

-- 5. ahs_lines: breadcrumb for nested-unfold origin
ALTER TABLE ahs_lines
  ADD COLUMN IF NOT EXISTS origin_parent_ahs_id uuid NULL;
