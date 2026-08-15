import type { RecipeComponent } from '../boqParserV2/types';

/**
 * File rebar diameter (mm) → a natural material name.
 *
 * These match the curated catalogue's rebar rows (`Besi beton {polos|ulir} N mm`,
 * unit kg, supplier_unit batang + a batang→kg factor). The parser emits the
 * quantity in BATANG; publish's normalizeComponentQty converts batang→kg for
 * storage via the catalogue factor, and SANO displays/orders back in batang.
 * Names are resolved through the exact→alias→fuzzy matcher, so a slightly
 * different catalogue naming still binds (the parser stays "broad"); an
 * unresolved diameter is flagged for review, never guessed.
 */
export const REBAR_NAME_BY_DIAMETER: Record<number, string> = {
  8: 'Besi beton polos 8 mm',
  10: 'Besi beton ulir 10 mm',
  13: 'Besi beton ulir 13 mm',
  16: 'Besi beton ulir 16 mm',
  19: 'Besi beton ulir 19 mm',
  22: 'Besi beton ulir 22 mm',
};

/** Tier-1 sheet's fixed rebar columns C–H, in diameter order. */
export const REBAR_COLUMNS: Array<{ col: string; diameter: number }> = [
  { col: 'C', diameter: 8 },
  { col: 'D', diameter: 10 },
  { col: 'E', diameter: 13 },
  { col: 'F', diameter: 16 },
  { col: 'G', diameter: 19 },
  { col: 'H', diameter: 22 },
];

/**
 * One rebar diameter of one work area → a recipe component in batang.
 * coefficient = lonjor per unit of the row's planned basis, so
 * master_planned = planned × coefficient = the original whole-lonjor count (in
 * batang, before publish's batang→kg conversion). The basis is the beton m³ for
 * a normal work area and 1 for a rebar-only one staged as a lump sum (see
 * tier1.ts). unitPrice 0 (Tier-1 material cost untracked).
 *
 * A non-positive basis is refused rather than silently yielding coefficient 0:
 * that is how a rebar-only work area's ~9,200 kg of steel used to disappear
 * from every envelope with no signal (CLAUDE.md §1.1 — absent beats wrong).
 */
export function buildRebarComponent(
  diameter: number,
  lonjor: number,
  plannedBasis: number,
  sourceSheet: string,
  sourceAddress: string,
): RecipeComponent {
  const name = REBAR_NAME_BY_DIAMETER[diameter];
  if (!name) throw new Error(`No rebar name mapping for diameter ${diameter}`);
  if (!(plannedBasis > 0)) {
    throw new Error(
      `Rebar component ø${diameter} at ${sourceSheet}!${sourceAddress} has a non-positive planned basis (${plannedBasis}) — the caller must stage a positive basis`,
    );
  }
  const quantityPerUnit = lonjor / plannedBasis;
  return {
    sourceCell: { sheet: sourceSheet, address: sourceAddress },
    referencedCell: { sheet: sourceSheet, address: sourceAddress },
    referencedBlockTitle: null,
    referencedBlockRow: null,
    quantityPerUnit,
    unitPrice: 0,
    costContribution: 0,
    lineType: 'material',
    confidence: 1,
    unit: 'batang',
    materialName: name,
  };
}
