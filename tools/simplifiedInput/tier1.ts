import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { REBAR_COLUMNS, buildRebarComponent } from './rebar';
import { splitLabel, makeBoqStagingRow } from './staging';
import { locateGradeColumn, parseBetonGrade, betonMaterialName } from './betonGrade';

export const TIER1_SHEET_NAME = 'SANO Input Tier 1';
/**
 * Fallback concrete name, used only when the sheet states no grade. It resolves
 * to NOTHING in the curated catalogue (whose concrete rows are grade-specific),
 * so the component publishes unresolved and is reported — which is the honest
 * outcome for "the estimator did not say which concrete this is". When the
 * optional "Mutu Beton" column IS filled, the emitted name is grade-specific
 * and resolves; see `betonGrade.ts`.
 */
export const BETON_MATERIAL_NAME = 'Beton Readymix';
/** Coded parse warning: the grade cell held something we refuse to interpret. */
export const UNRECOGNIZED_GRADE_FLAG = 'unrecognized_beton_grade';
const DATA_START_ROW = 4; // 1-indexed: rows 1–2 header, row 3 blank
/**
 * Unit for a work area with rebar but no beton (e.g. "Umum ; Kolom Balok
 * Praktis": practical columns/beams cast off the surrounding pours). There is
 * no m³ to take off, so the row is staged as one lump sum — see
 * `parseTier1Sheet`.
 */
const LUMP_SUM_UNIT = 'ls';

function numAt(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c && c.v != null ? String(c.v).trim() : '';
}

/**
 * Parse "SANO Input Tier 1" into one `boq` staging row per work area.
 * Each row's recipe = a beton component (coefficient 1.0) plus one batang
 * rebar component per nonzero diameter cell (C–H). Blank rows are skipped.
 *
 * Rebar-only work areas (beton cell blank, at least one lonjor count) are staged
 * as planned = 1 'ls' with the ABSOLUTE lonjor counts as coefficients, and with
 * NO beton component — a Beton Readymix line at 0 m³ would be a fabricated
 * number. Before this, they staged planned = 0 and publish's zero-planned filter
 * dropped them whole: no boq_item, no work group in Permintaan, and their rebar
 * missing from every envelope without a word (CLAUDE.md §1.1).
 *
 * A work area with neither beton nor rebar carries no take-off at all; it stays
 * planned = 0 / needs_review so the estimator sees it flagged and publish keeps
 * skipping it — there is nothing to stage a lump sum FOR.
 *
 * The beton component's NAME comes from the optional per-row "Mutu Beton"
 * column (any column from I rightwards, labelled in either header row). Stated
 * grade → a catalogue-resolvable name; no column or a blank cell → the legacy
 * bare `Beton Readymix`; an unrecognized value → the legacy name PLUS a
 * `unrecognized_beton_grade` review flag carrying the raw text. See
 * `betonGrade.ts` for why the grade is never inferred.
 */
export function parseTier1Sheet(ws: XLSX.WorkSheet, startRowNumber = 1): StagingRowV2[] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const gradeCol = locateGradeColumn(ws, range);
  const out: StagingRowV2[] = [];
  let seq = 0;
  let rowNumber = startRowNumber;

  for (let r = DATA_START_ROW; r <= range.e.r + 1; r++) {
    const label = strAt(ws, `A${r}`);
    if (!label) continue; // blank spacer between zones

    const betonM3 = numAt(ws, `B${r}`);
    const rebar = REBAR_COLUMNS
      .map(({ col, diameter }) => ({ col, diameter, lonjor: numAt(ws, `${col}${r}`) }))
      .filter((x) => x.lonjor > 0);
    const rebarOnly = !(betonM3 > 0) && rebar.length > 0;
    // The basis one unit of `planned` denominates: m³ of beton normally, one
    // lump sum for a rebar-only area (so coefficient = the raw lonjor count and
    // planned × coefficient reproduces the sheet figure exactly).
    const planned = rebarOnly ? 1 : betonM3;

    // The grade only ever names the beton component, so a rebar-only row (which
    // emits none) is left completely untouched by this column — no name change,
    // and no review flag for a cell that changes nothing about its output.
    const gradeRaw = gradeCol && !rebarOnly ? strAt(ws, `${gradeCol}${r}`) : '';
    const grade = gradeRaw ? parseBetonGrade(gradeRaw) : null;
    const gradeUnrecognized = gradeRaw !== '' && grade === null;

    seq += 1;
    const code = `T1-${String(seq).padStart(3, '0')}`;
    const { chapter, subChapter } = splitLabel(label);

    const components: RecipeComponent[] = [];
    if (!rebarOnly) {
      components.push({
        sourceCell: { sheet: TIER1_SHEET_NAME, address: `B${r}` },
        referencedCell: { sheet: TIER1_SHEET_NAME, address: `B${r}` },
        referencedBlockTitle: null,
        referencedBlockRow: null,
        quantityPerUnit: 1.0,
        unitPrice: 0,
        costContribution: 0,
        lineType: 'material',
        confidence: 1,
        unit: 'm³',
        materialName: grade ? betonMaterialName(grade) : BETON_MATERIAL_NAME,
      });
    }
    for (const { col, diameter, lonjor } of rebar) {
      components.push(buildRebarComponent(diameter, lonjor, planned, TIER1_SHEET_NAME, `${col}${r}`));
    }

    const recipe: BoqRowRecipe = {
      perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
      subkonPerUnit: 0,
      components,
      markup: null,
      totalCached: 0,
    };

    // Provenance carried on raw_data, never on the emitted number:
    //  - rebar_only: this row's planned 1 is a lump sum we chose, not a
    //    quantity read off the sheet. Anyone reading the staged row back can
    //    tell the two apart.
    //  - beton_grade / beton_grade_raw + _cell: what the sheet said about the
    //    grade and where it said it, so a reviewer can check the emitted
    //    material name against the source without reopening the workbook.
    const extraRaw: Record<string, unknown> = {};
    if (rebarOnly) extraRaw.rebar_only = true;
    if (grade) extraRaw.beton_grade = grade.canonical;
    if (gradeUnrecognized) {
      extraRaw.beton_grade_raw = gradeRaw;
      extraRaw.beton_grade_cell = `${gradeCol}${r}`;
    }

    out.push(
      makeBoqStagingRow({
        code,
        label,
        chapter,
        subChapter,
        unit: rebarOnly ? LUMP_SUM_UNIT : 'm³',
        planned,
        recipe,
        sourceSheet: TIER1_SHEET_NAME,
        sourceRow: r,
        rowNumber: rowNumber++,
        ...(Object.keys(extraRaw).length > 0 ? { extraRaw } : {}),
        ...(gradeUnrecognized ? { flagReason: UNRECOGNIZED_GRADE_FLAG } : {}),
      }),
    );
  }
  return out;
}
