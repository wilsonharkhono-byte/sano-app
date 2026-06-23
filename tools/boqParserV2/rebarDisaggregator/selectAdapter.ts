import type { RebarAdapter } from './types';
import { balokSloofAdapter } from './adapters/balokSloof';
import { poerAdapter } from './adapters/poer';
import { platAdapter } from './adapters/plat';
import { kolomAdapter } from './adapters/kolom';

export const ADAPTERS: RebarAdapter[] = [
  balokSloofAdapter,
  poerAdapter,
  platAdapter,
  kolomAdapter,
];

export function selectAdapter(
  label: string,
): { adapter: RebarAdapter; typeCode: string } | null {
  if (!label) return null;
  const cleaned = label.replace(/^[\s\-–—]+/, '').trim();
  if (!cleaned) return null;
  for (const adapter of ADAPTERS) {
    const m = cleaned.match(adapter.prefixPattern);
    if (m) {
      const typeCode = m[1].trim();
      if (typeCode) return { adapter, typeCode };
    }
  }
  return null;
}

/**
 * Fallback selector for rows whose label matches no adapter prefix (e.g.
 * "Dak atap garasi", "Pit lift", "Overflow kolam renang" in I4-29) but whose
 * column-Z formula still cites a known REKAP sheet. We pick the adapter whose
 * `sheetName` the formula references; the caller then resolves the exact REKAP
 * row from that same formula, so `typeCode` is unused (returned empty). Returns
 * null when the formula cites no adapter sheet (e.g. 'Retaining Wall', which has
 * no per-diameter columns).
 */
export function selectAdapterByRekapFormula(
  zFormula: string | null | undefined,
): { adapter: RebarAdapter; typeCode: string } | null {
  if (!zFormula) return null;
  for (const adapter of ADAPTERS) {
    const esc = adapter.sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`'?${esc}'?!`, 'i').test(zFormula)) {
      return { adapter, typeCode: '' };
    }
  }
  return null;
}
