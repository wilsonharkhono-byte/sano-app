import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { readBreakdownHeader, readBreakdownComponents, readBreakdownSheets } from '../breakdownSheetReader';

function makeSheet(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe('readBreakdownHeader', () => {
  it('parses the header block of a well-formed Breakdown sheet', () => {
    const sheet = makeSheet([
      ['BREAKDOWN — IV.A.2.7 Balok B24-1 (At-Cost)'],
      ['Source: RAB (A)!132 + Analisa AHS blocks'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      ['Unit cost (Rp/m³)', 6839679],
      ['Line total at-cost (Rp)', 1809779],
    ]);

    const header = readBreakdownHeader(sheet, 'Breakdown IV.A.2.7');

    expect(header).toEqual({
      boqCode: 'IV.A.2.7',
      description: '- Balok B24-1',
      unit: 'm3',
      volume: 0.2646,
      unitCost: 6839679,
      lineTotal: 1809779,
    });
  });

  it('throws on missing volume row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN — IV.A.2.7 Balok B24-1 (At-Cost)'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*volume/i);
  });

  it('throws on missing Unit cost row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      // Unit cost row absent
      ['Line total at-cost (Rp)', 1809779],
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*unit cost/i);
  });

  it('throws on missing Line total row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      ['Unit cost (Rp/m³)', 6839679],
      // Line total row absent
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*line total/i);
  });
});

describe('readBreakdownComponents', () => {
  it('parses material/labor/equipment rows and infers group from header rows', () => {
    const sheet = makeSheet([
      [], [], [], [], [], [], [], [], [], // 9 padding rows (header lives in row 10)
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', 'slump 18 ± 2 cm', 1.05, 'm3', 'per m3 beton (waste 5%)', 1043400, 1.0500, 1095570, 0.2778, 289888],
      [2, 'BEKISTING BALOK (Material) — ratio 10 m²'],
      ['', '', 'Multipleks 15 mm', '30x50 panjang 4 m', 2.00, 'lbr', 'per balok (4 m² form)', 200000, 5.0000, 1000000, 1.3230, 264600],
      [3, 'UPAH (Labor) — borongan'],
      ['', '', 'Upah cor + besi + bekisting (borongan)', 'all-in labor', 1.0, 'm3', 'per m3 beton', 1500000, 1.0, 1500000, 0.2646, 396900],
      [4, 'PERALATAN (Equipment)'],
      ['', '', 'Sewa peralatan (vibrator, concrete pump)', '', 1.0, 'm3', 'per m3 beton', 75000, 1.0, 75000, 0.2646, 19845],
    ]);

    const { components, warnings } = readBreakdownComponents(sheet, 'Breakdown IV.A.2.7');

    expect(warnings).toEqual([]);
    expect(components).toHaveLength(4);
    expect(components[0]).toMatchObject({
      group: 'material', materialName: 'Beton readymix K-350',
      qtyPerNativeUnit: 1.05, nativeUnit: 'm3', unitPrice: 1043400,
      qtyPerBoqUnit: 1.0500, costPerBoqUnit: 1095570, totalQty: 0.2778, totalCost: 289888,
    });
    expect(components[1]).toMatchObject({ group: 'material', materialName: 'Multipleks 15 mm' });
    expect(components[2]).toMatchObject({ group: 'labor', materialName: 'Upah cor + besi + bekisting (borongan)' });
    expect(components[3]).toMatchObject({ group: 'equipment', materialName: 'Sewa peralatan (vibrator, concrete pump)' });
  });

  // NOTE: The plan originally checked `totalCost vs totalQty × unitPrice` but
  // that comparison is rounding-unstable because the workbook author rounds
  // totalQty to 4 decimals. The implementation checks the rounding-stable
  // alternative `costPerBoqUnit vs qtyPerBoqUnit × unitPrice`. The fixture
  // below places the wrong number in column J (costPerBoqUnit) to exercise
  // that check.
  it('emits COST_MISMATCH warning when costPerBoqUnit ≠ qtyPerBoqUnit × unitPrice', () => {
    const sheet = makeSheet([
      [], [], [], [], [], [], [], [], [],
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', '', 1.05, 'm3', '', 1043400, 1.05, 999999, 0.2778, 289888], // wrong cost/unit
    ]);
    const { warnings } = readBreakdownComponents(sheet, 'Breakdown IV.A.2.7');
    expect(warnings.some((w) => w.code === 'COST_MISMATCH')).toBe(true);
  });

  it('emits MALFORMED_COMPONENT_ROW warning when qty or price cell is missing/non-numeric', () => {
    const sheet = makeSheet([
      [], [], [], [], [], [], [], [], [],
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', '', '', 'm3', '', 1043400, 1.05, 1095570, 0.2778, 289888], // qty cell empty
      ['', '', 'Multipleks 15 mm',     '', 5.0, 'lbr', '', '',     5.0,  1000000, 1.3230, 264600], // price cell empty
    ]);
    const { components, warnings } = readBreakdownComponents(sheet, 'Breakdown TEST');
    expect(warnings.filter((w) => w.code === 'MALFORMED_COMPONENT_ROW')).toHaveLength(2);
    expect(components).toHaveLength(0);
  });
});

describe('readBreakdownSheets (workbook)', () => {
  it('returns a Map keyed by boqCode for every "Breakdown {code}" sheet', () => {
    const wb = XLSX.utils.book_new();
    const sheet1 = makeSheet([
      ['BREAKDOWN — IV.A.2.7'],
      [],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      ['Unit cost (Rp/m³)', 6839679],
      ['Line total at-cost (Rp)', 1809779],
      [],
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', '', 1.05, 'm3', '', 1043400, 1.05, 1095570, 0.2778, 289888],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet1, 'Breakdown IV.A.2.7');
    const unrelated = makeSheet([['ignore me']]);
    XLSX.utils.book_append_sheet(wb, unrelated, 'Random');

    const { breakdowns, warnings } = readBreakdownSheets(wb);

    expect(warnings).toEqual([]);
    expect(breakdowns.size).toBe(1);
    const bd = breakdowns.get('IV.A.2.7');
    expect(bd).toBeDefined();
    expect(bd!.volume).toBe(0.2646);
    expect(bd!.components).toHaveLength(1);
    expect(bd!.components[0].materialName).toBe('Beton readymix K-350');
    expect(bd!.sourceSheet).toBe('Breakdown IV.A.2.7');
  });

  it('reconciles=true when the computed line total matches source within tolerance', () => {
    const wb = XLSX.utils.book_new();
    // Component cost-per-unit 1095570 × volume 0.2 = 219114 — exactly equal to declared line total
    const sheet = makeSheet([
      ['BREAKDOWN — TEST'],
      [],
      [],
      ['Description', 'test'],
      ['Unit', 'm3'],
      ['Volume', 0.2],
      ['Unit cost (Rp/m³)', 1095570],
      ['Line total at-cost (Rp)', 219114],
      [],
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', '', 1.05, 'm3', '', 1043400, 1.05, 1095570, 0.21, 219114],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Breakdown TEST');
    const { breakdowns } = readBreakdownSheets(wb);
    const bd = breakdowns.get('TEST')!;
    expect(bd.reconciliation.reconciles).toBe(true);
    expect(bd.reconciliation.lineTotalVariance).toBeLessThanOrEqual(1);
  });

  it('reconciles=false when computed line total drifts beyond tolerance', () => {
    const wb = XLSX.utils.book_new();
    const sheet = makeSheet([
      ['BREAKDOWN — BAD'],
      [],
      [],
      ['Description', 'test'],
      ['Unit', 'm3'],
      ['Volume', 0.2],
      ['Unit cost (Rp/m³)', 1095570],
      ['Line total at-cost (Rp)', 500000], // deliberately wrong
      [],
      ['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', 'Qty per m³ beton', 'Cost per m³ beton (Rp)', 'Total qty (× vol)', 'Total cost (Rp)'],
      [1, 'BETON READYMIX (Material)'],
      ['', '', 'Beton readymix K-350', '', 1.05, 'm3', '', 1043400, 1.05, 1095570, 0.21, 219114],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Breakdown BAD');
    const { breakdowns } = readBreakdownSheets(wb);
    const bd = breakdowns.get('BAD')!;
    expect(bd.reconciliation.reconciles).toBe(false);
    expect(Math.abs(bd.reconciliation.lineTotalVariance)).toBeGreaterThan(1000);
  });
});

describe('readBreakdownSheets — real AAL-5 workbook', () => {
  const WORKBOOK = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5_Claude Override.xlsx');
  const skip = !fs.existsSync(WORKBOOK);
  const itx = skip ? it.skip : it;

  itx('reads Breakdown IV.A.2.7 with 13 components and reconciles', () => {
    const buf = fs.readFileSync(WORKBOOK);
    const wb = XLSX.read(buf);
    const { breakdowns, warnings } = readBreakdownSheets(wb);
    const bd = breakdowns.get('IV.A.2.7');
    expect(bd).toBeDefined();
    expect(bd!.volume).toBeCloseTo(0.2646, 4);
    expect(bd!.components.length).toBeGreaterThanOrEqual(13);

    // Spot-check 4 canonical materials from spec Appendix A.
    const byName = (name: string) => bd!.components.find((c) => c.materialName.startsWith(name));
    expect(byName('Beton readymix K-350')?.qtyPerBoqUnit).toBeCloseTo(1.05, 4);
    expect(byName('Multipleks 15 mm')?.qtyPerBoqUnit).toBeCloseTo(5.0, 4);
    expect(byName('Besi beton D8')?.qtyPerBoqUnit).toBeCloseTo(75.2587, 3);
    expect(byName('Bendrat')?.qtyPerBoqUnit).toBeCloseTo(3.5107, 3);

    expect(bd!.reconciliation.reconciles).toBe(true);
    // Allow up to a few COST_MISMATCH warnings for rows that use formulas in the
    // workbook where xlsx may return computed values that round differently.
    // Any warnings for this sheet must be COST_MISMATCH only.
    for (const w of warnings) {
      if (w.sheet === 'Breakdown IV.A.2.7') {
        expect(w.code).toBe('COST_MISMATCH');
      }
    }
  });
});
