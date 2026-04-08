// SAN Contractor — Server-Derived Totals
// Computes installed quantities and received totals from append-only event tables
// rather than trusting client-side increments. These functions serve as the
// source of truth for BoQ progress, PO receipt status, and material balances.

import { supabase } from './supabase';

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
    supabase
      .from('boq_items')
      .select('id, planned, installed, unit, tier1_material, tier2_material')
      .eq('project_id', projectId),
    supabase
      .from('ahs_versions')
      .select('id')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1),
    supabase
      .from('purchase_orders')
      .select('id, material_name')
      .eq('project_id', projectId),
    supabase
      .from('receipts')
      .select('id, po_id, receipt_lines(material_name, quantity_actual)')
      .eq('project_id', projectId),
  ]);

  const boqPlannedMap = new Map((boqItems ?? []).map((item) => [item.id, Number(item.planned ?? 0)]));
  const derivedInstalledMap = new Map(boqTotals.map(total => [total.boq_item_id, Number(total.total_installed ?? 0)]));
  const poMaterialMap = new Map((purchaseOrders ?? []).map((po) => [po.id, po.material_name]));
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
      const key = normalizeMaterialKey(line.material_name || poMaterialMap.get(receipt.po_id));
      if (!key) continue;
      receivedByName.set(key, (receivedByName.get(key) ?? 0) + Number(line.quantity_actual ?? 0));
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
    const { data: ahsLines } = await supabase
      .from('ahs_lines')
      .select('material_id, usage_rate, waste_factor, unit, boq_item_id, material_catalog(name)')
      .eq('ahs_version_id', latestAhsId);

    for (const line of ahsLines ?? []) {
      const boqPlanned = boqPlannedMap.get(line.boq_item_id) ?? 0;
      const boqInstalled = derivedInstalledMap.get(line.boq_item_id) ?? 0;
      const multiplier = 1 + Number(line.waste_factor ?? 0);
      const planned = boqPlanned * Number(line.usage_rate ?? 0) * multiplier;
      const installed = boqInstalled * Number(line.usage_rate ?? 0) * multiplier;
      upsertAggregate(
        line.material_id ?? null,
        (line as unknown as { material_catalog?: { name: string } }).material_catalog?.name ?? null,
        line.unit ?? '',
        planned,
        installed,
      );
      hasStructuredBaseline = true;
    }
  } else {
    const { data: masterHeader } = await supabase
      .from('project_material_master')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1);

    const masterId = masterHeader?.[0]?.id;
    if (masterId) {
      const { data: masterLines } = await supabase
        .from('project_material_master_lines')
        .select('material_id, boq_item_id, planned_quantity, unit')
        .eq('master_id', masterId);

      for (const line of masterLines ?? []) {
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
    ? await supabase.from('material_catalog').select('id, name, unit').in('id', materialIds)
    : { data: [] as Array<{ id: string; name: string; unit: string }> };
  const materialMap = new Map((materials ?? []).map((material) => [material.id, material]));

  const balances: MaterialBalance[] = Array.from(aggregate.values()).map((bucket) => {
    const material = bucket.material_id ? materialMap.get(bucket.material_id) : null;
    const materialName = material?.name ?? bucket.material_name ?? bucket.material_id ?? 'Material belum dipetakan';
    const received = receivedByName.get(normalizeMaterialKey(materialName)) ?? 0;
    const unit = bucket.unit || material?.unit || '—';

    return {
      material_name: materialName,
      material_id: bucket.material_id,
      planned: Number(bucket.planned.toFixed(3)),
      received: Number(received.toFixed(3)),
      installed: Number(bucket.installed.toFixed(3)),
      on_site: Number((received - bucket.installed).toFixed(3)),
      unit,
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
