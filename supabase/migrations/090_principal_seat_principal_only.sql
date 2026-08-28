-- 090 — The principal seat is SQL-only
--
-- Rule (user, 2026-08-19): "Admin can add or change structure of principal.
--   This should not be possible. They can only modify supervisor, estimator,
--   and admin. Principal should be out of touch by all, except principal."
--   Refined the same day: "principal assigning should only be reserved to me
--   as principal, or editing through SQL. not any form of UI."
--
-- Contract this migration enforces:
--   • profiles.role — ANY change that touches 'principal' (either end of the
--     move) is refused for every JWT actor, principal included. The seat is
--     edited only where auth.uid() IS NULL: the Dashboard SQL editor or the
--     service-role key. Ordinary supervisor/estimator/admin changes keep the
--     057 rule (admin/principal actors).
--   • project_assignments — adding or removing a PRINCIPAL member needs a
--     principal actor (or SQL). Roster is membership, not role assignment, so
--     the principal keeps it in-app; admin/estimator lose only principal rows
--     and keep the 023/037 rules for everyone else. A principal JWT must stay
--     allowed here: createProject self-assigns its creator, and a principal
--     creating a project would otherwise break.
--
-- Deliberately NOT touched: profiles_update_managers (024). The ask is about
--   assigning/structure; an admin editing a principal's name/phone is left
--   as-is, and leaving 024 alone means re-pasting 024 cannot revert this
--   migration. The only re-paste trap is 057 (its function is REPLACEd here).
--
-- Why this is a real hole and not just tidiness: 'principal' is the
-- escalation authority for the other server gates — the manual "Tahan"
-- (088 §5.2), the AUTO_HOLD clearance, the ceiling raise. An actor who can
-- mint a principal, or demote the sitting one and take the seat, collapses
-- all of those at once. Same class of escalation migration 057 closed for
-- the self-update path.
--
-- Why triggers rather than policies:
--   • Role changes — RLS WITH CHECK cannot see the OLD row, so "you may not
--     demote a principal" is not expressible as a policy. 057 already solved
--     that with a BEFORE UPDATE OF role trigger; this migration extends that
--     same function rather than adding a second one.
--   • Roster changes — expressible in RLS, but a narrowed USING/WITH CHECK
--     turns a blocked DELETE into a silent 0-row success: the app would toast
--     "Anggota dihapus" while nothing happened. A BEFORE INSERT OR DELETE
--     trigger RAISEs instead, so the client gets a real message. The 023/037
--     policies are deliberately left alone — they still decide *who manages a
--     team at all*; this trigger only carves the principal rows out of it.
--
-- The auth.uid() IS NULL passthrough from 057 is preserved everywhere: the
-- service-role key and the Dashboard SQL editor run without a JWT, and both
-- supabase/functions/invite-user (which refuses principal invites itself)
-- and manual operator fix-ups depend on it. Under this migration that NULL
-- branch is not just a convenience — it IS the one sanctioned path for
-- seating or unseating a principal.
--
-- TS twin (UI layer): tools/rolePermissions.ts (canAssignRole /
--   canChangeMemberRole / canManageTeamMember / assignableRoles) +
--   tools/__tests__/teamManagementPermissions.test.ts. Static SQL guard:
--   tools/__tests__/migration090.test.ts.
--
-- Idempotent / re-paste-safe: CREATE OR REPLACE FUNCTION, DROP ... IF EXISTS
--   before every CREATE TRIGGER.

-- ============================================================================
-- 1. profiles.role — changes touching 'principal' are SQL-only
--    (extends 057_lock_profile_role.sql; that trigger's guarantees are kept)
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_profile_role_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_role TEXT;
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Service-role key / Dashboard SQL editor: no JWT, auth.uid() is NULL.
    -- Trusted execution contexts (057 exception #1) — and under 090 the ONLY
    -- sanctioned path for granting or revoking the principal seat.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT role INTO actor_role FROM profiles WHERE id = auth.uid();

    -- No matching profile row for this JWT must never fall through to
    -- "allowed" (057 exception #2).
    IF actor_role IS NULL OR actor_role NOT IN ('admin', 'principal') THEN
      RAISE EXCEPTION 'role change not permitted for %', COALESCE(actor_role, 'anon');
    END IF;

    -- 090: any change that touches the principal seat — either end of the
    -- move — is refused for EVERY JWT actor, principal included. Guarding
    -- both ends matters: blocking only NEW.role = 'principal' would still
    -- leave demote-the-sitting-principal-first open.
    IF NEW.role = 'principal' OR OLD.role = 'principal' THEN
      RAISE EXCEPTION 'principal role is changed directly in SQL only, never from the app (actor: %)', actor_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_role_immutable_trg ON profiles;
CREATE TRIGGER profiles_role_immutable_trg
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_profile_role_immutable();

-- ============================================================================
-- 2. project_assignments — only a principal (or SQL) adds/removes a principal
-- ============================================================================

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
