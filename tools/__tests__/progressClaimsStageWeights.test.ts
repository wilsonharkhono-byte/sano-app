// tools/__tests__/progressClaimsStageWeights.test.ts
import {
  SINGLE_WEIGHTS, isSingle, referenceWeightsFor, stagesOf, validateStageWeights, weightOf, weightsFromAmounts,
  type ReferenceProfile,
} from '../progressClaims/stageWeights';

describe('validateStageWeights', () => {
  it('accepts SINGLE and a three-stage split summing to 1', () => {
    expect(validateStageWeights({ SINGLE: 1 })).toEqual({ ok: true, weights: { SINGLE: 1 } });
    expect(validateStageWeights({ BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 }).ok).toBe(true);
    expect(validateStageWeights({ BEKISTING: 0.3334, PEMBESIAN: 0.3333, PENGECORAN: 0.3333 }).ok).toBe(true);
  });

  it.each([
    [null],
    [[0.5, 0.5]],
    [{ SINGLE: 0.9 }],
    [{ BEKISTING: 0.5, PEMBESIAN: 0.5 }],
    [{ BEKISTING: 0.5, PEMBESIAN: 0.3, PENGECORAN: 0.3 }],
    [{ BEKISTING: -0.1, PEMBESIAN: 0.6, PENGECORAN: 0.5 }],
    [{ BEKISTING: 0.4, PEMBESIAN: 0.4, PENGECORAN: 0.2, SINGLE: 1 }],
    [{ BEKISTING: '0.4', PEMBESIAN: 0.4, PENGECORAN: 0.2 }],
  ])('refuses %j', (raw) => {
    expect(validateStageWeights(raw).ok).toBe(false);
  });
});

describe('weightsFromAmounts', () => {
  it('turns Rupiah subtotals into fractions that sum to 1 (spec §7.1 worked example, Citraland Balok lt 2)', () => {
    expect(weightsFromAmounts({ BEKISTING: 5_235_945, PEMBESIAN: 3_205_034, PENGECORAN: 1_299_533 }))
      .toEqual({ BEKISTING: 0.538, PEMBESIAN: 0.329, PENGECORAN: 0.133 });
  });

  it('accepts percents and refuses all-zero or negative input', () => {
    expect(weightsFromAmounts({ BEKISTING: 37, PEMBESIAN: 38, PENGECORAN: 25 })).toEqual({ BEKISTING: 0.37, PEMBESIAN: 0.38, PENGECORAN: 0.25 });
    expect(weightsFromAmounts({ BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 })).toBeNull();
    expect(weightsFromAmounts({ BEKISTING: -1, PEMBESIAN: 1, PENGECORAN: 1 })).toBeNull();
  });
});

describe('shape helpers', () => {
  const split = { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 };

  it('lists stages and reads weights for both shapes', () => {
    expect(isSingle(SINGLE_WEIGHTS)).toBe(true);
    expect(isSingle(split)).toBe(false);
    expect(stagesOf(SINGLE_WEIGHTS)).toEqual(['SINGLE']);
    expect(stagesOf(split)).toEqual(['BEKISTING', 'PEMBESIAN', 'PENGECORAN']);
    expect(weightOf(split, 'PEMBESIAN')).toBe(0.5);
    expect(weightOf(split, 'SINGLE')).toBe(0);
    expect(weightOf(SINGLE_WEIGHTS, 'SINGLE')).toBe(1);
    expect(weightOf(SINGLE_WEIGHTS, 'BEKISTING')).toBe(0);
  });

  it('uses the profile for a stage-priced class and SINGLE for every other class', () => {
    const profile: ReferenceProfile = {
      KOLOM: { weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, workbooks: 5, rows: 208, volume_m3: 313 },
    };
    expect(referenceWeightsFor('KOLOM', profile)).toEqual({ BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 });
    expect(referenceWeightsFor('TANGGA', profile)).toEqual({ SINGLE: 1 });
    expect(referenceWeightsFor('LAINNYA', profile)).toEqual({ SINGLE: 1 });
  });
});
