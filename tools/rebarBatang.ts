// Fixed kg↔batang conversion factors for besi beton (rebar).
//
// Provenance: SNI theoretical weight for nominal diameter d (steel density
// 7850 kg/m³): kg/m = 0.006165 × d². Standard Indonesian lonjor = 12 m.
// kg per batang = kg/m × 12, rounded to 2 dp — these are the FIXED contract
// values stored in material_catalog.base_qty_per_supplier_unit (migration
// 052). Change them here and in the DB in lockstep, or not at all.

export const BATANG_LENGTH_M = 12;

/** SNI theoretical weight (kg/m) by nominal diameter (mm). */
export const REBAR_KG_PER_M: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  13: 1.042,
  16: 1.578,
  19: 2.226,
  22: 2.984,
  25: 3.853,
  29: 5.185,
  32: 6.313,
};

/** kg per 12 m batang by nominal diameter (mm), 2 dp. */
export const REBAR_KG_PER_BATANG: Record<number, number> = Object.fromEntries(
  Object.entries(REBAR_KG_PER_M).map(([dia, kgPerM]) => [
    Number(dia),
    Math.round(kgPerM * BATANG_LENGTH_M * 100) / 100,
  ]),
);

/** Catalog code → diameter for the 10 rebar rows (kg-estimated, batang-ordered). */
const DIAMETER_BY_CODE: Record<string, number> = {
  'REB-PL06': 6,
  'REB-PL08': 8,
  'REB-DE10': 10,
  'REB-PL10': 10,
  'REB-PL12': 12,
  'REB-DE13': 13,
  'REB-DE16': 16,
  'REB-DE19': 19,
  'REB-DE22': 22,
  'REB-DE25': 25,
  'REB-DE29': 29,
  'REB-DE32': 32,
};

/** kg-per-batang for a catalog code, or null if the code is not a rebar bar. */
export function rebarFactorByCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const dia = DIAMETER_BY_CODE[code];
  return dia != null ? REBAR_KG_PER_BATANG[dia] : null;
}

// Matches the diameter token in workbook component names: "Besi D8",
// "Besi beton D-10", "Besi beton P-12", "Besi Tulangan Ø16". Requires a
// non-alphanumeric char (or start) before D/P/Ø so "PAD-6" etc. don't match.
const DIAMETER_TOKEN_RE = /(?:^|[^a-z0-9])[dpøØ]\s?-?\s?(6|8|10|12|13|16|19|22|25|29|32)(?![0-9])/i;

/**
 * kg-per-batang from a workbook component name (used where no catalog id is
 * available, e.g. RecipeView / takeoff rollups). Only matches explicit
 * D/P/Ø-diameter tokens; catalog-style names ("Besi beton ulir 16 mm") and
 * derived lines (waste/decking/bendrat) return null — resolve those by code.
 */
export function rebarFactorByName(name: string | null | undefined): number | null {
  if (!name || !/besi/i.test(name)) return null;
  const m = DIAMETER_TOKEN_RE.exec(name);
  return m ? REBAR_KG_PER_BATANG[Number(m[1])] ?? null : null;
}

/** The 10 (code, factor) pairs — the single source the data tasks seed from. */
export const REBAR_CATALOG_FACTORS: Array<{ code: string; kgPerBatang: number }> =
  Object.entries(DIAMETER_BY_CODE).map(([code, dia]) => ({
    code,
    kgPerBatang: REBAR_KG_PER_BATANG[dia],
  }));
