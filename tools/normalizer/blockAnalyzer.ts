import type { HarvestedCell } from '../boqParserV2/types';

const ROWS_BEFORE = 3;
const ROWS_AFTER = 15;

export interface CellContext {
  sheet: string;
  anchorRow: number;
  rows: Array<{ row: number; cells: HarvestedCell[] }>;
}

export function extractBlockCellContext(blockId: string, cells: HarvestedCell[]): CellContext {
  const bangIdx = blockId.indexOf('!');
  if (bangIdx < 0) throw new Error(`extractBlockCellContext: invalid blockId ${blockId}`);
  const sheet = blockId.slice(0, bangIdx);
  const addr = blockId.slice(bangIdx + 1);
  const m = /^[A-Z]+(\d+)$/.exec(addr);
  if (!m) throw new Error(`extractBlockCellContext: invalid blockId ${blockId}`);
  const anchorRow = parseInt(m[1], 10);
  const minRow = anchorRow - ROWS_BEFORE;
  const maxRow = anchorRow + ROWS_AFTER;

  const byRow = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== sheet) continue;
    if (c.row < minRow || c.row > maxRow) continue;
    const bucket = byRow.get(c.row) ?? [];
    bucket.push(c);
    byRow.set(c.row, bucket);
  }

  const rows = Array.from(byRow.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([row, rowCells]) => ({ row, cells: rowCells }));

  return { sheet, anchorRow, rows };
}
