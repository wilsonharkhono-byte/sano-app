// tools/__tests__/progressClaimsDiaryEvidence.test.ts
import { diarySummary, latestRevisionLines, linesByRowSince, proposeFromDiary, type DiaryLine } from '../progressClaims/diaryEvidence';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
let seq = 0;
const line = (over: Partial<DiaryLine>): DiaryLine => ({
  id: `l${++seq}`, boq_item_id: 'k1', stage: 'BEKISTING', activity_state: 'LANJUT', line_text: 'Kolom :: bekisting', line_index: 0,
  report_id: 'r1', report_no: 1, revision: 1, period_end: '2026-09-10', issued_at: '2026-09-10T10:00:00Z', ...over,
});

describe('latestRevisionLines', () => {
  it('keeps only lines of the latest revision of each report number', () => {
    const lines = [
      line({ id: 'a', report_id: 'r1v1', report_no: 1, revision: 1 }),
      line({ id: 'b', report_id: 'r1v2', report_no: 1, revision: 2 }),
      line({ id: 'c', report_id: 'r2v1', report_no: 2, revision: 1 }),
    ];
    expect(latestRevisionLines(lines).map((l) => l.id)).toEqual(['b', 'c']);
  });
});

describe('linesByRowSince', () => {
  it('keeps lines issued after the row was last verified, and every line of a row never verified', () => {
    const lines = [
      line({ id: 'old', boq_item_id: 'k1', issued_at: '2026-09-08T09:00:00Z' }),
      line({ id: 'new', boq_item_id: 'k1', issued_at: '2026-09-09T09:00:00Z' }),
      line({ id: 'other', boq_item_id: 'b1', issued_at: '2026-08-01T09:00:00Z' }),
      line({ id: 'unlinked', boq_item_id: null }),
    ];
    const byRow = linesByRowSince(lines, new Map([['k1', '2026-09-08T12:00:00Z']]));
    expect(byRow.get('k1')?.map((l) => l.id)).toEqual(['new']);
    expect(byRow.get('b1')?.map((l) => l.id)).toEqual(['other']);
    expect(byRow.size).toBe(2);
  });
});

describe('proposeFromDiary', () => {
  const prev = { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 };

  it('lets the latest line of each stage decide: finished is 100, running is 50', () => {
    const p = proposeFromDiary(kolom, prev, [
      line({ stage: 'BEKISTING', activity_state: 'LANJUT', period_end: '2026-09-08', report_no: 12 }),
      line({ stage: 'BEKISTING', activity_state: 'SELESAI', period_end: '2026-09-10', report_no: 14 }),
      line({ stage: 'PEMBESIAN', activity_state: 'MULAI', period_end: '2026-09-10', report_no: 14 }),
    ]);
    expect(p?.pct).toEqual({ BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 });
    expect(p?.changed).toBe(true);
    expect(p?.stages).toEqual([
      { stage: 'BEKISTING', status: 'SELESAI', reportNo: 14, date: '2026-09-10' },
      { stage: 'PEMBESIAN', status: 'BERJALAN', reportNo: 14, date: '2026-09-10' },
    ]);
  });

  it('reads a later "lanjut" after a "selesai" as running again', () => {
    const p = proposeFromDiary(kolom, prev, [
      line({ stage: 'BEKISTING', activity_state: 'SELESAI', period_end: '2026-09-08' }),
      line({ stage: 'BEKISTING', activity_state: 'LANJUT', period_end: '2026-09-10' }),
    ]);
    expect(p?.pct.BEKISTING).toBe(50);
  });

  it('never proposes below the verified figure, and says nothing changed when the diary adds nothing', () => {
    const verified = { BEKISTING: 100, PEMBESIAN: 70, PENGECORAN: 0 };
    const p = proposeFromDiary(kolom, verified, [
      line({ stage: 'BEKISTING', activity_state: 'LANJUT' }),
      line({ stage: 'PEMBESIAN', activity_state: 'LANJUT' }),
    ]);
    expect(p?.pct).toEqual(verified);
    expect(p?.changed).toBe(false);
  });

  it('lists work without BoQ weight as context and proposes nothing from it', () => {
    const p = proposeFromDiary(kolom, prev, [line({ stage: 'CURING', activity_state: 'SELESAI' }), line({ stage: null })]);
    expect(p?.pct).toEqual(prev);
    expect(p?.changed).toBe(false);
    expect(p?.context).toHaveLength(2);
  });

  it('takes the latest line of any stage for a one-stage row', () => {
    const p = proposeFromDiary({ SINGLE: 1 }, { SINGLE: 0 }, [
      line({ stage: 'GALIAN', activity_state: 'MULAI', period_end: '2026-09-08' }),
      line({ stage: 'LAINNYA', activity_state: 'SELESAI', period_end: '2026-09-11', report_no: 15 }),
    ]);
    expect(p?.pct).toEqual({ SINGLE: 100 });
    expect(p?.stages).toEqual([{ stage: 'SINGLE', status: 'SELESAI', reportNo: 15, date: '2026-09-11' }]);
  });

  it('proposes nothing without lines', () => {
    expect(proposeFromDiary(kolom, prev, [])).toBeNull();
  });
});

describe('diarySummary', () => {
  it('names the report and each stage status', () => {
    const p = proposeFromDiary(kolom, { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 }, [
      line({ stage: 'BEKISTING', activity_state: 'SELESAI', report_no: 14 }),
      line({ stage: 'PEMBESIAN', activity_state: 'LANJUT', report_no: 14 }),
    ]);
    expect(diarySummary(p)).toBe('Dari laporan #14: Bekisting selesai · Pembesian berjalan');
    const two = proposeFromDiary(kolom, { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 }, [
      line({ stage: 'BEKISTING', activity_state: 'SELESAI', report_no: 12, period_end: '2026-09-08' }),
      line({ stage: 'PEMBESIAN', activity_state: 'LANJUT', report_no: 14 }),
    ]);
    expect(diarySummary(two)).toBe('Dari laporan #12, #14: Bekisting selesai · Pembesian berjalan');
    expect(diarySummary(null)).toBe('');
  });
});
