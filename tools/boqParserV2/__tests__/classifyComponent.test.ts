import { parseFormulaRef, isCatalogSheet, classifyComponent } from '../classifyComponent';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';
import type { HarvestedCell, HarvestLookup } from '../types';

function mockCell(
  sheet: string,
  address: string,
  value: unknown,
  formula: string | null = null,
): HarvestedCell {
  return { sheet, address, row: 0, col: 0, value, formula };
}

function buildLookup(cells: HarvestedCell[]): HarvestLookup {
  return new Map(cells.map(c => [`${c.sheet}!${c.address}`, c]));
}

describe('parseFormulaRef', () => {
  it('returns null for a literal (no formula)', () => {
    expect(parseFormulaRef(null, 'Analisa')).toEqual({ kind: 'literal' });
  });

  it('recognizes cross-sheet absolute reference', () => {
    expect(parseFormulaRef('=Material!$F$12', 'Analisa')).toEqual({
      kind: 'cross_sheet_abs',
      sheet: 'Material',
      address: 'F12',
    });
  });

  it('recognizes quoted cross-sheet reference', () => {
    expect(parseFormulaRef("='REKAP Balok'!$K$526", 'RAB (A)')).toEqual({
      kind: 'cross_sheet_abs',
      sheet: 'REKAP Balok',
      address: 'K526',
    });
  });

  it('recognizes intra-sheet absolute reference', () => {
    expect(parseFormulaRef('=$I$199', 'Analisa')).toEqual({
      kind: 'intra_sheet_abs',
      sheet: 'Analisa',
      address: 'I199',
    });
  });

  it('recognizes SUMIFS aggregation', () => {
    const r = parseFormulaRef("=SUMIFS('Besi Balok'!$AA$23:$AA$9622, ...)", 'REKAP Balok');
    expect(r.kind).toBe('aggregation');
  });

  it('recognizes SUM aggregation', () => {
    expect(parseFormulaRef('=SUM(F142:F149)', 'Analisa').kind).toBe('aggregation');
  });

  it('recognizes cross-cell multiply (rebar pattern)', () => {
    const r = parseFormulaRef('=$F$240*B155', 'Analisa');
    expect(r.kind).toBe('cross_multiply');
  });

  it('recognizes simple B*E multiply as default path', () => {
    expect(parseFormulaRef('=B155*E155', 'Analisa').kind).toBe('simple_multiply');
  });

  it('falls back to unknown for unrecognized formulas', () => {
    expect(parseFormulaRef('=IF(A1>0,B1,C1)', 'Analisa').kind).toBe('unknown');
  });

  it('parses harvested cross-sheet formulas end-to-end', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Analisa',
        cells: [
          { address: 'F199', value: 100, formula: "'Harga Bahan'!$D$42", result: 100 },
        ],
      },
    ]);
    const { lookup } = await harvestWorkbook(wb);
    const cell = lookup.get('Analisa!F199');
    const ref = parseFormulaRef(cell?.formula ?? null, 'Analisa');
    expect(ref.kind).toBe('cross_sheet_abs');
  });
});

describe('isCatalogSheet', () => {
  it('treats Material and Upah as catalog', () => {
    expect(isCatalogSheet('Material')).toBe(true);
    expect(isCatalogSheet('Upah')).toBe(true);
  });
  it('rejects REKAP-style sheets', () => {
    expect(isCatalogSheet('REKAP Balok')).toBe(false);
    expect(isCatalogSheet('Data-Kolom')).toBe(false);
    expect(isCatalogSheet('Hasil-PC')).toBe(false);
    expect(isCatalogSheet('Besi Balok')).toBe(false);
  });
  it('defaults unknown sheets to catalog=true (conservative)', () => {
    expect(isCatalogSheet('Pipa')).toBe(true);
  });
});

describe('classifyComponent', () => {
  it('classifies catalog-based component', () => {
    const eCell = mockCell('Analisa', 'E143', 1500000, '=Material!$F$12');
    const fCell = mockCell('Analisa', 'F143', 75000);
    const srcCell = mockCell('Material', 'F12', 1500000);
    const lookup = buildLookup([eCell, fCell, srcCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('catalog');
    expect(result.ref_cells?.unit_price?.sheet).toBe('Material');
  });

  it('classifies literal component', () => {
    const eCell = mockCell('Analisa', 'E52', 150000);
    const fCell = mockCell('Analisa', 'F52', 150000);
    const lookup = buildLookup([eCell, fCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('literal');
  });

  it('classifies nested_ahs component', () => {
    const eCell = mockCell('Analisa', 'E175', 886530, '=$I$140');
    const fCell = mockCell('Analisa', 'F175', 250000);
    const jumlahCell = mockCell('Analisa', 'I140', 886530);
    const lookup = buildLookup([eCell, fCell, jumlahCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('nested_ahs');
    expect(result.ref_cells?.unit_price?.cell).toBe('I140');
  });

  it('classifies cross_ref (rebar split) and populates cost_split from F/G/H', () => {
    const eCell = mockCell('Analisa', 'E155', 11218, '=$I$132+1300');
    const fCell = mockCell('Analisa', 'F155', 1662746, '=$F$240*B155');
    const gCell = mockCell('Analisa', 'G155', 0);
    const hCell = mockCell('Analisa', 'H155', 73744, '=1300*B155');
    const lookup = buildLookup([eCell, fCell, gCell, hCell]);
    const result = classifyComponent(eCell, fCell, gCell, hCell, lookup);
    expect(result.cost_basis).toBe('cross_ref');
    expect(result.cost_split).toEqual({
      material: 1662746,
      labor: 0,
      equipment: 73744,
    });
  });

  it('parses Indonesian-formatted string values in cost_split (commas as decimal)', () => {
    const eCell = mockCell('Analisa', 'E155', 11218, '=$I$132+1300');
    const fCell = mockCell('Analisa', 'F155', '1.662.746', '=$F$240*B155');
    const gCell = mockCell('Analisa', 'G155', 0);
    const hCell = mockCell('Analisa', 'H155', '73.744', '=1300*B155');
    const lookup = buildLookup([eCell, fCell, gCell, hCell]);
    const result = classifyComponent(eCell, fCell, gCell, hCell, lookup);
    expect(result.cost_basis).toBe('cross_ref');
    expect(result.cost_split).toEqual({
      material: 1662746,
      labor: 0,
      equipment: 73744,
    });
  });

  it('classifies takeoff_ref component (cross-sheet abs into REKAP-style sheet)', () => {
    const eCell = mockCell('RAB (A)', 'E150', 45000, "='REKAP Balok'!$K$526");
    const fCell = mockCell('RAB (A)', 'F150', 45000);
    const srcCell = mockCell('REKAP Balok', 'K526', 45000);
    const lookup = buildLookup([eCell, fCell, srcCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('takeoff_ref');
    expect(result.ref_cells?.unit_price?.sheet).toBe('REKAP Balok');
    expect(result.ref_cells?.unit_price?.cell).toBe('K526');
  });
});
