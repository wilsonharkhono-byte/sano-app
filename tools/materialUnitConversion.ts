// Boundary conversions between a material's BASE unit (what estimation, gates,
// envelopes, and every stored quantity use — kg for rebar) and its SUPPLIER
// unit (what humans order — batang for rebar).
//
// factor = material_catalog.base_qty_per_supplier_unit = base units per ONE
// supplier unit (kg per batang). null/0/absent ⇒ 1:1, all functions identity.
//
// Truth contract: gates and persistence always receive BASE quantities;
// supplier units exist only at input/display boundaries. A supplier-unit
// input without a factor is an error, never a silent pass-through.

export interface MaterialUnitInfo {
  unit: string;
  supplier_unit?: string | null;
  base_qty_per_supplier_unit?: number | null;
}

function factorOrNull(factor: number | null | undefined): number | null {
  return typeof factor === 'number' && isFinite(factor) && factor > 0 ? factor : null;
}

/** Supplier qty (batang) → base qty (kg). Identity without a factor. */
export function supplierToBase(qtySupplier: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? qtySupplier : qtySupplier * f;
}

/** Base qty (kg) → exact supplier qty (fractional batang, for display). */
export function baseToSupplierExact(qtyBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? qtyBase : qtyBase / f;
}

/** Base qty (kg) → whole supplier units, rounded UP (you can't buy 0.4 rod). */
export function baseToSupplierOrder(qtyBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  if (f == null) return qtyBase;
  // Guard float dust: 103.60000000000001 / 7.4 must not ceil 14 → 15.
  // Math.max also normalizes the -0 that Math.ceil(-1e-9) yields for qty 0.
  return Math.max(0, Math.ceil(qtyBase / f - 1e-9));
}

/** Price per base unit (Rp/kg) → price per supplier unit (Rp/batang). */
export function supplierUnitPrice(pricePerBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? pricePerBase : pricePerBase * f;
}

const BATANG_SPELLINGS = new Set(['btg', 'batang', 'lonjor']);

/** Normalize a raw unit string; all batang spellings collapse to 'batang'. */
export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? '').trim().toLowerCase();
  return BATANG_SPELLINGS.has(u) ? 'batang' : u;
}

/**
 * THE display entry point: convert a stored base quantity to what the UI
 * shows. Rebar (has factor) → batang with kg kept alongside; everything else
 * passes through. No screen converts on its own.
 */
export function displayQty(
  qtyBase: number,
  material: MaterialUnitInfo,
): { qty: number; unit: string; baseQty: number; baseUnit: string; converted: boolean } {
  const f = factorOrNull(material.base_qty_per_supplier_unit);
  if (f == null) {
    return { qty: qtyBase, unit: material.unit, baseQty: qtyBase, baseUnit: material.unit, converted: false };
  }
  const qty = Math.round((qtyBase / f) * 100) / 100;
  return {
    qty,
    unit: material.supplier_unit || 'batang',
    baseQty: qtyBase,
    baseUnit: material.unit,
    converted: true,
  };
}

/**
 * THE ingest entry point: normalize an input quantity to the material's base
 * unit. Batang-denominated input needs a factor; without one it is an error
 * routed to review — never treated as kg, never guessed.
 */
export function toBaseQty(
  qty: number,
  rawUnit: string | null | undefined,
  material: MaterialUnitInfo,
): { ok: true; qtyBase: number; converted: boolean } | { ok: false; error: string } {
  const unit = normalizeUnit(rawUnit);
  if (unit !== 'batang') {
    return { ok: true, qtyBase: qty, converted: false };
  }
  const f = factorOrNull(material.base_qty_per_supplier_unit);
  if (f == null) {
    return {
      ok: false,
      error: `qty dalam batang tapi material "${material.unit}" tidak punya faktor kg/batang — perlu review manual`,
    };
  }
  return { ok: true, qtyBase: qty * f, converted: true };
}
