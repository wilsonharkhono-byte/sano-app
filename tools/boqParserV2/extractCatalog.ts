import type { HarvestedCell } from './types';
import { toNumber } from './classifyComponent';

export interface CatalogRow {
  code: string;
  name: string;
  unit: string;
  reference_unit_price: number;
  sourceRow: number;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  return toNumber(c.value);
}

export function extractCatalogRows(
  cells: HarvestedCell[],
  sheetNames: string[],
): CatalogRow[] {
  const out: CatalogRow[] = [];
  for (const sheet of sheetNames) {
    const byRow = new Map<number, Map<string, HarvestedCell>>();
    for (const c of cells) {
      if (c.sheet !== sheet) continue;
      const colLetter = c.address.replace(/\d+/g, '');
      const map = byRow.get(c.row) ?? new Map();
      map.set(colLetter, c);
      byRow.set(c.row, map);
    }
    for (const [row, map] of byRow) {
      if (row === 1) continue; // skip header
      const code = cellText(map.get('A'));
      const name = cellText(map.get('B'));
      const unit = cellText(map.get('C'));
      const price = cellNumber(map.get('D'));
      if (!code) continue;
      out.push({ code, name, unit, reference_unit_price: price, sourceRow: row });
    }
  }
  return out;
}
