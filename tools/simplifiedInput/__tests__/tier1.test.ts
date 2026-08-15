import * as XLSX from 'xlsx';
import { parseTier1Sheet, BETON_MATERIAL_NAME } from '../tier1';

function tier1Sheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
    [null, null, 8, 10, 13, 16, 19, 22],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

describe('parseTier1Sheet', () => {
  const ws = tier1Sheet([
    ['Lt. Basement ; Kolom', 39.02277465724567, 0, 517, 57, 174, 91, 60],
    [], // blank spacer between zones
    ['Bunker; Tangga', 2.76, 7, 9, 19, 0, 0, 0],
  ]);
  const rows = parseTier1Sheet(ws);

  it('emits one boq row per non-blank work area with sequential codes', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.parsed_data.code)).toEqual(['T1-001', 'T1-002']);
  });

  it('splits the label into chapter/sub_chapter and sets planned = beton m³', () => {
    const r = rows[0];
    expect(r.raw_data.chapter).toBe('Lt. Basement');
    expect(r.raw_data.subChapter).toBe('Kolom');
    expect(r.parsed_data.unit).toBe('m³');
    expect(r.parsed_data.planned).toBeCloseTo(39.02277465724567, 9);
  });

  it('builds a beton component with coefficient 1.0 plus one rebar component per nonzero diameter', () => {
    const comps = (rows[0].parsed_data.recipe as any).components;
    const beton = comps.find((c: any) => c.materialName === BETON_MATERIAL_NAME);
    expect(beton.quantityPerUnit).toBe(1.0);
    expect(beton.unit).toBe('m³');
    // ø8 was 0 → skipped; ø10/13/16/19/22 present → 5 rebar + 1 beton = 6
    expect(comps).toHaveLength(6);
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm');
    expect(d10.unit).toBe('batang');
    expect(d10.quantityPerUnit * (rows[0].parsed_data.planned as number)).toBeCloseTo(517, 6);
  });

  it('skips fully blank rows and stops at the end of data', () => {
    const comps2 = (rows[1].parsed_data.recipe as any).components;
    // Bunker; Tangga: ø8=7, ø10=9, ø13=19 → 3 rebar + 1 beton
    expect(comps2).toHaveLength(4);
    expect(rows[1].raw_data.chapter).toBe('Bunker');
    expect(rows[1].raw_data.subChapter).toBe('Tangga');
  });
});

describe('parseTier1Sheet rebar-only work areas', () => {
  // Real case: "Umum ; Kolom Balok Praktis" — practical columns/beams cast from
  // the surrounding pours, so the estimator left Beton Readymix blank but still
  // took off 684 lonjor ø8 + 805 lonjor ø10 (~9,200 kg of rebar).
  const rows = parseTier1Sheet(
    tier1Sheet([
      ['Umum ; Kolom Balok Praktis', null as unknown as number, 684, 805, 0, 0, 0, 0],
      ['Lt. 1 ; Judul Saja', null as unknown as number, 0, 0, 0, 0, 0, 0],
    ]),
  );

  it('stages a publishable lump-sum row instead of a planned = 0 ghost', () => {
    const r = rows[0];
    expect(r.parsed_data.planned).toBe(1);
    expect(r.parsed_data.unit).toBe('ls');
    expect(r.needs_review).toBe(false);
    expect(r.raw_data.chapter).toBe('Umum');
    expect(r.raw_data.subChapter).toBe('Kolom Balok Praktis');
  });

  it('omits the Beton Readymix component rather than claiming 0 m³', () => {
    const comps = (rows[0].parsed_data.recipe as any).components;
    expect(comps.some((c: any) => c.materialName === BETON_MATERIAL_NAME)).toBe(false);
    expect(comps).toHaveLength(2);
  });

  it('INVARIANT: planned × coefficient reproduces the sheet lonjor count EXACTLY', () => {
    const planned = rows[0].parsed_data.planned as number;
    const comps = (rows[0].parsed_data.recipe as any).components;
    const d8 = comps.find((c: any) => c.materialName === 'Besi beton polos 8 mm');
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm');
    expect(d8.unit).toBe('batang');
    expect(planned * d8.quantityPerUnit).toBe(684);
    expect(planned * d10.quantityPerUnit).toBe(805);
  });

  it('leaves a truly empty work area (no beton, no rebar) at planned 0 as before', () => {
    const r = rows[1];
    expect(r.parsed_data.planned).toBe(0);
    expect(r.parsed_data.unit).toBe('m³');
    expect(r.needs_review).toBe(true);
    expect((r.parsed_data.recipe as any).components).toHaveLength(1); // the beton lump only
  });
});
