// SANO — Task B: Tier-2 allocation, with a GENERAL_STOCK fallback for
// project-level "Others" master lines.
//
// Background: get_envelope_boq_breakdown (migration 063) INNER JOINs boq_items,
// so it returns zero rows for materials whose project_material_master_lines are
// project-level (boq_item_id NULL — the simplified "SANO Input" Others shape,
// migration 082). Before this fallback, PermintaanScreen refused to submit any
// Tier-2 line in that shape ("Envelope … belum punya breakdown baseline"),
// which is why every Tier-2 request line ever submitted in production is
// actually tier 1 — Tier 2 has never been orderable for these materials, on
// any project.
//
// The fix does NOT touch migration 063 (a LEFT JOIN would inject a phantom
// boq_item_id-NULL row into the breakdown, corrupting the proportional-split
// denominator in tools/envelopes.ts). Instead: when the per-BoQ breakdown is
// empty but the material's project envelope (v_material_envelope_status) shows
// real planned demand, post the whole request as one GENERAL_STOCK line — the
// same basis Tier 3/4 already use for materials with no BoQ-row deduction
// target (material_request_line_allocations.boq_item_id is nullable and
// GENERAL_STOCK has been an allowed allocation_basis since migration 005).
//
// When there is NEITHER a breakdown NOR a planned envelope, this still returns
// [] — the genuinely-broken case (no baseline anywhere) must keep hard-blocking
// submit, per the truth-correctness contract: never invent an allocation for a
// material nobody planned.

import type {
  EnvelopeBoqBreakdown,
  MaterialEnvelopeStatus,
  MaterialRequestAllocationBasis,
} from './types';

export interface Tier2AllocationLine {
  boqItemId: string | null;
  boqCode: string;
  boqLabel: string;
  allocatedQuantity: number;
  proportionPct: number;
  allocationBasis: MaterialRequestAllocationBasis;
}

function roundQty(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Split a Tier-2 order proportionally across the BoQ rows that plan this
 * material, per get_envelope_boq_breakdown. Unchanged from the pre-existing
 * PermintaanScreen.buildTier2Allocations — moved here so the new fallback
 * branch (resolveTier2Allocations) can sit next to it as a pure unit.
 */
export function buildTier2Allocations(
  breakdown: EnvelopeBoqBreakdown[],
  requestedQty: number,
): Tier2AllocationLine[] {
  if (requestedQty <= 0 || breakdown.length === 0) return [];

  const totalPlanned = breakdown.reduce((sum, row) => sum + Number(row.planned_quantity ?? 0), 0);
  if (totalPlanned <= 0) return [];

  let allocatedSoFar = 0;

  return breakdown.map((row, index) => {
    const baseQty = requestedQty * (Number(row.planned_quantity ?? 0) / totalPlanned);
    const allocatedQuantity = index === breakdown.length - 1
      ? roundQty(requestedQty - allocatedSoFar)
      : roundQty(baseQty);

    allocatedSoFar = roundQty(allocatedSoFar + allocatedQuantity);

    return {
      boqItemId: row.boq_item_id,
      boqCode: row.boq_code,
      boqLabel: row.boq_label,
      allocatedQuantity,
      proportionPct: Number(row.pct_of_total ?? 0),
      allocationBasis: 'TIER2_ENVELOPE',
    };
  });
}

/**
 * The fallback basis for a Tier-2 order with no per-BoQ deduction target: one
 * line against general stock, mirroring Tier 3/4's buildGeneralStockAllocation.
 */
export function buildTier2GeneralStockAllocation(requestedQty: number): Tier2AllocationLine[] {
  return [{
    boqItemId: null,
    boqCode: 'STOK',
    boqLabel: 'Stok Umum',
    allocatedQuantity: roundQty(requestedQty),
    proportionPct: 100,
    allocationBasis: 'GENERAL_STOCK',
  }];
}

/**
 * Tier-2 allocation, with the Task B fallback. Try the per-BoQ breakdown
 * first (unchanged happy path — most Tier-2 materials still resolve here).
 * Only when that comes back empty do we check whether the project actually
 * planned this material at all (envelope.total_planned > 0); if so, the
 * breakdown's emptiness is known to be the boq_item_id-NULL join gap, not an
 * absence of baseline, so post the order as GENERAL_STOCK instead of refusing
 * it. If the envelope is ALSO empty/missing, there is genuinely no baseline
 * for this material and the caller must keep hard-blocking submit — returning
 * [] here is what PermintaanScreen's existing
 * `line.tier === 2 && line.allocationPreview.length === 0` guard keys off.
 */
export function resolveTier2Allocations(
  breakdown: EnvelopeBoqBreakdown[],
  envelope: MaterialEnvelopeStatus | null,
  requestedQty: number,
): Tier2AllocationLine[] {
  const perRowAllocations = buildTier2Allocations(breakdown, requestedQty);
  if (perRowAllocations.length > 0) return perRowAllocations;

  if (requestedQty <= 0) return [];
  if ((envelope?.total_planned ?? 0) <= 0) return [];

  return buildTier2GeneralStockAllocation(requestedQty);
}
