import * as XLSX from 'xlsx';
import type { StagingRowV2 } from '../boqParserV2/types';

export const OTHERS_SHEET_NAME = 'SANO Input Others';
const DATA_START_ROW = 3; // 1-indexed: row 1 header, row 2 blank
/** Legacy layout, used only when no header row can be recognized. */
const FALLBACK_COLUMNS: OthersColumns = { name: 'A', tier: 'B', unit: 'C', volume: 'D', price: 'E' };
/** The header sits in the first few rows; scanning further would risk matching a data row. */
const HEADER_SEARCH_ROWS = 5;

/**
 * Header labels we accept per field, normalized (lowercased, punctuation and
 * repeated spaces collapsed). Matching is EXACT against these — substring
 * matching would let "Total Harga" claim the price column and "Harga Satuan"
 * claim the unit column, which is precisely the silent mis-read this lookup
 * exists to prevent.
 */
const COLUMN_LABELS: Record<keyof OthersColumns, string[]> = {
  name: ['material', 'nama material', 'nama bahan', 'nama', 'bahan', 'uraian'],
  tier: ['tier'],
  unit: ['satuan', 'sat', 'unit'],
  // "Jumlah" is deliberately NOT a volume alias: in these workbooks it usually
  // means the Rupiah total, and reading it as a quantity would be silently wrong.
  volume: ['volume', 'vol', 'qty', 'kuantitas'],
  price: ['harga satuan', 'harga/satuan', 'harga per satuan', 'harga'],
};

interface OthersColumns {
  name: string | null;
  tier: string | null;
  unit: string | null;
  volume: string | null;
  price: string | null;
}

function numAt(ws: XLSX.WorkSheet, addr: string | null, row: number): number {
  if (!addr) return 0;
  const c = ws[`${addr}${row}`];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string | null, row: number): string {
  if (!addr) return '';
  const c = ws[`${addr}${row}`];
  return c && c.v != null ? String(c.v).trim() : '';
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The label spellings a header cell offers for matching: as written, and with a
 * trailing parenthesized annotation stripped — "Volume (m3)" and "Harga Satuan
 * (Rp)" are routine estimator edits that must not degrade the parse to
 * volume/price null. Only a TRAILING "(…)" is stripped; anything else stays
 * exact so "Total Harga" still cannot claim the price column.
 */
function headerCandidates(raw: string): string[] {
  const full = normalizeHeader(raw);
  const stripped = normalizeHeader(raw.replace(/\s*\([^)]*\)\s*$/, ''));
  return stripped && stripped !== full ? [full, stripped] : [full];
}

/**
 * Locate the header row and each field's column letter. Estimators edit these
 * sheets by hand: on 2026-08-15 one inserted a "Keterangan" column at A, which
 * shifted every field one column right. The old fixed A–E read then produced
 * name="Umum" / volume=0 for all 13 project materials and publish dropped them
 * without a word. Reading by header text survives inserted, removed and
 * reordered columns.
 *
 * A row counts as the header only when it carries the material-name label AND
 * at least one other known label — one stray "Material" cell in a title row is
 * not enough to bet the whole parse on. Fields whose label is absent stay null
 * (their values read as empty/0, which publish reports as a loud skip) rather
 * than falling back to a positional guess that could pick up a neighbouring
 * column's numbers.
 */
function locateColumns(ws: XLSX.WorkSheet, range: XLSX.Range): { columns: OthersColumns; headerRow: number | null } {
  const lastSearchRow = Math.min(range.e.r, HEADER_SEARCH_ROWS - 1); // decode_range is 0-indexed
  for (let r0 = range.s.r; r0 <= lastSearchRow; r0++) {
    const found: OthersColumns = { name: null, tier: null, unit: null, volume: null, price: null };
    for (let c0 = range.s.c; c0 <= range.e.c; c0++) {
      const cell = ws[XLSX.utils.encode_cell({ r: r0, c: c0 })];
      if (!cell || cell.v == null) continue;
      const labels = headerCandidates(String(cell.v));
      if (labels.every((l) => !l)) continue;
      for (const field of Object.keys(COLUMN_LABELS) as (keyof OthersColumns)[]) {
        // First match wins so a duplicated label can't silently retarget a
        // column we already resolved.
        if (found[field] == null && labels.some((l) => COLUMN_LABELS[field].includes(l))) {
          found[field] = XLSX.utils.encode_col(c0);
          break;
        }
      }
    }
    const matched = Object.values(found).filter((v) => v != null).length;
    if (found.name != null && matched >= 2) return { columns: found, headerRow: r0 + 1 };
  }
  return { columns: FALLBACK_COLUMNS, headerRow: null };
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
  const { columns, headerRow } = locateColumns(ws, range);
  // Data starts right after the header when we found one; the customary blank
  // spacer row is skipped by the empty-name guard below. With no header we keep
  // the legacy fixed start (row 1 header, row 2 blank).
  const firstDataRow = headerRow != null ? headerRow + 1 : DATA_START_ROW;
  const rows: StagingRowV2[] = [];
  let seq = 0;
  let rowNumber = startRowNumber;

  for (let r = firstDataRow; r <= range.e.r + 1; r++) {
    const name = strAt(ws, columns.name, r);
    if (!name) continue;
    const tierRaw = numAt(ws, columns.tier, r);
    const unit = strAt(ws, columns.unit, r);
    const volume = numAt(ws, columns.volume, r);
    const unitPrice = numAt(ws, columns.price, r);

    seq += 1;
    rows.push({
      row_type: 'material',
      row_number: rowNumber++,
      raw_data: {
        source_sheet: OTHERS_SHEET_NAME,
        source_row: r,
        source_cell: `${columns.name}${r}`,
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
