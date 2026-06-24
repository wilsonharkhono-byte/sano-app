jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
import { mapPriceBookRows } from '../priceBookIngest';

describe('mapPriceBookRows', () => {
  it('maps clean rows', () => {
    const { records, unresolved } = mapPriceBookRows([
      { material: 'Besi D8', unit: 'kg', unit_price: 9000, tier: 1 },
      { material: 'Cat tembok', unit: 'ltr', unit_price: 85000, tier: 3 },
    ]);
    expect(unresolved).toHaveLength(0);
    expect(records[0]).toEqual({ material_name: 'Besi D8', unit: 'kg', unit_price: 9000, tier: 1 });
  });

  it('routes rows with no price to unresolved, never guesses', () => {
    const { records, unresolved } = mapPriceBookRows([{ material: 'Pasir', unit: 'm3', tier: 2 }]);
    expect(records).toHaveLength(0);
    expect(unresolved[0].reason).toMatch(/price/i);
  });

  it('routes rows with an out-of-range tier to unresolved', () => {
    const { unresolved } = mapPriceBookRows([{ material: 'Lakban', unit: 'roll', unit_price: 15000, tier: 9 }]);
    expect(unresolved[0].reason).toMatch(/tier/i);
  });
});
