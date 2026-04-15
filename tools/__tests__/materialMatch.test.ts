import { normalizeMaterialName } from '../materialMatch';

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
