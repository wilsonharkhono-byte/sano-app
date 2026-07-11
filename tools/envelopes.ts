// SANO — Tier 2 Material Envelope Logic
// Handles cross-BoQ material aggregation for Tier 2 ordering.
//
// Key concept:
//   Tier 1 (concrete, rebar): 1:1 mapping to BoQ item. Order 5 m3 for Kolom K1.
//   Tier 2 (bricks, cement, sand): order covers MULTIPLE BoQ items.
//     Supervisor orders 10,000 bricks → system deducts from an "envelope"
//     that aggregates all BoQ items using that material.
//   Tier 3 (paint, adhesives, sealant): Rupiah budget envelope — order × price is
//     compared against the material's budget; envelope depletes at order time.
//   Tier 4 (nails, oil, consumables): untracked — never gated, always approved.

import { supabase } from './supabase';
import { MRStatus } from './constants';
import type {
  MaterialEnvelopeStatus,
  MaterialBudgetStatus,
  EnvelopeBoqBreakdown,
  FlagLevel,
  GateResult,
  AhsLine,
} from './types';
import { evaluateTier3Budget, evaluateTier4Untracked } from './budgetGate';
import { summarizeAhsBaselinePrices } from '../workflows/gates/gate2';
import type { MaterialBaselinePriceSummary } from '../workflows/gates/gate2';

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
 * Tier-3 Rupiah budget status for a material (reads v_material_budget_status
 * via RPC, mirroring getMaterialEnvelope).
 */
export async function getMaterialBudget(
  projectId: string,
  materialId: string,
): Promise<MaterialBudgetStatus | null> {
  const { data, error } = await supabase
    .rpc('get_material_budget', { p_project_id: projectId, p_material_id: materialId })
    .single();
  if (error || !data) return null;
  // Cast: the RPC result set does not include project_id; re-attach it from the argument.
  const r = data as Omit<MaterialBudgetStatus, 'project_id'>;
  return { ...r, project_id: projectId } as MaterialBudgetStatus;
}

/**
 * Gate 1 check for Tier-3 materials: order × price vs Rupiah budget envelope.
 * actualUnitPrice overrides the benchmark for this order when the admin enters one.
 */
export async function checkTier3Budget(
  projectId: string,
  materialId: string | null,
  requestedQty: number,
  actualUnitPrice?: number,
): Promise<GateResult> {
  if (!materialId) {
    return { flag: 'WARNING', check: 'tier3_no_material', msg: 'Tier 3 check requires material_id for budget lookup' };
  }
  const budget = await getMaterialBudget(projectId, materialId);
  return evaluateTier3Budget(budget, requestedQty, actualUnitPrice);
}

/**
 * Get all material envelopes for a project (Tier 2 overview).
 */
export async function getProjectEnvelopes(
  projectId: string,
  tierFilter?: 1 | 2 | 3 | 4,
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

/**
 * Work-group envelope: planned vs ordered for a material across a specific set
 * of BoQ rows (the work-group). Mirrors getMaterialEnvelope but row-scoped, so
 * burn is computed for the group only — not the whole project.
 *
 * Returns a MaterialEnvelopeStatus shape so the existing Tier-2 gate branch can
 * consume it unchanged. Fields the RPC does not compute (tier, total_received,
 * material_code) are filled with neutral defaults.
 */
export async function getWorkGroupEnvelope(
  projectId: string,
  materialId: string,
  boqItemIds: string[],
): Promise<MaterialEnvelopeStatus | null> {
  if (boqItemIds.length === 0) return null;
  const { data, error } = await supabase
    .rpc('get_workgroup_envelope', {
      p_project_id: projectId,
      p_material_id: materialId,
      p_boq_item_ids: boqItemIds,
    })
    .single();

  if (error || !data) return null;
  const row = data as {
    material_id: string;
    material_name: string;
    unit: string;
    total_planned: number;
    total_ordered: number;
    total_installed: number;
    remaining_to_order: number;
    burn_pct: number;
    boq_item_count: number;
  };
  return {
    material_id: row.material_id,
    project_id: projectId,
    material_code: null,
    material_name: row.material_name,
    tier: 1,
    unit: row.unit,
    total_planned: Number(row.total_planned ?? 0),
    total_ordered: Number(row.total_ordered ?? 0),
    // The work-group RPC (get_workgroup_envelope) still derives total_ordered from
    // request allocations — it has no PO-scoped split yet (that lands in Task 2.4).
    // So at work-group grain the RPC's "ordered" IS the requested demand; mirror it
    // into total_requested to keep the field coherent (never displayed via the
    // di-PO / permintaan-berjalan split, which is project-grain only).
    total_requested: Number(row.total_ordered ?? 0),
    total_received: 0,
    total_installed: Number(row.total_installed ?? 0),
    remaining_to_order: Number(row.remaining_to_order ?? 0),
    burn_pct: Number(row.burn_pct ?? 0),
    boq_item_count: Number(row.boq_item_count ?? 0),
  };
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
 * LEGACY / DEAD — no production callers. NOT the server twin since 069
 * (uncapped severities, pre-069 formula). Do not resurrect without
 * re-deriving from compute_tier*_flag. Live client gates:
 * workflows/gates/gate1.ts, PermintaanScreen buildTier2Result /
 * buildProjectEnvelopeOverageResult, tools/budgetGate.ts
 * evaluateTier3BudgetSoft.
 *
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

  // Burn on total_requested (request demand), NOT total_ordered (SANO PO qty).
  // Pre-069 formula, frozen — see the dead-code warning above. The live server
  // twin is compute_tier2_flag (069), which burns PO-ordered + other-open +
  // this request against total_planned, capped at WARNING.
  const newTotal = envelope.total_requested + requestedQty;
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
 * LEGACY / DEAD — no production callers. NOT the server twin since 069
 * (uncapped severities, pre-069 formula). Do not resurrect without
 * re-deriving from compute_tier*_flag. Live client gates:
 * workflows/gates/gate1.ts, PermintaanScreen buildTier2Result /
 * buildProjectEnvelopeOverageResult, tools/budgetGate.ts
 * evaluateTier3BudgetSoft.
 *
 * Unified Gate 1 material check that branches by tier.
 *
 *   Tier 1 → check against specific BoQ item planned quantity
 *   Tier 2 → check against aggregated material envelope
 *   Tier 3 → Rupiah budget envelope; Tier 4 → untracked
 */
export async function checkMaterialRequest(
  projectId: string,
  materialId: string | null,
  materialTier: 1 | 2 | 3 | 4,
  boqItemId: string,
  requestedQty: number,
  /**
   * Per-unit BASE price (pre-markup, before profit margin). MUST NOT be
   * the post-markup display price. Recommended sources:
   *   - `ahs_lines.unit_price` (already pre-markup post Phase 0)
   *   - `material_catalog.reference_price` (catalog base price)
   * Markup factor (1.15, etc.) is tracked separately in
   * `import_sessions.parser_metadata` and applied at quote/billing time,
   * not at envelope/spend-cap evaluation.
   */
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
      return checkTier3Budget(projectId, materialId, requestedQty, unitPrice);
    case 4:
      return evaluateTier4Untracked();
    default:
      return { flag: 'OK', check: 'tier_unknown', msg: 'Unknown material tier' };
  }
}

/**
 * LEGACY / DEAD — no production callers. NOT the server twin since 069
 * (uncapped severities, pre-069 formula). Do not resurrect without
 * re-deriving from compute_tier*_flag. Live client gates:
 * workflows/gates/gate1.ts, PermintaanScreen buildTier2Result /
 * buildProjectEnvelopeOverageResult, tools/budgetGate.ts
 * evaluateTier3BudgetSoft.
 *
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
      return r.material_request_lines?.material_request_headers?.overall_status !== MRStatus.REJECTED;
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

// ─── Batch Envelope + Baseline Price ────────────────────────────────

export interface EnvelopeWithPrice extends MaterialEnvelopeStatus {
  baseline_unit_price: number | null;       // null = no AHS lines for this material
  envelope_total_rupiah: number | null;     // total_planned × baseline_unit_price
  envelope_used_rupiah: number | null;      // total_ordered × baseline_unit_price
  envelope_remaining_rupiah: number | null; // total - used
}

export function mergeEnvelopeWithBaselinePrice(
  envelope: MaterialEnvelopeStatus,
  price: MaterialBaselinePriceSummary | null,
): EnvelopeWithPrice {
  const unitPrice = price?.baseline_unit_price && price.baseline_unit_price > 0
    ? price.baseline_unit_price
    : null;

  if (unitPrice === null) {
    return {
      ...envelope,
      baseline_unit_price: null,
      envelope_total_rupiah: null,
      envelope_used_rupiah: null,
      envelope_remaining_rupiah: null,
    };
  }

  const total = envelope.total_planned * unitPrice;
  const used = envelope.total_ordered * unitPrice;
  return {
    ...envelope,
    baseline_unit_price: unitPrice,
    envelope_total_rupiah: total,
    envelope_used_rupiah: used,
    envelope_remaining_rupiah: total - used,
  };
}

/**
 * Batch fetch envelope rows + AHS-line baseline prices for a set of
 * materials in a single round trip. Returns a Map keyed by material_id
 * for O(1) lookup at render time.
 *
 * Used by ApprovalsScreen to populate `<MaterialUsagePanel>` per
 * request line without per-component fetches.
 */
export async function getEnvelopesByMaterialIds(
  projectId: string,
  materialIds: string[],
): Promise<Map<string, EnvelopeWithPrice>> {
  const out = new Map<string, EnvelopeWithPrice>();
  if (materialIds.length === 0) return out;

  // Fetch envelopes
  const { data: envRows } = await supabase
    .from('v_material_envelope_status')
    .select('*')
    .eq('project_id', projectId)
    .in('material_id', materialIds);

  // Fetch ahs_lines for current ahs_version of this project, filtered to materials we care about
  const { data: versionRow } = await supabase
    .from('ahs_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle();

  const ahsLines: Array<Pick<AhsLine, 'material_id' | 'unit_price' | 'line_type'>> = [];
  if (versionRow?.id) {
    const { data: lineRows } = await supabase
      .from('ahs_lines')
      .select('material_id, unit_price, line_type')
      .eq('ahs_version_id', versionRow.id)
      .in('material_id', materialIds);
    if (lineRows) ahsLines.push(...lineRows as typeof ahsLines);
  }

  const priceMap = summarizeAhsBaselinePrices(ahsLines);

  for (const row of (envRows ?? []) as MaterialEnvelopeStatus[]) {
    out.set(row.material_id, mergeEnvelopeWithBaselinePrice(row, priceMap.get(row.material_id) ?? null));
  }
  return out;
}
