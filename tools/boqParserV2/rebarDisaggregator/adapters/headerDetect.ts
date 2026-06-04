/**
 * Shared header-detection helpers for layout-aware REKAP adapters.
 *
 * Different RAB workbooks lay out their REKAP sheets with different column
 * letters for each diameter. AAL-5, PD3, I4-29 and ERNAWATI all differ. The
 * adapters used to hardcode AAL-5 column letters; this module replaces that
 * with a tolerant detector that finds the diameter header row anywhere in
 * the sheet and builds a `{ diameter: columnLetter }` map from it.
 *
 * Detection rule (intentionally loose, since some workbooks list diameter
 * headers as numbers like `8`, others as strings like `"D8"`, others as
 * `"D8 (kg)"`): a cell qualifies if its value, after normalisation, equals
 * one of the canonical diameter markers (6, 8, 10, 13, 16, 19, 22, 25, 29,
 * 32). A row qualifies as the diameter header if at least 3 of its cells
 * (within the candidate column range) qualify as diameter markers.
 *
 * The "label column" is the column carrying type codes (e.g. "PC.1",
 * "S24-1", "K174-1"). Because that column varies (A/B/C/D depending on the
 * workbook), the adapters scan a small set of candidate label columns and
 * match against the provided type code. This avoids relying on text-based
 * header detection (which would have to match "Type" / "Tipe" / "Nomor
 * Balok" / "Rekap Pile Cap" / "No. Kolom" etc.) and instead trusts the
 * caller's typeCode, which is already correct.
 */

import type { HarvestedCell } from '../../types';

/** Canonical rebar diameters used across SANO BoQ workbooks. */
export const CANONICAL_DIAMETERS = [6, 8, 10, 13, 16, 19, 22, 25, 29, 32] as const;

export type Diameter = `D${number}`;

/** Map diameter label (e.g. "D8") -> column letter (e.g. "K"). */
export type DiameterColumnMap = Map<Diameter, string>;

/**
 * Parse a cell value into a canonical diameter number, or null if it isn't
 * a diameter marker. Accepts:
 *   8, "8", "D8", "Φ8", "D 8", "8 mm", "8mm", "D8 (kg)"
 */
export function parseDiameterMarker(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && (CANONICAL_DIAMETERS as readonly number[]).includes(value)
      ? value
      : null;
  }
  if (typeof value !== 'string') return null;
  // Strip leading D / Φ / "phi" / whitespace, then keep first integer.
  const m = value.trim().match(/^(?:D|Φ|phi|ø)?\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return (CANONICAL_DIAMETERS as readonly number[]).includes(n) ? n : null;
}

interface DetectHeaderOptions {
  /** Inclusive scan range. Defaults to rows 1..30. */
  rowMin?: number;
  rowMax?: number;
  /** Minimum number of qualifying diameter markers on a row to accept. */
  minMarkers?: number;
  /** Column letters that are candidates for diameter cells. Defaults A..Z. */
  candidateColumns?: string[];
}

/**
 * Find the diameter-header row in `sheet` and return a column-letter map.
 * Returns null if no qualifying row exists.
 *
 * The first row meeting `minMarkers` (default 3) is used. Ties are not
 * relevant because real workbooks have exactly one diameter header per
 * sheet in the scan range.
 */
export function detectDiameterHeader(
  cells: HarvestedCell[],
  sheet: string,
  options: DetectHeaderOptions = {},
): { row: number; map: DiameterColumnMap } | null {
  const rowMin = options.rowMin ?? 1;
  const rowMax = options.rowMax ?? 30;
  const minMarkers = options.minMarkers ?? 3;
  const candidateCols = options.candidateColumns ?? defaultCandidateCols();

  // Group cells by row, limited to our sheet + range + candidate cols.
  const rows = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== sheet) continue;
    if (c.row < rowMin || c.row > rowMax) continue;
    const col = columnLetterOf(c.address);
    if (!col || !candidateCols.includes(col)) continue;
    if (!rows.has(c.row)) rows.set(c.row, []);
    rows.get(c.row)!.push(c);
  }

  // Iterate rows in ascending order — the first valid hit wins.
  const sortedRows = Array.from(rows.keys()).sort((a, b) => a - b);
  for (const r of sortedRows) {
    const map: DiameterColumnMap = new Map();
    for (const c of rows.get(r)!) {
      const d = parseDiameterMarker(c.value);
      if (d == null) continue;
      const col = columnLetterOf(c.address);
      if (!col) continue;
      const key: Diameter = `D${d}`;
      // If two cells in the same row map to the same diameter (shouldn't
      // happen on real workbooks), prefer the leftmost.
      if (!map.has(key)) map.set(key, col);
    }
    if (map.size >= minMarkers) {
      return { row: r, map };
    }
  }
  return null;
}

/**
 * Find the first row in `cells` (restricted to `sheet`) where ANY of the
 * `labelCols` carries the given type code exactly (case-insensitive trim
 * comparison). Returns the row number or null.
 *
 * This avoids hardcoding a single label column letter — the same physical
 * sheet shape uses different label columns across workbooks (REKAP Plat
 * has labels in C for AAL-5/PD3, REKAP-PC has labels in A, REKAP Balok in
 * D, Hasil-Kolom summary in D).
 */
export function findRowByLabel(
  cells: HarvestedCell[],
  sheet: string,
  labelCols: string[],
  typeCode: string,
  options: { rowMin?: number; rowMax?: number } = {},
): { row: number; labelCol: string } | null {
  const rowMin = options.rowMin ?? 1;
  const rowMax = options.rowMax ?? Number.POSITIVE_INFINITY;
  const target = typeCode.trim().toLowerCase();
  if (!target) return null;
  for (const c of cells) {
    if (c.sheet !== sheet) continue;
    if (c.row < rowMin || c.row > rowMax) continue;
    const col = columnLetterOf(c.address);
    if (!col || !labelCols.includes(col)) continue;
    const v = String(c.value ?? '').trim().toLowerCase();
    if (v === target) {
      return { row: c.row, labelCol: col };
    }
  }
  return null;
}

function columnLetterOf(address: string): string | null {
  const m = address.match(/^([A-Z]+)\d+$/);
  return m ? m[1] : null;
}

function defaultCandidateCols(): string[] {
  // A..Z; sufficient for every workbook seen so far. REKAP sheets never
  // push diameter columns past Z in any reference workbook.
  return Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
}
