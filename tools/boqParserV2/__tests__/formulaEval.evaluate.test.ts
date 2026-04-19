import { evaluateFormula } from '../formulaEval';
import type { HarvestLookup, HarvestedCell } from '../types';

function mkLookup(cells: HarvestedCell[]): HarvestLookup {
  const m = new Map<string, HarvestedCell>();
  for (const c of cells) m.set(`${c.sheet}!${c.address}`, c);
  return m;
}

describe('evaluateFormula — direct refs', () => {
  it('emits a component for a bare cross-sheet ref', () => {
    const lookup = mkLookup([
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 1232100, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 1232100, formula: '=Analisa!$F$82' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.components).toEqual([
      {
        sourceCell: { sheet: 'RAB (A)', address: 'R59' },
        referencedCell: { sheet: 'Analisa', address: 'F82' },
        coefficient: 1,
        unitPrice: 1232100,
        costContribution: 1232100,
        confidence: 1,
      },
    ]);
    expect(result.markup).toBeNull();
    expect(result.evaluatedValue).toBe(1232100);
  });

  it('returns no components when formula has no target-sheet refs', () => {
    const lookup = mkLookup([]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'X1', row: 1, col: 24, value: 5, formula: '=2+3' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.components).toEqual([]);
    expect(result.evaluatedValue).toBe(5);
  });
});

describe('evaluateFormula — composite AF pattern', () => {
  it('resolves I=AF, AF=R+V*W+Z*AA into three components', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'AF59', row: 59, col: 32, value: 2428231.4090444, formula: '=R59+V59*W59+Z59*AA59' },
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 1232100, formula: '=Analisa!$F$82' },
      { sheet: 'RAB (A)', address: 'V59', row: 59, col: 22, value: 2.1333, formula: "='REKAP-PC'!T16" },
      { sheet: 'RAB (A)', address: 'W59', row: 59, col: 23, value: 166705.668, formula: '=Analisa!$F$35' },
      { sheet: 'RAB (A)', address: 'Z59', row: 59, col: 26, value: 84.749, formula: "='REKAP-PC'!U16" },
      { sheet: 'RAB (A)', address: 'AA59', row: 59, col: 27, value: 9917.5, formula: '=Analisa!$F$132' },
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 1232100, formula: null },
      { sheet: 'Analisa', address: 'F35', row: 35, col: 6, value: 166705.668, formula: null },
      { sheet: 'Analisa', address: 'F132', row: 132, col: 6, value: 9917.5, formula: null },
      { sheet: 'REKAP-PC', address: 'T16', row: 16, col: 20, value: 2.1333, formula: null },
      { sheet: 'REKAP-PC', address: 'U16', row: 16, col: 21, value: 84.749, formula: null },
    ]);

    const i59: HarvestedCell = { sheet: 'RAB (A)', address: 'I59', row: 59, col: 9, value: 2428231.4090444, formula: '=AF59' };
    const result = evaluateFormula(i59, lookup, { targetSheet: 'Analisa' });

    expect(result.components).toHaveLength(3);
    const byRef = Object.fromEntries(result.components.map(c => [c.referencedCell.address, c]));
    expect(byRef['F82'].coefficient).toBeCloseTo(1.0, 4);
    expect(byRef['F82'].costContribution).toBeCloseTo(1232100, 2);
    expect(byRef['F35'].coefficient).toBeCloseTo(2.1333, 4);
    expect(byRef['F35'].costContribution).toBeCloseTo(2.1333 * 166705.668, 2);
    expect(byRef['F132'].coefficient).toBeCloseTo(84.749, 4);
    expect(byRef['F132'].costContribution).toBeCloseTo(84.749 * 9917.5, 2);

    const total = result.components.reduce((s, c) => s + c.costContribution, 0);
    expect(Math.abs(total - 2428231.4090444)).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe('evaluateFormula — markup', () => {
  it('peels off *REKAP_RAB!$O$4 as markup, leaves components pre-markup', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 3303241, formula: null },
      { sheet: 'REKAP RAB', address: 'O4', row: 4, col: 15, value: 1.2, formula: null },
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 3303241, formula: null },
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 3303241, formula: '=Analisa!$F$82' },
    ]);
    lookup.set('RAB (A)!N59', { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 3303241, formula: '=R59' });

    const e59: HarvestedCell = {
      sheet: 'RAB (A)', address: 'E59', row: 59, col: 5, value: 3963889,
      formula: "=N59*'REKAP RAB'!$O$4",
    };
    const result = evaluateFormula(e59, lookup, { targetSheet: 'Analisa' });

    expect(result.markup).toEqual({
      factor: 1.2,
      sourceCell: { sheet: 'REKAP RAB', address: 'O4' },
    });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].costContribution).toBeCloseTo(3303241, 0);
  });
});
