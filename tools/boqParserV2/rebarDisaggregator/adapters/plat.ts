import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';
import { detectDiameterHeader, findRowByLabel } from './headerDetect';

/**
 * REKAP Plat layout varies per workbook:
 *
 *   AAL-5:        header row 2  -> K=8, L=10, M=13, N=16, O=25       (label in C)
 *   PD3-23:       header row 2  -> K=8, L=10, M=13, N=16, O=25       (label in C)
 *   I4-29 / ERNAWATI: header row 2 -> N=8, O=10, P=13                 (label in C)
 *
 * The previous hardcoded adapter used N..R = D8..D19 — which matched
 * ERNAWATI but completely missed AAL-5 and PD3 (off by 3 columns AND
 * different diameter set; produced empty diameter weights on those
 * workbooks). We now detect the header row dynamically.
 *
 * Note: REKAP Plat in every reference workbook starts at diameter D8 — it
 * does NOT include D6 (D6 is only used on Balok stirrups and Poer rebar).
 */

const SHEET = 'REKAP Plat';
const LABEL_COLS = ['B', 'C', 'D'];

export const platAdapter: RebarAdapter = {
  name: 'plat',
  sheetName: SHEET,
  prefixPattern: /^Plat\s+(.+)$/i,
  lookupBreakdown(typeCode, cells, hint) {
    const header = detectDiameterHeader(cells, SHEET, { rowMin: 1, rowMax: 30 });
    if (!header) return null;
    let targetRow: number | null = hint?.rekapRow ?? null;
    if (targetRow == null) {
      const found = findRowByLabel(cells, SHEET, LABEL_COLS, typeCode, {
        rowMin: header.row + 1,
      });
      if (!found) return null;
      targetRow = found.row;
    }
    const out: RebarBreakdown[] = [];
    for (const [diameter, col] of header.map) {
      const cell = cells.find((c) => c.sheet === SHEET && c.address === `${col}${targetRow}`);
      const w = Number(cell?.value ?? 0);
      if (w > 0) {
        out.push({ diameter, weightKg: w, sourceCell: `${SHEET}!${col}${targetRow}` });
      }
    }
    return out;
  },
};
