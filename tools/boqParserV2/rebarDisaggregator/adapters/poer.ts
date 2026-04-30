import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';

// REKAP-PC column layout: A = label, H–O = diameter weights.
// Header row 9: H=6, I=8, J=10, K=13, L=16, M=19, N=22, O=25.
const DIAMETER_COLUMNS: Array<{ col: string; diameter: string }> = [
  { col: 'H', diameter: 'D6' },
  { col: 'I', diameter: 'D8' },
  { col: 'J', diameter: 'D10' },
  { col: 'K', diameter: 'D13' },
  { col: 'L', diameter: 'D16' },
  { col: 'M', diameter: 'D19' },
  { col: 'N', diameter: 'D22' },
  { col: 'O', diameter: 'D25' },
];

const SHEET = 'REKAP-PC';
const LABEL_COL = 'A';

function findLabelRow(cells: HarvestedCell[], typeCode: string): number | null {
  for (const c of cells) {
    if (c.sheet !== SHEET) continue;
    if (c.address.startsWith(LABEL_COL) && /^A\d+$/.test(c.address)) {
      const val = String(c.value ?? '').trim();
      if (val === typeCode) return c.row;
    }
  }
  return null;
}

function findCell(cells: HarvestedCell[], col: string, row: number): HarvestedCell | undefined {
  return cells.find((c) => c.sheet === SHEET && c.address === `${col}${row}`);
}

export const poerAdapter: RebarAdapter = {
  name: 'poer',
  sheetName: SHEET,
  prefixPattern: /^Poer\s+(.+)$/i,
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
