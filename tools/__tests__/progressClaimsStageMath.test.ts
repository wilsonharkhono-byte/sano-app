// tools/__tests__/progressClaimsStageMath.test.ts
import { clampPct, claimDelta, deltaFromInstalled, rowFraction, workStatusFor } from '../progressClaims/stageMath';

const split = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };

describe('clampPct', () => {
  it('clamps to 0..100 with one decimal and refuses non-numbers', () => {
    expect(clampPct(42.26)).toBe(42.3);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(-3)).toBe(0);
    expect(clampPct('40')).toBeNull();
    expect(clampPct(Number.NaN)).toBeNull();
  });
});

describe('rowFraction', () => {
  it('weights each stage percent and counts a missing stage as zero', () => {
    expect(rowFraction(split, { BEKISTING: 100, PEMBESIAN: 50 })).toBe(0.558);
    expect(rowFraction(split, {})).toBe(0);
    expect(rowFraction(split, { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 })).toBe(1);
  });

  it('uses the single percent for a SINGLE row and ignores stage keys on it', () => {
    expect(rowFraction({ SINGLE: 1 }, { SINGLE: 40, BEKISTING: 100 })).toBe(0.4);
  });

  it('clamps out-of-range percents', () => {
    expect(rowFraction(split, { BEKISTING: 150, PEMBESIAN: -5 })).toBe(0.368);
  });
});

describe('claimDelta', () => {
  it('adds planned × the fraction gained', () => {
    expect(claimDelta(216.25, 0.2, 0.558)).toEqual({
      deltaQuantity: 77.4175, installedAfter: 120.6675, progressAfter: 55.8, regression: false, unchanged: false,
    });
  });

  it('flags a regression and an unchanged row', () => {
    expect(claimDelta(10, 0.5, 0.4)).toMatchObject({ deltaQuantity: -1, installedAfter: 4, progressAfter: 40, regression: true, unchanged: false });
    expect(claimDelta(10, 0.5, 0.5)).toMatchObject({ deltaQuantity: 0, regression: false, unchanged: true });
  });
});

describe('workStatusFor', () => {
  it('is COMPLETE only at 100%', () => {
    expect(workStatusFor(1)).toBe('COMPLETE');
    expect(workStatusFor(0.999)).toBe('IN_PROGRESS');
  });
});

describe('rowFraction normalization', () => {
  it('reaches 1 when every stage is complete even if the weights sum to 0.999', () => {
    expect(rowFraction({ BEKISTING: 0.333, PEMBESIAN: 0.333, PENGECORAN: 0.333 }, { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 })).toBe(1);
  });
});

describe('deltaFromInstalled', () => {
  it('writes the difference from what the entries already sum to', () => {
    expect(deltaFromInstalled(100, 32.6, 0.6176)).toMatchObject({ installedAfter: 61.76, deltaQuantity: 29.16, regression: false });
    expect(deltaFromInstalled(100, 52.04, 0.4)).toMatchObject({ installedAfter: 40, deltaQuantity: -12.04, regression: true });
    expect(deltaFromInstalled(10, 0, 0.5)).toMatchObject({ installedAfter: 5, deltaQuantity: 5, progressAfter: 50, unchanged: false });
  });
});
