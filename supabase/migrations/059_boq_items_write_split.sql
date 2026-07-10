-- 059 — Role-gate boq_items writes while preserving supervisor progress
-- writes (Task 0.3, HIGH)
--
-- Problem: boq_items_assigned (001_core_tables.sql:433-436) is
--   FOR ALL USING (<assigned>) with no WITH CHECK, so the USING clause
--   doubles as the write check (Postgres RLS rule when WITH CHECK is
--   omitted on a FOR ALL/UPDATE policy). Any user assigned to a project —
--   including a site supervisor — can INSERT/UPDATE/DELETE ANY column on
--   that project's boq_items, including `planned` (which drives
--   compute_tier1_flag / the Gate-1 envelope — a supervisor could rewrite
--   `planned` to widen their own material budget) and
--   `internal_unit_price` / `client_unit_price`.
--
--   036_office_global_project_access.sql's header (lines 14-16) claims:
--   "The 'supervisor cannot edit BoQ' rule lives in a SEPARATE role gate
--   (role IN admin/estimator/principal) on the write policies. We do not
--   touch that gate, so supervisors stay blocked from BoQ exactly as
--   today." That claim was already false the day it was written — no such
--   gate has ever existed on boq_items; 001's FOR ALL policy has always let
--   any assigned user, of any role, write any column. This migration
--   corrects the record and actually builds the gate 036 assumed existed.
--
-- Fix — three pieces:
--   1. Narrow 001's "boq_items_assigned" from FOR ALL to SELECT only.
--      Assigned users (any role) keep read access; the implicit
--      write-via-USING is removed. Replaces the policy under a new name
--      (boq_items_assigned_read) so the old FOR ALL grant cannot linger
--      under its own name if this migration is re-applied out of order.
--   2. Office write access is already granted by 036's
--      "boq_items_office_all" (FOR ALL USING (is_office_role())
--      WITH CHECK (is_office_role())), which is NOT scoped to assignment —
--      matching 036's stated design that office roles (admin/principal/
--      estimator, see is_office_role() in 036) collaborate across EVERY
--      project, not just ones they're assigned to. We compose with that
--      policy rather than duplicate or narrow it: this migration does not
--      touch it, and does not add an <assigned> condition to office write
--      access (that would be a regression from 036's intended scope, not a
--      fix).
--   3. Add a narrow UPDATE policy for assigned (non-office) users, scoped
--      by the same <assigned> subquery boq_items_assigned used (copied
--      verbatim), plus a BEFORE UPDATE trigger that whitelists which
--      columns a non-office actor may change: only `installed` and
--      `progress`. RLS cannot restrict by column, so the trigger is the
--      actual enforcement point. Whitelist (not blacklist), so any column
--      a future migration adds to boq_items is protected by default
--      without a follow-up migration.
--
-- End-state:
--   SELECT — any assigned user, OR any office-role user (any project, via
--            036's boq_items_office_all).
--   INSERT — office roles only (via 036's boq_items_office_all). No policy
--            here grants INSERT to a merely-assigned non-office user.
--   DELETE — office roles only (via 036's boq_items_office_all). Same.
--   UPDATE — office roles: any column, any project (via 036).
--            assigned non-office users (supervisors, any other role, or an
--            authenticated user with no profiles row): installed/progress
--            only, enforced by the trigger below. RLS lets the UPDATE
--            statement through if the row is in an assigned project; the
--            trigger is what actually blocks the disallowed columns.
--
-- Actor resolution in the trigger mirrors 057_lock_profile_role.sql:
--   * auth.uid() IS NULL  → allow, unconditionally. The service-role key
--     and the Supabase Dashboard SQL editor both run with no JWT, yet
--     triggers (unlike RLS policies) still fire for those connections.
--     This is a trusted execution context, not a normal app path.
--   * actor role admin/principal/estimator → allow (any column).
--   * actor role supervisor, any other/future role, OR no matching
--     profiles row (actor_role resolves to NULL, so the membership check
--     below is NULL — not TRUE — and plpgsql treats a NULL IF-condition as
--     false, so control falls through to the whitelist check rather than
--     being silently allowed) → whitelist check (installed/progress only).
--
-- App writers verified against this end-state (full detail in
-- .superpowers/sdd/task-0.3-report.md):
--   tools/publishBaselineV2.ts (~572-591) — estimator upsert of
--     code/label/unit/planned on publish — office path, allowed via 036's
--     boq_items_office_all; not subject to the trigger's whitelist because
--     the actor role is 'estimator'.
--   tools/derivation.ts syncBoqInstalledFromDerived (~381-410) — updates
--     only installed/progress, called from
--     workflows/screens/ProgresScreen.tsx:256 (the supervisor progress-
--     entry flow) — allowed via the new boq_items_assigned_progress_update
--     policy + trigger whitelist.
--
-- Idempotent / re-paste-safe: DROP POLICY IF EXISTS before CREATE POLICY,
--   CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE
--   TRIGGER. Safe to paste into the Supabase Dashboard SQL editor more than
--   once. Does not assume 036/057/058 ran in this session — only that they
--   exist on this branch (per the task brief) — and does not depend on any
--   function 036 defines (is_office_role() is never called here; the
--   trigger reads profiles.role directly, same as 057).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Narrow the original assignment policy to SELECT only.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "boq_items_assigned" ON boq_items;
DROP POLICY IF EXISTS "boq_items_assigned_read" ON boq_items;
CREATE POLICY "boq_items_assigned_read" ON boq_items FOR SELECT USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Assigned-user UPDATE — column-scoped by the trigger in step 3 below.
--    Office write access (INSERT/UPDATE/DELETE, any project) is granted
--    separately by 036's boq_items_office_all and is intentionally not
--    duplicated or modified here.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "boq_items_assigned_progress_update" ON boq_items;
CREATE POLICY "boq_items_assigned_progress_update" ON boq_items FOR UPDATE TO authenticated USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
) WITH CHECK (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Column-guard trigger — the actual write-scoping enforcement for
--    non-office actors, since RLS cannot restrict by column.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION guard_boq_items_supervisor_cols()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_role TEXT;
BEGIN
  -- Service-role key / Dashboard SQL editor: no JWT, auth.uid() is NULL,
  -- but triggers still fire. Trusted execution context — same exception as
  -- 057_lock_profile_role.sql, for the identical reason.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO actor_role FROM profiles WHERE id = auth.uid();

  -- Office roles: no column restriction. 036 already grants them
  -- unconditional write access to boq_items; this keeps the trigger
  -- consistent with that rather than adding a second, redundant gate.
  IF actor_role IN ('admin', 'principal', 'estimator') THEN
    RETURN NEW;
  END IF;

  -- Everyone else — supervisor, any future/unrecognized role, or an
  -- authenticated user with no matching profiles row — may only change
  -- installed/progress. Whitelist, not blacklist: any column a future
  -- migration adds to boq_items is protected by default.
  IF (to_jsonb(NEW) - 'installed' - 'progress') IS DISTINCT FROM (to_jsonb(OLD) - 'installed' - 'progress') THEN
    RAISE EXCEPTION 'supervisor may update only installed/progress on boq_items';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boq_items_guard_supervisor_cols_trg ON boq_items;
CREATE TRIGGER boq_items_guard_supervisor_cols_trg
  BEFORE UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION guard_boq_items_supervisor_cols();
