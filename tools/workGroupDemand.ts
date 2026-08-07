// SANO — BoQ-first Permintaan: one work group's envelope result → the demand
// rows the group-first screen renders.
// Design authority: docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §2
//
// Pure: no supabase, no react-native — the screen stays a thin renderer over
// this (repo convention, like tools/submitMaterialRequest.ts).
//
// UNITS: get_workgroup_material_envelopes (086) answers in BASE units (kg for
// rebar). Display goes through displayQty so a supervisor reads batang, exactly
// like every other surface (tools/materialUnitConversion.ts is THE boundary).

import { displayQty, type MaterialUnitInfo } from './materialUnitConversion';

/**
 * The catalog fields a demand row needs. Structurally satisfied by
 * PermintaanScreen's MaterialOption, so the screen passes materialOptions
 * straight in — no adapter, no second catalog fetch.
 */
export interface DemandCatalogMaterial extends MaterialUnitInfo {
  id: string;
  name: string;
  /** Base unit ('kg' for rebar) — what gates and storage use. */
  unit: string;
  /** Supplier unit ('batang' for rebar). null/absent = same as unit. */
  supplier_unit?: string | null;
  /** Base units per ONE supplier unit. null = 1:1. */
  base_qty_per_supplier_unit?: number | null;
  tier: 1 | 2 | 3 | 4;
  code?: string | null;
}

/** One row of get_workgroup_material_envelopes (base units). */
export interface WorkGroupEnvelopeRow {
  material_id: string;
  planned: number;
  ordered: number;
  requested: number;
}

export interface DemandRow {
  materialId: string;
  material: DemandCatalogMaterial;
  tier: 1 | 2 | 3 | 4;
  plannedBase: number;
  orderedBase: number;
  requestedBase: number;
  /** max(0, planned − ordered − requested), BASE units. */
  sisaBase: number;
  /** Supplier-unit view of sisaBase (batang for rebar). */
  sisaDisplay: ReturnType<typeof displayQty>;
}

export interface WorkGroupDemand {
  /** Primary list: Tier-1 materials this group actually plans (spec §2). */
  tier1: DemandRow[];
  /** "Material terkait (Tier 2+)" — every non-Tier-1 material in the result. */
  tier2plus: DemandRow[];
}

/**
 * Remaining need = planned − already-ordered − still-open. Floored at zero: a
 * group that has been over-ordered has NO remaining need, not a negative one
 * (a negative sisa would read as a credit the supervisor could spend).
 */
export function computeSisa(planned: number, ordered: number, requested: number): number {
  return Math.max(0, planned - ordered - requested);
}

function byName(a: DemandRow, b: DemandRow): number {
  return a.material.name.localeCompare(b.material.name, 'id', { sensitivity: 'base' });
}

/**
 * Turn a work group's envelope rows into the two rendered lists.
 *
 * Rows with no catalog match are DROPPED, deliberately: the screen's catalog is
 * the only source of a name, unit, tier and conversion factor, and it already
 * excludes company-owned equipment (is_asset). Rendering a bare uuid, or
 * guessing a name, would violate the truth-correctness contract — and such a
 * material cannot be requested anyway.
 *
 * A Tier-1 row with planned = 0 is dropped too: the primary list is "what this
 * work needs" (spec §2), and an unplanned Tier-1 material is reachable through
 * "Tambah material lain", where it correctly shows the no-baseline INFO flag.
 * Tier 2+ rows are kept regardless of planned demand — they are tracked at
 * project level, so their presence in the group is informational either way.
 */
export function buildWorkGroupDemand(
  rows: WorkGroupEnvelopeRow[],
  catalog: DemandCatalogMaterial[],
): WorkGroupDemand {
  const byId = new Map(catalog.map(m => [m.id, m]));
  const tier1: DemandRow[] = [];
  const tier2plus: DemandRow[] = [];

  for (const row of rows) {
    const material = byId.get(row.material_id);
    if (!material) continue;

    const sisaBase = computeSisa(row.planned, row.ordered, row.requested);
    const demandRow: DemandRow = {
      materialId: row.material_id,
      material,
      tier: material.tier,
      plannedBase: row.planned,
      orderedBase: row.ordered,
      requestedBase: row.requested,
      sisaBase,
      sisaDisplay: displayQty(sisaBase, material),
    };

    if (material.tier === 1) {
      if (row.planned > 0) tier1.push(demandRow);
    } else {
      tier2plus.push(demandRow);
    }
  }

  return { tier1: tier1.sort(byName), tier2plus: tier2plus.sort(byName) };
}

/**
 * Sisa as the row renders it: "214 batang (≈ 2.675 kg)" when a conversion
 * factor exists, "20,5 m3" when it does not. id-ID formatting throughout,
 * matching tools/requestOverage.ts.
 */
export function formatSisaLabel(row: DemandRow): string {
  const { qty, unit, baseQty, baseUnit, converted } = row.sisaDisplay;
  const shown = qty.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  if (!converted) return `${shown} ${unit}`;
  return `${shown} ${unit} (≈ ${Math.round(baseQty).toLocaleString('id-ID')} ${baseUnit})`;
}
