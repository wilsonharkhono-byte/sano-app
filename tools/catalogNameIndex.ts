// Build a normalized-name → catalog row lookup that never guesses on
// duplicate names.
//
// Several screens resolve a material by NAME rather than id — PO headers
// (TerimaScreen) and legacy imports carry no material_id, only the text the
// supplier/estimator typed. The catalog is known to carry duplicate/
// overlapping names during the transition (see MEMORY
// project_material_catalog_overlap), so a naive `Map.set` last-write-wins
// index silently id-links a receipt to an ARBITRARY duplicate row whenever
// two catalog rows share a normalized name — wrong material_id means the
// wrong material's envelope gets credited, and (for rebar) the wrong
// batang→kg factor gets applied at entry.
//
// Migration 055's own receipt_lines.material_id backfill already commits to
// the correct contract: link ONLY names that resolve to EXACTLY ONE catalog
// row; a name matching 2+ rows is deliberately left unlinked rather than
// guessed (055:56-73, "catalog has known duplicate names — never guess on
// ambiguity"). This helper gives every screen-side name lookup that same
// contract instead of each screen re-deriving (and potentially getting
// wrong) its own ad hoc Map.
//
// Deliberately NOT added to materialSelection.ts: that module's docstring
// scopes it to ONE concern — mapping an already-selected catalog row to the
// request-line fields PermintaanScreen writes. This helper solves a prior,
// different problem (turning a raw, possibly-duplicated catalog fetch into
// a safe name index before any row is "selected") and has its own callers
// (today TerimaScreen; conceptually any exact-name catalog lookup). Keeping
// it separate avoids growing materialSelection.ts past its stated purpose.

/** Case/whitespace normalization for catalog name matching — matches
 * migration 055's backfill predicate `lower(trim(name))` exactly, so a
 * screen-side lookup and the server-side backfill always agree on whether
 * two names are "the same". */
export function normalizeCatalogName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

/**
 * Index catalog rows by normalized name. A name shared by 2+ rows maps to
 * `null` — an explicit "ambiguous" sentinel — instead of whichever row
 * happened to be inserted last. A name absent from the catalog simply has
 * no entry (`.get` returns `undefined`). Callers should treat both cases
 * identically: no id link, no derived factor, never a guess.
 */
export function buildUnambiguousCatalogNameMap<T extends { name: string }>(
  rows: readonly T[],
): Map<string, T | null> {
  const map = new Map<string, T | null>();
  for (const row of rows) {
    const key = normalizeCatalogName(row.name);
    if (!key) continue; // blank/missing name — nothing to index
    map.set(key, map.has(key) ? null : row);
  }
  return map;
}
