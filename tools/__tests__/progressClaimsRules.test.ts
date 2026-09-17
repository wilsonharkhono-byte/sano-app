// tools/__tests__/progressClaimsRules.test.ts
import {
  CLAIM_RPC_ERROR_COPY, canEditStageWeights, canSaveClaimLine, canVerifyClaim, canVerifyClaimAs, claimLineView, isClaimEditable,
  ClaimRpcError, claimRpcErrorCode, isRegression, mapClaimRpcError, regressReasonRowCode, validateClaimPct,
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
