// tools/normalizer/needsExpansion.ts
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';

const PATTERNS = [/^Bekisting/i, /^Pembesian/i, /^Pengecoran Beton/i];

// Finishing blocks (plesteran, acian) reference an Analisa block via two
// non-zero recipe lumps (one material, one labor) that BOTH point at the
// block's Jumlah row. They never trip the zero-cost branch and their title
// isn't structural, so without this they'd be silently excluded — leaving
// the user with no Semen / Pasir / Upah detail. The direct-ref tier expands
// these block jumlah-row lumps into itemized sub-items (see
// expandDirectRefBlocks in cli-deterministic.ts).
const FINISHING_PATTERNS = [/Plesteran/i, /Acian/i];

export function needsExpansion(row: BoqRowV2): boolean {
  if (!row.recipe) return false;
  for (const c of row.recipe.components) {
    if (c.quantityPerUnit * c.unitPrice === 0) return true;
    if (c.referencedBlockTitle && PATTERNS.some((re) => re.test(c.referencedBlockTitle!))) return true;
    if (c.referencedBlockTitle && FINISHING_PATTERNS.some((re) => re.test(c.referencedBlockTitle!))) return true;
  }
  return false;
}
