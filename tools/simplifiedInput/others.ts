import * as XLSX from 'xlsx';
import type { StagingRowV2 } from '../boqParserV2/types';

export const OTHERS_SHEET_NAME = 'SANO Input Others';
const DATA_START_ROW = 3; // 1-indexed: row 1 header, row 2 blank

function numAt(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c && c.v != null ? String(c.v).trim() : '';
}

/**
 * Parse "SANO Input Others" into PROJECT-LEVEL material staging rows (row_type
 * 'material', flagged project_material). These are Tier-2/3 envelopes with NO
 * BoQ relation — publish writes them as master lines with boq_item_id = NULL
 * (see publishProjectMaterials). Using 'material' (not 'boq') keeps them out of
 * every BoQ / supersede / work-group path automatically. Returns [] when the
 * sheet has no data rows.
 */
export function parseOthersSheet(ws: XLSX.WorkSheet, startRowNumber = 1): StagingRowV2[] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows: StagingRowV2[] = [];
  let seq = 0;
  let rowNumber = startRowNumber;

  for (let r = DATA_START_ROW; r <= range.e.r + 1; r++) {
    const name = strAt(ws, `A${r}`);
    if (!name) continue;
    const tierRaw = numAt(ws, `B${r}`);
    const unit = strAt(ws, `C${r}`);
    const volume = numAt(ws, `D${r}`);
    const unitPrice = numAt(ws, `E${r}`);

    seq += 1;
    rows.push({
      row_type: 'material',
      row_number: rowNumber++,
      raw_data: {
        source_sheet: OTHERS_SHEET_NAME,
        source_row: r,
        source_cell: `A${r}`,
        project_material: true,
      },
      parsed_data: {
        code: `OTH-${String(seq).padStart(3, '0')}`,
        name,
        unit,
        reference_unit_price: unitPrice,
        tier: tierRaw > 0 ? tierRaw : null,
        volume,
        project_material: true,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: null,
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });
  }
  return rows;
}
