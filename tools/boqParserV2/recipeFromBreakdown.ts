import type { BoqRowV2 } from './extractTakeoffs';
import type { BoqRowRecipe, RecipeComponent } from './types';
import type { RowBreakdown, BreakdownGroup } from './breakdownSheetReader.types';

function lineTypeFromGroup(g: BreakdownGroup): RecipeComponent['lineType'] {
  if (g === 'labor') return 'labor';
  if (g === 'equipment') return 'equipment';
  return 'material';
}

export function buildRecipeFromBreakdown(row: BoqRowV2, breakdown: RowBreakdown): BoqRowRecipe {
  const components: RecipeComponent[] = breakdown.components.map((c, idx) => {
    // Address corresponds to col C ("Material/Item") of the data row.
    // Header block + blank rows + table header occupy rows 1–10; first data row is 11
    // (group-header) or 12 (first material). We map by component index for traceability.
    const cellAddr = `C${12 + idx}`;
    return {
      sourceCell: { sheet: breakdown.sourceSheet, address: cellAddr },
      referencedCell: { sheet: breakdown.sourceSheet, address: cellAddr },
      referencedBlockTitle: c.componentGroup || null,
      referencedBlockRow: null,
      quantityPerUnit: c.qtyPerBoqUnit,
      unitPrice: c.unitPrice,
      costContribution: c.costPerBoqUnit,
      lineType: lineTypeFromGroup(c.group),
      confidence: 1,
      materialName: c.materialName,
      disaggregatedFrom: c.componentGroup || undefined,
    };
  });

  return {
    perUnit: row.cost_split ?? { material: 0, labor: 0, equipment: 0, prelim: 0 },
    subkonPerUnit: row.subkon_cost_per_unit ?? 0,
    components,
    markup: null,
    totalCached: row.total_cost ?? 0,
  };
}
