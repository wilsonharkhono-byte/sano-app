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
 * coefficient = lonjor per beton-m³, so master_planned = betonM3 × coefficient
 * = the original whole-lonjor count (in batang, before publish's batang→kg
 * conversion). unitPrice 0 (Tier-1 material cost untracked).
 */
export function buildRebarComponent(
  diameter: number,
  lonjor: number,
  betonM3: number,
  sourceSheet: string,
  sourceAddress: string,
): RecipeComponent {
  const name = REBAR_NAME_BY_DIAMETER[diameter];
  if (!name) throw new Error(`No rebar name mapping for diameter ${diameter}`);
  const quantityPerUnit = betonM3 > 0 ? lonjor / betonM3 : 0;
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
