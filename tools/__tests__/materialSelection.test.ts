import { applyCatalogMaterialToLine } from '../materialSelection';
import { supplierToBase } from '../materialUnitConversion';

// Rebar-shaped catalog row: ordered in batang, stored/gated in kg.
const REBAR_D10 = {
  id: 'mat-d10',
  name: 'Besi D10',
  unit: 'kg',
  supplier_unit: 'batang',
  tier: 1 as const,
  code: 'BSI-D10',
  category: 'Besi',
  base_qty_per_supplier_unit: 6.31,
};

// 1:1 material — no supplier/base split (e.g. semen dijual per zak = 1 zak).
const SEMEN = {
  id: 'mat-semen',
  name: 'Semen 50kg',
  unit: 'zak',
  supplier_unit: 'zak',
  tier: 3 as const,
  code: 'SMN-50',
  category: 'Semen',
  base_qty_per_supplier_unit: null,
};

describe('applyCatalogMaterialToLine', () => {
  it('carries the batang→kg factor for a rebar catalog row (the assist-path bug)', () => {
    const patch = applyCatalogMaterialToLine(REBAR_D10);

    expect(patch.base_qty_per_supplier_unit).toBe(6.31);
    expect(patch.baseUnit).toBe('kg');
    expect(patch.unit).toBe('batang');

    // The whole point: 6 batang must NOT be stored as 6 kg.
    const stored = supplierToBase(6, patch.base_qty_per_supplier_unit);
    expect(stored).not.toBe(6);
    expect(stored).toBeCloseTo(37.86, 6);
  });

  it('leaves conversion as identity for a 1:1 material (no factor)', () => {
    const patch = applyCatalogMaterialToLine(SEMEN);

    expect(patch.base_qty_per_supplier_unit).toBeNull();
    expect(patch.baseUnit).toBe('zak');
    expect(patch.unit).toBe('zak');

    const stored = supplierToBase(3, patch.base_qty_per_supplier_unit);
    expect(stored).toBe(3);
  });

  it('matches the exact field set the picker path (applyMaterialSelection) produced', () => {
    // Regression pin: this is byte-for-byte what
    // workflows/screens/PermintaanScreen.tsx's applyMaterialSelection used to
    // build inline before it was extracted into this shared helper.
    const patch = applyCatalogMaterialToLine(REBAR_D10);

    expect(patch).toEqual({
      materialId: 'mat-d10',
      materialName: 'Besi D10',
      isCustom: false,
      tier: 1,
      unit: 'batang',
      baseUnit: 'kg',
      base_qty_per_supplier_unit: 6.31,
      boqItemId: null,
      workGroupKey: null,
      lineResult: null,
      allocationPreview: [],
    });
  });

  it('falls back unit to the base unit when supplier_unit is absent', () => {
    const noSupplierUnit = { ...SEMEN, supplier_unit: '' };
    const patch = applyCatalogMaterialToLine(noSupplierUnit);
    expect(patch.unit).toBe('zak');
  });

  it('defaults tier to 3 when the catalog row has no tier (assist-path fallback)', () => {
    const untiered = { ...SEMEN, tier: null };
    const patch = applyCatalogMaterialToLine(untiered);
    expect(patch.tier).toBe(3);
  });
});
