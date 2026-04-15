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

const TITLE_RE = /^\s*\d+\s+m\s*[²³23]?\s+\S/i;
const HEADER_LABELS = new Set([
  'uraian', 'satuan', 'koefisien', 'harga', 'jumlah harga', 'no', 'kode', 'bahan',
]);

export function isTitleRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return TITLE_RE.test(text);
}

export function isHeaderRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return HEADER_LABELS.has(text.trim().toLowerCase());
}

function isJumlahRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.trim().toLowerCase() === 'jumlah';
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

    // Scan forward for Jumlah row
    let jumlahRow = -1;
    for (let j = i + 1; j < sortedRows.length; j++) {
      const r = sortedRows[j];
      const aText = cellText(cellAt(r, 'A'));
      const bText = cellText(cellAt(r, 'B'));
      const cText = cellText(cellAt(r, 'C'));
      if (isJumlahRow(aText) || isJumlahRow(bText) || isJumlahRow(cText)) {
        jumlahRow = r;
        break;
      }
      // Safety: stop if we encounter another title row
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
