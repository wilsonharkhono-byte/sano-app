// Executable copy of the team-management rule:
//
//   "Admin can add or change structure of principal. This should not be
//    possible. They can only modify supervisor, estimator, and admin.
//    Principal should be out of touch by all, except principal."
//
// Refined (user, 2026-08-19): "principal assigning should only be reserved to
// me as principal, or editing through SQL. not any form of UI."
//
// So the contract splits in two:
//   • ROLE — absolute: NO app actor, principal included, grants or revokes
//     `principal` from any screen. The seat is edited directly in SQL
//     (Dashboard / service role).
//   • ROSTER — principal-only: a principal may add/remove a principal on a
//     project team in-app; admin and estimator may not.
//
// The principal seat is the escalation authority for every other gate in the
// app (approvals, manual hold, ceiling raises), so an actor who could mint or
// demote a principal collapses all of them at once — the same class of hole
// migration 057 closed for self-escalation.
//
// This suite is the TS half of the dual-layer gate. The authoritative half is
// migration 090 (triggers on profiles.role and project_assignments); the SQL
// text guard for it lives in migration090.test.ts.

import {
  canAssignRole,
  canChangeMemberRole,
  canManageTeamMember,
  assignableRoles,
} from '../rolePermissions';
import { UserRole, type UserRoleType } from '../constants';

const ALL_ROLES: UserRoleType[] = [
  UserRole.SUPERVISOR,
  UserRole.ESTIMATOR,
  UserRole.ADMIN,
  UserRole.PRINCIPAL,
];

const NON_PRINCIPAL: UserRoleType[] = [
  UserRole.SUPERVISOR,
  UserRole.ESTIMATOR,
  UserRole.ADMIN,
];

// ── canAssignRole — nobody hands out the principal seat from the app ────────

describe('canAssignRole — granting the principal role is denied for EVERY app actor', () => {
  it.each(ALL_ROLES)('role=%s cannot grant principal', (actor) => {
    const result = canAssignRole(actor, UserRole.PRINCIPAL);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('the denial reason points at SQL, not at another role', () => {
    expect(canAssignRole(UserRole.PRINCIPAL, UserRole.PRINCIPAL).reason).toMatch(/SQL/);
  });
});

describe('canAssignRole — the three ordinary roles stay open to admin/principal', () => {
  const ordinary: UserRoleType[] = [UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN];

  it.each(ordinary)('admin can grant %s', (target) => {
    expect(canAssignRole(UserRole.ADMIN, target).allowed).toBe(true);
  });

  it.each(ordinary)('principal can grant %s', (target) => {
    expect(canAssignRole(UserRole.PRINCIPAL, target).allowed).toBe(true);
  });

  it.each(ordinary)('supervisor cannot grant %s — never a team manager', (target) => {
    expect(canAssignRole(UserRole.SUPERVISOR, target).allowed).toBe(false);
  });
});

// ── canChangeMemberRole — the OLD role matters as much as the new one ───────
// Blocking only the target role would still let an actor demote the sitting
// principal to supervisor and then hand the seat to themselves.

describe('canChangeMemberRole — any move touching the principal seat is denied for EVERY app actor', () => {
  const others: UserRoleType[] = [UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN];

  for (const actor of ALL_ROLES) {
    it.each(others)(`role=${actor} cannot demote a principal to %s`, (to) => {
      const result = canChangeMemberRole(actor, UserRole.PRINCIPAL, to);
      expect(result.allowed).toBe(false);
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it.each(others)(`role=${actor} cannot promote a %s to principal`, (from) => {
      const result = canChangeMemberRole(actor, from, UserRole.PRINCIPAL);
      expect(result.allowed).toBe(false);
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it(`role=${actor} cannot even no-op a principal to principal`, () => {
      expect(canChangeMemberRole(actor, UserRole.PRINCIPAL, UserRole.PRINCIPAL).allowed).toBe(false);
    });
  }
});

describe('canChangeMemberRole — ordinary reshuffles admin keeps', () => {
  it('admin can move a supervisor to estimator', () => {
    expect(canChangeMemberRole(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.ESTIMATOR).allowed).toBe(true);
  });

  it('admin can move an estimator to admin', () => {
    expect(canChangeMemberRole(UserRole.ADMIN, UserRole.ESTIMATOR, UserRole.ADMIN).allowed).toBe(true);
  });

  it('principal can move an admin to estimator', () => {
    expect(canChangeMemberRole(UserRole.PRINCIPAL, UserRole.ADMIN, UserRole.ESTIMATOR).allowed).toBe(true);
  });

  it('an ordinary no-op change is allowed for role assigners', () => {
    expect(canChangeMemberRole(UserRole.ADMIN, UserRole.ADMIN, UserRole.ADMIN).allowed).toBe(true);
  });
});

// ── canManageTeamMember — the roster: principal-only for principal members ──
// Estimator is a project-assignment manager (migration 037), so the guard must
// name them explicitly, not just admin. Roster is NOT role assignment, so the
// principal actor keeps it — createProject's self-assign also relies on a
// principal being able to put themselves on a team.

describe('canManageTeamMember — adding/removing a principal on a project', () => {
  it.each(NON_PRINCIPAL)('role=%s cannot add or remove a principal', (actor) => {
    const result = canManageTeamMember(actor, UserRole.PRINCIPAL);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('principal can add or remove a principal', () => {
    expect(canManageTeamMember(UserRole.PRINCIPAL, UserRole.PRINCIPAL).allowed).toBe(true);
  });
});

describe('canManageTeamMember — the rest of the roster is unchanged', () => {
  const managers: UserRoleType[] = [UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL];
  const members: UserRoleType[] = [UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN];

  for (const actor of managers) {
    it.each(members)(`role=${actor} can manage a %s`, (member) => {
      expect(canManageTeamMember(actor, member).allowed).toBe(true);
    });
  }

  it.each(members)('supervisor cannot manage a %s', (member) => {
    expect(canManageTeamMember(UserRole.SUPERVISOR, member).allowed).toBe(false);
  });
});

// ── assignableRoles — what the role-chip row is allowed to render ───────────

describe('assignableRoles', () => {
  it('omits principal for admin', () => {
    expect(assignableRoles(UserRole.ADMIN)).toEqual([
      UserRole.SUPERVISOR,
      UserRole.ESTIMATOR,
      UserRole.ADMIN,
    ]);
  });

  it('omits principal for principal too — "not any form of UI"', () => {
    expect(assignableRoles(UserRole.PRINCIPAL)).toEqual([
      UserRole.SUPERVISOR,
      UserRole.ESTIMATOR,
      UserRole.ADMIN,
    ]);
  });

  it('never contains principal for anyone', () => {
    for (const actor of ALL_ROLES) {
      expect(assignableRoles(actor)).not.toContain(UserRole.PRINCIPAL);
    }
  });

  it('is empty for roles that never manage a team', () => {
    expect(assignableRoles(UserRole.SUPERVISOR)).toEqual([]);
    expect(assignableRoles(UserRole.ESTIMATOR)).toEqual([]);
  });

  it('never yields a role the actor could not assign one-by-one', () => {
    for (const actor of ALL_ROLES) {
      for (const target of assignableRoles(actor)) {
        expect(canAssignRole(actor, target).allowed).toBe(true);
      }
    }
  });
});
