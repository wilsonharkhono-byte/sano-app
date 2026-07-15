// SAN Contractor — Server-Derived Totals
// Computes installed quantities and received totals from append-only event tables
// rather than trusting client-side increments. These functions serve as the
// source of truth for BoQ progress, PO receipt status, and material balances.

import { supabase } from './supabase';
import { fetchAllPaged } from './queryHelpers';
import { displayQty, type MaterialUnitInfo } from './materialUnitConversion';
import type { FlagLevel, MaterialBudgetStatus } from './types';

function normalizeMaterialKey(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

// ── BoQ Installed Totals ─────────────────────────────────────────────
// Sum progress_entries per BoQ item to derive the true installed quantity.

export interface DerivedBoqTotal {
  boq_item_id: string;
  total_installed: number;
  entry_count: number;
  last_entry_at: string | null;
}

export async function deriveBoqInstalledTotals(projectId: string): Promise<DerivedBoqTotal[]> {
  const { data, error } = await supabase.rpc('derive_boq_installed', { p_project_id: projectId });
  if (error) {
    console.warn('derive_boq_installed RPC failed, falling back to client query:', error.message);
    return deriveBoqInstalledFallback(projectId);
  }
  return data ?? [];
}

async function deriveBoqInstalledFallback(projectId: string): Promise<DerivedBoqTotal[]> {
  const { data: entries } = await supabase
    .from('progress_entries')
    .select('boq_item_id, quantity, created_at')
    .eq('project_id', projectId);

  if (!entries || entries.length === 0) return [];

  const totals = new Map<string, DerivedBoqTotal>();
  for (const e of entries) {
    const existing = totals.get(e.boq_item_id);
    if (existing) {
      existing.total_installed += e.quantity;
      existing.entry_count += 1;
      if (!existing.last_entry_at || e.created_at > existing.last_entry_at) {
        existing.last_entry_at = e.created_at;
      }
    } else {
      totals.set(e.boq_item_id, {
        boq_item_id: e.boq_item_id,
        total_installed: e.quantity,
        entry_count: 1,
        last_entry_at: e.created_at,
      });
    }
  }
  return Array.from(totals.values());
}

// ── PO Received Totals ──────────────────────────────────────────────
// Sum receipt_lines per PO to derive the true received quantity.

export interface DerivedPoTotal {
  po_id: string;
  material_name: string;
  total_received: number;
  receipt_count: number;
  last_receipt_at: string | null;
}

export async function derivePoReceivedTotals(projectId: string): Promise<DerivedPoTotal[]> {
  const { data, error } = await supabase.rpc('derive_po_received', { p_project_id: projectId });
  if (error) {
    console.warn('derive_po_received RPC failed, falling back to client query:', error.message);
    return derivePoReceivedFallback(projectId);
  }
  return data ?? [];
}

async function derivePoReceivedFallback(projectId: string): Promise<DerivedPoTotal[]> {
  const { data: receipts } = await supabase
    .from('receipts')
    .select('id, po_id, created_at')
    .eq('project_id', projectId);

  if (!receipts || receipts.length === 0) return [];

  const receiptIds = receipts.map(r => r.id);
  const { data: lines } = await supabase
    .from('receipt_lines')
    .select('receipt_id, material_name, quantity_actual')
    .in('receipt_id', receiptIds);

  const receiptMap = new Map(receipts.map(r => [r.id, r]));
  const totals = new Map<string, DerivedPoTotal>();

  for (const line of lines ?? []) {
    const receipt = receiptMap.get(line.receipt_id);
    if (!receipt) continue;
    const key = receipt.po_id;
    const existing = totals.get(key);
    if (existing) {
      existing.total_received += line.quantity_actual;
      existing.receipt_count += 1;
      if (!existing.last_receipt_at || receipt.created_at > existing.last_receipt_at) {
        existing.last_receipt_at = receipt.created_at;
      }
    } else {
      totals.set(key, {
        po_id: receipt.po_id,
        material_name: line.material_name,
        total_received: line.quantity_actual,
        receipt_count: 1,
        last_receipt_at: receipt.created_at,
      });
    }
  }
  return Array.from(totals.values());
}

// ── Material Balance ────────────────────────────────────────────────
// Compares planned (from material master) vs received (from receipts)
// vs installed (from progress) to show material balance per item.

export interface MaterialBalance {
  material_name: string;
  material_id: string | null;
  planned: number;
  received: number;
  installed: number;
  on_site: number;  // received - installed
  unit: string;
}

export async function deriveMaterialBalance(projectId: string): Promise<MaterialBalance[]> {
  const [boqTotals, { data: boqItems }, { data: latestAhs }, { data: purchaseOrders }, { data: receipts }] = await Promise.all([
    deriveBoqInstalledTotals(projectId),
    // Task 3.1: active-plan-only. `boqPlannedMap`/`boqItems` below feed BOTH
    // the ahs_lines path (already scoped to the latest ahs_version, whose
    // boq_item_id set can never include a superseded row by construction —
    // this filter is a no-op there) AND the legacy v1 fallback loop (no
    // ahs_version/master scoping at all — there, a superseded row WOULD
    // double-count into the balance without this filter). See migration
    // 074_boq_items_supersede.sql.
    supabase
      .from('boq_items')
      .select('id, planned, installed, unit, tier1_material, tier2_material')
      .eq('project_id', projectId)
      .is('superseded_at', null),
    // Pick the CURRENT baseline, not "highest version" — every publish writes
    // version=1, so ordering by version is a tie that can return a stale,
    // demoted version. publishBaselineV2 maintains is_current (demote old →
    // insert new), so filter on it; fall back to newest published_at.
    supabase
      .from('ahs_versions')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .order('published_at', { ascending: false })
      .limit(1),
    supabase
      .from('purchase_orders')
      .select('id, material_name')
      .eq('project_id', projectId),
    supabase
      .from('receipts')
      .select('id, po_id, receipt_lines(material_id, material_name, quantity_actual)')
      .eq('project_id', projectId),
  ]);

  const boqPlannedMap = new Map((boqItems ?? []).map((item) => [item.id, Number(item.planned ?? 0)]));
  const derivedInstalledMap = new Map(boqTotals.map(total => [total.boq_item_id, Number(total.total_installed ?? 0)]));
  const poMaterialMap = new Map((purchaseOrders ?? []).map((po) => [po.id, po.material_name]));
  // Received quantities are aggregated into TWO maps: by catalog material_id
  // (the reliable join, populated once receipt_lines carry material_id — mig 055)
  // and by normalized material_name (the legacy fallback for lines with no id).
  // The lookup site tries id first, then name, so a receipt whose free-text name
  // differs from the catalog name still reconciles via its material_id.
  const receivedById = new Map<string, number>();
  const receivedByName = new Map<string, number>();

  for (const receipt of receipts ?? []) {
    const receiptLines = Array.isArray(receipt.receipt_lines) ? receipt.receipt_lines : [];
    if (receiptLines.length === 0) {
      const fallbackName = poMaterialMap.get(receipt.po_id);
      if (fallbackName) {
        receivedByName.set(
          normalizeMaterialKey(fallbackName),
          (receivedByName.get(normalizeMaterialKey(fallbackName)) ?? 0),
        );
      }
      continue;
    }

    for (const line of receiptLines) {
      const qty = Number(line.quantity_actual ?? 0);
      const materialId = (line as { material_id?: string | null }).material_id ?? null;
      if (materialId) {
        receivedById.set(materialId, (receivedById.get(materialId) ?? 0) + qty);
        continue;
      }
      const key = normalizeMaterialKey(line.material_name || poMaterialMap.get(receipt.po_id));
      if (!key) continue;
      receivedByName.set(key, (receivedByName.get(key) ?? 0) + qty);
    }
  }

  type AggregateBucket = {
    material_id: string | null;
    material_name: string | null;
    planned: number;
    installed: number;
    unit: string;
  };
  const aggregate = new Map<string, AggregateBucket>();

  const upsertAggregate = (
    materialId: string | null,
    materialName: string | null,
    unit: string,
    planned: number,
    installed: number,
  ) => {
    const normalizedName = normalizeMaterialKey(materialName);
    const key = materialId ?? (normalizedName ? `name:${normalizedName}` : `unknown:${unit}`);
    const existing = aggregate.get(key);
    if (existing) {
      existing.planned += planned;
      existing.installed += installed;
      if (!existing.unit && unit) existing.unit = unit;
      if (!existing.material_name && materialName) existing.material_name = materialName;
    } else {
      aggregate.set(key, {
        material_id: materialId,
        material_name: materialName,
        planned,
        installed,
        unit,
      });
    }
  };

  const latestAhsId = latestAhs?.[0]?.id;
  let hasStructuredBaseline = false;
  if (latestAhsId) {
    // ahs_lines is a per-component table — a large multi-building baseline has
    // thousands of rows (well past Supabase's default 1000-row cap). An
    // unpaginated fetch silently truncates, making the balance undercount every
    // material; page through all rows. Order by id for stable, non-overlapping
    // pages.
    const ahsLines = await fetchAllPaged<{
      material_id: string | null;
      usage_rate: number | null;
      coefficient?: number;
      waste_factor?: number;
      unit?: string;
      boq_item_id: string;
      material_spec?: string;
      line_type?: string;
      material_catalog?: { name: string } | null;
    }>((from, to) =>
      supabase
        .from('ahs_lines')
        .select('material_id, usage_rate, coefficient, waste_factor, unit, boq_item_id, material_spec, line_type, material_catalog(name)')
        .eq('ahs_version_id', latestAhsId)
        // Material Balance is materials only — exclude labor (Upah), equipment
        // (Sewa) and subcontractor lines, which carry cost not a material balance.
        .eq('line_type', 'material')
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: { message?: string } | null }>);

    for (const line of ahsLines) {
      const boqPlanned = boqPlannedMap.get(line.boq_item_id) ?? 0;
      const boqInstalled = derivedInstalledMap.get(line.boq_item_id) ?? 0;
      // The v2 publish writes the per-unit quantity to `coefficient` (waste
      // already folded in) and leaves `usage_rate` at 0; v1 used `usage_rate` +
      // a separate `waste_factor`. Prefer coefficient, fall back to usage_rate —
      // without this, every v2-published project shows planned = 0.
      const rate = Number((line as { coefficient?: number }).coefficient) || Number(line.usage_rate ?? 0);
      const multiplier = 1 + Number(line.waste_factor ?? 0);
      const planned = boqPlanned * rate * multiplier;
      const installed = boqInstalled * rate * multiplier;
      // Prefer the catalog name; fall back to the line's own material_spec so an
      // unlinked component still shows its real name (e.g. "Beton readymix K-350")
      // instead of collapsing into a generic "Material belum dipetakan" unit bucket.
      const catalogName = (line as unknown as { material_catalog?: { name: string } }).material_catalog?.name;
      const specName = (line as unknown as { material_spec?: string }).material_spec;
      upsertAggregate(
        line.material_id ?? null,
        catalogName ?? specName ?? null,
        line.unit ?? '',
        planned,
        installed,
      );
      hasStructuredBaseline = true;
    }
  }

  if (!hasStructuredBaseline) {
    const { data: masterHeader } = await supabase
      .from('project_material_master')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1);

    const masterId = masterHeader?.[0]?.id;
    if (masterId) {
      // Same 1000-row cap concern as ahs_lines — page through every master line.
      const masterLines = await fetchAllPaged<{
        material_id: string | null;
        boq_item_id: string;
        planned_quantity: number | null;
        unit?: string;
      }>((from, to) =>
        supabase
          .from('project_material_master_lines')
          .select('material_id, boq_item_id, planned_quantity, unit')
          .eq('master_id', masterId)
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: { message?: string } | null }>);

      for (const line of masterLines) {
        const boqPlanned = boqPlannedMap.get(line.boq_item_id) ?? 0;
        const boqInstalled = derivedInstalledMap.get(line.boq_item_id) ?? 0;
        const ratio = boqPlanned > 0 ? boqInstalled / boqPlanned : 0;
        upsertAggregate(
          line.material_id ?? null,
          null,
          line.unit ?? '',
          Number(line.planned_quantity ?? 0),
          Number(line.planned_quantity ?? 0) * ratio,
        );
        hasStructuredBaseline = true;
      }
    }
  }

  if (!hasStructuredBaseline) {
    for (const item of boqItems ?? []) {
      const planned = Number(item.planned ?? 0);
      const installed = derivedInstalledMap.get(item.id) ?? Number(item.installed ?? 0);
      const unit = item.unit ?? '—';

      if (item.tier1_material) {
        upsertAggregate(null, item.tier1_material, unit, planned, installed);
      }
      if (item.tier2_material) {
        upsertAggregate(null, item.tier2_material, unit, planned, installed);
      }
    }
  }

  const materialIds = Array.from(new Set(Array.from(aggregate.values()).map(item => item.material_id).filter(Boolean))) as string[];
  const { data: materials } = materialIds.length > 0
    ? await supabase.from('material_catalog').select('id, name, unit, supplier_unit, base_qty_per_supplier_unit').in('id', materialIds)
    : { data: [] as Array<{ id: string; name: string; unit: string; supplier_unit: string | null; base_qty_per_supplier_unit: number | null }> };
  const materialMap = new Map((materials ?? []).map((material) => [material.id, material]));

  const balances: MaterialBalance[] = Array.from(aggregate.values()).map((bucket) => {
    const material = bucket.material_id ? materialMap.get(bucket.material_id) : null;
    const materialName = material?.name ?? bucket.material_name ?? bucket.material_id ?? 'Material belum dipetakan';
    // Prefer the id link (a receipt keyed to this material_id counts even when
    // its free-text name differs from the catalog name); fall back to the name
    // key for legacy/unlinked receipt lines.
    const receivedForId = bucket.material_id ? receivedById.get(bucket.material_id) : undefined;
    const received = receivedForId ?? receivedByName.get(normalizeMaterialKey(materialName)) ?? 0;

    // Quantities are stored in the material's BASE unit (kg for rebar). Rebar is
    // ordered and shown in SUPPLIER units (batang); every order/gate/catalog
    // screen already converts via `displayQty`. Route the report through the
    // same helper so besi reads in batang here too — not raw stored kg. Materials
    // without a factor pass through unchanged.
    const info: MaterialUnitInfo = {
      unit: bucket.unit || material?.unit || '—',
      supplier_unit: material?.supplier_unit ?? null,
      base_qty_per_supplier_unit: material?.base_qty_per_supplier_unit ?? null,
    };
    const round3 = (n: number) => Number(n.toFixed(3));
    const plannedDisp = displayQty(bucket.planned, info);

    return {
      material_name: materialName,
      material_id: bucket.material_id,
      planned: round3(plannedDisp.qty),
      received: round3(displayQty(received, info).qty),
      installed: round3(displayQty(bucket.installed, info).qty),
      on_site: round3(displayQty(received - bucket.installed, info).qty),
      unit: plannedDisp.unit,
    };
  });

  return balances.sort((a, b) => a.material_name.localeCompare(b.material_name));
}

// ── Sync Derived Totals Back to BoQ ─────────────────────────────────
// Updates boq_items.installed from derived totals. Call after progress entries.

export async function syncBoqInstalledFromDerived(projectId: string): Promise<number> {
  const totals = await deriveBoqInstalledTotals(projectId);
  let updated = 0;

  for (const t of totals) {
    const { error } = await supabase
      .from('boq_items')
      .update({
        installed: t.total_installed,
        progress: 0, // Will be recomputed below
      })
      .eq('id', t.boq_item_id);

    if (!error) {
      // Recompute progress percentage
      const { data: item } = await supabase
        .from('boq_items')
        .select('planned')
        .eq('id', t.boq_item_id)
        .single();

      if (item && item.planned > 0) {
        const pct = Math.min(100, Math.round((t.total_installed / item.planned) * 100));
        await supabase.from('boq_items').update({ progress: pct }).eq('id', t.boq_item_id);
      }
      updated++;
    }
  }
  return updated;
}

// ── Control-aware Material Balance ───────────────────────────────────
// Merges quantity balances with Rupiah budgets into one row per material.
// control = QTY for tier 1/2, RP for tier 3, NONE for tier 4 / unpriced.
// flag/burn are driven by the control dimension.

export interface MaterialBalanceRow extends MaterialBalance {
  tier: 1 | 2 | 3 | 4 | null;
  control: 'QTY' | 'RP' | 'NONE';
  benchmark_unit_price: number | null;
  budget_total_rupiah: number | null;
  committed_rupiah: number | null;
  burn_pct: number | null;     // burn on the CONTROL dimension
  flag: FlagLevel;
}

const QTY_WARN = 80, QTY_OVER = 100, RP_WARN = 80, RP_OVER = 100, RP_CRIT = 120;

/**
 * Merge quantity balances with Rupiah budgets into one row per material.
 * control = QTY for tier 1/2, RP for tier 3, NONE for tier 4 / unpriced.
 * flag/burn are driven by the control dimension.
 */
export function buildMaterialBalanceRows(
  balances: MaterialBalance[],
  budgets: MaterialBudgetStatus[],
): MaterialBalanceRow[] {
  const byId = new Map(budgets.filter(b => b.material_id).map(b => [b.material_id, b]));
  return balances.map((b) => {
    const bud = b.material_id ? byId.get(b.material_id) ?? null : null;
    const tier = (bud?.tier ?? null) as MaterialBalanceRow['tier'];
    const control: MaterialBalanceRow['control'] =
      tier === 3 ? 'RP' : tier === 4 ? 'NONE' : tier === 1 || tier === 2 ? 'QTY' : 'QTY';

    let burn: number | null = null;
    let flag: FlagLevel = 'OK';
    // NOTE: report RP bands are coarser than the Tier-3 gate (tools/budgetGate.ts):
    // the gate also has an INFO (>50%) band and evaluates PROSPECTIVE burn (committed +
    // this order), whereas the report shows CURRENT committed burn with OK/WARNING/HIGH/
    // CRITICAL only. A material can read OK here yet INFO at the gate — this is intended.
    if (control === 'RP' && bud?.budget_total_rupiah) {
      burn = bud.burn_pct;
      flag = (burn ?? 0) > RP_CRIT ? 'CRITICAL' : (burn ?? 0) > RP_OVER ? 'HIGH' : (burn ?? 0) > RP_WARN ? 'WARNING' : 'OK';
    } else if (control === 'QTY' && b.planned > 0) {
      burn = Math.round((b.received / b.planned) * 1000) / 10;
      flag = burn > QTY_OVER ? 'HIGH' : burn > QTY_WARN ? 'WARNING' : 'OK';
    } else if (control === 'NONE') {
      burn = null; flag = 'OK';
    }

    return {
      ...b,
      tier,
      control,
      benchmark_unit_price: bud?.benchmark_unit_price ?? null,
      budget_total_rupiah: bud?.budget_total_rupiah ?? null,
      committed_rupiah: bud?.committed_rupiah ?? null,
      burn_pct: burn,
      flag,
    };
  });
}

export async function deriveMaterialBalanceWithControl(projectId: string): Promise<MaterialBalanceRow[]> {
  const [balances, { data: budgetRows }] = await Promise.all([
    deriveMaterialBalance(projectId),
    supabase.from('v_material_budget_status').select('*').eq('project_id', projectId),
  ]);
  return buildMaterialBalanceRows(balances, (budgetRows ?? []) as MaterialBudgetStatus[]);
}
