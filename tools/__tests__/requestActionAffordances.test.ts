// Which material-request actions a card may offer, per role × status — the
// screen-facing projection of docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md
// §3/§5.2. The copy assertions compare against tools/rolePermissions.ts rather
// than hardcoding strings, so the withheld-action explanation (spec §6) can
// only ever come from the one place the matrix lives.

import { getRequestActionAffordances } from '../requestActionAffordances';
import {
  canApproveOrRejectRequest,
  canClearAutoHold,
  canReturnApprovedRequest,
} from '../rolePermissions';
import { UserRole, MRStatus, type UserRoleType } from '../constants';

const NOTHING = {
  showDecide: false,
  showHold: false,
  showReopen: false,
  showReturn: false,
  withheldNotice: '',
};

describe('getRequestActionAffordances — open statuses (PENDING / UNDER_REVIEW)', () => {
  const OPEN = [MRStatus.PENDING, MRStatus.UNDER_REVIEW];

  it.each(OPEN)('estimator decides but never holds (%s)', (status) => {
    expect(getRequestActionAffordances(UserRole.ESTIMATOR, status)).toEqual({
      showDecide: true,
      showHold: false,
      showReopen: false,
      showReturn: false,
      withheldNotice: '',
    });
  });

  it.each(OPEN)('principal decides and keeps the manual hold (%s)', (status) => {
    expect(getRequestActionAffordances(UserRole.PRINCIPAL, status)).toEqual({
      showDecide: true,
      showHold: true,
      showReopen: false,
      showReturn: false,
      withheldNotice: '',
    });
  });

  it.each(OPEN)('admin gets no verdict button and is told why (%s)', (status) => {
    expect(getRequestActionAffordances(UserRole.ADMIN, status)).toEqual({
      ...NOTHING,
      withheldNotice: canApproveOrRejectRequest(UserRole.ADMIN).reason,
    });
  });

  it.each(OPEN)('supervisor gets no verdict button either (%s)', (status) => {
    expect(getRequestActionAffordances(UserRole.SUPERVISOR, status)).toEqual({
      ...NOTHING,
      withheldNotice: canApproveOrRejectRequest(UserRole.SUPERVISOR).reason,
    });
  });
});

describe('getRequestActionAffordances — AUTO_HOLD', () => {
  it.each([UserRole.ESTIMATOR, UserRole.PRINCIPAL])(
    '%s may clear the hold, and is not offered "Tahan" on an already-held request',
    (role) => {
      expect(getRequestActionAffordances(role, MRStatus.AUTO_HOLD)).toEqual({
        showDecide: true,
        showHold: false,
        showReopen: false,
        showReturn: false,
        withheldNotice: '',
      });
    },
  );

  it('admin may never clear a hold, and gets the hold-specific explanation', () => {
    // Spec §2 decision 7: AUTO_HOLD is cleared by estimator or principal, never
    // admin — the copy differs from the ordinary approve/reject denial.
    expect(getRequestActionAffordances(UserRole.ADMIN, MRStatus.AUTO_HOLD)).toEqual({
      ...NOTHING,
      withheldNotice: canClearAutoHold(UserRole.ADMIN).reason,
    });
  });
});

describe('getRequestActionAffordances — APPROVED', () => {
  it.each([UserRole.ADMIN, UserRole.PRINCIPAL])('%s may return the request to the estimator', (role) => {
    expect(getRequestActionAffordances(role, MRStatus.APPROVED)).toEqual({
      showDecide: false,
      showHold: false,
      showReopen: false,
      showReturn: true,
      withheldNotice: '',
    });
  });

  it('estimator cannot return an approved request and is told who does', () => {
    expect(getRequestActionAffordances(UserRole.ESTIMATOR, MRStatus.APPROVED)).toEqual({
      ...NOTHING,
      withheldNotice: canReturnApprovedRequest(UserRole.ESTIMATOR).reason,
    });
  });

  it('an approved request is never re-decided in place — that is what RETURNED is for', () => {
    for (const role of [UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL]) {
      expect(getRequestActionAffordances(role, MRStatus.APPROVED).showDecide).toBe(false);
    }
  });
});

describe('getRequestActionAffordances — RETURNED', () => {
  it.each([UserRole.ESTIMATOR, UserRole.PRINCIPAL])(
    '%s can re-decide directly AND re-open, so the round trip costs no extra click',
    (role) => {
      expect(getRequestActionAffordances(role, MRStatus.RETURNED)).toEqual({
        showDecide: true,
        showHold: false,
        showReopen: true,
        showReturn: false,
        withheldNotice: '',
      });
    },
  );

  it('admin, having already returned it, has no action left and is told why', () => {
    expect(getRequestActionAffordances(UserRole.ADMIN, MRStatus.RETURNED)).toEqual({
      ...NOTHING,
      withheldNotice: canApproveOrRejectRequest(UserRole.ADMIN).reason,
    });
  });

  it('a returned request cannot be returned again — it is no longer APPROVED', () => {
    expect(getRequestActionAffordances(UserRole.ADMIN, MRStatus.RETURNED).showReturn).toBe(false);
  });
});

describe('getRequestActionAffordances — terminal and unknown states', () => {
  it.each([UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL])(
    'REJECTED offers nothing to %s, and carries no explanation because nothing is withheld',
    (role) => {
      expect(getRequestActionAffordances(role, MRStatus.REJECTED)).toEqual(NOTHING);
    },
  );

  it('an unrecognised status offers nothing rather than guessing', () => {
    expect(getRequestActionAffordances(UserRole.PRINCIPAL, 'SOMETHING_NEW')).toEqual(NOTHING);
  });

  it('a not-yet-loaded profile withholds every action WITHOUT accusing the user', () => {
    // role === null means "we do not know yet", not "you are not allowed" —
    // rendering "Persetujuan dilakukan estimator" at that moment would be a
    // confident claim about a fact we do not have.
    for (const status of [MRStatus.PENDING, MRStatus.AUTO_HOLD, MRStatus.APPROVED, MRStatus.RETURNED]) {
      expect(getRequestActionAffordances(null, status)).toEqual(NOTHING);
    }
  });
});

describe('getRequestActionAffordances — no role ever holds two sides of the same request', () => {
  const ALL_ROLES: UserRoleType[] = [
    UserRole.SUPERVISOR,
    UserRole.ESTIMATOR,
    UserRole.ADMIN,
    UserRole.PRINCIPAL,
  ];
  const ALL_STATUSES = [
    MRStatus.PENDING,
    MRStatus.UNDER_REVIEW,
    MRStatus.APPROVED,
    MRStatus.REJECTED,
    MRStatus.AUTO_HOLD,
    MRStatus.RETURNED,
  ];

  it('estimator and admin never both act on the same status', () => {
    for (const status of ALL_STATUSES) {
      const estimator = getRequestActionAffordances(UserRole.ESTIMATOR, status);
      const admin = getRequestActionAffordances(UserRole.ADMIN, status);
      const acts = (a: ReturnType<typeof getRequestActionAffordances>) =>
        a.showDecide || a.showHold || a.showReopen || a.showReturn;
      expect(acts(estimator) && acts(admin)).toBe(false);
    }
  });

  it('a visible action never comes with a withheld explanation', () => {
    for (const role of ALL_ROLES) {
      for (const status of ALL_STATUSES) {
        const a = getRequestActionAffordances(role, status);
        if (a.showDecide || a.showReturn || a.showReopen) expect(a.withheldNotice).toBe('');
      }
    }
  });
});
