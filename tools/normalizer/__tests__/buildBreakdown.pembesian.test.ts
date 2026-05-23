import { expandPembesian } from '../buildBreakdown';
import type { BlockSchema } from '../types';

const PEMBESIAN_SCHEMA: BlockSchema = {
  blockId: 'Analisa!F128',
  blockType: 'pembesian',
  elementHint: null,
  cycleFactor: null,
  ratioBasis: 'per_kg_finished_rebar',
  rolledUpTotalPerNativeUnit: 9918,
  confidence: 'high',
  notes: null,
  subItems: [
    { materialName: 'Besi beton',    specNote: 'U24/U40', qtyPerNativeUnit: 1.05, nativeUnit: 'kg', unitPrice: 9000,  includedInRolledUpTotal: true },
    { materialName: 'Beton decking', specNote: 'spacer',  qtyPerNativeUnit: 1.00, nativeUnit: 'kg', unitPrice: 100,   includedInRolledUpTotal: true },
    { materialName: 'Bendrat',       specNote: '2%',      qtyPerNativeUnit: 0.02, nativeUnit: 'kg', unitPrice: 17500, includedInRolledUpTotal: true },
  ],
};

describe('expandPembesian', () => {
  it('produces per-diameter raw-priced lines + waste + decking + bendrat for D8 + D13', () => {
    const rows = expandPembesian({
      schema: PEMBESIAN_SCHEMA,
      diameters: [
        { diameter: 'D8',  qtyPerBoqUnit: 75.2587 },
        { diameter: 'D13', qtyPerBoqUnit: 91.9190 },
      ],
      volume: 0.2646,
    });

    expect(rows).toHaveLength(5);

    const d8 = rows.find((r) => r.materialName === 'Besi beton D8')!;
    expect(d8.qtyPerBoqUnit).toBeCloseTo(75.2587, 4);
    expect(d8.unitPrice).toBe(9000);
    expect(d8.totalQty).toBeCloseTo(19.9134, 3);

    const waste = rows.find((r) => r.materialName.includes('waste'))!;
    expect(waste.qtyPerBoqUnit).toBeCloseTo(8.3589, 3);
    expect(waste.unitPrice).toBe(9000);

    const decking = rows.find((r) => r.materialName === 'Beton decking')!;
    expect(decking.qtyPerBoqUnit).toBeCloseTo(167.1777, 3);
    expect(decking.unitPrice).toBe(100);

    const bendrat = rows.find((r) => r.materialName.includes('Bendrat'))!;
    expect(bendrat.qtyPerBoqUnit).toBeCloseTo(3.5107, 3);
    expect(bendrat.unitPrice).toBe(17500);
  });

  it('returns empty array when no diameters provided', () => {
    expect(expandPembesian({ schema: PEMBESIAN_SCHEMA, diameters: [], volume: 0.2646 })).toEqual([]);
  });
});
