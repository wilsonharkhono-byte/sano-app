-- Backfills milestones.created_at on DBs where the table predates migration 001.
ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
