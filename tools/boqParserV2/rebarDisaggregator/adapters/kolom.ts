import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';
import { parseDiameterMarker, findRowByLabel } from './headerDetect';

/**
 * Hasil-Kolom (column rebar) layouts seen in the field:
 *
 *   AAL-5  row 177 -> H=8 I=10 J=13 K=16   |   L=10 M=13 N=16 O=19 P=22 Q=25 R=29 S=32
 *   PD3-23 row 213 -> H=8 I=10 J=13 K=16   |   L=8  M=10 N=13 O=16 P=19 Q=22 R=25 S=29
 *   I4-29  similar shape (stirrup at H..K, main at L..S+).
 *
 * The header row carries TWO groups of diameters: "Besi Sengkang"
 * (stirrups) on the left, "Besi Utama + Ex" (main + extras) on the
 * right. The same diameter often appears in BOTH groups for a given
 * project — e.g. AAL-5 has D10/D13/D16 in both groups, D8 only as
 * stirrup, D19+ only as main. Per spec §2.4 the adapter must SUM the
 * stirrup + main weights into one entry per diameter and tag the source
 * cells appropriately.
 *
 * Detection strategy: scan the summary range (rows 140..320 — wide
 * enough to absorb taller workbooks like PD3 which push the header to
 * row 213 and label rows up to ~300) for the diameter-header row. The
 * column "L" always marks the stirrup→main boundary on every reference
 * workbook; columns strictly before "L" are stirrups, columns "L" and
 * beyond are main. Within each group we parse diameter markers from the
 * cell values.
 *
 * Previously this adapter hardcoded H/I/J/K = D8/D10/D13/D16 stirrup
 * and L/M/N/O = D10/D13/D16/D19 main — which matched AAL-5 but was
 * wrong on PD3 (where L=D8 not D10) and missed D22/D25/D29 main weights
 * entirely. The new header-aware version handles every shape correctly.
 */

const SHEET = 'Hasil-Kolom';
const LABEL_COLS = ['B', 'C', 'D'];
const SUMMARY_ROW_MIN = 140;
const SUMMARY_ROW_MAX = 320;

interface KolomHeader {
  row: number;
  /** Stirrup column letter for each diameter found in the stirrup half. */
  stirrupCols: Map<string, string>;
  /** Main column letter for each diameter found in the main half. */
  mainCols: Map<string, string>;
}

function detectKolomHeader(cells: HarvestedCell[]): KolomHeader | null {
  // Group qualifying cells by row across the summary range.
  const rows = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== SHEET) continue;
    if (c.row < SUMMARY_ROW_MIN || c.row > SUMMARY_ROW_MAX) continue;
    const m = c.address.match(/^([A-Z]+)\d+$/);
    if (!m) continue;
    if (!rows.has(c.row)) rows.set(c.row, []);
    rows.get(c.row)!.push(c);
  }
  // The header row is the one with the largest number of diameter markers
  // in column range H..Z. We don't take the first hit — some workbooks
  // have stray "8" or "10" labels in unrelated metadata rows; the real
  // header has many markers.
  let best: KolomHeader | null = null;
  let bestCount = 0;
  for (const [r, rcells] of rows) {
    const markers: Array<{ col: string; d: number }> = [];
    for (const c of rcells) {
      const colMatch = c.address.match(/^([A-Z]+)\d+$/);
      if (!colMatch) continue;
      const col = colMatch[1];
      // Diameter columns live H..Z on every observed workbook.
      if (col < 'H' || col > 'Z') continue;
      const d = parseDiameterMarker(c.value);
      if (d == null) continue;
      markers.push({ col, d });
    }
    if (markers.length < 4) continue;
    // Build stirrup vs main split. Per inspection, the main half always
    // starts at column "L". Anything earlier (H..K) is stirrup; L onward
    // is main.
    const stirrupCols = new Map<string, string>();
    const mainCols = new Map<string, string>();
    for (const { col, d } of markers) {
      const key = `D${d}`;
      if (col < 'L') {
        if (!stirrupCols.has(key)) stirrupCols.set(key, col);
      } else {
        if (!mainCols.has(key)) mainCols.set(key, col);
      }
    }
    if (markers.length > bestCount) {
      bestCount = markers.length;
      best = { row: r, stirrupCols, mainCols };
    }
  }
  return best;
}

export const kolomAdapter: RebarAdapter = {
  name: 'kolom',
  sheetName: SHEET,
  // "Kolom K174" and also shear walls "SW1"/"SW 2": shear-wall rebar is
  // computed on the same Hasil-Kolom sheet (the BoQ row's Z-formula cites
  // 'Hasil-Kolom'!W{row}), so they disaggregate through this adapter via the
  // Z-hint. Without this, SW rows fall back to the "U24 & U40" pembesian lump.
  prefixPattern: /^(?:Kolom\s+|SW\s*)(.+)$/i,
  lookupBreakdown(typeCode, cells, hint) {
    const header = detectKolomHeader(cells);
    if (!header) return null;
    let targetRow: number | null = hint?.rekapRow ?? null;
    if (targetRow == null) {
      const found = findRowByLabel(cells, SHEET, LABEL_COLS, typeCode, {
        rowMin: header.row + 1,
        rowMax: SUMMARY_ROW_MAX,
      });
      if (!found) return null;
      targetRow = found.row;
    }
    // targetRow is non-null below: either hint set it, or label-search did.
    const row: number = targetRow;

    // Union of diameters seen in either group — preserves the existing
    // semantics where D8 is stirrup-only and D19+ is main-only.
    const allDiameters = new Set<string>([
      ...header.stirrupCols.keys(),
      ...header.mainCols.keys(),
    ]);
    // Iterate in canonical numerical order so output is deterministic.
    const sortedDiameters = Array.from(allDiameters).sort(
      (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10),
    );
    const out: RebarBreakdown[] = [];
    for (const diameter of sortedDiameters) {
      const stirrupCol = header.stirrupCols.get(diameter) ?? null;
      const mainCol = header.mainCols.get(diameter) ?? null;
      const stirrupKg = stirrupCol ? readWeight(cells, stirrupCol, row) : 0;
      const mainKg = mainCol ? readWeight(cells, mainCol, row) : 0;
      const total = stirrupKg + mainKg;
      if (total <= 0) continue;
      let sourceCell: string;
      if (stirrupKg > 0 && mainKg > 0 && stirrupCol && mainCol) {
        sourceCell = `${SHEET}!${stirrupCol}${row}+${mainCol}${row}`;
      } else if (stirrupKg > 0 && stirrupCol) {
        sourceCell = `${SHEET}!${stirrupCol}${row}`;
      } else if (mainCol) {
        sourceCell = `${SHEET}!${mainCol}${row}`;
      } else {
        // Unreachable — total > 0 implies at least one column.
        continue;
      }
      out.push({ diameter, weightKg: total, sourceCell });
    }
    return out;
  },
};

function readWeight(cells: HarvestedCell[], col: string, row: number): number {
  const cell = cells.find((c) => c.sheet === SHEET && c.address === `${col}${row}`);
  return Number(cell?.value ?? 0);
}
