/**
 * Site Changes — unified capture for all field changes
 *
 * Replaces separate defect + VO workflows with a single "Catatan Perubahan"
 * entry point. Supervisor captures quickly, estimator reviews cost/decision.
 */

import { supabase } from './supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChangeType =
  | 'permintaan_owner'
  | 'kondisi_lapangan'
  | 'rework'
  | 'revisi_desain'
  | 'catatan_mutu';

export type Impact = 'ringan' | 'sedang' | 'berat';
export type Decision = 'pending' | 'disetujui' | 'ditolak' | 'selesai';
export type CostBearer = 'mandor' | 'owner' | 'kontraktor';

export interface SiteChange {
  id: string;
  project_id: string;
  location: string;
  description: string;
  photo_urls: string[];
  change_type: ChangeType;
  boq_item_id: string | null;
  contract_id: string | null;
  impact: Impact;
  is_urgent: boolean;
  reported_by: string;
  est_cost: number | null;
  cost_bearer: CostBearer | null;
  needs_owner_approval: boolean;
  decision: Decision;
  reviewed_by: string | null;
  reviewed_at: string | null;
  estimator_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  boq_code?: string;
  boq_label?: string;
  mandor_name?: string;
  reporter_name?: string;
}

export interface SiteChangeSummary {
  pending_count: number;
  pending_berat: number;
  pending_sedang: number;
  approved_unresolved: number;
  open_rework: number;
  open_quality_notes: number;
  approved_cost_total: number;
  total_count: number;
}

// ─── Labels ────────────────────────────────────────────────────────────────

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  permintaan_owner: 'Permintaan Owner',
  kondisi_lapangan: 'Kondisi Lapangan',
  rework: 'Rework / Perbaikan',
  revisi_desain: 'Revisi Desain',
  catatan_mutu: 'Catatan Mutu',
};

export const IMPACT_LABELS: Record<Impact, string> = {
  ringan: 'Ringan',
  sedang: 'Sedang',
  berat: 'Berat',
};

export const IMPACT_COLORS: Record<Impact, string> = {
  ringan: '#3D8B40',
  sedang: '#E65100',
  berat: '#C62828',
};

export const DECISION_LABELS: Record<Decision, string> = {
  pending: 'Pending',
  disetujui: 'Disetujui',
  ditolak: 'Ditolak',
  selesai: 'Selesai',
};

export const COST_BEARER_LABELS: Record<CostBearer, string> = {
  mandor: 'Mandor',
  owner: 'Owner',
  kontraktor: 'Kontraktor',
};

// ─── Queries ───────────────────────────────────────────────────────────────

export async function getSiteChanges(projectId: string): Promise<SiteChange[]> {
  const { data } = await supabase
    .from('site_changes')
    .select('*, boq_items(code, label), mandor_contracts(mandor_name), profiles!site_changes_reported_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & {
      boq_items?: { code?: string; label?: string } | null;
      mandor_contracts?: { mandor_name?: string } | null;
      profiles?: { full_name?: string } | null;
    };
    return {
      ...row,
      boq_code: r.boq_items?.code,
      boq_label: r.boq_items?.label,
      mandor_name: r.mandor_contracts?.mandor_name,
      reporter_name: r.profiles?.full_name,
      boq_items: undefined,
      mandor_contracts: undefined,
      profiles: undefined,
    };
  }) as SiteChange[];
}

export async function getSiteChangeSummary(projectId: string): Promise<SiteChangeSummary> {
  const { data } = await supabase
    .from('v_site_change_summary')
    .select('*')
    .eq('project_id', projectId)
    .single();

  return data ?? {
    pending_count: 0,
    pending_berat: 0,
    pending_sedang: 0,
    approved_unresolved: 0,
    open_rework: 0,
    open_quality_notes: 0,
    approved_cost_total: 0,
    total_count: 0,
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────────

/** Supervisor: quick capture */
export async function createSiteChange(params: {
  projectId: string;
  location: string;
  description: string;
  changeType: ChangeType;
  impact: Impact;
  isUrgent?: boolean;
  boqItemId?: string;
  contractId?: string;
  photoUrls?: string[];
}): Promise<{ data?: SiteChange; error?: string }> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: 'Tidak terautentikasi' };

  const { data, error } = await supabase
    .from('site_changes')
    .insert({
      project_id: params.projectId,
      location: params.location,
      description: params.description,
      change_type: params.changeType,
      impact: params.impact,
      is_urgent: params.isUrgent ?? false,
      boq_item_id: params.boqItemId ?? null,
      contract_id: params.contractId ?? null,
      photo_urls: params.photoUrls ?? [],
      reported_by: user.user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { data: data as SiteChange };
}

/** Estimator/admin: review with cost + decision */
export async function reviewSiteChange(params: {
  id: string;
  decision: Decision;
  estCost?: number;
  costBearer?: CostBearer;
  needsOwnerApproval?: boolean;
  estimatorNote?: string;
}): Promise<{ error?: string }> {
  const updates: Record<string, unknown> = {
    decision: params.decision,
    reviewed_by: (await supabase.auth.getUser()).data.user?.id,
    reviewed_at: new Date().toISOString(),
  };
  if (params.estCost !== undefined) updates.est_cost = params.estCost;
  if (params.costBearer !== undefined) updates.cost_bearer = params.costBearer;
  if (params.needsOwnerApproval !== undefined) updates.needs_owner_approval = params.needsOwnerApproval;
  if (params.estimatorNote !== undefined) updates.estimator_note = params.estimatorNote;

  const { error } = await supabase
    .from('site_changes')
    .update(updates)
    .eq('id', params.id);

  return { error: error?.message };
}

/** Mark resolved */
export async function resolveSiteChange(
  id: string,
  note?: string,
): Promise<{ error?: string }> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  const { error } = await supabase
    .from('site_changes')
    .update({
      decision: 'selesai',
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_note: note ?? null,
    })
    .eq('id', id);

  return { error: error?.message };
}
