import { expandConcrete } from '../buildBreakdown';
import type { BlockSchema } from '../types';

const CONCRETE_SCHEMA: BlockSchema = {
  blockId: 'Analisa!F103',
  blockType: 'concrete',
  elementHint: 'Balok',
  cycleFactor: null,
  ratioBasis: 'per_m3_concrete',
  rolledUpTotalPerNativeUnit: 2670570,
  confidence: 'high',
  notes: null,
  subItems: [
    { materialName: 'Beton readymix K-350',  specNote: 'slump 18 ± 2 cm', qtyPerNativeUnit: 1.05, nativeUnit: 'm3', unitPrice: 1043400, includedInRolledUpTotal: true },
    { materialName: 'Sewa peralatan',        specNote: 'vibrator + pump', qtyPerNativeUnit: 1.00, nativeUnit: 'm3', unitPrice: 75000,   includedInRolledUpTotal: true },
    { materialName: 'Upah cor, besi, bekisting borongan', specNote: null, qtyPerNativeUnit: 1.00, nativeUnit: 'm3', unitPrice: 1500000, includedInRolledUpTotal: true },
  ],
};

describe('expandConcrete', () => {
  it('emits readymix as material (qty 1.05), labor and equipment with correct groups', () => {
    const rows = expandConcrete({ schema: CONCRETE_SCHEMA, volume: 0.2646 });
    expect(rows).toHaveLength(3);

    const readymix = rows.find((r) => r.materialName.startsWith('Beton readymix'))!;
    expect(readymix.group).toBe('material');
    expect(readymix.qtyPerNativeUnit).toBeCloseTo(1.05, 4);
    expect(readymix.qtyPerBoqUnit).toBeCloseTo(1.05, 4);
    expect(readymix.unitPrice).toBe(1043400);
    expect(readymix.totalQty).toBeCloseTo(0.2778, 4);

    const equip = rows.find((r) => /Sewa peralatan/i.test(r.materialName))!;
    expect(equip.group).toBe('equipment');
    expect(equip.unitPrice).toBe(75000);

    const labor = rows.find((r) => /Upah/i.test(r.materialName))!;
    expect(labor.group).toBe('labor');
    expect(labor.unitPrice).toBe(1500000);
  });
});
