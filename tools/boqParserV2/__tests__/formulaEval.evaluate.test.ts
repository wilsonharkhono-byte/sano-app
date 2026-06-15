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

  it('does NOT peel a REKAP-PC reference as markup', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 100, formula: null },
      { sheet: 'REKAP-PC', address: 'B8', row: 8, col: 2, value: 1.5, formula: null },
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 100, formula: null },
    ]);
    const e59: HarvestedCell = {
      sheet: 'RAB (A)', address: 'E59', row: 59, col: 5, value: 150,
      formula: "=N59*'REKAP-PC'!B8",
    };
    const result = evaluateFormula(e59, lookup, { targetSheet: 'Analisa' });
    expect(result.markup).toBeNull();
  });
});

describe('evaluateFormula — unknown functions (I4)', () => {
  it('surfaces unknown function names in result', () => {
    const lookup = mkLookup([]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'X1', row: 1, col: 24, value: 0, formula: '=IFERROR(A1,0)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.unknownFunctions).toContain('IFERROR');
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it('returns NaN (unresolved sentinel) when an unknown fn has no usable cached value', () => {
    const lookup = mkLookup([]);
    const result = evaluateFormula(
      // string cached value is not a usable computed number → must not coerce to 0
      { sheet: 'RAB (A)', address: 'X1', row: 1, col: 24, value: '#N/A', formula: '=VLOOKUP(A1,B2:C9,2,0)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.unknownFunctions).toContain('VLOOKUP');
    expect(Number.isNaN(result.evaluatedValue)).toBe(true);
  });

  it('prefers a genuine cached numeric value over an unresolved unknown fn', () => {
    const lookup = mkLookup([]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'X1', row: 1, col: 24, value: 42, formula: '=VLOOKUP(A1,B2:C9,2,0)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.unknownFunctions).toContain('VLOOKUP');
    expect(result.evaluatedValue).toBe(42);
  });
});

describe('evaluateFormula — SUM over ranges', () => {
  it('sums a vertical range of cached values', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'S6', row: 6, col: 19, value: 10, formula: null },
      { sheet: 'RAB (A)', address: 'S7', row: 7, col: 19, value: 20, formula: null },
      { sheet: 'RAB (A)', address: 'S8', row: 8, col: 19, value: 30, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'S10', row: 10, col: 19, value: 0, formula: '=SUM(S6:S8)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(60);
  });

  it('sums mixed range + scalar args', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'A1', row: 1, col: 1, value: 5, formula: null },
      { sheet: 'RAB (A)', address: 'A2', row: 2, col: 1, value: 7, formula: null },
      { sheet: 'RAB (A)', address: 'B1', row: 1, col: 2, value: 100, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C1', row: 1, col: 3, value: 0, formula: '=SUM(A1:A2,B1)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(112);
  });
});

describe('evaluateFormula — SUMIF', () => {
  function fixture() {
    // B column = labels, S column = values to sum
    return mkLookup([
      { sheet: 'RAB (A)', address: 'B6', row: 6, col: 2, value: 'Besi', formula: null },
      { sheet: 'RAB (A)', address: 'B7', row: 7, col: 2, value: 'Beton', formula: null },
      { sheet: 'RAB (A)', address: 'B8', row: 8, col: 2, value: 'Besi', formula: null },
      { sheet: 'RAB (A)', address: 'S6', row: 6, col: 19, value: 100, formula: null },
      { sheet: 'RAB (A)', address: 'S7', row: 7, col: 19, value: 200, formula: null },
      { sheet: 'RAB (A)', address: 'S8', row: 8, col: 19, value: 300, formula: null },
      { sheet: 'RAB (A)', address: 'B20', row: 20, col: 2, value: 'Besi', formula: null }, // the criteria cell
    ]);
  }

  it('sums sum_range where range matches a cell-ref criteria (default plain equality)', () => {
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C20', row: 20, col: 3, value: 0, formula: '=SUMIF($B$6:$B$8,B20,$S$6:$S$8)' },
      fixture(),
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(400); // 100 + 300
  });

  it('case-insensitive text match', () => {
    const lookup = fixture();
    lookup.set('RAB (A)!B20', { sheet: 'RAB (A)', address: 'B20', row: 20, col: 2, value: 'BESI', formula: null });
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C20', row: 20, col: 3, value: 0, formula: '=SUMIF($B$6:$B$8,B20,$S$6:$S$8)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(400);
  });

  it('defaults sum_range to range when omitted', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'S6', row: 6, col: 19, value: 5, formula: null },
      { sheet: 'RAB (A)', address: 'S7', row: 7, col: 19, value: 3, formula: null },
      { sheet: 'RAB (A)', address: 'S8', row: 8, col: 19, value: 9, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C1', row: 1, col: 3, value: 0, formula: '=SUMIF(S6:S8,">=5")' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(14); // 5 + 9
  });

  it('supports operator criteria as a quoted string (<>)', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'S6', row: 6, col: 19, value: 0, formula: null },
      { sheet: 'RAB (A)', address: 'S7', row: 7, col: 19, value: 4, formula: null },
      { sheet: 'RAB (A)', address: 'S8', row: 8, col: 19, value: 6, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C1', row: 1, col: 3, value: 0, formula: '=SUMIF(S6:S8,"<>0",S6:S8)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(10); // 4 + 6
  });
});

describe('evaluateFormula — SUMIFS', () => {
  it('sums where ALL criteria match (two criteria pairs)', () => {
    // U = values; B = group label; F = type label
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'U6', row: 6, col: 21, value: 100, formula: null },
      { sheet: 'RAB (A)', address: 'U7', row: 7, col: 21, value: 200, formula: null },
      { sheet: 'RAB (A)', address: 'U8', row: 8, col: 21, value: 400, formula: null },
      { sheet: 'RAB (A)', address: 'B6', row: 6, col: 2, value: 'P1', formula: null },
      { sheet: 'RAB (A)', address: 'B7', row: 7, col: 2, value: 'P1', formula: null },
      { sheet: 'RAB (A)', address: 'B8', row: 8, col: 2, value: 'P2', formula: null },
      { sheet: 'RAB (A)', address: 'F6', row: 6, col: 6, value: 'D8', formula: null },
      { sheet: 'RAB (A)', address: 'F7', row: 7, col: 6, value: 'D10', formula: null },
      { sheet: 'RAB (A)', address: 'F8', row: 8, col: 6, value: 'D8', formula: null },
      { sheet: 'RAB (A)', address: 'B20', row: 20, col: 2, value: 'P1', formula: null },
      { sheet: 'RAB (A)', address: 'E19', row: 19, col: 5, value: 'D8', formula: null },
    ]);
    const result = evaluateFormula(
      {
        sheet: 'RAB (A)', address: 'C20', row: 20, col: 3, value: 0,
        formula: '=SUMIFS($U$6:$U$8,$B$6:$B$8,B20,$F$6:$F$8,$E$19)',
      },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(100); // only row 6 matches P1 AND D8
  });

  it('returns 0 when no rows satisfy all criteria', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'U6', row: 6, col: 21, value: 100, formula: null },
      { sheet: 'RAB (A)', address: 'B6', row: 6, col: 2, value: 'P1', formula: null },
      { sheet: 'RAB (A)', address: 'B20', row: 20, col: 2, value: 'P9', formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'C20', row: 20, col: 3, value: 0, formula: '=SUMIFS($U$6:$U$6,$B$6:$B$6,B20)' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(0);
  });

  it('does not zero a quantity that has a non-zero cached value (regression guard)', () => {
    // Even with empty lookup, a cell carrying a SUMIFS formula but a valid
    // cached numeric value must keep that value, not collapse to 0.
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'D199', row: 199, col: 4, value: 12.5, formula: '=SUMIFS(X6:X9,Y6:Y9,Z199)' },
      mkLookup([]),
      { targetSheet: 'Analisa' },
    );
    expect(result.evaluatedValue).toBe(12.5);
  });
});
