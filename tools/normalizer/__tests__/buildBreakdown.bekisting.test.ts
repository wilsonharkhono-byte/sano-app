import { expandBekisting } from '../buildBreakdown';
import type { BlockSchema } from '../types';

const BEKISTING_BALOK_SCHEMA: BlockSchema = {
  blockId: 'Analisa!F55',
  blockType: 'bekisting',
  elementHint: 'Balok',
  cycleFactor: 4,
  ratioBasis: 'per_m2_form_per_cycle',
  rolledUpTotalPerNativeUnit: 251113,
  confidence: 'high',
  notes: null,
  subItems: [
    { materialName: 'Multipleks 15 mm',      specNote: '30x50 panjang 4 m', qtyPerNativeUnit: 2.00, nativeUnit: 'lbr', unitPrice: 200000, includedInRolledUpTotal: true },
    { materialName: 'Usuk 5/7 (vertikal)',   specNote: 'kayu',              qtyPerNativeUnit: 9.00, nativeUnit: 'btg', unitPrice: 47600,  includedInRolledUpTotal: true },
    { materialName: 'Usuk 5/7 (horizontal)', specNote: 'kayu',              qtyPerNativeUnit: 3.00, nativeUnit: 'btg', unitPrice: 47600,  includedInRolledUpTotal: true },
    { materialName: 'Paku',                  specNote: null,                qtyPerNativeUnit: 1.50, nativeUnit: 'kg',  unitPrice: 13000,  includedInRolledUpTotal: true },
    { materialName: 'Form oil',              specNote: null,                qtyPerNativeUnit: 0.50, nativeUnit: 'ltr', unitPrice: 27500,  includedInRolledUpTotal: true },
    { materialName: 'Perancah Bekisting Balok', specNote: 'sewa', qtyPerNativeUnit: 1.00, nativeUnit: 'm2', unitPrice: 150000, includedInRolledUpTotal: false },
  ],
};

describe('expandBekisting', () => {
  it('multiplies sub-item qty by ratioPerM3 / cycleFactor and skips items not in rolled-up total', () => {
    const rows = expandBekisting({ schema: BEKISTING_BALOK_SCHEMA, ratioPerM3: 10, volume: 0.2646 });
    expect(rows).toHaveLength(5); // Perancah excluded
    expect(rows[0]).toMatchObject({
      materialName: 'Multipleks 15 mm',
      qtyPerNativeUnit: 2.0,
      nativeUnit: 'lbr',
      unitPrice: 200000,
      qtyPerBoqUnit: 5.0,
      costPerBoqUnit: 1000000,
    });
    expect(rows[0].totalQty).toBeCloseTo(1.323, 3);
    expect(rows[0].totalCost).toBe(264600);
    expect(rows[1]).toMatchObject({ materialName: 'Usuk 5/7 (vertikal)',   qtyPerBoqUnit: 22.5 });
    expect(rows[2]).toMatchObject({ materialName: 'Usuk 5/7 (horizontal)', qtyPerBoqUnit: 7.5 });
    expect(rows[3]).toMatchObject({ materialName: 'Paku',                  qtyPerBoqUnit: 3.75 });
    expect(rows[4]).toMatchObject({ materialName: 'Form oil',              qtyPerBoqUnit: 1.25 });
  });

  it('returns empty array when schema has cycleFactor null', () => {
    const schema = { ...BEKISTING_BALOK_SCHEMA, cycleFactor: null };
    expect(expandBekisting({ schema, ratioPerM3: 10, volume: 0.2646 })).toEqual([]);
  });
});
