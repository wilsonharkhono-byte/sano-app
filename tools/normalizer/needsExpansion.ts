// tools/normalizer/needsExpansion.ts
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';

const PATTERNS = [/^Bekisting/i, /^Pembesian/i, /^Pengecoran Beton/i];

export function needsExpansion(row: BoqRowV2): boolean {
  if (!row.recipe) return false;
  for (const c of row.recipe.components) {
    if (c.quantityPerUnit * c.unitPrice === 0) return true;
    if (c.referencedBlockTitle && PATTERNS.some((re) => re.test(c.referencedBlockTitle!))) return true;
  }
  return false;
}
