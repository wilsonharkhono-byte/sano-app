// tools/__tests__/progressClaimsRules.test.ts
import {
  CLAIM_RPC_ERROR_COPY, canEditStageWeights, canSaveClaimLine, canVerifyClaim, canVerifyClaimAs, claimLineView, isClaimEditable,
  ClaimRpcError, claimChangedSince, claimRpcErrorCode, claimRpcRowCode, isRegression, isStaleClaimRefusal, mapClaimRpcError,
  regressReasonRowCode, validateClaimPct,
} from '../progressClaims/claimRules';

const split = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };

describe('roles and states', () => {
  it('lets supervisors, estimators and admins save lines, and never the principal', () => {
    expect(canSaveClaimLine('supervisor')).toBe(true);
    expect(canSaveClaimLine('estimator')).toBe(true);
    expect(canSaveClaimLine('principal')).toBe(false);
    expect(canSaveClaimLine(undefined)).toBe(false);
  });

  it('lets only estimators and admins verify or edit weights', () => {
    expect(canVerifyClaim('estimator')).toBe(true);
    expect(canVerifyClaim('admin')).toBe(true);
    expect(canVerifyClaim('principal')).toBe(false);
    expect(canVerifyClaim('supervisor')).toBe(false);
    expect(canEditStageWeights('estimator')).toBe(true);
    expect(canEditStageWeights('supervisor')).toBe(false);
  });

  it('never lets the submitter verify their own claim', () => {
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-sup')).toBe(true);
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-est')).toBe(false);
    expect(canVerifyClaimAs('admin', null, 'u-sup')).toBe(false);
    expect(canVerifyClaimAs('supervisor', 'u-sup2', 'u-sup')).toBe(false);
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-sup', ['u-sup', 'u-est'])).toBe(false);
    expect(canVerifyClaimAs('estimator', 'u-est2', 'u-sup', ['u-sup', 'u-est'])).toBe(true);
  });

  it('allows editing a draft or returned claim only', () => {
    expect(isClaimEditable('DRAFT')).toBe(true);
    expect(isClaimEditable('RETURNED')).toBe(true);
    expect(isClaimEditable('SUBMITTED')).toBe(false);
    expect(isClaimEditable('VERIFIED')).toBe(false);
  });
});

describe('validateClaimPct', () => {
  it('accepts exactly the stages of the weights, keeping one decimal', () => {
    expect(validateClaimPct(split, { BEKISTING: 100, PEMBESIAN: 42.26, PENGECORAN: 0 }))
      .toEqual({ ok: true, pct: { BEKISTING: 100, PEMBESIAN: 42.3, PENGECORAN: 0 } });
    expect(validateClaimPct({ SINGLE: 1 }, { SINGLE: 55 })).toEqual({ ok: true, pct: { SINGLE: 55 } });
  });

  it.each([
    [split, { BEKISTING: 100, PEMBESIAN: 40 }],
    [split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0, SINGLE: 10 }],
    [split, { BEKISTING: 101, PEMBESIAN: 40, PENGECORAN: 0 }],
    [split, { BEKISTING: '100', PEMBESIAN: 40, PENGECORAN: 0 }],
    [{ SINGLE: 1 as const }, { BEKISTING: 50 }],
    [split, null],
  ])('refuses %j with %j', (weights, raw) => {
    expect(validateClaimPct(weights, raw).ok).toBe(false);
  });
});

describe('claimLineView', () => {
  it('shows the fraction before, after, the quantity added and no regression', () => {
    const view = claimLineView(split, { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, 216.25);
    expect(view.previousFraction).toBe(0.368);
    expect(view.claimedFraction).toBe(0.558);
    expect(view.delta.deltaQuantity).toBe(41.0875);
    expect(view.regression).toBe(false);
  });

  it('flags a stage that goes below what was verified, even when the row total rises', () => {
    expect(isRegression(split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 90, PEMBESIAN: 60, PENGECORAN: 0 })).toBe(true);
    expect(isRegression(split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 })).toBe(false);
  });
});

describe('mapClaimRpcError', () => {
  it('maps every code to its sentence and never collides', () => {
    for (const [code, copy] of CLAIM_RPC_ERROR_COPY) {
      expect(mapClaimRpcError(`${code}: detail from SQL`)).toBe(copy);
    }
    expect(new Set(CLAIM_RPC_ERROR_COPY.map(([code]) => code)).size).toBe(CLAIM_RPC_ERROR_COPY.length);
  });

  it('falls back to the raw text, then to a generic sentence', () => {
    expect(mapClaimRpcError('connection reset')).toBe('Gagal menyimpan: connection reset');
    expect(mapClaimRpcError(null)).toBe('Gagal menyimpan. Coba lagi.');
  });
});

describe('refusal codes', () => {
  it('names the code in a refusal and nothing in any other failure', () => {
    expect(claimRpcErrorCode('CLAIM_REGRESS_REASON: baris T1-001 turun dari progres terverifikasi')).toBe('CLAIM_REGRESS_REASON');
    expect(claimRpcErrorCode('CLAIM_ROLE: peran estimator')).toBe('CLAIM_ROLE');
    expect(claimRpcErrorCode('connection reset')).toBeNull();
    expect(claimRpcErrorCode(undefined)).toBeNull();
  });

  it('carries the sentence, the code and the server text', () => {
    const err = new ClaimRpcError('CLAIM_LOCKED: klaim x sedang menunggu verifikasi');
    expect(err).toBeInstanceOf(ClaimRpcError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(mapClaimRpcError('CLAIM_LOCKED: x'));
    expect(err.code).toBe('CLAIM_LOCKED');
    expect(err.detail).toBe('CLAIM_LOCKED: klaim x sedang menunggu verifikasi');
  });

  it('reads the row a reason was demanded for', () => {
    expect(regressReasonRowCode('CLAIM_REGRESS_REASON: baris IV.A.2.7 turun dari progres terverifikasi')).toBe('IV.A.2.7');
    expect(regressReasonRowCode('CLAIM_LOCKED: x')).toBeNull();
    expect(regressReasonRowCode(null)).toBeNull();
  });
});

describe('refusals that name a row, and claims that changed', () => {
  it('reads the BoQ code a refusal names, never an id', () => {
    expect(claimRpcRowCode('CLAIM_ROW: baris T1-003 sudah tidak berlaku')).toBe('T1-003');
    expect(claimRpcRowCode('CLAIM_PCT: persentase baris IV.A.2.7 tidak cocok dengan bobotnya')).toBe('IV.A.2.7');
    expect(claimRpcRowCode('CLAIM_NO_PLANNED: volume rencana baris T1-004 adalah 0')).toBe('T1-004');
    expect(claimRpcRowCode('CLAIM_NO_WEIGHTS: baris T1-005 belum punya bobot tahapan')).toBe('T1-005');
    expect(claimRpcRowCode('CLAIM_ROW: baris 3f2a1b4c-1111-4222-8333-444455556666 tidak ditemukan')).toBeNull();
    expect(claimRpcRowCode('CLAIM_NOT_FOUND: baris klaim 3f2a1b4c-1111-4222-8333-444455556666 tidak ditemukan')).toBeNull();
    expect(claimRpcRowCode('CLAIM_LOCKED: klaim x sedang menunggu verifikasi')).toBeNull();
    expect(claimRpcRowCode(null)).toBeNull();
  });

  it('puts the row in front of the sentence', () => {
    const err = new ClaimRpcError('CLAIM_PCT: persentase baris T1-003 tidak cocok dengan bobotnya');
    expect(err.message).toBe(`T1-003: ${mapClaimRpcError('CLAIM_PCT: x')}`);
    expect(err.rowCode).toBe('T1-003');
    expect(new ClaimRpcError('CLAIM_LOCKED: klaim x sedang menunggu verifikasi').rowCode).toBeNull();
  });

  it('knows which refusals mean the screen is out of date', () => {
    for (const code of ['CLAIM_STATE', 'CLAIM_LOCKED', 'CLAIM_NOT_FOUND', 'CLAIM_ROW', 'CLAIM_PCT', 'CLAIM_NO_WEIGHTS', 'CLAIM_NO_PLANNED', 'CLAIM_LINES']) {
      expect(isStaleClaimRefusal(code)).toBe(true);
    }
    for (const code of ['CLAIM_REGRESS_REASON', 'CLAIM_EVIDENCE', 'CLAIM_AUTH', null, undefined]) {
      expect(isStaleClaimRefusal(code)).toBe(false);
    }
  });

  it('sees a claim that was returned and sent again, or edited, since the page loaded', () => {
    const claim = { id: 'c1', status: 'SUBMITTED', submitted_at: '2026-09-17T01:00:00Z', updated_at: '2026-09-17T01:00:00Z' };
    const lines = [{ id: 'l1', updated_at: '2026-09-16T10:00:00Z' }];
    const loaded = { claim, lines };
    expect(claimChangedSince(loaded, { claim, lines })).toBe(false);
    expect(claimChangedSince(loaded, { claim: null, lines: [] })).toBe(true);
    expect(claimChangedSince(loaded, { claim: { ...claim, status: 'RETURNED' }, lines })).toBe(true);
    expect(claimChangedSince(loaded, { claim: { ...claim, submitted_at: '2026-09-17T03:00:00Z', updated_at: '2026-09-17T03:00:00Z' }, lines })).toBe(true);
    expect(claimChangedSince(loaded, { claim, lines: [{ id: 'l1', updated_at: '2026-09-17T02:00:00Z' }] })).toBe(true);
    expect(claimChangedSince(loaded, { claim, lines: [...lines, { id: 'l2', updated_at: '2026-09-17T02:00:00Z' }] })).toBe(true);
  });
});
