// tools/__tests__/progressClaimsFlags.test.ts
import { CLAIM_FLAG_LABELS, claimFlags } from '../progressClaims/claimFlags';
import { proposeFromDiary, type DiaryLine } from '../progressClaims/diaryEvidence';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const prev = { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 };
const diary = (stage: string, state: string): DiaryLine => ({
  id: `${stage}-${state}`, boq_item_id: 'k1', stage, activity_state: state, line_text: 'x', line_index: 0,
  report_id: 'r1', report_no: 14, revision: 1, period_end: '2026-09-10', issued_at: '2026-09-10T10:00:00Z',
});
const base = { weights: kolom, source: 'manual' as const, prevPct: prev, photoCount: 1, diaryLines: [] as DiaryLine[], proposal: null };

describe('claimFlags (advisory, spec 2026-09-17 §4.4)', () => {
  it('flags a rise with neither a photo nor a diary line', () => {
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 50, PEMBESIAN: 0, PENGECORAN: 0 }, photoCount: 0 })).toEqual(['NO_EVIDENCE']);
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 50, PEMBESIAN: 0, PENGECORAN: 0 }, photoCount: 0, diaryLines: [diary('BEKISTING', 'LANJUT')], proposal: proposeFromDiary(kolom, prev, [diary('BEKISTING', 'LANJUT')]) })).toEqual([]);
    expect(claimFlags({ ...base, claimedPct: prev, photoCount: 0 })).toEqual([]);
  });

  it('flags pouring ahead of rebar or formwork', () => {
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 100 } })).toEqual(['STAGE_ORDER']);
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 } })).toEqual([]);
    expect(claimFlags({ ...base, weights: { SINGLE: 1 }, prevPct: { SINGLE: 0 }, claimedPct: { SINGLE: 100 } })).toEqual([]);
  });

  it('flags a claim that disagrees with the diary on a stage', () => {
    const lines = [diary('BEKISTING', 'SELESAI')];
    const proposal = proposeFromDiary(kolom, prev, lines);
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 50, PEMBESIAN: 0, PENGECORAN: 0 }, diaryLines: lines, proposal })).toEqual(['DIARY_MISMATCH']);
    expect(claimFlags({ ...base, claimedPct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, diaryLines: lines, proposal })).toEqual([]);
  });

  it('flags reference weights, and every flag has a label', () => {
    expect(claimFlags({ ...base, source: 'reference', claimedPct: prev })).toEqual(['REFERENCE_WEIGHTS']);
    for (const flag of ['NO_EVIDENCE', 'STAGE_ORDER', 'DIARY_MISMATCH', 'REFERENCE_WEIGHTS'] as const) {
      expect(CLAIM_FLAG_LABELS[flag].length).toBeGreaterThan(5);
    }
  });
});
