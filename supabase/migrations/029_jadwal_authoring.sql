-- 029_jadwal_authoring.sql
-- Spec: docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md §4 + §10

-- ── milestones: additive columns ─────────────────────────────────────
ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT 'human'
    CHECK (proposed_by IN ('human', 'ai')),
  ADD COLUMN IF NOT EXISTS confidence_score numeric(4,3)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  ADD COLUMN IF NOT EXISTS ai_explanation text,
  ADD COLUMN IF NOT EXISTS author_status text NOT NULL DEFAULT 'confirmed'
    CHECK (author_status IN ('draft', 'confirmed')),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── indexes for the new columns ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS milestones_depends_on_gin
  ON milestones USING GIN (depends_on);

CREATE INDEX IF NOT EXISTS milestones_project_status_active
  ON milestones (project_id, author_status)
  WHERE deleted_at IS NULL;

-- ── ai_draft_runs: audit table for AI draft-assist ───────────────────
CREATE TABLE IF NOT EXISTS ai_draft_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parameters jsonb NOT NULL,
  prompt_hash text NOT NULL,
  response_summary jsonb NOT NULL,
  committed_milestone_ids uuid[],
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_draft_runs_project_user_recent
  ON ai_draft_runs (project_id, user_id, created_at DESC);

-- ── RLS for ai_draft_runs ────────────────────────────────────────────
ALTER TABLE ai_draft_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_draft_runs_project_read
  ON ai_draft_runs
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_draft_runs_insert
  ON ai_draft_runs
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_draft_runs_update
  ON ai_draft_runs
  FOR UPDATE
  USING (user_id = auth.uid());
