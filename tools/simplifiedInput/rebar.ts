import type { RecipeComponent } from '../boqParserV2/types';

/**
 * File rebar diameter (mm) → the ISOLATED batang catalog row it links to.
 * Names are the EXACT catalog names inserted by migration 082 so
 * reconcileMaterials' exact-match tier links them to the batang rows, never
 * the near-identical kg rows (see spec §5.4). Only the six diameters the
 * simplified format uses are mapped.
 */
export const REBAR_BATANG_BY_DIAMETER: Record<number, { code: string; name: string }> = {
  8: { code: 'REB-PL08-BTG', name: 'Besi beton polos 8 mm (batang)' },
  10: { code: 'REB-DE10-BTG', name: 'Besi beton ulir 10 mm (batang)' },
  13: { code: 'REB-DE13-BTG', name: 'Besi beton ulir 13 mm (batang)' },
  16: { code: 'REB-DE16-BTG', name: 'Besi beton ulir 16 mm (batang)' },
  19: { code: 'REB-DE19-BTG', name: 'Besi beton ulir 19 mm (batang)' },
  22: { code: 'REB-DE22-BTG', name: 'Besi beton ulir 22 mm (batang)' },
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
 * = the original whole-lonjor count. unitPrice 0 (Tier-1 material cost untracked).
 */
export function buildRebarComponent(
  diameter: number,
  lonjor: number,
  betonM3: number,
  sourceSheet: string,
  sourceAddress: string,
): RecipeComponent {
  const target = REBAR_BATANG_BY_DIAMETER[diameter];
  if (!target) throw new Error(`No batang rebar mapping for diameter ${diameter}`);
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
    materialName: target.name,
  };
}
