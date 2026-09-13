// tools/__tests__/progressClaimsStages.test.ts
import { REPORT_LINE_STAGES, ACTIVITY_STATES } from '../reportLineDraftValidate';
import { STAGE_LABELS, ACTIVITY_STATE_LABELS, stageLabel, activityStateLabel, stageOptions } from '../progressClaims/stages';

describe('progressClaims/stages', () => {
  it('labels every stage and every activity state', () => {
    for (const s of REPORT_LINE_STAGES) expect(STAGE_LABELS[s]).toEqual(expect.any(String));
    for (const a of ACTIVITY_STATES) expect(ACTIVITY_STATE_LABELS[a]).toEqual(expect.any(String));
  });

  it('falls back to a neutral label for a missing stage', () => {
    expect(stageLabel(null)).toBe('Tanpa tahap');
    expect(stageLabel('BEKISTING')).toBe('Bekisting');
    expect(activityStateLabel('SELESAI')).toBe('Selesai');
  });

  it('offers every stage as a picker option, weight-bearing ones marked', () => {
    const opts = stageOptions();
    expect(opts.map((o) => o.value)).toEqual([...REPORT_LINE_STAGES]);
    expect(opts.find((o) => o.value === 'PENGECORAN')?.meta).toBe('berbobot');
    expect(opts.find((o) => o.value === 'GALIAN')?.meta).toBeUndefined();
  });
});
