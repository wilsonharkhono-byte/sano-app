import { buildRecipe } from '../recipeBuilder';
import type { HarvestedCell, HarvestLookup, CostSplit } from '../types';
import type { AhsBlock } from '../detectBlocks';

function mkLookup(cells: HarvestedCell[]): HarvestLookup {
  const m = new Map<string, HarvestedCell>();
  for (const c of cells) m.set(`${c.sheet}!${c.address}`, c);
  return m;
}

describe('buildRecipe', () => {
  const baseLookup = mkLookup([
    { sheet: 'RAB (A)', address: 'I59', row: 59, col: 9, value: 2428240.77, formula: '=Analisa!$F$82' },
    { sheet: 'RAB (A)', address: 'J59', row: 59, col: 10, value: 800000, formula: '=Analisa!$G$82' },
    { sheet: 'RAB (A)', address: 'K59', row: 59, col: 11, value: 75000, formula: '=Analisa!$H$82' },
    { sheet: 'RAB (A)', address: 'E59', row: 59, col: 5, value: 2913889, formula: "=N59*'REKAP RAB'!$O$4" },
    { sheet: 'RAB (A)', address: 'F59', row: 59, col: 6, value: 5122541, formula: '=D59*E59' },
    { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 2428240.77, formula: '=SUM(I59:M59)' },
    { sheet: 'REKAP RAB', address: 'O4', row: 4, col: 15, value: 1.2, formula: null },
    { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 2428240.77, formula: null },
    { sheet: 'Analisa', address: 'G82', row: 82, col: 7, value: 800000, formula: null },
    { sheet: 'Analisa', address: 'H82', row: 82, col: 8, value: 75000, formula: null },
  ]);

  const blocks: AhsBlock[] = [
    {
      title: 'Pengecoran Beton Readymix (KHUSUS POER)',
      titleRow: 77,
      jumlahRow: 89,
      jumlahCachedValue: 2428240.77,
      grandTotalAddress: 'I89',
      components: [],
      componentRows: [],
      componentSubtotals: [],
    },
  ];

  const costSplit: CostSplit = { material: 2428240.77, labor: 800000, equipment: 75000, prelim: 0 };

  it('assembles recipe with three line types and a markup', () => {
    const recipe = buildRecipe({
      sourceRow: 59,
      sourceSheet: 'RAB (A)',
      costSplit,
      subkonPerUnit: 0,
      splitColumns: { material: 'I', labor: 'J', equipment: 'K', subkon: null, prelim: null },
      markupCell: 'E',
      totalCell: 'F',
      lookup: baseLookup,
      blocks,
      analisaSheet: 'Analisa',
    });

    expect(recipe.perUnit).toEqual(costSplit);
    expect(recipe.subkonPerUnit).toBe(0);
    expect(recipe.markup).toEqual({
      factor: 1.2,
      sourceCell: { sheet: 'REKAP RAB', address: 'O4' },
      sourceLabel: null,
    });
    expect(recipe.components.length).toBeGreaterThanOrEqual(3);
    const byType = recipe.components.reduce<Record<string, number>>((acc, c) => {
      acc[c.lineType] = (acc[c.lineType] ?? 0) + c.costContribution;
      return acc;
    }, {});
    expect(byType.material).toBeCloseTo(2428240.77, 0);
    expect(byType.labor).toBeCloseTo(800000, 0);
    expect(byType.equipment).toBeCloseTo(75000, 0);
    expect(recipe.components[0].referencedBlockTitle).toBe('Pengecoran Beton Readymix (KHUSUS POER)');
  });
});
