// tools/normalizer/__tests__/buildRowBreakdown.test.ts
import { buildRowBreakdown } from '../buildBreakdown';
import type { RowExpansionInput } from '../types';

const INPUT: RowExpansionInput = {
  boqCode: 'IV.A.2.7',
  description: '- Balok B24-1',
  unit: 'm3',
  volume: 0.2646,
  sourceUnitCost: 6839679,
  sourceLineTotal: 1809779,
  bekistingSchema: {
    blockId: 'Analisa!F55', blockType: 'bekisting', elementHint: 'Balok',
    cycleFactor: 4, ratioBasis: 'per_m2_form_per_cycle',
    rolledUpTotalPerNativeUnit: 251113, confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Multipleks 15 mm',      specNote: '30x50', qtyPerNativeUnit: 2.0, nativeUnit: 'lbr', unitPrice: 200000, includedInRolledUpTotal: true },
      { materialName: 'Usuk 5/7 (vertikal)',   specNote: 'kayu',  qtyPerNativeUnit: 9.0, nativeUnit: 'btg', unitPrice: 47600,  includedInRolledUpTotal: true },
      { materialName: 'Usuk 5/7 (horizontal)', specNote: 'kayu',  qtyPerNativeUnit: 3.0, nativeUnit: 'btg', unitPrice: 47600,  includedInRolledUpTotal: true },
      { materialName: 'Paku',                  specNote: null,    qtyPerNativeUnit: 1.5, nativeUnit: 'kg',  unitPrice: 13000,  includedInRolledUpTotal: true },
      { materialName: 'Form oil',              specNote: null,    qtyPerNativeUnit: 0.5, nativeUnit: 'ltr', unitPrice: 27500,  includedInRolledUpTotal: true },
      { materialName: 'Perancah Bekisting Balok', specNote: 'sewa', qtyPerNativeUnit: 1.0, nativeUnit: 'm2', unitPrice: 150000, includedInRolledUpTotal: false },
    ],
  },
  bekistingRatioPerM3: 10,
  pembesianSchema: {
    blockId: 'Analisa!F128', blockType: 'pembesian', elementHint: null,
    cycleFactor: null, ratioBasis: 'per_kg_finished_rebar',
    rolledUpTotalPerNativeUnit: 9918, confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Besi beton',    specNote: 'U24/U40', qtyPerNativeUnit: 1.05, nativeUnit: 'kg', unitPrice: 9000,  includedInRolledUpTotal: true },
      { materialName: 'Beton decking', specNote: 'spacer',  qtyPerNativeUnit: 1.00, nativeUnit: 'kg', unitPrice: 100,   includedInRolledUpTotal: true },
      { materialName: 'Bendrat',       specNote: '2%',      qtyPerNativeUnit: 0.02, nativeUnit: 'kg', unitPrice: 17500, includedInRolledUpTotal: true },
    ],
  },
  pembesianKgPerM3: 167.1777,
  pembesianDiameters: [
    { diameter: 'D8',  qtyPerBoqUnit: 75.2587 },
    { diameter: 'D13', qtyPerBoqUnit: 91.9190 },
  ],
  concreteSchema: {
    blockId: 'Analisa!F103', blockType: 'concrete', elementHint: 'Balok',
    cycleFactor: null, ratioBasis: 'per_m3_concrete',
    rolledUpTotalPerNativeUnit: 2670570, confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Beton readymix K-350',  specNote: 'slump', qtyPerNativeUnit: 1.05, nativeUnit: 'm3', unitPrice: 1043400, includedInRolledUpTotal: true },
      { materialName: 'Sewa peralatan',        specNote: null,    qtyPerNativeUnit: 1.00, nativeUnit: 'm3', unitPrice: 75000,   includedInRolledUpTotal: true },
      { materialName: 'Upah cor, besi, bekisting borongan', specNote: null, qtyPerNativeUnit: 1.00, nativeUnit: 'm3', unitPrice: 1500000, includedInRolledUpTotal: true },
    ],
  },
};

describe('buildRowBreakdown', () => {
  it('produces 13 components matching spec Appendix A for IV.A.2.7', () => {
    const result = buildRowBreakdown(INPUT);
    expect(result.components).toHaveLength(13);
    expect(result.boqCode).toBe('IV.A.2.7');
    expect(result.volume).toBe(0.2646);
    expect(result.sourceSheet).toBe('Breakdown IV.A.2.7');

    // Sum of cost/m³ should be Rp 6,839,679 within ±10 Rp (rounding noise from 13 components)
    const sumUnitCost = result.components.reduce((s, c) => s + c.costPerBoqUnit, 0);
    expect(Math.abs(sumUnitCost - 6839679)).toBeLessThanOrEqual(10);

    // Reconciles flag should be true (line total within tolerance scaling with N)
    expect(result.reconciliation.reconciles).toBe(true);
  });

  it('emits only concrete when bekisting and pembesian schemas absent', () => {
    const input: RowExpansionInput = {
      ...INPUT,
      bekistingSchema: null,
      bekistingRatioPerM3: null,
      pembesianSchema: null,
      pembesianDiameters: [],
    };
    const result = buildRowBreakdown(input);
    expect(result.components).toHaveLength(3); // just the 3 concrete sub-items
  });
});
