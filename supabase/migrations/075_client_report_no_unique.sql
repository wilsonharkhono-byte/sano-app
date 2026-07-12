-- 075 — Hard uniqueness for client report numbering (Task 3.7)
--
-- Problem: tools/clientReport.ts assignNextReportNo (and, symmetrically, the
-- revision counter) does a plain SELECT max(...) + 1 with NO write-time
-- guard behind it (050:65 created only a non-unique index on
-- (project_id, report_no)). Two "Terbitkan" taps issued close together — two
-- browser tabs, or a slow network retry — can both read the same max and
-- both insert, silently minting two client_progress_reports rows with the
-- identical (project_id, report_no, revision). Nothing downstream would ever
-- notice: Riwayat Laporan would just show two rows labeled "#07", and
-- whichever the client opened last looks authoritative.
--
-- Revision model (read from 050 + tools/clientReport.ts before deciding the
-- key): a correction to an already-issued report is a NEW ROW with the SAME
-- report_no and revision + 1 (issueClientReport / ClientReportBuilderScreen
-- startRevision). So (project_id, report_no) is legitimately NOT unique —
-- multiple revisions of the same report_no are the intended, immutable
-- history. The actual identity key is the full triple:
--   (project_id, report_no, revision)
-- A partial index scoped to "the head revision only" was considered and
-- rejected — every revision (not just revision 1) needs the same collision
-- protection, since "Buat Revisi" races on nextRevisionNo() exactly the way
-- a brand-new report races on assignNextReportNo().
--
-- Fix, two parts:
--   1. (this file) A hard UNIQUE index on (project_id, report_no, revision).
--      Guarded by an upfront duplicate check that RAISEs and refuses to
--      install if dupes already exist — silently skipping the index would
--      leave the table exactly as unprotected as before with no signal to
--      the operator. Resolve dupes first (renumber/delete the extra row),
--      then re-paste this migration.
--   2. (app change, tools/clientReport.ts issueClientReport) Keeps the
--      existing read-then-insert shape but now CATCHES the unique-violation
--      (Postgres 23505) this index raises on a lost race, recomputes the
--      true next report_no (or, for an explicit revision re-issue, the true
--      next revision) via a fresh SELECT max(...), and retries — bounded at
--      5 attempts. This is the simplest race-safe fix that doesn't require a
--      sequence table or a transaction-wrapped RPC: the retry loop lives
--      entirely in the client, using this index purely as the authoritative
--      conflict detector.
--
-- Deploy order: the retry logic works correctly WITH or WITHOUT this index
-- applied — the index only changes what happens on a lost race, from
-- "silently insert a duplicate number" to "raise 23505, which the retry loop
-- catches and retries with a fresh number." Paste this migration whenever is
-- convenient; there is no ordering dependency on the app build.
--
-- Idempotent / re-paste-safe: CREATE UNIQUE INDEX IF NOT EXISTS. The
-- duplicate-count guard is a pure SELECT — safe to re-run every time; once
-- the index exists, a re-paste just no-ops on the IF NOT EXISTS branch
-- without re-running the guard's RAISE path (dupes can't exist post-index).

DO $$
DECLARE
  v_dupe_groups INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dupe_groups
  FROM (
    SELECT project_id, report_no, revision
    FROM client_progress_reports
    GROUP BY project_id, report_no, revision
    HAVING COUNT(*) > 1
  ) dupes;

  IF v_dupe_groups > 0 THEN
    RAISE EXCEPTION 'Migration 075 aborted: client_progress_reports has % duplicate (project_id, report_no, revision) group(s). Resolve them first — e.g. SELECT project_id, report_no, revision, array_agg(id) FROM client_progress_reports GROUP BY project_id, report_no, revision HAVING COUNT(*) > 1; then renumber or delete the extra row(s) — then re-paste this migration.', v_dupe_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_progress_reports_no_revision
  ON client_progress_reports (project_id, report_no, revision);
