import type { HarvestedCell } from '../types';

/**
 * Resolve the REKAP row a BoQ row depends on by reading its column-Z formula
 * (kg pembesian per m³). The formula in workbooks that distinguish elements
 * by floor (e.g., ERNAWATI: B24-1 has separate summary rows per Lantai) looks
 * like `='REKAP Balok'!X291`. Without this lookup, the rebar disaggregator
 * label-searches for "B24-1" and finds whichever floor's row appears first
 * in REKAP — which is wrong for every BoQ row referring to a different floor.
 *
 * Returns the REKAP row number on success; null if either:
 *   - the BoQ row has no Z-column formula,
 *   - the formula doesn't reference `rekapSheet`,
 *   - or the cell can't be located.
 *
 * The check is intentionally narrow: we only accept formulas that directly
 * cite the expected REKAP sheet. Indirect computations (SUM, lookups) fall
 * back to the adapter's label-search path so behavior on AAL-5 / PD3 / I4
 * (which all itemize cleanly via label search today) is preserved.
 */
export function resolveRekapRowFromBoqFormula(
  cells: HarvestedCell[],
  boqSheet: string,
  boqRow: number,
  rekapSheet: string,
): number | null {
  const z = cells.find((c) => c.sheet === boqSheet && c.address === `Z${boqRow}`);
  if (!z?.formula) return null;
  // Quoted sheet name like 'REKAP Balok' or 'REKAP-PC'; or plain like Analisa.
  // Allow $ in row/col absolute references.
  const escSheet = rekapSheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`'?${escSheet}'?!\\$?[A-Z]+\\$?(\\d+)`, 'i');
  const m = z.formula.match(re);
  if (!m) return null;
  const row = parseInt(m[1], 10);
  return Number.isFinite(row) && row > 0 ? row : null;
}
