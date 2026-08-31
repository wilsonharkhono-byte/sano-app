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
  /**
   * A coded parse warning for this row (e.g. `unrecognized_beton_grade`). Sets
   * needs_review and lands in `raw_data.flag_reason` — the app's one row-level
   * warning channel: `tools/flagGroups.ts` buckets the review queue by it and
   * `tools/flagExplanation.ts` turns it into the estimator-facing "Kenapa
   * dicek / Saran" callout. A new code MUST be registered in both, or the row
   * falls into the unexplained "Lainnya" bucket.
   */
  flagReason?: string;
}

/**
 * Build one `boq` StagingRowV2 in the exact shape publishBaselineV2 consumes:
 * chapter/subChapter live in raw_data (buildBoqItemInsert reads them there);
 * recipe.components drive the material-master lines. needs_review fires on any
 * structural problem — or on a coded `flagReason` — so a bad row is surfaced,
 * never silently published.
 */
export function makeBoqStagingRow(input: BoqStagingInput): StagingRowV2 {
  const needsReview =
    !input.code || !input.label || !input.unit || !(input.planned > 0) || !!input.flagReason;
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
      // Last so a caller's extraRaw can never shadow the warning code.
      ...(input.flagReason ? { flag_reason: input.flagReason } : {}),
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
