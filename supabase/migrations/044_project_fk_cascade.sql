-- 044_project_fk_cascade.sql
--
-- Bug: deleting a project fails with
--   "update or delete on table \"projects\" violates foreign key constraint
--    \"report_exports_project_id_fkey\" on table \"report_exports\""
--
-- Root cause: deleteProject() (tools/projectManagement.ts) hard-deletes a
-- project and RELIES on every FK referencing projects(id) having
-- ON DELETE CASCADE so the delete propagates to all descendants. That holds
-- for the tables in 001/002 that were authored with the cascade clause, but a
-- cluster of "operational" tables (material_receipts in 001; receipts plus the
-- audit/approval/anomaly/scoring/digest/export tables in 002) were created with
-- a bare `REFERENCES projects(id)` and NO ON DELETE action. Any project that
-- accumulated a row in any of these tables can no longer be deleted —
-- report_exports is simply the first constraint Postgres happens to check.
--
-- This is the same neglected cluster that 043 just brought under RLS.
--
-- Fix: convert each of those FKs to ON DELETE CASCADE so a project delete
-- propagates, matching every sibling table and deleteProject()'s contract.
--
-- Special case: mtn_requests.destination_project_id is a NULLABLE pointer to a
-- DIFFERENT project (a material-transfer destination); the request itself
-- belongs to another project via mtn_requests.project_id. Cascading a delete
-- there would wrongly destroy another project's transfer request, so this one
-- gets ON DELETE SET NULL instead — deleting the destination project just
-- clears the pointer.
--
-- This migration is IDEMPOTENT and SAFE to re-run:
--   * The existing FK constraint is discovered from pg_constraint by the
--     (table, referenced=projects, column) shape rather than by a hardcoded
--     name, then dropped and recreated with the desired ON DELETE action.
--   * to_regclass() guards skip any table absent in a given environment.
--   * Re-running simply drops the (already-cascading) constraint and re-adds
--     an identical one.

-- ============================================================================
-- 1. project_id FKs that must CASCADE on project delete
-- ============================================================================

DO $$
DECLARE
  t TEXT;
  conname_found TEXT;
  cascade_tbls TEXT[] := ARRAY[
    'material_receipts',   -- 001:393
    'receipts',            -- 002:241
    'approval_tasks',      -- 002:411
    'audit_cases',         -- 002:423
    'anomaly_events',      -- 002:434
    'performance_scores',  -- 002:445
    'vendor_scorecards',   -- 002:458
    'weekly_digests',      -- 002:470
    'report_exports'       -- 002:479  (the constraint in the reported error)
  ];
BEGIN
  FOREACH t IN ARRAY cascade_tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      -- Find the FK on this table's project_id column that points at projects.
      SELECT con.conname INTO conname_found
      FROM pg_constraint con
      WHERE con.conrelid = ('public.' || t)::regclass
        AND con.contype = 'f'
        AND con.confrelid = 'public.projects'::regclass
        AND con.conkey = ARRAY[(
          SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = ('public.' || t)::regclass
            AND a.attname = 'project_id'
            AND NOT a.attisdropped
        )];

      IF conname_found IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, conname_found);
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I '
        || 'FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE',
        t, t || '_project_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 2. mtn_requests.destination_project_id — SET NULL (points at another project)
-- ============================================================================

DO $$
DECLARE
  conname_found TEXT;
BEGIN
  IF to_regclass('public.mtn_requests') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.mtn_requests'::regclass
         AND attname = 'destination_project_id'
         AND NOT attisdropped
     )
  THEN
    SELECT con.conname INTO conname_found
    FROM pg_constraint con
    WHERE con.conrelid = 'public.mtn_requests'::regclass
      AND con.contype = 'f'
      AND con.confrelid = 'public.projects'::regclass
      AND con.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = 'public.mtn_requests'::regclass
          AND a.attname = 'destination_project_id'
          AND NOT a.attisdropped
      )];

    IF conname_found IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.mtn_requests DROP CONSTRAINT %I', conname_found);
    END IF;

    ALTER TABLE public.mtn_requests
      ADD CONSTRAINT mtn_requests_destination_project_id_fkey
      FOREIGN KEY (destination_project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;
