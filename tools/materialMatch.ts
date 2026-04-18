export function normalizeMaterialName(input: string | null | undefined): string {
  if (input == null) return '';
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(normalizeMaterialName(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeMaterialName(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

export interface FuzzyMatchCandidate {
  id: string;
  name: string;
  score: number;
}

export interface CatalogMatchRow {
  id: string;
  name: string;
}

export function fuzzyMatchMaterial(
  query: string,
  catalog: CatalogMatchRow[],
  threshold = 0.7,
): FuzzyMatchCandidate[] {
  const qNorm = normalizeMaterialName(query);
  const scored = catalog
    .map(row => {
      const rNorm = normalizeMaterialName(row.name);
      const lev = levenshteinRatio(qNorm, rNorm);
      const tok = tokenSetRatio(qNorm, rNorm);
      return { id: row.id, name: row.name, score: Math.max(lev, tok) };
    })
    .filter(c => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return scored;
}
