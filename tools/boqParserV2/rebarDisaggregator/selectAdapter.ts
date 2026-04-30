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
