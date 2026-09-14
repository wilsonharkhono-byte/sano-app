// tools/__tests__/progressClaimsReferenceWeights.test.ts
import * as path from 'path';
import { hasStageColumns, rabConcreteRows, referenceProfile, sheetClassTotals } from '../progressClaims/referenceStageWeights';
import { loadReferenceWorkbooks, referenceWorkbooksAvailable } from '../progressClaims/loadReferenceWorkbooks';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';

// Column indexes of the SANO RAB layout: A=0 B=1 D=3 R=17 V=21 W=22 Z=25 AA=26.
function row(cells: Record<number, unknown>): unknown[] {
  const r: unknown[] = [];
  for (const [k, v] of Object.entries(cells)) r[Number(k)] = v;
  return r;
}
const header = (): unknown[][] => [[], [], [], [], [], row({ 17: 'Beton', 21: 'Bekisting', 25: 'Besi' }), []];
const concrete = (label: string, volume: number, R: number, V: number, W: number, Z: number, AA: number) =>
  row({ 1: label, 3: volume, 17: R, 21: V, 22: W, 25: Z, 26: AA });

describe('rabConcreteRows', () => {
  it('reads chapters, sections and stage Rupiah, and skips rows no stage prices', () => {
    const rows = [
      ...header(),
      row({ 0: 'III', 1: 'PEKERJAAN FISIK LANTAI 1' }),
      row({ 0: '3', 1: 'Kolom (Readymix)' }),
      concrete('- Kolom K1', 2, 1_000_000, 10, 100_000, 200, 10_000),
      row({ 1: 'Uitzet', 3: 5, 4: 1000 }),
    ];
    expect(hasStageColumns(rows)).toBe(true);
    expect(rabConcreteRows(rows)).toEqual([{
      chapterTitle: 'PEKERJAAN FISIK LANTAI 1', section: 'Kolom (Readymix)', label: '- Kolom K1',
      volume: 2, bekisting: 2_000_000, pembesian: 4_000_000, pengecoran: 2_000_000,
    }]);
  });
});

describe('sheetClassTotals', () => {
  it('counts only rows priced on all three stages and puts a basement slab in the ground class', () => {
    const rows = [
      ...header(),
      row({ 0: 'III', 1: 'PEKERJAAN FISIK LANTAI BASEMENT' }),
      concrete('- Plat lantai basement', 10, 1_000_000, 1, 100_000, 100, 10_000),
      row({ 0: 'IV', 1: 'PEKERJAAN FISIK LANTAI 1' }),
      concrete('- Plat lantai', 10, 1_000_000, 8, 150_000, 110, 12_000),
      concrete('- Tangga', 3, 5_250_000, 0, 0, 0, 0),
    ];
    const totals = sheetClassTotals(rows);
    expect(totals.get('PILECAP_SLOOF_PLAT_DASAR')).toEqual({ rows: 1, volume: 10, bekisting: 1_000_000, pembesian: 10_000_000, pengecoran: 10_000_000 });
    expect(totals.get('BALOK_PLAT')).toEqual({ rows: 1, volume: 10, bekisting: 12_000_000, pembesian: 13_200_000, pengecoran: 10_000_000 });
    expect(totals.has('TANGGA')).toBe(false);
  });
});

describe('referenceProfile', () => {
  it('averages per-workbook shares, so one large workbook cannot dominate', () => {
    const small = [...header(), row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 1, 2_000_000, 1, 1_000_000, 1, 1_000_000)];
    const large = [...header(), row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 100, 1_000_000, 1, 1_000_000, 1, 2_000_000)];
    // small 25/25/50, large 25/50/25 → 25/37.5/37.5 whatever the volumes
    const profile = referenceProfile([{ name: 'a', sheets: [small] }, { name: 'b', sheets: [large] }]);
    expect(profile.KOLOM).toEqual({ weights: { BEKISTING: 0.25, PEMBESIAN: 0.375, PENGECORAN: 0.375 }, workbooks: 2, rows: 2, volume_m3: 101 });
    expect(profile.TANGGA).toBeUndefined();
  });

  it('ignores sheets without the stage columns', () => {
    const noHeader = [row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 1, 2_000_000, 1, 1_000_000, 1, 1_000_000)];
    expect(referenceProfile([{ name: 'x', sheets: [noHeader] }])).toEqual({});
  });
});

describe('REFERENCE_PROFILE (generated file)', () => {
  const boqDir = path.join(process.cwd(), 'assets', 'BOQ');

  (referenceWorkbooksAvailable(boqDir) ? it : it.skip)('equals a fresh derivation from the reference RAB workbooks', () => {
    expect(referenceProfile(loadReferenceWorkbooks(boqDir))).toEqual(REFERENCE_PROFILE);
  }, 60_000);

  it('covers the four stage-priced classes with weights summing to 1', () => {
    for (const cls of ['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING'] as const) {
      const w = REFERENCE_PROFILE[cls]?.weights;
      expect(w).toBeDefined();
      expect(w!.BEKISTING + w!.PEMBESIAN + w!.PENGECORAN).toBeCloseTo(1, 3);
    }
  });
});
