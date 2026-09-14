// tools/__tests__/progressClaimsView.test.ts
import {
  buildRowViews, claimStatusSummary, claimableRows, countLinesByRow, formatPercent, formatQty, latestRevisionReportIds,
  latestVerifiedByRow, missingWeightSeeds, parsePercentInput, pctInputs, readPctInputs, readWeightPercentInputs,
  regressedStages, stageKeyLabel, weightPercentInputs, weightSourceLabel, type ClaimableItem,
} from '../progressClaims/claimView';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';

const row = (over: Partial<ClaimableItem> & Pick<ClaimableItem, 'id' | 'code' | 'label'>): ClaimableItem => ({
  unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: 0, chapter: null, sub_chapter: null, superseded_at: null, ...over,
});
const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const EN_DASH = String.fromCharCode(0x2013);

describe('claimableRows', () => {
  it('keeps live T1 work areas with planned volume in BoQ order and drops the Others anchor', () => {
    const rows = claimableRows([
      row({ id: 'b', code: 'T1-002', label: 'Lantai 1 ; Kolom', sort_order: 2 }),
      row({ id: 'a', code: 'T1-001', label: 'Lantai 1 ; Pile Cap', sort_order: 1 }),
      row({ id: 'm', code: 'MATERIAL-UMUM', label: 'Material umum', sort_order: 0 }),
      row({ id: 's', code: 'T1-003', label: 'Lantai 2 ; Balok', superseded_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'z', code: 'T1-004', label: 'Tangga', planned: 0 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps every live planned row of a full-RAB project', () => {
    const rows = claimableRows([
      row({ id: 'x', code: 'IV.A.2.7', label: 'Balok B24-1', sort_order: 5 }),
      row({ id: 'y', code: 'III.A.1.1', label: 'Poer PC.1', sort_order: 1 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['y', 'x']);
  });
});

describe('weights', () => {
  it('seeds only rows without weights, classified across the project (basement-first ground)', () => {
    const rows = [
      row({ id: 'p1', code: 'T1-001', label: 'Lantai 1 ; Plat Lantai' }),
      row({ id: 'p2', code: 'T1-002', label: 'Lantai 2 ; Plat Lantai' }),
      row({ id: 'k1', code: 'T1-003', label: 'Lantai 1 ; Kolom' }),
    ];
    expect(missingWeightSeeds(rows, [{ boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM' }])).toEqual([
      { boq_item_id: 'p1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' },
      { boq_item_id: 'p2', reference_class: 'BALOK_PLAT' },
    ]);
  });

  it('labels the source of a row weights', () => {
    expect(weightSourceLabel('reference', 'KOLOM')).toBe('Bobot referensi (Kolom)');
    expect(weightSourceLabel('manual', null)).toBe('Bobot diatur estimator');
    expect(weightSourceLabel(null, null)).toBe('Bobot belum diatur');
  });

  it('turns stored weights into percent inputs and three percents back into weights', () => {
    expect(weightPercentInputs(REFERENCE_PROFILE.BALOK_PLAT!.weights)).toEqual({ BEKISTING: '36,8', PEMBESIAN: '38', PENGECORAN: '25,2' });
    expect(weightPercentInputs({ SINGLE: 1 })).toEqual({ BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' });
    expect(readWeightPercentInputs({ BEKISTING: '36,8', PEMBESIAN: '38', PENGECORAN: '25,2' }))
      .toEqual({ ok: true, weights: { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 } });
    const short = readWeightPercentInputs({ BEKISTING: '30', PEMBESIAN: '40', PENGECORAN: '29' });
    expect(short.ok).toBe(false);
    expect(!short.ok && short.reason).toBe('Jumlah bobot 99%, harus 100%.');
    expect(readWeightPercentInputs({ BEKISTING: '30', PEMBESIAN: 'x', PENGECORAN: '70' }).ok).toBe(false);
  });
});

describe('verified figures and report evidence', () => {
  it('keeps the most recently verified figure per row and ignores lines without one', () => {
    const map = latestVerifiedByRow([
      { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, updated_at: '2026-09-07T03:00:00+00:00', progress_claims: { verified_at: '2026-09-07T03:00:00+00:00' } },
      { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, updated_at: '2026-09-14T03:00:00+00:00', progress_claims: [{ verified_at: '2026-09-14T03:00:00+00:00' }] },
      { boq_item_id: 't1', verified_pct: null, updated_at: '2026-09-14T03:00:00+00:00', progress_claims: { verified_at: '2026-09-14T03:00:00+00:00' } },
    ]);
    expect(map.get('k1')).toEqual({ BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 });
    expect(map.has('t1')).toBe(false);
  });

  it('counts confirmed lines of the latest revision of each report only', () => {
    const ids = latestRevisionReportIds([
      { id: 'r1v1', report_no: 1, revision: 1 },
      { id: 'r1v2', report_no: 1, revision: 2 },
      { id: 'r2', report_no: 2, revision: 1 },
    ]);
    expect([...ids].sort()).toEqual(['r1v2', 'r2']);
    expect(countLinesByRow([
      { boq_item_id: 'k1', report_id: 'r1v1' },
      { boq_item_id: 'k1', report_id: 'r1v2' },
      { boq_item_id: 'k1', report_id: 'r2' },
      { boq_item_id: null, report_id: 'r2' },
    ], ids)).toEqual(new Map([['k1', 2]]));
  });
});

describe('buildRowViews', () => {
  it('joins weights, verified figures and this claim line into one view per row', () => {
    const rows = [
      row({ id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom' }),
      row({ id: 't1', code: 'T1-002', label: 'Tangga', planned: 10 }),
      row({ id: 'x', code: 'T1-003', label: 'Lantai 2 ; Dinding' }),
    ];
    const views = buildRowViews(
      rows,
      [
        { boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM' },
        { boq_item_id: 't1', weights: { SINGLE: 2 }, source: 'manual', reference_class: null },
      ],
      new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]),
      [{
        id: 'l1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
        claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, note: 'Begel', regress_reason: null,
        evidence: { photo_refs: ['progress/p/1.jpg'] },
      }],
      new Map([['k1', 3]]),
    );
    expect(views[0]).toMatchObject({ lineId: 'l1', source: 'reference', prevFraction: 0.326, claimedFraction: 0.6176, photoRefs: ['progress/p/1.jpg'], linkedLines: 3, note: 'Begel' });
    expect(views[1]).toMatchObject({ weights: null, source: null, claimedFraction: null, prevFraction: 0 });
    expect(views[2]).toMatchObject({ weights: null, prevPct: {}, lineId: null, linkedLines: 0 });
  });
});

describe('claimStatusSummary', () => {
  const base = { week_start: '2026-09-14', verified_at: null, return_note: null };
  it('reads each state in Indonesian with its week', () => {
    const week = `Minggu 14${EN_DASH}20 Sep`;
    expect(claimStatusSummary(null).label).toBe('Belum ada klaim');
    expect(claimStatusSummary({ ...base, status: 'DRAFT' })).toEqual({ label: 'Belum dikirim', flag: 'WARNING', detail: week });
    expect(claimStatusSummary({ ...base, status: 'SUBMITTED' })).toEqual({ label: 'Menunggu verifikasi', flag: 'INFO', detail: week });
    expect(claimStatusSummary({ ...base, status: 'RETURNED', return_note: 'Foto kurang' })).toEqual({ label: 'Dikembalikan', flag: 'HIGH', detail: `${week}: Foto kurang` });
    expect(claimStatusSummary({ ...base, status: 'VERIFIED', verified_at: '2026-09-15T20:00:00Z' }))
      .toEqual({ label: 'Terverifikasi', flag: 'OK', detail: `${week}, diverifikasi 16 Sep` });
  });
});

describe('percent inputs', () => {
  it.each([
    ['42,5', 42.5], ['42.5', 42.5], [' 100 ', 100], ['33,33', 33.3], ['0', 0],
  ])('parses %j as %d', (raw, expected) => {
    expect(parsePercentInput(raw)).toBe(expected);
  });

  it.each(['101', '-1', 'abc', '1.2.3', '1000'])('refuses %j', (raw) => {
    expect(parsePercentInput(raw)).toBeNaN();
  });

  it('reads blank as missing', () => {
    expect(parsePercentInput('  ')).toBeNull();
  });

  it('prefills inputs and reads them back per stage of the weights', () => {
    expect(pctInputs(kolom, { BEKISTING: 100, PEMBESIAN: 42.5, PENGECORAN: 0 })).toEqual({ BEKISTING: '100', PEMBESIAN: '42,5', PENGECORAN: '0' });
    expect(pctInputs({ SINGLE: 1 }, null)).toEqual({ SINGLE: '' });
    expect(readPctInputs({ SINGLE: 1 }, { SINGLE: '40' })).toEqual({ ok: true, pct: { SINGLE: 40 } });
    expect(readPctInputs(kolom, { BEKISTING: '100', PEMBESIAN: '40' })).toEqual({ ok: false, reason: 'Isi persentase pengecoran.' });
    expect(readPctInputs(kolom, { BEKISTING: '120', PEMBESIAN: '40', PENGECORAN: '0' })).toEqual({ ok: false, reason: 'Persentase bekisting harus angka 0 sampai 100.' });
  });

  it('names the stages that go below the verified figure', () => {
    expect(regressedStages(kolom, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 90, PEMBESIAN: 60, PENGECORAN: 0 })).toEqual(['BEKISTING']);
    expect(stageKeyLabel('SINGLE')).toBe('Progres');
    expect(stageKeyLabel('PEMBESIAN')).toBe('Pembesian');
  });

  it('formats percents and quantities with a decimal comma', () => {
    expect(formatPercent(61.76)).toBe('61,8%');
    expect(formatPercent(null)).toBe('—');
    expect(formatQty(41.0875, 'm³')).toBe('41,09 m³');
    expect(formatQty(-9.72, 'm³')).toBe('-9,72 m³');
    expect(formatQty(38, 'm³')).toBe('38 m³');
  });
});
