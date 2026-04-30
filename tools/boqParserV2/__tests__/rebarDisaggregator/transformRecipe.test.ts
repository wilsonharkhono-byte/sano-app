import { transformRecipe } from '../../rebarDisaggregator/transformRecipe';
import type { BoqRowRecipe, RecipeComponent } from '../../types';
import type { RebarBreakdown } from '../../rebarDisaggregator/types';

function mkComponent(over: Partial<RecipeComponent> = {}): RecipeComponent {
  return {
    sourceCell: { sheet: 'RAB (A)', address: 'X1' },
    referencedCell: { sheet: 'Analisa', address: 'F1' },
    referencedBlockTitle: null,
    referencedBlockRow: null,
    quantityPerUnit: 1,
    unitPrice: 1000,
    costContribution: 1000,
    lineType: 'material',
    confidence: 1,
    ...over,
  };
}

describe('transformRecipe', () => {
  it('replaces the besi component with N diameter-specific components', () => {
    const recipe: BoqRowRecipe = {
      perUnit: { material: 3764123, labor: 1100000, equipment: 90000, prelim: 0 },
      subkonPerUnit: 0,
      components: [
        mkComponent({
          referencedBlockTitle: 'Pengecoran Beton Readymix',
          quantityPerUnit: 1,
          unitPrice: 1398600,
          costContribution: 1398600,
          lineType: 'material',
        }),
        mkComponent({
          referencedBlockTitle: 'Pembesian U24 & U40',
          referencedCell: { sheet: 'Analisa', address: 'F233' },
          quantityPerUnit: 143.10,
          unitPrice: 10442.50,
          costContribution: 1494326,
          lineType: 'material',
        }),
        mkComponent({
          referencedBlockTitle: 'Pengecoran Beton Readymix',
          quantityPerUnit: 1,
          unitPrice: 1100000,
          costContribution: 1100000,
          lineType: 'labor',
        }),
      ],
      markup: { factor: 1.15, sourceCell: { sheet: 'REKAP RAB', address: 'O5' }, sourceLabel: null },
      totalCached: 58187066,
    };

    const breakdown: RebarBreakdown[] = [
      { diameter: 'D8', weightKg: 404.365, sourceCell: 'REKAP Balok!M267' },
      { diameter: 'D13', weightKg: 1057.148, sourceCell: 'REKAP Balok!O267' },
    ];

    const result = transformRecipe(recipe, breakdown, /* boqVolume */ 10.2132);

    // Beton (1) + 2 Besi (D8, D13) + Upah (1) = 4 components total
    expect(result.recipe.components).toHaveLength(4);

    const beton = result.recipe.components.find((c) => c.referencedBlockTitle === 'Pengecoran Beton Readymix' && c.lineType === 'material');
    expect(beton).toBeDefined();
    expect(beton!.materialName).toBeUndefined();

    const upah = result.recipe.components.find((c) => c.lineType === 'labor');
    expect(upah).toBeDefined();
    expect(upah!.materialName).toBeUndefined();

    const d8 = result.recipe.components.find((c) => c.materialName === 'Besi D8');
    expect(d8).toBeDefined();
    expect(d8!.lineType).toBe('material');
    expect(d8!.disaggregatedFrom).toBe('Pembesian U24 & U40');
    expect(d8!.unitPrice).toBe(10442.50);
    expect(d8!.quantityPerUnit).toBeCloseTo(404.365 / 10.2132, 4);
    expect(d8!.sourceCell).toEqual({ sheet: 'REKAP Balok', address: 'M267' });
    expect(d8!.referencedCell).toEqual({ sheet: 'REKAP Balok', address: 'M267' });
    expect(d8!.confidence).toBe(1);

    const d13 = result.recipe.components.find((c) => c.materialName === 'Besi D13');
    expect(d13).toBeDefined();
    expect(d13!.unitPrice).toBe(10442.50);

    // Conservation: sum of disaggregated contributions ≈ original aggregate
    const disaggSum = (d8!.costContribution + d13!.costContribution);
    expect(disaggSum).toBeCloseTo(1494326, 0);

    expect(result.warning).toBeNull();
  });

  it('emits a warning when conservation breaks (>0.1% drift)', () => {
    const recipe: BoqRowRecipe = {
      perUnit: { material: 1494326, labor: 0, equipment: 0, prelim: 0 },
      subkonPerUnit: 0,
      components: [
        mkComponent({
          referencedBlockTitle: 'Pembesian U24 & U40',
          quantityPerUnit: 143.10,
          unitPrice: 10442.50,
          costContribution: 1494326,
          lineType: 'material',
        }),
      ],
      markup: null,
      totalCached: 1494326,
    };

    // Breakdown only sums to 100 + 200 = 300 kg, but aggregate says 143.10 × 10.2132 = 1461.5 kg
    const breakdown: RebarBreakdown[] = [
      { diameter: 'D8', weightKg: 100, sourceCell: 'REKAP Balok!M267' },
      { diameter: 'D13', weightKg: 200, sourceCell: 'REKAP Balok!O267' },
    ];

    const result = transformRecipe(recipe, breakdown, 10.2132);
    expect(result.warning).not.toBeNull();
    expect(result.warning!.kind).toBe('conservation_violation');
    expect(result.recipe.components).toHaveLength(2);
  });

  it('returns recipe unchanged when no Pembesian component exists', () => {
    const recipe: BoqRowRecipe = {
      perUnit: { material: 1000, labor: 0, equipment: 0, prelim: 0 },
      subkonPerUnit: 0,
      components: [
        mkComponent({ referencedBlockTitle: 'Pengecoran Beton Readymix' }),
      ],
      markup: null,
      totalCached: 1000,
    };

    const breakdown: RebarBreakdown[] = [
      { diameter: 'D8', weightKg: 100, sourceCell: 'REKAP Balok!M267' },
    ];

    const result = transformRecipe(recipe, breakdown, 1);
    expect(result.recipe).toBe(recipe);
    expect(result.warning).toBeNull();
  });

  it('preserves Kolom role metadata when present in breakdown', () => {
    const recipe: BoqRowRecipe = {
      perUnit: { material: 1000, labor: 0, equipment: 0, prelim: 0 },
      subkonPerUnit: 0,
      components: [
        mkComponent({
          referencedBlockTitle: 'Pembesian U24 & U40',
          quantityPerUnit: 100,
          unitPrice: 10,
          costContribution: 1000,
          lineType: 'material',
        }),
      ],
      markup: null,
      totalCached: 1000,
    };

    const breakdown: RebarBreakdown[] = [
      { diameter: 'D10', weightKg: 100, sourceCell: 'Hasil-Kolom!I152+L152', role: undefined },
    ];

    const result = transformRecipe(recipe, breakdown, 1);
    expect(result.recipe.components[0].materialName).toBe('Besi D10');
    expect(result.recipe.components[0].role).toBeUndefined();
  });
});
