import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { makeBoqStagingRow } from './staging';

export const OTHERS_SHEET_NAME = 'SANO Input Others';
export const ANCHOR_CODE = 'MATERIAL-UMUM';
const DATA_START_ROW = 3; // 1-indexed: row 1 header, row 2 blank

interface OthersMaterial {
  name: string;
  tier: number | null;
  unit: string;
  volume: number;
  unitPrice: number;
}

function numAt(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c && c.v != null ? String(c.v).trim() : '';
}

/**
 * Parse "SANO Input Others" into ONE synthetic "Material Umum" anchor boq row
 * (planned = 1) whose components are the project-level Tier-2/3 materials.
 * master_planned = 1 × Volume = the project total, in the sheet's unit. The
 * file's declared tier/price are captured in raw_data.others_materials for the
 * reconcile helper. Returns null when the sheet has no data rows.
 */
export function parseOthersSheet(ws: XLSX.WorkSheet, rowNumber = 1): StagingRowV2 | null {
  if (!ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const components: RecipeComponent[] = [];
  const materials: OthersMaterial[] = [];

  for (let r = DATA_START_ROW; r <= range.e.r + 1; r++) {
    const name = strAt(ws, `A${r}`);
    if (!name) continue;
    const tierRaw = numAt(ws, `B${r}`);
    const unit = strAt(ws, `C${r}`);
    const volume = numAt(ws, `D${r}`);
    const unitPrice = numAt(ws, `E${r}`);

    components.push({
      sourceCell: { sheet: OTHERS_SHEET_NAME, address: `A${r}` },
      referencedCell: { sheet: OTHERS_SHEET_NAME, address: `A${r}` },
      referencedBlockTitle: null,
      referencedBlockRow: null,
      quantityPerUnit: volume,
      unitPrice,
      costContribution: volume * unitPrice,
      lineType: 'material',
      confidence: 1,
      unit,
      materialName: name,
    });
    materials.push({ name, tier: tierRaw > 0 ? tierRaw : null, unit, volume, unitPrice });
  }

  if (components.length === 0) return null;

  const recipe: BoqRowRecipe = {
    perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
    subkonPerUnit: 0,
    components,
    markup: null,
    totalCached: 0,
  };

  return makeBoqStagingRow({
    code: ANCHOR_CODE,
    label: 'Material Umum (Tier 2 & 3)',
    chapter: 'Material Umum',
    subChapter: null,
    unit: 'ls',
    planned: 1,
    recipe,
    sourceSheet: OTHERS_SHEET_NAME,
    sourceRow: DATA_START_ROW,
    rowNumber,
    extraRaw: { others_materials: materials },
  });
}
