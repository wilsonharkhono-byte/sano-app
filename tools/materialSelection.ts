// The single mapping from "user picked this catalog material" to the request
// line fields it should populate. PermintaanScreen has two call sites that
// apply a catalog material to a request line — the material picker
// (`applyMaterialSelection`) and the MaterialNamingAssist "use this catalog
// match" callback. They used to duplicate this mapping inline, and the
// assist path silently dropped `baseUnit` / `base_qty_per_supplier_unit`.
// For rebar (ordered in batang, stored/gated in kg) that meant
// `supplierToBase` in materialUnitConversion.ts had no factor to convert
// with, so a typed batang count was written straight into
// material_request_lines.quantity as if it were kg — a 2.7-75.8x
// under-count that let the Tier-1 envelope gate pass wrongly.
//
// Route both call sites through this helper so they cannot drift apart
// again.

export interface CatalogMaterialForSelection {
  id: string;
  name: string;
  unit: string;
  supplier_unit?: string | null;
  tier?: 1 | 2 | 3 | 4 | null;
  /** Base units per ONE supplier_unit (kg per batang for rebar). null = 1:1. */
  base_qty_per_supplier_unit?: number | null;
}

export interface CatalogMaterialSelectionPatch {
  materialId: string;
  materialName: string;
  isCustom: false;
  tier: 1 | 2 | 3 | 4;
  /** Typed/displayed in SUPPLIER units (batang for rebar). */
  unit: string;
  /** The material's base unit ('kg' for rebar) — what gates/storage use. */
  baseUnit: string;
  /** kg per batang for rebar; null = unit is already base (1:1). */
  base_qty_per_supplier_unit: number | null;
  boqItemId: null;
  workGroupKey: null;
  lineResult: null;
  allocationPreview: never[];
}

/**
 * Map a catalog material to the request-line fields selecting it should set.
 * Pure — no I/O, no React state. Both `applyMaterialSelection` (picker) and
 * `MaterialNamingAssist.onSelectCatalogMaterial` (assist) in
 * workflows/screens/PermintaanScreen.tsx delegate here.
 */
export function applyCatalogMaterialToLine(
  material: CatalogMaterialForSelection,
): CatalogMaterialSelectionPatch {
  return {
    materialId: material.id,
    materialName: material.name,
    isCustom: false,
    tier: material.tier ?? 3,
    unit: material.supplier_unit || material.unit,
    baseUnit: material.unit,
    base_qty_per_supplier_unit: material.base_qty_per_supplier_unit ?? null,
    boqItemId: null,
    workGroupKey: null,
    lineResult: null,
    allocationPreview: [],
  };
}
