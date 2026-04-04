// SANO — Tier 2 Material Envelope Logic
// Handles cross-BoQ material aggregation for Tier 2 ordering.
//
// Key concept:
//   Tier 1 (concrete, rebar): 1:1 mapping to BoQ item. Order 5 m3 for Kolom K1.
//   Tier 2 (bricks, cement, sand): order covers MULTIPLE BoQ items.
//     Supervisor orders 10,000 bricks → system deducts from an "envelope"
//     that aggregates all BoQ items using that material.
//   Tier 3 (nails, oil, consumables): spend cap, no strict quantity tracking.

import { supabase } from './supabase';
import type {
  MaterialEnvelopeStatus,
  EnvelopeBoqBreakdown,
  FlagLevel,
  GateResult,
} from './types';

// ─── Envelope Queries ────────────────────────────────────────────────

/**
 * Get the aggregated envelope status for a specific material in a project.
 * Shows: total planned across all BoQ items, total ordered, total received, remaining.
 */
export async function getMaterialEnvelope(
  projectId: string,
  materialId: string,
): Promise<MaterialEnvelopeStatus | null> {
  const { data, error } = await supabase
    .rpc('get_material_envelope', {
      p_project_id: projectId,
      p_material_id: materialId,
    })
    .single();

  if (error || !data) return null;
  return data as MaterialEnvelopeStatus;
}

/**
 * Get all material envelopes for a project (Tier 2 overview).
 */
export async function getProjectEnvelopes(
  projectId: string,
  tierFilter?: 1 | 2 | 3,
): Promise<MaterialEnvelopeStatus[]> {
  let query = supabase
    .from('v_material_envelope_status')
    .select('*')
    .eq('project_id', projectId);

  if (tierFilter !== undefined) {
    query = query.eq('tier', tierFilter);
  }

  const { data, error } = await query.order('burn_pct', { ascending: false });
  if (error) return [];
  return (data ?? []) as MaterialEnvelopeStatus[];
}

/**
 * Get per-BoQ breakdown for a material — shows which BoQ items
 * use this material and their proportional share.
 */
export async function getEnvelopeBreakdown(
  projectId: string,
  materialId: string,
): Promise<EnvelopeBoqBreakdown[]> {
  const { data, error } = await supabase
    .rpc('get_envelope_boq_breakdown', {
      p_project_id: projectId,
      p_material_id: materialId,
    });

  if (error) return [];
  return (data ?? []) as EnvelopeBoqBreakdown[];
}

// ─── Tier 2 Allocation ──────────────────────────────────────────────

export interface AllocationResult {
  boqItemId: string;
  boqCode: string;
  boqLabel: string;
  allocatedQuantity: number;
  proportionPct: number;
}

/**
 * Allocate a Tier 2 material order proportionally across BoQ items.
 * Used when a supervisor orders a batch of material (e.g., 5,000 bricks)
 * that serves multiple BoQ items.
 *
 * Returns the per-BoQ allocation for display and tracking.
 * Does NOT write anything — caller decides whether to persist.
 */
export async function allocateTier2Order(
  projectId: string,
  materialId: string,
  orderQuantity: number,
): Promise<AllocationResult[]> {
  const breakdown = await getEnvelopeBreakdown(projectId, materialId);
  if (breakdown.length === 0) return [];

  const totalPlanned = breakdown.reduce((sum, b) => sum + b.planned_quantity, 0);
  if (totalPlanned === 0) return [];

  return breakdown.map(b => ({
    boqItemId: b.boq_item_id,
    boqCode: b.boq_code,
    boqLabel: b.boq_label,
    allocatedQuantity: Math.round((orderQuantity * (b.planned_quantity / totalPlanned)) * 100) / 100,
    proportionPct: b.pct_of_total,
  }));
}

// ─── Gate 1 Envelope Check ──────────────────────────────────────────

const ENVELOPE_WARNING_PCT = 80;
const ENVELOPE_CRITICAL_PCT = 100;

/**
 * Gate 1 check for Tier 2 materials.
 * Instead of checking against a single BoQ item, checks against
 * the aggregated envelope across all BoQ items using this material.
 *
 * Returns a GateResult with appropriate flag level:
 *   OK: order within comfortable range
 *   INFO: order is fine but approaching threshold
 *   WARNING: order pushes envelope past 80%
 *   HIGH: order pushes envelope past 100%
 *   CRITICAL: order significantly exceeds envelope
 */
export async function checkTier2Envelope(
  projectId: string,
  materialId: string,
  requestedQty: number,
): Promise<GateResult> {
  const envelope = await getMaterialEnvelope(projectId, materialId);

  if (!envelope) {
    return {
      flag: 'INFO',
      check: 'envelope_missing',
      msg: 'No material envelope found — material may not be in baseline AHS',
    };
  }

  const newTotal = envelope.total_ordered + requestedQty;
  const newBurnPct = envelope.total_planned > 0
    ? (newTotal / envelope.total_planned) * 100
    : 0;

  // Check various thresholds
  if (newBurnPct > ENVELOPE_CRITICAL_PCT + 20) {
    return {
      flag: 'CRITICAL',
      check: 'envelope_exceeded',
      msg: `Order of ${requestedQty} ${envelope.unit} would exceed envelope by ${(newBurnPct - 100).toFixed(0)}%. Total: ${newTotal.toLocaleString('id-ID')} / ${envelope.total_planned.toLocaleString('id-ID')} ${envelope.unit} (${newBurnPct.toFixed(0)}%). Requires principal override.`,
      extra: {
        flag: 'INFO',
        check: 'envelope_detail',
        msg: `${envelope.material_name} serves ${envelope.boq_item_count} BoQ items`,
      },
    };
  }

  if (newBurnPct > ENVELOPE_CRITICAL_PCT) {
    return {
      flag: 'HIGH',
      check: 'envelope_over',
      msg: `Order would push ${envelope.material_name} to ${newBurnPct.toFixed(0)}% of envelope (${newTotal.toLocaleString('id-ID')} / ${envelope.total_planned.toLocaleString('id-ID')} ${envelope.unit}). Exceeds planned quantity.`,
    };
  }

  if (newBurnPct > ENVELOPE_WARNING_PCT) {
    return {
      flag: 'WARNING',
      check: 'envelope_warning',
      msg: `${envelope.material_name} envelope at ${newBurnPct.toFixed(0)}% after this order (${newTotal.toLocaleString('id-ID')} / ${envelope.total_planned.toLocaleString('id-ID')} ${envelope.unit}). Approaching limit.`,
    };
  }

  if (newBurnPct > 50) {
    return {
      flag: 'INFO',
      check: 'envelope_info',
      msg: `${envelope.material_name}: ${newBurnPct.toFixed(0)}% of envelope used (${newTotal.toLocaleString('id-ID')} / ${envelope.total_planned.toLocaleString('id-ID')} ${envelope.unit})`,
    };
  }

  return {
    flag: 'OK',
    check: 'envelope_ok',
    msg: `${envelope.material_name}: ${newBurnPct.toFixed(0)}% of envelope (${newTotal.toLocaleString('id-ID')} / ${envelope.total_planned.toLocaleString('id-ID')} ${envelope.unit})`,
  };
}

// ─── Tier-Aware Gate 1 Dispatcher ────────────────────────────────────

/**
 * Unified Gate 1 material check that branches by tier.
 *
 *   Tier 1 → check against specific BoQ item planned quantity
 *   Tier 2 → check against aggregated material envelope
 *   Tier 3 → spend cap check
 */
export async function checkMaterialRequest(
  projectId: string,
  materialId: string | null,
  materialTier: 1 | 2 | 3,
  boqItemId: string,
  requestedQty: number,
  unitPrice?: number,
): Promise<GateResult> {
  switch (materialTier) {
    case 1:
      return checkTier1Direct(projectId, boqItemId, materialId, requestedQty);
    case 2:
      if (!materialId) {
        return { flag: 'WARNING', check: 'tier2_no_material', msg: 'Tier 2 check requires material_id for envelope lookup' };
      }
      return checkTier2Envelope(projectId, materialId, requestedQty);
    case 3:
      return checkTier3SpendCap(projectId, requestedQty, unitPrice);
    default:
      return { flag: 'OK', check: 'tier_unknown', msg: 'Unknown material tier' };
  }
}

/**
 * Tier 1: direct quantity check against a specific BoQ item.
 * Order maps 1:1 to the planned quantity.
 */
async function checkTier1Direct(
  projectId: string,
  boqItemId: string,
  materialId: string | null,
  requestedQty: number,
): Promise<GateResult> {
  // Get the BoQ item's planned quantity
  const { data: boqItem } = await supabase
    .from('boq_items')
    .select('code, label, planned, installed, unit')
    .eq('id', boqItemId)
    .single();

  if (!boqItem) {
    return { flag: 'WARNING', check: 'boq_not_found', msg: 'BoQ item not found' };
  }

  // Get already-ordered quantity for this material + BoQ item using persisted allocations.
  let allocationQuery = supabase
    .from('material_request_line_allocations')
    .select(`
      allocated_quantity,
      material_request_lines!inner(
        material_id,
        material_request_headers!inner(project_id, overall_status)
      )
    `)
    .eq('boq_item_id', boqItemId)
    .eq('material_request_lines.material_request_headers.project_id', projectId);

  if (materialId) {
    allocationQuery = allocationQuery.eq('material_request_lines.material_id', materialId);
  }

  const { data: allocatedOrders } = await allocationQuery;

  const alreadyOrdered = (allocatedOrders ?? [])
    .filter((row) => {
      const r = row as unknown as { material_request_lines?: { material_request_headers?: { overall_status?: string } } };
      return r.material_request_lines?.material_request_headers?.overall_status !== 'REJECTED';
    })
    .reduce((sum: number, row) => sum + Number((row as unknown as { allocated_quantity?: number }).allocated_quantity ?? 0), 0);

  const remaining = boqItem.planned - alreadyOrdered;
  const overOrderPct = remaining > 0 ? ((requestedQty - remaining) / remaining) * 100 : 100;

  if (requestedQty > remaining * 1.2) {
    return {
      flag: 'HIGH',
      check: 'tier1_over',
      msg: `Request of ${requestedQty} ${boqItem.unit} exceeds remaining ${remaining.toFixed(1)} for "${boqItem.label}" (${boqItem.code}). Over by ${overOrderPct.toFixed(0)}%.`,
    };
  }

  if (requestedQty > remaining) {
    return {
      flag: 'WARNING',
      check: 'tier1_slight_over',
      msg: `Request slightly exceeds remaining: ${requestedQty} vs ${remaining.toFixed(1)} ${boqItem.unit} for "${boqItem.label}"`,
    };
  }

  return {
    flag: 'OK',
    check: 'tier1_ok',
    msg: `${requestedQty} / ${remaining.toFixed(1)} ${boqItem.unit} remaining for "${boqItem.label}"`,
  };
}

/**
 * Tier 3: simple spend cap check.
 */
async function checkTier3SpendCap(
  projectId: string,
  requestedQty: number,
  unitPrice?: number,
): Promise<GateResult> {
  const TIER3_PER_REQUEST_CAP = 5_000_000; // Rp 5 juta per request

  if (!unitPrice) {
    return { flag: 'OK', check: 'tier3_no_price', msg: 'Tier 3 — no price provided, skipping spend cap check' };
  }

  const totalSpend = requestedQty * unitPrice;

  if (totalSpend > TIER3_PER_REQUEST_CAP) {
    return {
      flag: 'WARNING',
      check: 'tier3_cap',
      msg: `Tier 3 spend Rp ${totalSpend.toLocaleString('id-ID')} exceeds per-request cap of Rp ${TIER3_PER_REQUEST_CAP.toLocaleString('id-ID')}`,
    };
  }

  return {
    flag: 'OK',
    check: 'tier3_ok',
    msg: `Tier 3 spend Rp ${totalSpend.toLocaleString('id-ID')} within cap`,
  };
}
