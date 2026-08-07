// SANO — Mode Besi (bulk rebar) matrix logic.
// Design authority: docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §3
//
// Pure: no supabase, no react-native. Every number Mode Besi shows or submits
// is computed here so the screen holds no arithmetic.
//
// REBAR IDENTITY comes from the CATALOG ONLY (material_catalog.code LIKE
// 'REB-%'). tools/rebarBatang.ts owns the kg↔batang FACTORS; the catalogue owns
// WHICH bars exist. Never hardcode a diameter list in a screen.
//
// UNITS: envelope numbers are BASE (kg); the matrix is entered and split in
// WHOLE BATANG (you cannot buy 0.4 lonjor). Conversion happens here via
// tools/materialUnitConversion.ts and nowhere else.

import { baseToSupplierOrder } from './materialUnitConversion';
import type { WorkGroupEnvelopeRow } from './workGroupDemand';

export const REBAR_CODE_PREFIX = 'REB-';

/** A rebar bar as the matrix needs it (projected from the catalog row). */
export interface RebarMaterial {
  id: string;
  /** Catalog code, e.g. 'REB-DE13'. Drives ordering. */
  code: string;
  name: string;
  /** Base unit — 'kg'. */
  unit: string;
  /** Supplier unit — 'batang'. */
  supplierUnit: string;
  /** kg per batang; null when the catalog row carries no factor (1:1). */
  kgPerBatang: number | null;
}

/** One work group's envelope result (Task 3's rows), tagged with its group. */
export interface RebarGroupEnvelope {
  groupKey: string;
  groupLabel: string;
  rows: WorkGroupEnvelopeRow[];
}

/** Per (material × group) demand, BASE units. */
export interface RebarCell {
  materialId: string;
  groupKey: string;
  plannedBase: number;
  /** max(0, planned − ordered − requested). */
  remainingBase: number;
}

export interface RebarMatrixRow {
  material: RebarMaterial;
  plannedBase: number;
  remainingBase: number;
  /** Whole batang, rounded UP. */
  remainingBatang: number;
  /** false → renders under "Diameter lain" with a "tanpa baseline" chip. */
  hasBaseline: boolean;
}

export interface RebarSplitBasis {
  groupKey: string;
  plannedBase: number;
  remainingBase: number;
}

export interface RebarSplitEntry {
  groupKey: string;
  batang: number;
}

export interface RebarRequestDraft {
  materialId: string;
  workGroupKey: string;
  /** Whole batang — SUPPLIER units, exactly what RequestLine.quantity holds. */
  quantityBatang: number;
}

export function isRebarCode(code: string | null | undefined): boolean {
  return (code ?? '').startsWith(REBAR_CODE_PREFIX);
}

/**
 * Sort key: ulir (REB-DE…) before polos (REB-PL…), then diameter ascending.
 * A REB- code with an unrecognized shape sorts last, by code — visible and
 * ordered, never silently dropped.
 */
function rebarSortKey(code: string): [number, number, string] {
  const m = /^REB-(DE|PL)(\d+)$/.exec(code);
  if (!m) return [2, 0, code];
  return [m[1] === 'DE' ? 0 : 1, Number(m[2]), code];
}

export function sortRebarMaterials(materials: RebarMaterial[]): RebarMaterial[] {
  return [...materials].sort((a, b) => {
    const ka = rebarSortKey(a.code);
    const kb = rebarSortKey(b.code);
    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || ka[2].localeCompare(kb[2]);
  });
}

/** Flatten per-group envelope results into (material × group) cells. */
export function buildRebarCells(
  materials: RebarMaterial[],
  groupEnvelopes: RebarGroupEnvelope[],
): RebarCell[] {
  const rebarIds = new Set(materials.map(m => m.id));
  const cells: RebarCell[] = [];
  for (const group of groupEnvelopes) {
    for (const row of group.rows) {
      if (!rebarIds.has(row.material_id)) continue;
      cells.push({
        materialId: row.material_id,
        groupKey: group.groupKey,
        plannedBase: row.planned,
        remainingBase: Math.max(0, row.planned - row.ordered - row.requested),
      });
    }
  }
  return cells;
}

/** Work groups with any planned rebar demand — the default (all-selected) scope. */
export function groupsWithRebarDemand(cells: RebarCell[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell.plannedBase <= 0 || seen.has(cell.groupKey)) continue;
    seen.add(cell.groupKey);
    keys.push(cell.groupKey);
  }
  return keys;
}

/**
 * Whole batang for a base quantity; a factorless material passes through.
 * Ordering always rounds UP: with a factor, baseToSupplierOrder already
 * ceils, so Math.ceil here is a no-op; without one, baseToSupplierOrder
 * returns the base quantity unchanged (possibly fractional) and Math.ceil
 * is what enforces "you cannot buy 0.4 lonjor" for that branch too.
 */
function toBatang(base: number, kgPerBatang: number | null): number {
  return Math.ceil(baseToSupplierOrder(base, kgPerBatang));
}

/**
 * Total rebar sisa for one group, in whole batang. Rounded UP per diameter and
 * then summed — batang are not fungible across diameters, so rounding the sum
 * would understate the order.
 */
export function groupRebarSisaBatang(
  materials: RebarMaterial[],
  cells: RebarCell[],
  groupKey: string,
): number {
  let total = 0;
  for (const material of materials) {
    let remaining = 0;
    for (const cell of cells) {
      if (cell.materialId !== material.id || cell.groupKey !== groupKey) continue;
      remaining += cell.remainingBase;
    }
    total += toBatang(remaining, material.kgPerBatang);
  }
  return total;
}

/** One row per bar, aggregated across the selected groups only. */
export function buildMatrixRows(
  materials: RebarMaterial[],
  cells: RebarCell[],
  selectedGroupKeys: string[],
): RebarMatrixRow[] {
  const scope = new Set(selectedGroupKeys);
  return sortRebarMaterials(materials).map(material => {
    let plannedBase = 0;
    let remainingBase = 0;
    for (const cell of cells) {
      if (cell.materialId !== material.id || !scope.has(cell.groupKey)) continue;
      plannedBase += cell.plannedBase;
      remainingBase += cell.remainingBase;
    }
    return {
      material,
      plannedBase,
      remainingBase,
      remainingBatang: toBatang(remainingBase, material.kgPerBatang),
      hasBaseline: plannedBase > 0,
    };
  });
}

/** Per-group planned/remaining for ONE bar, in the scope's order. */
export function splitBasisFor(
  cells: RebarCell[],
  materialId: string,
  selectedGroupKeys: string[],
): RebarSplitBasis[] {
  return selectedGroupKeys.map(groupKey => {
    let plannedBase = 0;
    let remainingBase = 0;
    for (const cell of cells) {
      if (cell.materialId !== materialId || cell.groupKey !== groupKey) continue;
      plannedBase += cell.plannedBase;
      remainingBase += cell.remainingBase;
    }
    return { groupKey, plannedBase, remainingBase };
  });
}

/**
 * Split a whole-batang total across weighted buckets so every part is an
 * integer and the parts sum EXACTLY to `total` (largest-remainder / Hare
 * quota). Ties resolve to the lower index, so the result is deterministic.
 *
 * Returns null when there is nothing to divide by (no buckets, every weight 0
 * or non-finite, or a non-integer/negative total). An even split would be a
 * fabricated proportion — the caller falls back or asks the user instead.
 * A non-finite weight (NaN, ±Infinity) is treated as 0 rather than allowed to
 * poison the sum — never fabricated garbage in the result.
 */
export function largestRemainderSplit(total: number, weights: number[]): number[] | null {
  if (weights.length === 0) return null;
  if (!Number.isInteger(total) || total < 0) return null;

  const safe = weights.map(w => (Number.isFinite(w) ? Math.max(0, w) : 0));
  const totalWeight = safe.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return null;

  const exact = safe.map(w => (w / totalWeight) * total);
  const out = exact.map(Math.floor);
  let assigned = out.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));

  let i = 0;
  while (assigned < total) {
    out[order[i % order.length].index] += 1;
    assigned += 1;
    i += 1;
  }
  return out;
}

/**
 * Default per-group split for one diameter (spec §3 step 3): proportional to
 * each selected group's REMAINING demand; if remaining is 0 everywhere, fall
 * back to PLANNED; if planned is 0 everywhere the diameter has no baseline in
 * scope — return null so the UI starts the inputs empty and the user assigns
 * them. Never a fabricated proportion.
 */
export function defaultSplit(
  totalBatang: number,
  basis: RebarSplitBasis[],
): RebarSplitEntry[] | null {
  const parts =
    largestRemainderSplit(totalBatang, basis.map(b => b.remainingBase))
    ?? largestRemainderSplit(totalBatang, basis.map(b => b.plannedBase));
  if (!parts) return null;
  return basis.map((b, index) => ({ groupKey: b.groupKey, batang: parts[index] }));
}

/**
 * Matrix → request drafts: one per (diameter × group) with a positive batang
 * amount. A group edited to 0 drops its line (spec §3 step 3). The screen turns
 * each draft into a standard RequestLine (tier 1, workGroupKey, quantity in
 * batang) and the existing pipeline does the rest — no new write path.
 */
export function expandRebarMatrix(
  entries: Array<{ materialId: string; splits: RebarSplitEntry[] }>,
): RebarRequestDraft[] {
  const out: RebarRequestDraft[] = [];
  for (const entry of entries) {
    for (const split of entry.splits) {
      if (!(split.batang > 0)) continue;
      out.push({
        materialId: entry.materialId,
        workGroupKey: split.groupKey,
        quantityBatang: split.batang,
      });
    }
  }
  return out;
}
