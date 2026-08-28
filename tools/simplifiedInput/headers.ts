/**
 * How a header cell's text is turned into label candidates for matching.
 *
 * Shared by every simplified-input sheet reader so "what counts as the same
 * header label" has exactly ONE definition. Matching against the candidates is
 * always EXACT (never substring): substring matching would let "Total Harga"
 * claim the price column and "Harga Satuan" claim the unit column, which is
 * precisely the silent mis-read this style exists to prevent.
 */

/** Lowercase, collapse punctuation and repeated spaces. "/" is kept ("harga/satuan"). */
export function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The label spellings a header cell offers for matching: as written, and with a
 * trailing parenthesized annotation stripped — "Volume (m3)" and "Harga Satuan
 * (Rp)" are routine estimator edits that must not degrade the parse to
 * volume/price null. Only a TRAILING "(…)" is stripped; anything else stays
 * exact so "Total Harga" still cannot claim the price column.
 */
export function headerCandidates(raw: string): string[] {
  const full = normalizeHeader(raw);
  const stripped = normalizeHeader(raw.replace(/\s*\([^)]*\)\s*$/, ''));
  return stripped && stripped !== full ? [full, stripped] : [full];
}
