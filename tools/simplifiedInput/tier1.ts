import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { REBAR_COLUMNS, buildRebarComponent } from './rebar';
import { splitLabel, makeBoqStagingRow } from './staging';

export const TIER1_SHEET_NAME = 'SANO Input Tier 1';
export const BETON_MATERIAL_NAME = 'Beton Readymix';
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
 */
export function parseTier1Sheet(ws: XLSX.WorkSheet, startRowNumber = 1): StagingRowV2[] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
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
        materialName: BETON_MATERIAL_NAME,
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
        // Provenance: this row's planned 1 is a lump sum we chose, not a
        // quantity read off the sheet. Anyone reading the staged row back can
        // tell the two apart.
        ...(rebarOnly ? { extraRaw: { rebar_only: true } } : {}),
      }),
    );
  }
  return out;
}
