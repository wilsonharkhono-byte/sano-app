-- 093 — The principal is on every project by default, future ones included
--
-- User (2026-08-26): "make the principal level to be by default in all project
--   that is generated in the future as well. i don't need to input myself into
--   the project first before i can add more people."
--
-- Why this is more than convenience: several server paths silently assume a
-- principal is a project member —
--   • enqueue_notification (066) joins project_assignments, so every
--     principal-targeted notification (PLAN_CEILING_RAISE 079/085, AUTO_HOLD
--     and CRITICAL receipt escalation 092) delivers ZERO rows on a project the
--     principal never joined. The escalation authority was unreachable by
--     default.
--   • Team management UI needs the principal on the roster before they can
--     see/add members from a project they didn't create.
--
-- What this migration does:
--   1. New project  → every profile with role 'principal' is auto-assigned
--      (AFTER INSERT trigger on projects).
--   2. New/promoted principal → assigned to every existing project
--      (AFTER INSERT OR UPDATE OF role trigger on profiles; the seat itself
--      is still granted only via SQL — migration 090 is untouched on that).
--   3. Back-fill: every current principal joins every current project.
--   4. Carve-out in enforce_principal_assignment_guard (090) so the auto-
--      assign triggers may insert principal rows even when the project is
--      being created by a non-principal JWT (admin/estimator). Without it,
--      an admin creating a project would abort at the guard.
--
-- Paste order: AFTER 090 (section 4 re-creates ITS
--   enforce_principal_assignment_guard) and together with 092 (whose read
--   policy expects the principal back-fill). Apply via Dashboard SQL Editor
--   (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe throughout.
--
-- ⚠ RE-CREATES A LIVE FUNCTION: enforce_principal_assignment_guard (090).
--   Re-pasting 090 after this file removes the nested-write carve-out; the
--   auto-assign then fails inside its EXCEPTION wrapper — projects still get
--   created, but principals silently stop being auto-assigned. Re-paste 093
--   after any re-paste of 090.
--
-- Removal stays symmetric with 090: only a principal (or SQL) can take a
-- principal OFF a roster; the auto-assign never re-adds to an existing
-- project, so an explicit removal sticks until the next principal-seat event.

-- =========================================================================
-- 1. enforce_principal_assignment_guard — 090 §2 body verbatim, plus the
--    nested-write carve-out (088 carve-out 3 precedent: pg_trigger_depth()).
-- =========================================================================

CREATE OR REPLACE FUNCTION enforce_principal_assignment_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row          RECORD;
  v_target_role  TEXT;
  v_actor_role   TEXT;
BEGIN
  -- One trigger covers INSERT and DELETE, so pick the applicable tuple up
  -- front. NEW is *unassigned* (not merely NULL) inside a DELETE trigger, so
  -- touching NEW.user_id there would raise "record new is not assigned yet"
  -- rather than fall through — hence the explicit TG_OP branch instead of a
  -- COALESCE over the two records.
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  -- Service role / Dashboard (no JWT) — same trusted-context carve-out as §1.
  -- invite-user's auto-assign (supabase/functions/invite-user, step 5) runs
  -- here; it has already vetted its caller and refuses principal invites.
  IF auth.uid() IS NULL THEN
    RETURN v_row;
  END IF;

  -- 093: nested write — this row is being written by another trigger, not by
  -- the client statement itself (same pg_trigger_depth() reasoning as 088's
  -- carve-out 3). The only triggers that write project_assignments are 093's
  -- own auto-assigners, which insert principal rows on behalf of the system —
  -- an admin creating a project must not be refused for a membership row the
  -- SYSTEM is adding. Direct client inserts run at depth 1 and still hit the
  -- full guard below.
  IF pg_trigger_depth() > 1 THEN
    RETURN v_row;
  END IF;

  -- Cascade carve-out. projects → project_assignments is ON DELETE CASCADE
  -- (044_project_fk_cascade.sql), and a cascaded delete DOES fire row triggers
  -- on the child table. Without this branch, deleting a project that happens
  -- to have a principal on its team would RAISE from here and abort the whole
  -- delete — an admin would find project deletion silently broken, which is
  -- not what "principal is out of touch" is asking for. By the time the
  -- cascade reaches us the parent row is already gone in this transaction, so
  -- its absence is the signal: no parent project ⇒ this is a cascade, not
  -- somebody unassigning a principal. Project deletion keeps its own gate
  -- (028_projects_delete_rls.sql).
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM projects WHERE id = v_row.project_id
  ) THEN
    RETURN v_row;
  END IF;

  SELECT role INTO v_target_role FROM profiles WHERE id = v_row.user_id;

  -- Only principal rows are restricted; everyone else keeps the 023/037 rules.
  -- A cascade from a deleted *profile* also lands here with a NULL role and
  -- passes: there is no principal left to protect at that point.
  IF v_target_role IS DISTINCT FROM 'principal' THEN
    RETURN v_row;
  END IF;

  SELECT role INTO v_actor_role FROM profiles WHERE id = auth.uid();

  -- A principal joining or leaving a project themselves is still a principal
  -- acting, so it passes the check below on v_actor_role alone — this is also
  -- what keeps createProject's self-assign working when a principal creates a
  -- project. No separate self-service branch is needed, and adding one would
  -- reopen the hole for a non-principal who somehow owns a principal's row.
  IF v_actor_role IS NULL OR v_actor_role <> 'principal' THEN
    RAISE EXCEPTION 'principal team membership may only be changed by a principal (actor: %)',
      COALESCE(v_actor_role, 'anon');
  END IF;

  RETURN v_row;
END;
$$;

DROP TRIGGER IF EXISTS project_assignments_principal_guard_trg ON project_assignments;
CREATE TRIGGER project_assignments_principal_guard_trg
  BEFORE INSERT OR DELETE ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_principal_assignment_guard();

-- =========================================================================
-- 2. New project → all principals join it.
--    EXCEPTION-wrapped: membership auto-assign must never make project
--    creation fail (mirrors the notifications never-block contract). If it
--    ever degrades (e.g. 090 re-pasted over §1's carve-out), the project is
--    still created and the WARNING names the cause.
-- =========================================================================

CREATE OR REPLACE FUNCTION auto_assign_principals_to_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO project_assignments (project_id, user_id)
    SELECT NEW.id, p.id
    FROM profiles p
    WHERE p.role = 'principal'
    ON CONFLICT (project_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto_assign_principals_to_project failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS projects_auto_assign_principals_trg ON projects;
CREATE TRIGGER projects_auto_assign_principals_trg
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION auto_assign_principals_to_project();

-- =========================================================================
-- 3. New / newly-seated principal → joins every existing project.
--    The seat itself is only ever granted where auth.uid() IS NULL (090), so
--    in practice this fires from the Dashboard SQL editor or service role —
--    but the trigger doesn't rely on that: it keys purely on the role value.
-- =========================================================================

CREATE OR REPLACE FUNCTION auto_assign_principal_to_all_projects()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'principal' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NULL;  -- role unchanged — nothing to do
  END IF;

  BEGIN
    INSERT INTO project_assignments (project_id, user_id)
    SELECT pr.id, NEW.id
    FROM projects pr
    ON CONFLICT (project_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto_assign_principal_to_all_projects failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_principal_membership_trg ON profiles;
CREATE TRIGGER profiles_principal_membership_trg
  AFTER INSERT OR UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_assign_principal_to_all_projects();

-- =========================================================================
-- 4. Back-fill: every current principal onto every current project.
--    Runs in the Dashboard (auth.uid() IS NULL) so the 090 guard passes via
--    its trusted-context branch. Re-paste-safe via ON CONFLICT.
-- =========================================================================

INSERT INTO project_assignments (project_id, user_id)
SELECT pr.id, p.id
FROM projects pr
CROSS JOIN profiles p
WHERE p.role = 'principal'
ON CONFLICT (project_id, user_id) DO NOTHING;
