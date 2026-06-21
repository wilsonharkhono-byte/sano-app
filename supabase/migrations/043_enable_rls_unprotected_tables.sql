-- 043_enable_rls_unprotected_tables.sql
--
-- Tech-debt finding M4: several project-scoped tables are read by the app but
-- never had Row Level Security enabled. With RLS disabled, ANY authenticated
-- user reads (and writes) EVERY tenant's rows. This migration enables RLS on
-- the affected tables and adds the standard project-scoped access policy that
-- the rest of the schema already uses, plus the office-role global-access
-- policy (mirroring 036) so office staff (admin/principal/estimator) keep the
-- cross-project collaboration access they have on every other operational
-- table.
--
-- This migration is ADDITIVE and IDEMPOTENT:
--   * Every policy is DROP POLICY IF EXISTS ... then CREATE POLICY, so re-runs
--     are safe.
--   * ENABLE ROW LEVEL SECURITY is harmless to re-run.
--   * to_regclass() guards skip any table absent in a given environment.
--
-- PER-TABLE LINKAGE REASONING (verified against 001/002 CREATE TABLE defs):
--   * approval_tasks      — DIRECT  project_id NOT NULL (002:409)
--   * audit_cases         — DIRECT  project_id NOT NULL (002:421)
--   * anomaly_events      — DIRECT  project_id NOT NULL (002:432)
--   * performance_scores  — DIRECT  project_id NOT NULL (002:443)
--   * vendor_scorecards   — DIRECT  project_id NOT NULL (002:455)
--   * material_receipts   — DIRECT  project_id NOT NULL (001:390; also has
--                                    po_id, but the direct project_id column is
--                                    authoritative and matches the standard
--                                    pattern used by sibling tables)
--   * milestone_revisions — INDIRECT no project_id column; links via
--                                    milestone_id -> milestones.id, and
--                                    milestones carries project_id (001:246).
--                                    Uses the EXISTS/JOIN pattern from 005.
--
-- PATTERN SOURCES (do not invent new patterns):
--   * Direct project_id  -> 001_core_tables.sql project-scoped policies, e.g.
--     boq_items_assigned: FOR ALL USING (project_id IN
--       (SELECT project_id FROM project_assignments WHERE user_id = auth.uid()))
--   * Indirect via JOIN  -> 005_material_request_allocations.sql
--     request_allocations_assigned_select EXISTS/JOIN-to-project_assignments.
--   * Office global      -> 036_office_global_project_access.sql
--     "<table>_office_all" FOR ALL USING (is_office_role()).
--
-- NOTE: 036's table list does NOT include any of these tables, so there is no
-- pre-existing office policy to collide with. is_office_role() was defined in
-- 035/036 and is assumed present (this migration ordering is after 036).

-- ============================================================================
-- 1. DIRECT project_id tables — standard assignment-scoped policy + office_all
-- ============================================================================
-- One FOR ALL assignment-scoped policy (mirrors boq_items_assigned etc.) plus
-- one office FOR ALL policy (mirrors 036). PostgreSQL OR's permissive policies,
-- so site supervisors get assignment-scoped access and office roles get global
-- access — exactly the model used everywhere else in the schema.

DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'approval_tasks',
    'audit_cases',
    'anomaly_events',
    'performance_scores',
    'vendor_scorecards',
    'material_receipts'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Assignment-scoped (direct project_id IN-subquery pattern from 001).
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_assigned', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING ('
        || 'project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid()))',
        t || '_assigned', t
      );

      -- Office global access (mirrors 036's "<table>_office_all").
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_office_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (is_office_role()) WITH CHECK (is_office_role())',
        t || '_office_all', t
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 2. INDIRECT table — milestone_revisions (links via milestone_id -> milestones)
-- ============================================================================
-- No project_id column. Trace milestone_id -> milestones.project_id ->
-- project_assignments, using the EXISTS/JOIN pattern from 005. Guarded by
-- to_regclass so the block is a no-op where the table is absent.

DO $$
BEGIN
  IF to_regclass('public.milestone_revisions') IS NOT NULL THEN
    ALTER TABLE public.milestone_revisions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "milestone_revisions_assigned" ON public.milestone_revisions;
    CREATE POLICY "milestone_revisions_assigned" ON public.milestone_revisions
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM milestones m
          JOIN project_assignments pa ON pa.project_id = m.project_id
          WHERE m.id = milestone_revisions.milestone_id
            AND pa.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "milestone_revisions_office_all" ON public.milestone_revisions;
    CREATE POLICY "milestone_revisions_office_all" ON public.milestone_revisions
      FOR ALL USING (is_office_role()) WITH CHECK (is_office_role());
  END IF;
END $$;

-- ============================================================================
-- 3. SKIPPED tables
-- ============================================================================
-- None skipped. All 7 flagged tables exist (approval_tasks, audit_cases,
-- anomaly_events, material_receipts, vendor_scorecards, performance_scores,
-- milestone_revisions), none had RLS enabled, none had any pre-existing policy,
-- and none were covered by 036's office list. All 7 are handled above.
