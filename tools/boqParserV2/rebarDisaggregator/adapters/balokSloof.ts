import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';

// REKAP Balok column layout: D = label, L–S = diameter weights.
// Header row 264 declares: L=6, M=8, N=10, O=13, P=16, Q=19, R=22, S=25.
const DIAMETER_COLUMNS: Array<{ col: string; diameter: string }> = [
  { col: 'L', diameter: 'D6' },
  { col: 'M', diameter: 'D8' },
  { col: 'N', diameter: 'D10' },
  { col: 'O', diameter: 'D13' },
  { col: 'P', diameter: 'D16' },
  { col: 'Q', diameter: 'D19' },
  { col: 'R', diameter: 'D22' },
  { col: 'S', diameter: 'D25' },
];

const SHEET = 'REKAP Balok';

function findLabelRow(cells: HarvestedCell[], typeCode: string): number | null {
  for (const c of cells) {
    if (c.sheet !== SHEET) continue;
    if (c.address.startsWith('D')) {
      const val = String(c.value ?? '').trim();
      if (val === typeCode) return c.row;
    }
  }
  return null;
}

function findCell(cells: HarvestedCell[], col: string, row: number): HarvestedCell | undefined {
  return cells.find((c) => c.sheet === SHEET && c.address === `${col}${row}`);
}

export const balokSloofAdapter: RebarAdapter = {
  name: 'balokSloof',
  sheetName: SHEET,
  prefixPattern: /^(?:Sloof|Balok)\s+(.+)$/i,
  lookupBreakdown(typeCode, cells) {
    const row = findLabelRow(cells, typeCode);
    if (row == null) return null;
    const out: RebarBreakdown[] = [];
    for (const { col, diameter } of DIAMETER_COLUMNS) {
      const cell = findCell(cells, col, row);
      const w = Number(cell?.value ?? 0);
      if (w > 0) {
        out.push({ diameter, weightKg: w, sourceCell: `${SHEET}!${col}${row}` });
      }
    }
    return out;
  },
};
