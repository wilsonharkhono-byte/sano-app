// SANO — pure role-capability helper for the approval / PO separation-of-duties
// feature (docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md).
//
// This is the SINGLE implementation of the spec's §3 capability matrix and §5.2
// transition table. Both office/screens/ApprovalsScreen.tsx and
// workflows/screens/Gate2Screen.tsx must consume this module rather than
// re-deriving the rules — the spec's §6 "Role-derived, not screen-derived"
// requirement exists precisely so the matrix has exactly one implementation.
//
// Kept pure (no supabase import, no react-native import) so it unit-tests
// without mocks, same discipline as tools/budgetGate.ts and
// tools/workGroupDemand.ts. The DB-side twin (migration 088's transition-guard
// trigger, spec §5.2) is authoritative server-side; this module mirrors it so
// the UI can hide a control and explain why *before* a write is attempted.

import { UserRole, type UserRoleType, MRStatus, type MRStatusType } from './constants';

/**
 * Result of a single-capability check. `reason` is a one-line Indonesian
 * explanation suitable both as a server-side error message and as the UI copy
 * rendered in place of a withheld button (spec §6: "Persetujuan dilakukan
 * estimator" style). Empty string when `allowed` is true.
 */
export interface PermissionCheck {
  allowed: boolean;
  reason: string;
}

const ALLOW: PermissionCheck = { allowed: true, reason: '' };
const deny = (reason: string): PermissionCheck => ({ allowed: false, reason });

// ── §3 capability matrix ────────────────────────────────────────────────────
// Each predicate below is one row of the matrix. Estimator and admin never
// share an action: estimator decides requests, admin decides POs; principal
// has both as the escalation path.

/** Approve or reject a material request (PENDING/UNDER_REVIEW → APPROVED/REJECTED). Estimator, principal — NOT admin (admin is read-only here). */
export function canApproveOrRejectRequest(role: UserRoleType): PermissionCheck {
  if (role === UserRole.ESTIMATOR || role === UserRole.PRINCIPAL) return ALLOW;
  return deny('Persetujuan dilakukan estimator.');
}

/** Clear an AUTO_HOLD request (approve or reject it). Estimator, principal — never admin (spec §2 decision 7). */
export function canClearAutoHold(role: UserRoleType): PermissionCheck {
  if (role === UserRole.ESTIMATOR || role === UserRole.PRINCIPAL) return ALLOW;
  return deny('Pembebasan status tahan dilakukan estimator.');
}

/** Manually hold a request ("Tahan"). Principal only — existing, unchanged behaviour. */
export function canManuallyHoldRequest(role: UserRoleType): PermissionCheck {
  if (role === UserRole.PRINCIPAL) return ALLOW;
  return deny('Penahanan manual ("Tahan") dilakukan prinsipal.');
}

/** Return an APPROVED request to the estimator with a reason. Admin, principal. */
export function canReturnApprovedRequest(role: UserRoleType): PermissionCheck {
  if (role === UserRole.ADMIN || role === UserRole.PRINCIPAL) return ALLOW;
  return deny('Pengembalian permintaan dilakukan admin.');
}

/** Create or edit purchase orders. Admin, principal — estimator is read-only here. */
export function canManagePurchaseOrders(role: UserRoleType): PermissionCheck {
  if (role === UserRole.ADMIN || role === UserRole.PRINCIPAL) return ALLOW;
  return deny('Pembuatan PO dilakukan admin.');
}

// ── §5.2 transition table ───────────────────────────────────────────────────
//
// | From → To                                    | Estimator | Admin | Principal |
// |-----------------------------------------------|-----------|-------|-----------|
// | PENDING / UNDER_REVIEW → APPROVED / REJECTED  | ✅        | ❌    | ✅        |
// | AUTO_HOLD → APPROVED / REJECTED               | ✅        | ❌    | ✅        |
// | APPROVED → RETURNED (reason required)         | ❌        | ✅    | ✅        |
// | RETURNED → APPROVED / REJECTED / PENDING      | ✅        | ❌    | ✅        |
// | * → AUTO_HOLD (manual "Tahan")                | ❌        | ❌    | ✅        |
//
// "* → AUTO_HOLD" is scoped to PENDING/UNDER_REVIEW, matching the existing
// ApprovalsScreen behaviour the spec marks *(unchanged)* — the Tahan control
// has never been offered from APPROVED/REJECTED/RETURNED, and this module
// must not invent a new transition the UI never exposed.
//
// Everything not matched below is denied — supervisor is never an actor in
// this table (they create requests and receive goods, never decide them), and
// REJECTED is never a source status outside the RETURNED round-trip.

export interface TransitionCheckOptions {
  /** Required, non-empty, for APPROVED → RETURNED (spec §5.2). */
  returnReason?: string;
}

export interface TransitionCheck {
  allowed: boolean;
  reason: string;
}

/**
 * Validate a material-request status transition for a given role. Mirrors the
 * §5.2 trigger (migration 088) so the UI can pre-flight exactly what the
 * server will accept. `reason` is Indonesian and fit for both a UI
 * explanation and a server-style rejection message.
 */
export function validateRequestStatusTransition(
  role: UserRoleType,
  from: MRStatusType,
  to: MRStatusType,
  options: TransitionCheckOptions = {},
): TransitionCheck {
  const isDecision = to === MRStatus.APPROVED || to === MRStatus.REJECTED;

  // PENDING / UNDER_REVIEW → APPROVED / REJECTED (ordinary approve/reject).
  if ((from === MRStatus.PENDING || from === MRStatus.UNDER_REVIEW) && isDecision) {
    return fromCheck(canApproveOrRejectRequest(role));
  }

  // AUTO_HOLD → APPROVED / REJECTED (clearing a hold).
  if (from === MRStatus.AUTO_HOLD && isDecision) {
    return fromCheck(canClearAutoHold(role));
  }

  // APPROVED → RETURNED (admin/principal, mandatory reason).
  if (from === MRStatus.APPROVED && to === MRStatus.RETURNED) {
    const perm = canReturnApprovedRequest(role);
    if (!perm.allowed) return fromCheck(perm);
    if (!options.returnReason || !options.returnReason.trim()) {
      return deny('Alasan pengembalian wajib diisi.');
    }
    return ALLOW;
  }

  // RETURNED → APPROVED / REJECTED / PENDING (re-decide direct, or re-open).
  if (from === MRStatus.RETURNED && (isDecision || to === MRStatus.PENDING)) {
    return fromCheck(canApproveOrRejectRequest(role));
  }

  // PENDING / UNDER_REVIEW → AUTO_HOLD (manual "Tahan").
  if (to === MRStatus.AUTO_HOLD && (from === MRStatus.PENDING || from === MRStatus.UNDER_REVIEW)) {
    return fromCheck(canManuallyHoldRequest(role));
  }

  return deny(`Transisi status dari ${from} ke ${to} tidak diizinkan.`);
}

function fromCheck(perm: PermissionCheck): TransitionCheck {
  return { allowed: perm.allowed, reason: perm.reason };
}

// ── Team management — the principal seat is SQL-only ────────────────────────
//
// Rule (user, 2026-08-19): "Admin can add or change structure of principal.
// This should not be possible. They can only modify supervisor, estimator, and
// admin. Principal should be out of touch by all, except principal." Refined
// the same day: "principal assigning should only be reserved to me as
// principal, or editing through SQL. not any form of UI."
//
// So the ROLE dimension is absolute: no app actor — principal included — may
// grant or revoke `principal` from any screen. The seat is edited directly in
// SQL (Dashboard / service role). The ROSTER dimension is principal-only: a
// principal may still add or remove a principal on a project team in-app
// (and createProject's self-assign depends on this at the DB layer).
//
// Why it matters beyond the team screen: `principal` is the escalation
// authority in every other gate above (canManuallyHoldRequest, the AUTO_HOLD
// clearance, ceiling raises). An admin who could mint a principal — or demote
// the sitting one and take the seat — collapses all of them at once, the same
// class of hole migration 057 closed for self-escalation.
//
// The guard covers the OLD role as well as the new one: blocking only
// "→ principal" would still let an actor demote the principal to supervisor
// first and hand the empty seat to themselves.
//
// DB-side twin: migration 090 (enforce_profile_role_immutable +
// enforce_principal_assignment_guard). That layer is authoritative; these
// helpers exist so the UI can withhold a chip and say why before a write.

/** Roles that may manage project team membership at all — mirrors is_project_assignment_manager() (migrations 023 + 037). */
const TEAM_MANAGERS: UserRoleType[] = [UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL];

/** Roles that may change another member's role — mirrors profiles_update_managers (024) + the 057 trigger. */
const ROLE_ASSIGNERS: UserRoleType[] = [UserRole.ADMIN, UserRole.PRINCIPAL];

const PRINCIPAL_VIA_SQL = 'Peran prinsipal tidak diubah dari aplikasi — hanya langsung lewat database (SQL).';

/**
 * May `actorRole` grant `targetRole` to somebody from the app? Admin and
 * principal hand out supervisor / estimator / admin; NOBODY hands out the
 * principal seat here — that is done directly in SQL.
 */
export function canAssignRole(actorRole: UserRoleType, targetRole: UserRoleType): PermissionCheck {
  if (!ROLE_ASSIGNERS.includes(actorRole)) return deny('Pengubahan peran dilakukan admin atau prinsipal.');
  if (targetRole === UserRole.PRINCIPAL) return deny(PRINCIPAL_VIA_SQL);
  return ALLOW;
}

/**
 * May `actorRole` move a member from `currentRole` to `newRole` from the app?
 * Denied for every actor when either end of the move is the principal seat —
 * the demote-then-reassign path is the one worth closing.
 */
export function canChangeMemberRole(
  actorRole: UserRoleType,
  currentRole: UserRoleType,
  newRole: UserRoleType,
): PermissionCheck {
  if (currentRole === UserRole.PRINCIPAL || newRole === UserRole.PRINCIPAL) {
    if (!ROLE_ASSIGNERS.includes(actorRole)) return deny('Pengubahan peran dilakukan admin atau prinsipal.');
    return deny(PRINCIPAL_VIA_SQL);
  }
  return canAssignRole(actorRole, newRole);
}

/**
 * May `actorRole` add `memberRole` to a project team, or remove them from it?
 * Estimators are team managers too (migration 037), so they are named here and
 * are held to the same principal rule as admins.
 */
export function canManageTeamMember(actorRole: UserRoleType, memberRole: UserRoleType): PermissionCheck {
  if (!TEAM_MANAGERS.includes(actorRole)) return deny('Pengelolaan tim dilakukan admin atau prinsipal.');
  if (memberRole === UserRole.PRINCIPAL && actorRole !== UserRole.PRINCIPAL) {
    return deny('Anggota prinsipal hanya bisa dikelola oleh prinsipal.');
  }
  return ALLOW;
}

/**
 * The role chips a team screen may render for `actorRole`, in display order.
 * Never contains `principal` for anyone (the seat is SQL-only). Empty for
 * roles that never assign a role at all, so a screen can drive both the chip
 * row and the invite-form role picker off one call.
 */
export function assignableRoles(actorRole: UserRoleType): UserRoleType[] {
  const ordered: UserRoleType[] = [
    UserRole.SUPERVISOR,
    UserRole.ESTIMATOR,
    UserRole.ADMIN,
    UserRole.PRINCIPAL,
  ];
  return ordered.filter((r) => canAssignRole(actorRole, r).allowed);
}
