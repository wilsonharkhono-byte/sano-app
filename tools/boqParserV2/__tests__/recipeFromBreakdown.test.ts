import { buildRecipeFromBreakdown } from '../recipeFromBreakdown';
import type { RowBreakdown } from '../breakdownSheetReader.types';
import type { BoqRowV2 } from '../extractTakeoffs';

const SAMPLE_ROW: BoqRowV2 = {
  code: 'IV.A.2.7',
  label: '- Balok B24-1',
  unit: 'm3',
  planned: 0.2646,
  sourceRow: 132,
  source_sheet: 'RAB (A)',
  cost_basis: 'inline_split',
  ref_cells: null,
  cost_split: { material: 5264679, labor: 1500000, equipment: 75000, prelim: 0 },
  subkon_cost_per_unit: 0,
  total_cost: 2171735,
  chapter: 'Pekerjaan Beton',
  chapter_index: 'IV',
  sub_chapter: 'Balok',
  sub_chapter_letter: 'A',
  is_sub_item: true,
  recipe: null,
};

const SAMPLE_BREAKDOWN: RowBreakdown = {
  boqCode: 'IV.A.2.7',
  description: '- Balok B24-1',
  unit: 'm3',
  volume: 0.2646,
  unitCost: 6839679,
  lineTotal: 1809779,
  components: [
    {
      group: 'material', componentGroup: 'BETON READYMIX (Material)',
      materialName: 'Beton readymix K-350', specNote: 'slump 18 ± 2 cm',
      qtyPerNativeUnit: 1.05, nativeUnit: 'm3', nativeBasis: 'per m3 beton',
      unitPrice: 1043400, qtyPerBoqUnit: 1.05, costPerBoqUnit: 1095570,
      totalQty: 0.2778, totalCost: 289888,
    },
    {
      group: 'labor', componentGroup: 'UPAH (Labor)',
      materialName: 'Upah cor + besi + bekisting (borongan)', specNote: 'all-in',
      qtyPerNativeUnit: 1.0, nativeUnit: 'm3', nativeBasis: null,
      unitPrice: 1500000, qtyPerBoqUnit: 1.0, costPerBoqUnit: 1500000,
      totalQty: 0.2646, totalCost: 396900,
    },
  ],
  reconciliation: {
    computedUnitCost: 2595570, sourceUnitCost: 6839679, unitCostVariance: -4244109,
    computedLineTotal: 686828, sourceLineTotal: 1809779, lineTotalVariance: -1122951,
    reconciles: false,
  },
  sourceSheet: 'Breakdown IV.A.2.7',
};

describe('buildRecipeFromBreakdown', () => {
  it('produces one RecipeComponent per BreakdownRow with matching qty/price', () => {
    const recipe = buildRecipeFromBreakdown(SAMPLE_ROW, SAMPLE_BREAKDOWN);
    expect(recipe.components).toHaveLength(2);

    expect(recipe.components[0]).toMatchObject({
      materialName: 'Beton readymix K-350',
      quantityPerUnit: 1.05,
      unitPrice: 1043400,
      costContribution: 1095570,
      lineType: 'material',
      confidence: 1,
      sourceCell: { sheet: 'Breakdown IV.A.2.7', address: 'C12' },
    });

    expect(recipe.components[1]).toMatchObject({
      materialName: 'Upah cor + besi + bekisting (borongan)',
      lineType: 'labor',
    });
  });

  it('preserves the BoQ row cost_split as recipe.perUnit', () => {
    const recipe = buildRecipeFromBreakdown(SAMPLE_ROW, SAMPLE_BREAKDOWN);
    expect(recipe.perUnit).toEqual(SAMPLE_ROW.cost_split);
    expect(recipe.subkonPerUnit).toBe(0);
    expect(recipe.totalCached).toBe(SAMPLE_ROW.total_cost);
  });
});
