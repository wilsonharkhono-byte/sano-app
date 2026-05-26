import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';
import { detectDiameterHeader, findRowByLabel } from './headerDetect';

/**
 * REKAP Balok column layout — usually:
 *   AAL-5  header row 12 -> L=6, M=8, N=10, O=13, P=16, Q=19, R=22, S=25, T=29  (label in D)
 *   PD3-23 header row 12 -> same as AAL-5
 *   I4-29  header row 11 -> same as AAL-5 (header row index shifted by 1)
 *
 * Previously hardcoded to AAL-5 columns L..S and missed T=D29 entirely.
 * Diameter-29 weights would be silently dropped if a project used them.
 * Header detection now covers D29 (and any future diameter we add to
 * CANONICAL_DIAMETERS in headerDetect.ts) automatically.
 */

const SHEET = 'REKAP Balok';
// Type-code labels live in column D in the per-element SUMMARY rows that
// the disaggregator targets. Column C carries the per-instance "Type"
// label in DETAIL rows (where the rebar weights are decomposed per
// individual balok occurrence, not aggregated for the element type).
// Reading from C would silently pick up a single-instance weight instead
// of the cross-floor aggregate the BoQ row depends on — that produced a
// ~1.45M Rp variance against ERNAWATI Sloof S24-1 in the integration
// test. Restricting to D is consistent with every reference workbook.
const LABEL_COLS = ['D'];

export const balokSloofAdapter: RebarAdapter = {
  name: 'balokSloof',
  sheetName: SHEET,
  prefixPattern: /^(?:Sloof|Balok)\s+(.+)$/i,
  lookupBreakdown(typeCode, cells, hint) {
    const header = detectDiameterHeader(cells, SHEET, { rowMin: 1, rowMax: 30 });
    if (!header) return null;
    // Prefer the hint row (BoQ row's own Z-formula reference). Otherwise
    // label-search — fine when REKAP has a single summary row per type, but
    // wrong when types repeat across floors (ERNAWATI Lantai 1/2/3 each get
    // their own B24-1 summary row).
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
