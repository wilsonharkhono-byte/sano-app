/**
 * Static guard for migration 090 (the principal seat is SQL-only).
 *
 * Rule: "Admin can add or change structure of principal. This should not be
 * possible. They can only modify supervisor, estimator, and admin. Principal
 * should be out of touch by all, except principal." Refined: "principal
 * assigning should only be reserved to me as principal, or editing through
 * SQL. not any form of UI."
 *
 * Like migration088.test.ts, this suite touches no database — migrations here
 * are pasted into the Supabase Dashboard (remote history diverged), so the DB
 * half of a dual-layer gate cannot be exercised from jest. The guard is the
 * SQL text itself: if someone edits 090 and drops the OLD.role arm, the
 * project_assignments trigger, or the TG_OP branch that keeps DELETE working,
 * the TS half (tools/rolePermissions.ts) would silently disagree with the
 * server. This fails first.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  canAssignRole,
  canChangeMemberRole,
  canManageTeamMember,
  assignableRoles,
} from '../rolePermissions';
import { UserRole } from '../constants';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/090_principal_seat_principal_only.sql'),
  'utf8',
);

describe('migration 090 — §1 principal role changes are SQL-only', () => {
  it('extends 057\'s function in place rather than adding a rival trigger', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION enforce_profile_role_immutable\(\)/);
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS profiles_role_immutable_trg ON profiles/);
    expect(SQL).toMatch(/BEFORE UPDATE OF role ON profiles/);
  });

  it('keeps 057\'s admin/principal floor and its NULL-actor fail-closed guard', () => {
    expect(SQL).toMatch(/actor_role IS NULL OR actor_role NOT IN \('admin', 'principal'\)/);
  });

  it('refuses EVERY JWT actor — principal included — when either end of the move is principal', () => {
    // No actor_role exemption on this branch: the seat is edited only via the
    // NULL-uid path (Dashboard / service role). Guarding both ends closes the
    // demote-the-sitting-principal-first route.
    expect(SQL).toMatch(/IF NEW\.role = 'principal' OR OLD\.role = 'principal' THEN/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'principal role is changed directly in SQL only/);
    expect(SQL).not.toMatch(/OLD\.role = 'principal'\) AND actor_role/);
  });

  it('preserves the auth.uid() IS NULL passthrough — the one sanctioned path for the seat', () => {
    expect(SQL).toMatch(/IF auth\.uid\(\) IS NULL THEN\s*\n\s*RETURN NEW;/);
  });
});

describe('migration 090 — §2 project_assignments roster guard', () => {
  it('fires on INSERT and DELETE, per row', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION enforce_principal_assignment_guard\(\)/);
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS project_assignments_principal_guard_trg ON project_assignments/);
    expect(SQL).toMatch(/BEFORE INSERT OR DELETE ON project_assignments/);
    expect(SQL).toMatch(/FOR EACH ROW EXECUTE FUNCTION enforce_principal_assignment_guard\(\)/);
  });

  it('branches on TG_OP instead of reading NEW during a DELETE', () => {
    // NEW is *unassigned* in a DELETE trigger: NEW.user_id would raise
    // "record new is not assigned yet", turning the guard into an outage.
    expect(SQL).toMatch(/IF TG_OP = 'DELETE' THEN\s*\n\s*v_row := OLD;\s*\n\s*ELSE\s*\n\s*v_row := NEW;/);
    expect(SQL).not.toMatch(/COALESCE\(NEW\.user_id, OLD\.user_id\)/);
    expect(SQL).not.toMatch(/COALESCE\(NEW, OLD\)/);
  });

  it('restricts only principal targets — the rest of the roster keeps 023/037', () => {
    expect(SQL).toMatch(/IF v_target_role IS DISTINCT FROM 'principal' THEN\s*\n\s*RETURN v_row;/);
  });

  it('keeps the principal JWT allowed here — roster is membership, not role assignment', () => {
    // createProject self-assigns its creator; a principal creating a project
    // must not break. The check is on v_actor_role = principal, not NULL-uid.
    expect(SQL).toMatch(/IF v_actor_role IS NULL OR v_actor_role <> 'principal' THEN/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'principal team membership may only be changed by a principal/);
  });

  it('RAISEs rather than narrowing RLS, so a blocked delete is not a silent 0-row success', () => {
    expect(SQL).not.toMatch(/DROP POLICY IF EXISTS "assignments_delete_managers"/);
    expect(SQL).not.toMatch(/DROP POLICY IF EXISTS "assignments_insert_managers"/);
  });
});

describe('migration 090 — §2 does not break project deletion', () => {
  it('lets a cascaded delete through, detected by the parent project already being gone', () => {
    // projects → project_assignments is ON DELETE CASCADE (044) and cascaded
    // deletes DO fire child row triggers. Without this carve-out, deleting any
    // project with a principal on the team would abort.
    expect(SQL).toMatch(/IF TG_OP = 'DELETE' AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM projects WHERE id = v_row\.project_id\s*\n\s*\) THEN\s*\n\s*RETURN v_row;/);
  });

  it('places the cascade check before the principal lookup, not after the RAISE', () => {
    const cascadeAt = SQL.indexOf('SELECT 1 FROM projects WHERE id = v_row.project_id');
    const raiseAt   = SQL.indexOf('RAISE EXCEPTION \'principal team membership');
    expect(cascadeAt).toBeGreaterThan(-1);
    expect(cascadeAt).toBeLessThan(raiseAt);
  });
});

describe('migration 090 — scope stays where it was asked', () => {
  it('does NOT recreate or drop 024\'s profiles_update_managers policy', () => {
    // The ask is about assigning/structure. Leaving 024 alone also means
    // re-pasting 024 cannot revert this migration — the only re-paste trap
    // is 057, whose function this file REPLACEs.
    expect(SQL).not.toMatch(/DROP POLICY IF EXISTS "profiles_update_managers"/);
    expect(SQL).not.toMatch(/CREATE POLICY "profiles_update_managers"/);
  });

  it('touches no other policies at all', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/);
    expect(SQL).not.toMatch(/DROP POLICY/);
  });
});

describe('migration 090 — the TS twin agrees with the SQL', () => {
  it('role changes touching principal: TS denies every actor, exactly as the trigger RAISEs for every JWT', () => {
    for (const actor of [UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL]) {
      expect(canAssignRole(actor, UserRole.PRINCIPAL).allowed).toBe(false);
      expect(canChangeMemberRole(actor, UserRole.PRINCIPAL, UserRole.SUPERVISOR).allowed).toBe(false);
      expect(canChangeMemberRole(actor, UserRole.SUPERVISOR, UserRole.PRINCIPAL).allowed).toBe(false);
      expect(assignableRoles(actor)).not.toContain(UserRole.PRINCIPAL);
    }
  });

  it('roster: TS allows exactly the principal actor the trigger allows, and denies the rest', () => {
    expect(canManageTeamMember(UserRole.PRINCIPAL, UserRole.PRINCIPAL).allowed).toBe(true);
    expect(canManageTeamMember(UserRole.ADMIN, UserRole.PRINCIPAL).allowed).toBe(false);
    expect(canManageTeamMember(UserRole.ESTIMATOR, UserRole.PRINCIPAL).allowed).toBe(false);
  });
});
