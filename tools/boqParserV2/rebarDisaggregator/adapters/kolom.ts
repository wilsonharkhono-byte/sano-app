import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';

const SHEET = 'Hasil-Kolom';
const LABEL_COL = 'D';
const SUMMARY_ROW_MIN = 145;
const SUMMARY_ROW_MAX = 250;

interface CombinedDiameter {
  diameter: string;
  stirrupCol: string | null;        // null if no stirrup variant
  mainCol: string | null;           // null if no main variant
}

// Per spec Section 2.4: D10/D13/D16 each have stirrup AND main columns
// that combine into one entry; D8 is stirrup-only; D19 is main-only.
const COMBINED_DIAMETERS: CombinedDiameter[] = [
  { diameter: 'D8',  stirrupCol: 'H', mainCol: null },
  { diameter: 'D10', stirrupCol: 'I', mainCol: 'L' },
  { diameter: 'D13', stirrupCol: 'J', mainCol: 'M' },
  { diameter: 'D16', stirrupCol: 'K', mainCol: 'N' },
  { diameter: 'D19', stirrupCol: null, mainCol: 'O' },
];

function findLabelRow(cells: HarvestedCell[], typeCode: string): number | null {
  for (const c of cells) {
    if (c.sheet !== SHEET) continue;
    if (c.row < SUMMARY_ROW_MIN || c.row > SUMMARY_ROW_MAX) continue;
    if (c.address.startsWith(LABEL_COL) && /^D\d+$/.test(c.address)) {
      const val = String(c.value ?? '').trim();
      if (val === typeCode) return c.row;
    }
  }
  return null;
}

function findCell(cells: HarvestedCell[], col: string, row: number): HarvestedCell | undefined {
  return cells.find((c) => c.sheet === SHEET && c.address === `${col}${row}`);
}

function readWeight(cells: HarvestedCell[], col: string | null, row: number): number {
  if (!col) return 0;
  const cell = findCell(cells, col, row);
  return Number(cell?.value ?? 0);
}

export const kolomAdapter: RebarAdapter = {
  name: 'kolom',
  sheetName: SHEET,
  prefixPattern: /^Kolom\s+(.+)$/i,
  lookupBreakdown(typeCode, cells) {
    const row = findLabelRow(cells, typeCode);
    if (row == null) return null;
    const out: RebarBreakdown[] = [];
    for (const { diameter, stirrupCol, mainCol } of COMBINED_DIAMETERS) {
      const stirrupKg = readWeight(cells, stirrupCol, row);
      const mainKg = readWeight(cells, mainCol, row);
      const total = Math.round((stirrupKg + mainKg) * 100) / 100;
      if (total <= 0) continue;
      let sourceCell: string;
      if (stirrupKg > 0 && mainKg > 0) {
        sourceCell = `${SHEET}!${stirrupCol}${row}+${mainCol}${row}`;
      } else if (stirrupKg > 0) {
        sourceCell = `${SHEET}!${stirrupCol}${row}`;
      } else {
        sourceCell = `${SHEET}!${mainCol}${row}`;
      }
      out.push({ diameter, weightKg: total, sourceCell });
    }
    return out;
  },
};
