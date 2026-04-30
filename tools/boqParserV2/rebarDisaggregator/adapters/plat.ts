import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';

// REKAP Plat layout: C = label, N–R = diameter weights (5 diameters only).
// Header row 2: N=8, O=10, P=13, Q=16, R=19. No D6 / D22 / D25.
const DIAMETER_COLUMNS: Array<{ col: string; diameter: string }> = [
  { col: 'N', diameter: 'D8' },
  { col: 'O', diameter: 'D10' },
  { col: 'P', diameter: 'D13' },
  { col: 'Q', diameter: 'D16' },
  { col: 'R', diameter: 'D19' },
];

const SHEET = 'REKAP Plat';
const LABEL_COL = 'C';

function findLabelRow(cells: HarvestedCell[], typeCode: string): number | null {
  for (const c of cells) {
    if (c.sheet !== SHEET) continue;
    if (c.address.startsWith(LABEL_COL) && /^C\d+$/.test(c.address)) {
      const val = String(c.value ?? '').trim();
      if (val === typeCode) return c.row;
    }
  }
  return null;
}

function findCell(cells: HarvestedCell[], col: string, row: number): HarvestedCell | undefined {
  return cells.find((c) => c.sheet === SHEET && c.address === `${col}${row}`);
}

export const platAdapter: RebarAdapter = {
  name: 'plat',
  sheetName: SHEET,
  prefixPattern: /^Plat\s+(.+)$/i,
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
