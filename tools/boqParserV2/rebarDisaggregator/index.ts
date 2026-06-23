import type { HarvestedCell } from '../types';
import type { BoqRowV2 } from '../extractTakeoffs';
import { selectAdapter, selectAdapterByRekapFormula } from './selectAdapter';
import { transformRecipe, type TransformWarning } from './transformRecipe';
import { resolveRekapRowFromBoqFormula } from './resolveRekapRow';

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
    let sel = selectAdapter(row.label);
    if (!sel) {
      // Label matched no adapter prefix — fall back to the adapter whose REKAP
      // sheet the row's column-Z formula cites (handles oddly-named structural
      // elements like "Dak atap", "Pit lift", "Overflow" in I4-29).
      const z = cells.find((c) => c.sheet === row.source_sheet && c.address === `Z${row.sourceRow}`);
      sel = selectAdapterByRekapFormula(z?.formula);
    }
    if (!sel) return row;
    // Prefer the REKAP row the workbook itself references via the BoQ row's
    // Z-column formula. Falls back to label-search when the formula doesn't
    // cite the adapter's REKAP sheet (e.g., AAL-5 / PD3 / I4 still work via
    // the existing label match).
    const hintRow = resolveRekapRowFromBoqFormula(
      cells,
      row.source_sheet,
      row.sourceRow,
      sel.adapter.sheetName,
    );
    const hint = hintRow != null ? { rekapRow: hintRow } : undefined;
    const breakdown = sel.adapter.lookupBreakdown(sel.typeCode, cells, hint);
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
