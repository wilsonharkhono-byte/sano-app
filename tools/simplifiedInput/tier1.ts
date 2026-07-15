import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { REBAR_COLUMNS, buildRebarComponent } from './rebar';
import { splitLabel, makeBoqStagingRow } from './staging';

export const TIER1_SHEET_NAME = 'SANO Input Tier 1';
export const BETON_MATERIAL_NAME = 'Beton Readymix';
const DATA_START_ROW = 4; // 1-indexed: rows 1–2 header, row 3 blank

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
    seq += 1;
    const code = `T1-${String(seq).padStart(3, '0')}`;
    const { chapter, subChapter } = splitLabel(label);

    const components: RecipeComponent[] = [
      {
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
      },
    ];
    for (const { col, diameter } of REBAR_COLUMNS) {
      const lonjor = numAt(ws, `${col}${r}`);
      if (lonjor > 0) {
        components.push(buildRebarComponent(diameter, lonjor, betonM3, TIER1_SHEET_NAME, `${col}${r}`));
      }
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
        unit: 'm³',
        planned: betonM3,
        recipe,
        sourceSheet: TIER1_SHEET_NAME,
        sourceRow: r,
        rowNumber: rowNumber++,
      }),
    );
  }
  return out;
}
