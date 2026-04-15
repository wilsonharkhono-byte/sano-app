import { normalizeMaterialName, levenshteinRatio } from '../materialMatch';

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
