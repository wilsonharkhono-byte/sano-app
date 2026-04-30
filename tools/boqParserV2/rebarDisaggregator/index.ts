import type { HarvestedCell } from '../types';
import type { BoqRowV2 } from '../extractTakeoffs';
import { selectAdapter } from './selectAdapter';
import { transformRecipe, type TransformWarning } from './transformRecipe';

export interface DisaggregateResult {
  boqRows: BoqRowV2[];
  warnings: Array<{ boqCode: string; warning: TransformWarning }>;
}

export function disaggregateRebar(
  boqRows: BoqRowV2[],
  cells: HarvestedCell[],
): DisaggregateResult {
  const warnings: Array<{ boqCode: string; warning: TransformWarning }> = [];
  const out = boqRows.map((row) => {
    if (!row.recipe) return row;
    const sel = selectAdapter(row.label);
    if (!sel) return row;
    const breakdown = sel.adapter.lookupBreakdown(sel.typeCode, cells);
    if (!breakdown) return row;
    if (breakdown.length === 0) return row;
    const { recipe, warning } = transformRecipe(row.recipe, breakdown, row.planned);
    if (warning) {
      warnings.push({ boqCode: row.code, warning });
    }
    return { ...row, recipe };
  });
  return { boqRows: out, warnings };
}
