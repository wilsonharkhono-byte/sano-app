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
