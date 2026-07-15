import type { StagingRowV2, BoqRowRecipe } from '../boqParserV2/types';

export function splitLabel(label: string): { chapter: string; subChapter: string | null } {
  const idx = label.indexOf(';');
  if (idx === -1) return { chapter: label.trim(), subChapter: null };
  const sub = label.slice(idx + 1).trim();
  return { chapter: label.slice(0, idx).trim(), subChapter: sub.length > 0 ? sub : null };
}

export interface BoqStagingInput {
  code: string;
  label: string;
  chapter: string;
  subChapter: string | null;
  unit: string;
  planned: number;
  recipe: BoqRowRecipe;
  sourceSheet: string;
  sourceRow: number;
  rowNumber: number;
  extraRaw?: Record<string, unknown>;
}

/**
 * Build one `boq` StagingRowV2 in the exact shape publishBaselineV2 consumes:
 * chapter/subChapter live in raw_data (buildBoqItemInsert reads them there);
 * recipe.components drive the material-master lines. needs_review fires on any
 * structural problem so a bad row is surfaced, never silently published.
 */
export function makeBoqStagingRow(input: BoqStagingInput): StagingRowV2 {
  const needsReview = !input.code || !input.label || !input.unit || !(input.planned > 0);
  return {
    row_type: 'boq',
    row_number: input.rowNumber,
    raw_data: {
      source_sheet: input.sourceSheet,
      source_row: input.sourceRow,
      source_cell: `A${input.sourceRow}`,
      chapter: input.chapter,
      subChapter: input.subChapter,
      ...(input.extraRaw ?? {}),
    },
    parsed_data: {
      code: input.code,
      label: input.label,
      unit: input.unit,
      planned: input.planned,
      chapter: input.chapter,
      sub_chapter: input.subChapter,
      unit_price: null,
      subkon_cost_per_unit: 0,
      total_cost: 0,
      recipe: input.recipe,
    },
    needs_review: needsReview,
    confidence: 1,
    review_status: 'PENDING',
    cost_basis: 'inline_split',
    parent_ahs_staging_id: null,
    ref_cells: null,
    cost_split: { material: 0, labor: 0, equipment: 0, prelim: 0 },
  };
}
