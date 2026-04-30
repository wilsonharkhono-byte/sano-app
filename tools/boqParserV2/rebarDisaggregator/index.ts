import type { HarvestedCell } from '../types';
import type { BoqRowV2 } from '../extractTakeoffs';
import { selectAdapter } from './selectAdapter';
import { transformRecipe } from './transformRecipe';

export function disaggregateRebar(
  boqRows: BoqRowV2[],
  cells: HarvestedCell[],
): BoqRowV2[] {
  return boqRows.map((row) => {
    if (!row.recipe) return row;
    const sel = selectAdapter(row.label);
    if (!sel) return row;
    const breakdown = sel.adapter.lookupBreakdown(sel.typeCode, cells);
    if (!breakdown) return row;
    if (breakdown.length === 0) return row;
    const { recipe } = transformRecipe(row.recipe, breakdown, row.planned);
    return { ...row, recipe };
  });
}
