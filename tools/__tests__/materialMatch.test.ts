import { normalizeMaterialName, levenshteinRatio, tokenSetRatio, fuzzyMatchMaterial } from '../materialMatch';

describe('normalizeMaterialName', () => {
  it('lowercases and trims', () => {
    expect(normalizeMaterialName('  Semen PC  ')).toBe('semen pc');
  });
  it('collapses whitespace', () => {
    expect(normalizeMaterialName('Semen   Portland    40kg')).toBe('semen portland 40kg');
  });
  it('strips punctuation except digits and units', () => {
    expect(normalizeMaterialName('Pasir, halus (Ex. Lumajang)')).toBe('pasir halus ex lumajang');
  });
  it('returns empty string for null/undefined', () => {
    expect(normalizeMaterialName(null)).toBe('');
    expect(normalizeMaterialName(undefined)).toBe('');
  });
});

describe('levenshteinRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinRatio('semen pc', 'semen pc')).toBe(1);
  });
  it('returns 0 for completely different strings of same length', () => {
    expect(levenshteinRatio('abcd', 'wxyz')).toBe(0);
  });
  it('returns high score for near-matches', () => {
    const score = levenshteinRatio('semen pc 40kg', 'semen pc 40 kg');
    expect(score).toBeGreaterThan(0.9);
  });
  it('handles empty strings', () => {
    expect(levenshteinRatio('', '')).toBe(1);
    expect(levenshteinRatio('abc', '')).toBe(0);
  });
});

describe('tokenSetRatio', () => {
  it('ignores word order', () => {
    expect(tokenSetRatio('semen pc 40kg', '40kg pc semen')).toBe(1);
  });
  it('penalizes missing tokens', () => {
    const score = tokenSetRatio('semen pc 40kg', 'semen pc');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});

describe('fuzzyMatchMaterial', () => {
  const catalog = [
    { id: '1', name: 'Semen Portland 40 kg' },
    { id: '2', name: 'Pasir halus Lumajang' },
    { id: '3', name: 'Kerikil beton 1-2 cm' },
  ];

  it('returns best match for a clean query', () => {
    const result = fuzzyMatchMaterial('Semen Portland 40kg', catalog);
    expect(result[0].id).toBe('1');
    expect(result[0].score).toBeGreaterThan(0.9);
  });

  it('returns empty array when no candidate scores >= 0.7', () => {
    const result = fuzzyMatchMaterial('cat food', catalog);
    expect(result).toEqual([]);
  });

  it('sorts candidates by score descending', () => {
    const result = fuzzyMatchMaterial('semen', catalog, 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
