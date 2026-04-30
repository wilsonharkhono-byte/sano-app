import type { BoqRowRecipe, RecipeComponent } from '../types';
import type { RebarBreakdown } from './types';

export interface TransformWarning {
  kind: 'conservation_violation';
  message: string;
  expectedKg: number;
  actualKg: number;
}

export interface TransformResult {
  recipe: BoqRowRecipe;
  warning: TransformWarning | null;
}

function isPembesianComponent(c: RecipeComponent): boolean {
  if (c.referencedBlockTitle && /^Pembesian/i.test(c.referencedBlockTitle)) return true;
  return false;
}

function parseSourceCellAddress(s: string): { sheet: string; address: string } {
  // Handles plain "REKAP Balok!M267" and Kolom-combined "Hasil-Kolom!I152+L152".
  // Strip any "+col row" suffix when emitting referencedCell — keep the first.
  const idx = s.indexOf('!');
  const sheet = s.slice(0, idx);
  const tail = s.slice(idx + 1);
  const firstAddr = tail.split('+')[0];
  return { sheet, address: firstAddr };
}

export function transformRecipe(
  recipe: BoqRowRecipe,
  breakdown: RebarBreakdown[],
  boqVolume: number,
): TransformResult {
  const pembesianIdx = recipe.components.findIndex(isPembesianComponent);
  if (pembesianIdx === -1) {
    return { recipe, warning: null };
  }
  const original = recipe.components[pembesianIdx];

  // Conservation: aggregate kg = quantityPerUnit (kg/m³) × boqVolume.
  const aggregateKg = original.quantityPerUnit * boqVolume;
  const disaggregatedKg = breakdown.reduce((s, b) => s + b.weightKg, 0);
  const tolerance = Math.max(1, aggregateKg * 0.001);
  const delta = aggregateKg - disaggregatedKg;
  const warning: TransformWarning | null =
    Math.abs(delta) > tolerance && breakdown.length > 0
      ? {
          kind: 'conservation_violation',
          message: `Aggregate ${aggregateKg.toFixed(3)} kg vs disaggregated ${disaggregatedKg.toFixed(3)} kg (delta ${delta.toFixed(3)} kg)`,
          expectedKg: aggregateKg,
          actualKg: disaggregatedKg,
        }
      : null;

  // Distribute original.costContribution proportionally by weight so that
  // the sum of new components always equals the original aggregate cost.
  // This preserves reconciliation in the smoke tests — REKAP weights are
  // used only to set the proportions, not to recompute costs from scratch.
  const totalKg = breakdown.reduce((s, b) => s + b.weightKg, 0);
  const newComponents: RecipeComponent[] = breakdown.map((b) => {
    const refCell = parseSourceCellAddress(b.sourceCell);
    const quantityPerUnit = boqVolume > 0 ? b.weightKg / boqVolume : 0;
    const fraction = totalKg > 0 ? b.weightKg / totalKg : breakdown.length > 0 ? 1 / breakdown.length : 0;
    return {
      sourceCell: refCell,
      referencedCell: refCell,
      referencedBlockTitle: original.referencedBlockTitle,
      referencedBlockRow: original.referencedBlockRow,
      quantityPerUnit,
      unitPrice: original.unitPrice,
      costContribution: fraction * original.costContribution,
      lineType: 'material',
      confidence: 1,
      materialName: `Besi ${b.diameter}`,
      disaggregatedFrom: original.referencedBlockTitle ?? undefined,
      role: b.role,
    };
  });

  const components = [
    ...recipe.components.slice(0, pembesianIdx),
    ...newComponents,
    ...recipe.components.slice(pembesianIdx + 1),
  ];

  return {
    recipe: { ...recipe, components },
    warning,
  };
}
