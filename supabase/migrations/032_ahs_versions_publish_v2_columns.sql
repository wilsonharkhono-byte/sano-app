-- 032_ahs_versions_publish_v2_columns.sql
--
-- Adds the two columns publishBaselineV2 expects on ahs_versions:
--   is_current         — boolean flag, exactly one true row per project
--   import_session_id  — links the version to its triggering import
--
-- Without these columns, every v2 publish fails with:
--   "Could not find the 'is_current' column of 'ahs_versions' in
--    the schema cache"
-- because tools/publishBaselineV2.ts L255 demotes via
--   UPDATE ahs_versions SET is_current = false ...
-- and L265 inserts the new row with
--   { project_id, import_session_id, is_current: true }.
--
-- v1 publish (tools/baseline.ts) is unaffected — it tracks history
-- via the existing `version` integer and never touches is_current.
-- The two paths coexist cleanly: v1 inserts get is_current=false by
-- default; v2 inserts go through the demote-then-insert sequence.

ALTER TABLE ahs_versions
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_session_id UUID
    REFERENCES import_sessions(id) ON DELETE SET NULL;

-- Partial unique index: at most one is_current=true row per project.
-- Enforces the invariant publishBaselineV2 relies on (demote-then-insert
-- assumes only one current version can exist).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ahs_versions_one_current_per_project
  ON ahs_versions(project_id) WHERE is_current = true;

-- Backfill: mark the most recent existing version per project as
-- is_current = true. Without this, projects that had baselines
-- published via v1 would suddenly look like they have no current
-- version, and any UI that reads is_current would render empty.
UPDATE ahs_versions av
SET is_current = true
WHERE av.id = (
  SELECT id FROM ahs_versions inner_av
  WHERE inner_av.project_id = av.project_id
  ORDER BY inner_av.published_at DESC, inner_av.version DESC
  LIMIT 1
);
