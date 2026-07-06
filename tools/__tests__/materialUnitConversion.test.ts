import {
  supplierToBase,
  baseToSupplierExact,
  baseToSupplierOrder,
  supplierUnitPrice,
  normalizeUnit,
  displayQty,
  toBaseQty,
} from '../materialUnitConversion';

const D10 = { unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 };
const SEMEN = { unit: 'zak', supplier_unit: 'zak', base_qty_per_supplier_unit: null };

describe('materialUnitConversion', () => {
  it('round-trips batang↔kg exactly', () => {
    expect(supplierToBase(14, 7.4)).toBeCloseTo(103.6, 10);
    expect(baseToSupplierExact(103.6, 7.4)).toBeCloseTo(14, 10);
  });

  it('null/zero factor is identity (1:1)', () => {
    expect(supplierToBase(5, null)).toBe(5);
    expect(baseToSupplierExact(5, undefined)).toBe(5);
    expect(baseToSupplierOrder(5, 0)).toBe(5);
    expect(supplierUnitPrice(9000, null)).toBe(9000);
  });

  it('ordering rounds UP to whole batang', () => {
    expect(baseToSupplierOrder(100, 7.4)).toBe(14); // 13.51 → 14
    expect(baseToSupplierOrder(103.6, 7.4)).toBe(14); // exact stays 14
    expect(baseToSupplierOrder(0, 7.4)).toBe(0);
  });

  it('converts per-kg price to per-batang', () => {
    expect(supplierUnitPrice(9000, 7.4)).toBeCloseTo(66600, 6);
  });

  it('normalizes batang spellings', () => {
    expect(normalizeUnit('btg')).toBe('batang');
    expect(normalizeUnit('Batang')).toBe('batang');
    expect(normalizeUnit(' LONJOR ')).toBe('batang');
    expect(normalizeUnit('kg')).toBe('kg');
    expect(normalizeUnit(null)).toBe('');
  });

  it('displayQty converts rebar, passes non-rebar through', () => {
    expect(displayQty(103.6, D10)).toEqual({
      qty: 14, unit: 'batang', baseQty: 103.6, baseUnit: 'kg', converted: true,
    });
    expect(displayQty(3, SEMEN)).toEqual({
      qty: 3, unit: 'zak', baseQty: 3, baseUnit: 'zak', converted: false,
    });
  });

  it('toBaseQty: batang input × factor → kg; kg passes through', () => {
    const rebar = toBaseQty(14, 'btg', D10);
    expect(rebar.ok).toBe(true);
    if (rebar.ok) {
      expect(rebar.qtyBase).toBeCloseTo(103.6, 10);
      expect(rebar.converted).toBe(true);
    }
    expect(toBaseQty(50, 'kg', D10)).toEqual({ ok: true, qtyBase: 50, converted: false });
    expect(toBaseQty(3, 'zak', SEMEN)).toEqual({ ok: true, qtyBase: 3, converted: false });
  });

  it('toBaseQty: batang input with no factor is an ERROR, never guessed', () => {
    const res = toBaseQty(14, 'batang', SEMEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/batang/i);
  });
});
