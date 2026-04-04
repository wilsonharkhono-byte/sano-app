export interface MaterialNamingCatalogEntry {
  id: string;
  name: string;
  unit: string;
  code?: string | null;
  category?: string | null;
  tier?: 1 | 2 | 3 | null;
  supplier_unit?: string | null;
}

export interface MaterialCatalogSuggestion {
  entry: MaterialNamingCatalogEntry;
  score: number;
  reason: 'exact' | 'code' | 'substring' | 'token_overlap';
}

export function normalizeMaterialNamingInput(value?: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeMaterialNamingInput(value)
    .split(' ')
    .filter(token => token.length > 1);
}

function countIntersection(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  let hits = 0;
  for (const token of left) {
    if (rightSet.has(token)) hits += 1;
  }
  return hits;
}

export function findCatalogMaterialSuggestions(
  query: string,
  catalog: MaterialNamingCatalogEntry[],
  limit = 4,
): MaterialCatalogSuggestion[] {
  const normalizedQuery = normalizeMaterialNamingInput(query);
  if (!normalizedQuery) return [];

  const queryTokens = tokenize(normalizedQuery);
  const ranked: MaterialCatalogSuggestion[] = [];

  for (const entry of catalog) {
    const normalizedName = normalizeMaterialNamingInput(entry.name);
    const normalizedCode = normalizeMaterialNamingInput(entry.code ?? '');
    if (!normalizedName && !normalizedCode) continue;

    let score = 0;
    let reason: MaterialCatalogSuggestion['reason'] = 'token_overlap';

    if (normalizedName === normalizedQuery) {
      score = 1;
      reason = 'exact';
    } else if (normalizedCode && normalizedCode === normalizedQuery) {
      score = 0.99;
      reason = 'code';
    } else if (
      normalizedName.includes(normalizedQuery)
      || normalizedQuery.includes(normalizedName)
      || (normalizedCode && normalizedCode.includes(normalizedQuery))
    ) {
      score = 0.86;
      reason = 'substring';
    } else if (queryTokens.length > 0) {
      const nameTokens = tokenize(normalizedName);
      const overlap = countIntersection(queryTokens, nameTokens);
      if (overlap > 0) {
        const overlapRatio = overlap / Math.max(queryTokens.length, nameTokens.length, 1);
        const prefixBonus = queryTokens.some(queryToken =>
          nameTokens.some(nameToken =>
            nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken),
          ),
        )
          ? 0.16
          : 0;
        score = Math.min(0.82, overlapRatio * 0.9 + prefixBonus);
      }
    }

    if (score >= 0.34) {
      ranked.push({
        entry,
        score: Math.round(score * 100) / 100,
        reason,
      });
    }
  }

  return ranked
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.entry.name.localeCompare(right.entry.name, 'id', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

