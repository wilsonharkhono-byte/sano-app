// publishBaselineV2 imports ../supabase whose react-native polyfills jest
// can't parse — stub it (same pattern as publishBreakdownTrial.test.ts).
jest.mock('../supabase', () => ({ supabase: {} }));

import { normalizeComponentQty } from '../publishBaselineV2';

const D10 = { unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 };

describe('normalizeComponentQty', () => {
  it('kg-denominated rebar passes through untouched', () => {
    expect(normalizeComponentQty({ quantityPerUnit: 75.26, unit: 'kg' }, D10))
      .toEqual({ coefficient: 75.26, unit: 'kg', error: null });
  });

  it('batang-denominated rebar converts to kg via the factor', () => {
    const r = normalizeComponentQty({ quantityPerUnit: 2, unit: 'btg' }, D10);
    expect(r.error).toBeNull();
    expect(r.coefficient).toBeCloseTo(14.8, 10);
    expect(r.unit).toBe('kg');
  });

  it('batang-denominated with unresolved material errors (→ review), never guesses', () => {
    const r = normalizeComponentQty({ quantityPerUnit: 2, unit: 'batang' }, null);
    expect(r.error).toMatch(/batang/i);
    expect(r.coefficient).toBe(2); // untouched — caller must not use it as kg
  });

  it('batang-denominated with no factor errors (→ review)', () => {
    const r = normalizeComponentQty(
      { quantityPerUnit: 2, unit: 'batang' },
      { unit: 'kg', supplier_unit: 'kg', base_qty_per_supplier_unit: null },
    );
    expect(r.error).toMatch(/faktor/i);
  });

  it('btg component whose material base unit IS batang passes through (kayu usuk)', () => {
    const usuk = { unit: 'btg', supplier_unit: 'btg', base_qty_per_supplier_unit: null };
    expect(normalizeComponentQty({ quantityPerUnit: 9, unit: 'btg' }, usuk))
      .toEqual({ coefficient: 9, unit: 'btg', error: null });
  });

  it('missing unit passes through', () => {
    expect(normalizeComponentQty({ quantityPerUnit: 1.05 }, D10))
      .toEqual({ coefficient: 1.05, unit: '', error: null });
  });
});
