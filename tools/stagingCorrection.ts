// Pure helpers for the import-review "Koreksi" editor (BaselineScreen).
//
// An import_staging_rows.parsed_data mixes two kinds of field: SCALARS the
// estimator may correct by hand (label, planned, unit, harga …) and STRUCTURAL
// payload the parser produced (`recipe`, with its per-material components).
// The editor is a flat list of text inputs, so it can only ever edit scalars.
//
// Before this module the editor rendered EVERY key: `recipe` was stringified
// into the draft as "[object Object]" and written straight back on save, so one
// correction replaced a row's whole recipe with a string. Publish then read
// `recipe?.components ?? []` off that string, got nothing, and published the
// row with zero material lines — a silent hole of exactly the kind CLAUDE.md
// §1.1 forbids. Structural fields are therefore neither shown nor written: they
// are carried through untouched.

/** A value the flat text/dropdown editor can faithfully round-trip. */
function isScalarField(value: unknown): boolean {
  return value === null || value === undefined
    || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * The parsed_data keys the correction editor may render, in their original
 * order. Object/array-valued keys (recipe, cost splits, …) are excluded.
 */
export function editableParsedFields(parsed: Record<string, unknown>): string[] {
  return Object.entries(parsed).filter(([, v]) => isScalarField(v)).map(([k]) => k);
}

/** Seed the editor's draft: every editable field as the text the user sees. */
export function draftFromParsedData(parsed: Record<string, unknown>): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const key of editableParsedFields(parsed)) {
    const value = parsed[key];
    draft[key] = value == null ? '' : String(value);
  }
  return draft;
}

/**
 * Merge the editor's draft back into parsed_data, typed by what the ORIGINAL
 * value was (a numeric field stays numeric, a boolean stays boolean) so the
 * corrected row keeps the shape publish expects.
 *
 * Rules that keep a correction from destroying data:
 * - structural (object/array) fields are copied through verbatim;
 * - a key absent from the draft keeps its previous value — "not edited" is not
 *   the same as "cleared" (the editor sends '' for a field the user emptied);
 * - a key present only in the draft is dropped, so an edit cannot invent
 *   fields the row never had;
 * - an unparseable number keeps the previous number rather than becoming NaN.
 */
export function applyCorrectionDraft(
  original: Record<string, unknown>,
  draft: Record<string, string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) {
    if (!isScalarField(value) || !(key in draft)) {
      next[key] = value;
      continue;
    }
    const draftValue = draft[key] ?? '';
    if (value === null || value === undefined) {
      next[key] = draftValue.trim() === '' ? null : draftValue;
    } else if (typeof value === 'number') {
      const parsed = Number(draftValue.trim().replace(',', '.'));
      next[key] = Number.isFinite(parsed) ? parsed : value;
    } else if (typeof value === 'boolean') {
      next[key] = ['true', '1', 'ya', 'yes'].includes(draftValue.trim().toLowerCase());
    } else {
      next[key] = draftValue;
    }
  }
  return next;
}
