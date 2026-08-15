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
