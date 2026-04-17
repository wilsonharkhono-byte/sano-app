import type { HarvestedCell } from './types';

export interface AhsBlock {
  title: string;
  titleRow: number;
  jumlahRow: number;
  jumlahCachedValue: number;
  grandTotalAddress: string | null;  // e.g. "I150"
  components: HarvestedCell[];        // the E-column cells of component rows
  componentRows: number[];            // row numbers
}

// AHS title conventions in Indonesian BoQ workbooks:
//  (a) "N <unit> <description>"  — e.g. "1 m2 Bekisting", "1 kg Pembesian",
//      "1 ls Pekerjaan Sementara", "10 titik Pemasangan Stop Kontak".
//      Supported units cover what v1's parser accepts.
//  (b) Workbooks sometimes use pure-verb headers like
//      "Pekerjaan Persiapan" or "Pasangan Bata". Match the common leading
//      verbs so those blocks aren't silently dropped.
const TITLE_UNIT_RE = /^\s*\d+\s+(m[123²³]|kg|ls|bh|pcs|titik|set|unit)\s+\S/i;
const TITLE_WORK_RE = /^(pekerjaan|pasangan|pemasangan|pengecoran|pembetonan|pembesian)\b/i;
const HEADER_LABELS = new Set([
  'uraian', 'satuan', 'koefisien', 'harga', 'jumlah harga', 'no', 'kode', 'bahan',
]);

export function isTitleRow(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return TITLE_UNIT_RE.test(trimmed) || TITLE_WORK_RE.test(trimmed);
}

export function isHeaderRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return HEADER_LABELS.has(text.trim().toLowerCase());
}

// Match "Jumlah", "Jumlah:", "Jumlah Harga", etc. in whatever column the
// workbook chose to put the end-of-block marker.
function isJumlahRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return /^\s*jumlah\b/i.test(text);
}

function cellText(cell: HarvestedCell | undefined): string | null {
  if (!cell) return null;
  if (typeof cell.value === 'string') return cell.value;
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function detectAhsBlocks(cells: HarvestedCell[], sheetName: string): AhsBlock[] {
  const byRow = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== sheetName) continue;
    const arr = byRow.get(c.row) ?? [];
    arr.push(c);
    byRow.set(c.row, arr);
  }

  const cellAt = (row: number, colLetter: string): HarvestedCell | undefined =>
    (byRow.get(row) ?? []).find(c => c.address.replace(/\d+/g, '') === colLetter);

  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);
  const blocks: AhsBlock[] = [];

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    const b = cellText(cellAt(row, 'B'));
    const c = cellText(cellAt(row, 'C'));
    const titleText = isTitleRow(b) ? b : isTitleRow(c) ? c : null;
    if (!titleText) continue;

    // Scan forward for Jumlah row. Standard Indonesian BoQ layout puts
    // "Jumlah" in col E (per v1 parser); other workbooks vary. Check every
    // cell in the row so layout drift doesn't silently drop the block.
    let jumlahRow = -1;
    for (let j = i + 1; j < sortedRows.length; j++) {
      const r = sortedRows[j];
      const rowCells = byRow.get(r) ?? [];
      if (rowCells.some(cell => isJumlahRow(cellText(cell)))) {
        jumlahRow = r;
        break;
      }
      // Safety: stop if we encounter another title row
      const bText = cellText(cellAt(r, 'B'));
      const cText = cellText(cellAt(r, 'C'));
      if (isTitleRow(bText) || isTitleRow(cText)) break;
    }
    if (jumlahRow === -1) continue;

    // Collect components between title and jumlah, skipping header rows
    const components: HarvestedCell[] = [];
    const componentRows: number[] = [];
    for (const r of sortedRows) {
      if (r <= row || r >= jumlahRow) continue;
      const bText = cellText(cellAt(r, 'B'));
      const cText = cellText(cellAt(r, 'C'));
      if (isHeaderRow(bText) || isHeaderRow(cText)) continue;
      const eCell = cellAt(r, 'E');
      if (!eCell) continue;
      components.push(eCell);
      componentRows.push(r);
    }

    const jumlahF = cellAt(jumlahRow, 'F');
    const jumlahI = cellAt(jumlahRow, 'I');
    blocks.push({
      title: titleText.trim(),
      titleRow: row,
      jumlahRow,
      jumlahCachedValue: toNumber(jumlahF?.value),
      grandTotalAddress: jumlahI?.address ?? null,
      components,
      componentRows,
    });
  }

  return blocks;
}
