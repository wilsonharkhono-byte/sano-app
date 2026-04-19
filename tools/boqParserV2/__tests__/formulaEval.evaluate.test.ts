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
