// Executable copy of docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md
// §3 (capability matrix) and §5.2 (transition table). Every cell of both
// tables is exercised for all four roles, including denied cells.

import {
  canApproveOrRejectRequest,
  canClearAutoHold,
  canManuallyHoldRequest,
  canReturnApprovedRequest,
  canManagePurchaseOrders,
  validateRequestStatusTransition,
} from '../rolePermissions';
import { UserRole, MRStatus, type UserRoleType } from '../constants';

const ALL_ROLES: UserRoleType[] = [
  UserRole.SUPERVISOR,
  UserRole.ESTIMATOR,
  UserRole.ADMIN,
  UserRole.PRINCIPAL,
];

// ── §3 capability matrix ────────────────────────────────────────────────────
// | Action                              | Supervisor | Estimator | Admin | Principal |
// | Approve / reject request            | —          | ✅        | —     | ✅        |
// | Clear AUTO_HOLD                     | —          | ✅        | ❌    | ✅        |
// | Manually hold ("Tahan")             | —          | ❌        | ❌    | ✅        |
// | Return an approved request          | —          | —         | ✅    | ✅        |
// | Create / edit purchase orders       | —          | —         | ✅    | ✅        |

describe('canApproveOrRejectRequest — §3 row "Approve / reject request"', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, true],
    [UserRole.ADMIN, false],
    [UserRole.PRINCIPAL, true],
  ])('role=%s → allowed=%s', (role, expected) => {
    const result = canApproveOrRejectRequest(role);
    expect(result.allowed).toBe(expected);
    if (!expected) expect(result.reason.length).toBeGreaterThan(0);
    else expect(result.reason).toBe('');
  });

  it('explains the withheld action for admin (spec §6 example)', () => {
    expect(canApproveOrRejectRequest(UserRole.ADMIN).reason).toBe('Persetujuan dilakukan estimator.');
  });
});

describe('canClearAutoHold — §3 row "Clear AUTO_HOLD" (spec §2 decision 7: never admin)', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, true],
    [UserRole.ADMIN, false],
    [UserRole.PRINCIPAL, true],
  ])('role=%s → allowed=%s', (role, expected) => {
    expect(canClearAutoHold(role).allowed).toBe(expected);
  });

  it('denies admin with a reason (never admin, even though admin can decide other things)', () => {
    const result = canClearAutoHold(UserRole.ADMIN);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('canManuallyHoldRequest — §3 row "Manually hold (Tahan)" (unchanged, principal only)', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, false],
    [UserRole.ADMIN, false],
    [UserRole.PRINCIPAL, true],
  ])('role=%s → allowed=%s', (role, expected) => {
    expect(canManuallyHoldRequest(role).allowed).toBe(expected);
  });
});

describe('canReturnApprovedRequest — §3 row "Return an approved request"', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, false],
    [UserRole.ADMIN, true],
    [UserRole.PRINCIPAL, true],
  ])('role=%s → allowed=%s', (role, expected) => {
    expect(canReturnApprovedRequest(role).allowed).toBe(expected);
  });

  it('denies estimator with a reason', () => {
    const result = canReturnApprovedRequest(UserRole.ESTIMATOR);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('canManagePurchaseOrders — §3 row "Create / edit purchase orders"', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, false],
    [UserRole.ADMIN, true],
    [UserRole.PRINCIPAL, true],
  ])('role=%s → allowed=%s', (role, expected) => {
    expect(canManagePurchaseOrders(role).allowed).toBe(expected);
  });

  it('explains the withheld action for estimator', () => {
    const result = canManagePurchaseOrders(UserRole.ESTIMATOR);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ── §5.2 transition table ───────────────────────────────────────────────────
// | From → To                                    | Estimator | Admin | Principal |
// | PENDING / UNDER_REVIEW → APPROVED / REJECTED | ✅        | ❌    | ✅        |
// | AUTO_HOLD → APPROVED / REJECTED              | ✅        | ❌    | ✅        |
// | APPROVED → RETURNED                          | ❌        | ✅    | ✅        |
// | RETURNED → APPROVED / REJECTED / PENDING     | ✅        | ❌    | ✅        |
// | * → AUTO_HOLD (manual "Tahan")               | ❌        | ❌    | ✅        |
//
// Supervisor is not an actor in this table anywhere — every cell for
// supervisor must be denied.

describe('validateRequestStatusTransition — PENDING/UNDER_REVIEW → APPROVED/REJECTED', () => {
  const sources = [MRStatus.PENDING, MRStatus.UNDER_REVIEW];
  const targets = [MRStatus.APPROVED, MRStatus.REJECTED];

  for (const from of sources) {
    for (const to of targets) {
      it.each([
        [UserRole.SUPERVISOR, false],
        [UserRole.ESTIMATOR, true],
        [UserRole.ADMIN, false],
        [UserRole.PRINCIPAL, true],
      ])(`${from} → ${to}: role=%s → allowed=%s`, (role, expected) => {
        const result = validateRequestStatusTransition(role, from, to);
        expect(result.allowed).toBe(expected);
        if (!expected) expect(result.reason.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('validateRequestStatusTransition — AUTO_HOLD → APPROVED/REJECTED (clearing a hold)', () => {
  const targets = [MRStatus.APPROVED, MRStatus.REJECTED];

  for (const to of targets) {
    it.each([
      [UserRole.SUPERVISOR, false],
      [UserRole.ESTIMATOR, true],
      [UserRole.ADMIN, false],
      [UserRole.PRINCIPAL, true],
    ])(`AUTO_HOLD → ${to}: role=%s → allowed=%s`, (role, expected) => {
      const result = validateRequestStatusTransition(role, MRStatus.AUTO_HOLD, to);
      expect(result.allowed).toBe(expected);
    });
  }

  it('admin is denied even though admin can act on other transitions (never clears a hold)', () => {
    const result = validateRequestStatusTransition(UserRole.ADMIN, MRStatus.AUTO_HOLD, MRStatus.APPROVED);
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('validateRequestStatusTransition — APPROVED → RETURNED (reason required)', () => {
  it.each([
    [UserRole.SUPERVISOR, false],
    [UserRole.ESTIMATOR, false],
    [UserRole.ADMIN, true],
    [UserRole.PRINCIPAL, true],
  ])('role=%s, with reason → allowed=%s', (role, expected) => {
    const result = validateRequestStatusTransition(role, MRStatus.APPROVED, MRStatus.RETURNED, {
      returnReason: 'Barang tidak tersedia di supplier.',
    });
    expect(result.allowed).toBe(expected);
    if (!expected) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('denies admin/principal without a non-empty reason', () => {
    const noReason = validateRequestStatusTransition(UserRole.ADMIN, MRStatus.APPROVED, MRStatus.RETURNED);
    expect(noReason.allowed).toBe(false);
    expect(noReason.reason.length).toBeGreaterThan(0);

    const blankReason = validateRequestStatusTransition(UserRole.PRINCIPAL, MRStatus.APPROVED, MRStatus.RETURNED, {
      returnReason: '   ',
    });
    expect(blankReason.allowed).toBe(false);
  });

  it('checks role BEFORE reason — estimator is denied even with a reason present', () => {
    const result = validateRequestStatusTransition(UserRole.ESTIMATOR, MRStatus.APPROVED, MRStatus.RETURNED, {
      returnReason: 'Some reason',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).not.toMatch(/alasan/i);
  });
});

describe('validateRequestStatusTransition — RETURNED → APPROVED/REJECTED/PENDING (re-decide / re-open)', () => {
  const targets = [MRStatus.APPROVED, MRStatus.REJECTED, MRStatus.PENDING];

  for (const to of targets) {
    it.each([
      [UserRole.SUPERVISOR, false],
      [UserRole.ESTIMATOR, true],
      [UserRole.ADMIN, false],
      [UserRole.PRINCIPAL, true],
    ])(`RETURNED → ${to}: role=%s → allowed=%s`, (role, expected) => {
      const result = validateRequestStatusTransition(role, MRStatus.RETURNED, to);
      expect(result.allowed).toBe(expected);
    });
  }
});

describe('validateRequestStatusTransition — * → AUTO_HOLD (manual "Tahan", principal only)', () => {
  const sources = [MRStatus.PENDING, MRStatus.UNDER_REVIEW];

  for (const from of sources) {
    it.each([
      [UserRole.SUPERVISOR, false],
      [UserRole.ESTIMATOR, false],
      [UserRole.ADMIN, false],
      [UserRole.PRINCIPAL, true],
    ])(`${from} → AUTO_HOLD: role=%s → allowed=%s`, (role, expected) => {
      const result = validateRequestStatusTransition(role, from, MRStatus.AUTO_HOLD);
      expect(result.allowed).toBe(expected);
    });
  }

  it('does not offer manual hold from APPROVED/REJECTED/RETURNED/AUTO_HOLD (matches existing UI, never invented)', () => {
    const disallowedSources = [MRStatus.APPROVED, MRStatus.REJECTED, MRStatus.RETURNED, MRStatus.AUTO_HOLD];
    for (const from of disallowedSources) {
      const result = validateRequestStatusTransition(UserRole.PRINCIPAL, from, MRStatus.AUTO_HOLD);
      expect(result.allowed).toBe(false);
    }
  });
});

describe('validateRequestStatusTransition — transitions absent from the table are denied for every role', () => {
  const illegalPairs: Array<[typeof MRStatus[keyof typeof MRStatus], typeof MRStatus[keyof typeof MRStatus]]> = [
    [MRStatus.PENDING, MRStatus.RETURNED],
    [MRStatus.REJECTED, MRStatus.APPROVED],
    [MRStatus.REJECTED, MRStatus.PENDING],
    [MRStatus.APPROVED, MRStatus.PENDING],
    [MRStatus.APPROVED, MRStatus.APPROVED],
  ];

  for (const [from, to] of illegalPairs) {
    for (const role of ALL_ROLES) {
      it(`${from} → ${to} denied for role=${role}`, () => {
        const result = validateRequestStatusTransition(role, from, to);
        expect(result.allowed).toBe(false);
        expect(result.reason.length).toBeGreaterThan(0);
      });
    }
  }
});
