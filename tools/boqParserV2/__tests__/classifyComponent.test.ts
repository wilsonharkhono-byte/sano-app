import { parseFormulaRef, isCatalogSheet } from '../classifyComponent';

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
