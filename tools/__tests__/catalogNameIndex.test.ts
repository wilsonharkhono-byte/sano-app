import { buildUnambiguousCatalogNameMap, normalizeCatalogName } from '../catalogNameIndex';

interface Row {
  id: string;
  name: string;
}

describe('buildUnambiguousCatalogNameMap', () => {
  it('maps a unique name to its row', () => {
    const rows: Row[] = [{ id: 'mat-1', name: 'Besi D10' }];
    const map = buildUnambiguousCatalogNameMap(rows);
    expect(map.get('besi d10')).toEqual({ id: 'mat-1', name: 'Besi D10' });
  });

  it('maps a name shared by 2+ rows to null — never an arbitrary duplicate', () => {
    const rows: Row[] = [
      { id: 'mat-1', name: 'Semen 50kg' },
      { id: 'mat-2', name: 'Semen 50kg' },
    ];
    const map = buildUnambiguousCatalogNameMap(rows);
    expect(map.get('semen 50kg')).toBeNull();
  });

  it('collapses case/whitespace variants to the same normalized key', () => {
    const rows: Row[] = [
      { id: 'mat-1', name: '  Besi D10  ' },
      { id: 'mat-2', name: 'BESI d10' },
    ];
    const map = buildUnambiguousCatalogNameMap(rows);
    // Both rows normalize to the same key "besi d10" → ambiguous → null.
    expect(map.size).toBe(1);
    expect(map.get('besi d10')).toBeNull();
  });

  it('a query normalized the same way finds a uniquely-named row regardless of case/whitespace', () => {
    const rows: Row[] = [{ id: 'mat-1', name: 'Multipleks 18mm' }];
    const map = buildUnambiguousCatalogNameMap(rows);
    expect(map.get(normalizeCatalogName('  MULTIPLEKS 18mm  '))).toEqual({
      id: 'mat-1',
      name: 'Multipleks 18mm',
    });
  });

  it('returns an empty map for an empty catalog', () => {
    const map = buildUnambiguousCatalogNameMap([]);
    expect(map.size).toBe(0);
    expect(map.get('anything')).toBeUndefined();
  });

  it('skips rows with a blank/missing name rather than polluting the map with an empty key', () => {
    const rows: Row[] = [
      { id: 'mat-1', name: '' },
      { id: 'mat-2', name: '   ' },
    ];
    const map = buildUnambiguousCatalogNameMap(rows);
    expect(map.size).toBe(0);
  });

  it('a 3rd duplicate stays ambiguous (null), not "third time is a tiebreaker"', () => {
    const rows: Row[] = [
      { id: 'mat-1', name: 'Paku' },
      { id: 'mat-2', name: 'Paku' },
      { id: 'mat-3', name: 'Paku' },
    ];
    const map = buildUnambiguousCatalogNameMap(rows);
    expect(map.get('paku')).toBeNull();
  });
});

describe('normalizeCatalogName', () => {
  it('lowercases and trims — matches migration 055 backfill normalization (lower(trim(name)))', () => {
    expect(normalizeCatalogName('  Besi Beton D10  ')).toBe('besi beton d10');
  });

  it('handles null/undefined as empty string', () => {
    expect(normalizeCatalogName(null)).toBe('');
    expect(normalizeCatalogName(undefined)).toBe('');
  });
});
