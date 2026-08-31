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
import { remainingToOrder, burnPct } from './envelopeMath';
import type {
  MaterialEnvelopeStatus,
  MaterialBudgetStatus,
  EnvelopeBoqBreakdown,
  GateResult,
  AhsLine,
} from './types';
import { evaluateTier3Budget } from './budgetGate';
import { summarizeAhsBaselinePrices } from '../workflows/gates/gate2';
import type { MaterialBaselinePriceSummary } from '../workflows/gates/gate2';
import { fetchAllPaged } from './queryHelpers';
import { computeDriftPct, type MaterialDrift } from './planDrift';

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
 * Work-group envelope: planned / ordered / requested for ONE material across a
 * specific set of BoQ rows (the work-group). Mirrors getMaterialEnvelope but
 * row-scoped, so burn is computed for the group only — not the whole project.
 *
 * ─── WHERE THE NUMBERS COME FROM (changed 2026-08-31, migration 094) ────────
 *
 * The burn legs come from `get_workgroup_material_envelopes` (migration 086),
 * which already returns planned / ordered / requested SPLIT and honest:
 *   ordered   = group demand linked to a non-CANCELLED SANO PO
 *   requested = the rest (non-rejected, not yet on a live PO)
 *
 * They used to come from `get_workgroup_envelope`, whose column named
 * `total_ordered` actually held REQUEST allocations and whose
 * `remaining_to_order` was planned − REQUESTS (061:269-285) — the same column
 * names as the project view carrying the opposite meaning. This wrapper papered
 * over that by mirroring one figure into two fields; migration 094 rebuilds the
 * RPC honestly and this function stops depending on the rotten columns.
 *
 * `get_workgroup_envelope` is still called, but ONLY for the four columns whose
 * meaning is IDENTICAL before and after 094: material_name, unit,
 * total_installed and boq_item_count. total_installed has no substitute — 086
 * cannot return it (its result type is frozen; adding a column needs DROP +
 * CREATE, which would couple every 086 caller to a deploy) and it cannot be
 * derived client-side without re-resolving the project's latest material master.
 * It is what feeds gate1's check-1d progress-pace advisory.
 *
 * That split is what makes this safe in EITHER deploy order — code-then-paste or
 * paste-then-code: no column whose meaning 094 changes crosses this boundary.
 *
 * Returns a MaterialEnvelopeStatus shape so the existing Tier-1/2 gate branches
 * consume it unchanged. Fields neither source computes (tier, total_received,
 * material_code) keep their neutral defaults.
 */
export async function getWorkGroupEnvelope(
  projectId: string,
  materialId: string,
  boqItemIds: string[],
): Promise<MaterialEnvelopeStatus | null> {
  if (boqItemIds.length === 0) return null;

  const [legs, meta] = await Promise.all([
    getWorkGroupMaterialEnvelopes(projectId, boqItemIds),
    supabase
      .rpc('get_workgroup_envelope', {
        p_project_id: projectId,
        p_material_id: materialId,
        p_boq_item_ids: boqItemIds,
      })
      .single(),
  ]);

  // A failed legs fetch is "we don't know", NOT "planned is 0": returning a
  // zeroed envelope would make the gate render a confident "no baseline" for a
  // material that may well have one. null → the caller shows the soft
  // "Tidak ada alokasi pembanding" heads-up, which is the honest answer.
  if (legs.error) return null;
  if (meta.error || !meta.data) return null;

  const row = meta.data as {
    material_name: string;
    unit: string;
    total_installed: number;
    boq_item_count: number;
  };

  // planned/ordered/requested are taken from 086 even where get_workgroup_envelope
  // also reports planned: 086 resolves "latest master" with the `id DESC`
  // tiebreaker (054), so it is the deterministic one when two masters share a
  // created_at second. (094 adds the same tiebreaker to the RPC, after which the
  // two agree by construction.) A material absent from the group's plan simply
  // has no row here → planned 0, which the gate reads as "no baseline".
  const found = legs.rows.find(r => r.material_id === materialId);
  // EnvelopeLegs, in tools/envelopeMath.ts terms. 086's `requested` leg is
  // already the OUTSTANDING figure that module's contract demands (allocations
  // NOT linked to a live PO), so remainingFree / burnPct('committed') are exact
  // here rather than pessimistic.
  const groupLegs = {
    planned: found?.planned ?? 0,
    ordered: found?.ordered ?? 0,
    requested: found?.requested ?? 0,
  };
  const { planned: totalPlanned, ordered: totalOrdered, requested: totalRequested } = groupLegs;

  return {
    material_id: materialId,
    project_id: projectId,
    material_code: null,
    material_name: row.material_name,
    tier: 1,
    unit: row.unit,
    total_planned: totalPlanned,
    // Real PO leg at group grain — no longer a mirror of the request figure.
    total_ordered: totalOrdered,
    total_requested: totalRequested,
    total_received: 0,
    total_installed: Number(row.total_installed ?? 0),
    // planned − ordered, RAW (may go negative) — the hard-gate semantic, named
    // and owned by tools/envelopeMath.ts remainingToOrder. Same convention as
    // v_material_envelope_status.remaining_to_order and as the server gates
    // (071, 088:671), so the name means ONE thing at every grain. The floored,
    // request-aware figure is remainingFree(legs) — callers that want "sisa
    // bebas" call envelopeMath directly rather than reading a field here.
    remaining_to_order: remainingToOrder(groupLegs),
    // Total committed demand against plan (ordered + requested) — numerically
    // what the old RPC's burn_pct reported, since it summed every non-rejected
    // allocation into one figure. No gate threshold moves.
    //
    // `?? 0` only fires when planned <= 0, and every consumer branches on
    // total_planned <= 0 BEFORE looking at burn_pct (gate1's "Tidak ada alokasi
    // pembanding"), so the 0 is never rendered as "nothing used yet".
    burn_pct: burnPct(groupLegs, 'committed') ?? 0,
    boq_item_count: Number(row.boq_item_count ?? 0),
  };
}

/** One row of get_workgroup_material_envelopes (migration 086). BASE units. */
export interface WorkGroupMaterialEnvelope {
  material_id: string;
  /** Planned demand for this material across the group's BoQ rows (latest master). */
  planned: number;
  /** Group demand already turned into a non-cancelled SANO PO. */
  ordered: number;
  /** Group demand still open (non-rejected requests not yet linked to a live PO). */
  requested: number;
}

/**
 * ALL-materials work-group envelope (migration 086): planned / ordered /
 * requested for every material planned against the given BoQ rows, in ONE round
 * trip. Generalizes getWorkGroupEnvelope above (one material per call) for the
 * BoQ-first request flow and Mode Besi.
 *
 * `ordered + requested` equals getWorkGroupEnvelope's total_ordered by
 * construction — see the verification query in the migration.
 *
 * Returns `{ rows, error }` instead of throwing: a failed envelope fetch is a
 * non-blocking INFO with a retry in the UI (design spec §7), never a dead
 * screen. Numeric coercion is mandatory — PostgREST hands NUMERIC back as a
 * string.
 */
export async function getWorkGroupMaterialEnvelopes(
  projectId: string,
  boqItemIds: string[],
): Promise<{ rows: WorkGroupMaterialEnvelope[]; error: string | null }> {
  if (boqItemIds.length === 0) return { rows: [], error: null };

  const { data, error } = await supabase.rpc('get_workgroup_material_envelopes', {
    p_project_id: projectId,
    p_boq_item_ids: boqItemIds,
  });

  if (error) return { rows: [], error: error.message };

  const raw = (data ?? []) as Array<Record<string, unknown>>;
  return {
    rows: raw.map(row => ({
      material_id: String(row.material_id),
      planned: Number(row.planned ?? 0),
      ordered: Number(row.ordered ?? 0),
      requested: Number(row.requested ?? 0),
    })),
    error: null,
  };
}

/**
 * Signal 2 (plan drift, Task 2.13): per-material {baseline, current, drift_pct}
 * for every material that has a baseline snapshot (077) in this project.
 *
 * Two flat, paginated selects rather than a Supabase relational join: the
 * snapshot table (a real table) and v_material_envelope_status (a view with
 * its own LATERAL joins) don't share a FK Supabase's PostgREST can traverse,
 * and the snapshot row count is small (one per material ever planned) — a
 * plain in-memory Map join is cheaper than round-tripping per material. Both
 * legs use fetchAllPaged since a large multi-building project can exceed the
 * 1000-row default cap (see project memory "SANO single-sheet ingest" for why
 * undercounted material rollups are the class of bug to avoid here).
 *
 * "Current planned" is v_material_envelope_status.total_planned (latest
 * published master) per design spec §4 — never re-derived here, so this
 * agrees with every other envelope-driven surface (PermintaanScreen,
 * ApprovalsScreen, Material Balance report) by construction.
 *
 * A material with a snapshot but no longer present in the current envelope
 * view (removed from the latest publish) is treated as current_planned_qty=0
 * — an honest "no longer planned", not a dropped row.
 */
export async function getMaterialDrift(projectId: string): Promise<MaterialDrift[]> {
  const [snapshots, envelopeRows] = await Promise.all([
    fetchAllPaged<{ material_id: string; baseline_planned_qty: number; unit: string }>((from, to) =>
      supabase
        .from('material_baseline_snapshots')
        .select('material_id, baseline_planned_qty, unit')
        .eq('project_id', projectId)
        .order('material_id', { ascending: true })
        .range(from, to)),
    fetchAllPaged<{ material_id: string; material_name: string; unit: string; total_planned: number }>((from, to) =>
      supabase
        .from('v_material_envelope_status')
        .select('material_id, material_name, unit, total_planned')
        .eq('project_id', projectId)
        .order('material_id', { ascending: true })
        .range(from, to)),
  ]);

  const currentByMaterial = new Map(envelopeRows.map(row => [row.material_id, row]));

  return snapshots.map((snap): MaterialDrift => {
    const current = currentByMaterial.get(snap.material_id);
    const baselinePlannedQty = Number(snap.baseline_planned_qty);
    const currentPlannedQty = Number(current?.total_planned ?? 0);
    return {
      material_id: snap.material_id,
      material_name: current?.material_name ?? '—',
      unit: current?.unit ?? snap.unit,
      baseline_planned_qty: baselinePlannedQty,
      current_planned_qty: currentPlannedQty,
      drift_pct: computeDriftPct(baselinePlannedQty, currentPlannedQty),
    };
  });
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
//
// DELETED 2026-08-31 (migration 094 change): checkTier2Envelope,
// checkMaterialRequest and checkTier1Direct lived here. All three were dead —
// no production caller anywhere in the app (verified by grep across *.ts/*.tsx)
// — and all three had been frozen at the PRE-069 band mapping, which still
// escalated to HIGH above 100% of envelope and CRITICAL above 120%. Request
// time never hard-blocks on quantity (spec §3: severity caps at WARNING), so
// resurrecting any of them would have re-introduced uncapped severities that
// disagree with the server. Their comments had said as much since 069; keeping
// them around only invited someone to wire them back up.
//
// The LIVE gate surfaces, which are the ones to change:
//   • workflows/gates/gate1.ts — computeWorkGroupGate1Flag (Tier-1 work group)
//     and buildProjectEnvelopeOverageResult (Tier-2/3 project grain)
//   • workflows/screens/PermintaanScreen.tsx — buildTier2Result /
//     buildProjectEnvelopeOverageResult wiring
//   • tools/budgetGate.ts — evaluateTier3Budget / evaluateTier3BudgetSoft
//   • tools/requestOverage.ts — the shared band mapping, twinned with
//     migration 069's compute_tier*_flag
//
// checkTier3Budget (above) is deliberately KEPT: it is a thin, current wrapper
// over evaluateTier3Budget with no stale band logic of its own.

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
