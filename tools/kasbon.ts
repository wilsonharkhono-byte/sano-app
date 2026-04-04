/**
 * Kasbon (Cash Advance) Tools
 *
 * CRUD and RPC wrappers for the mandor kasbon ledger.
 * Kasbon lifecycle: REQUESTED → APPROVED → SETTLED (auto on opname approval)
 */

import { supabase } from './supabase';
import type { Kasbon, KasbonAging } from './types';
import { KasbonStatus } from './constants';

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all kasbon entries for a contract, ordered by date desc */
export async function getKasbonByContract(contractId: string): Promise<Kasbon[]> {
  const { data } = await supabase
    .from('mandor_kasbon')
    .select('*')
    .eq('contract_id', contractId)
    .order('kasbon_date', { ascending: false });
  return data ?? [];
}

/** Get all kasbon entries for a project */
export async function getKasbonByProject(projectId: string): Promise<Kasbon[]> {
  const { data } = await supabase
    .from('mandor_kasbon')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Get unsettled (APPROVED) kasbon total for a contract */
export async function getUnsettledKasbonTotal(contractId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_unsettled_kasbon_total', {
    p_contract_id: contractId,
  });
  if (error) return 0;
  return data ?? 0;
}

/** Get aging kasbon for principal dashboard alerts */
export async function getKasbonAging(projectId: string): Promise<KasbonAging[]> {
  const { data } = await supabase
    .from('v_kasbon_aging')
    .select('*')
    .eq('project_id', projectId)
    .order('age_days', { ascending: false });
  return data ?? [];
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Request a new kasbon (supervisor/admin) */
export async function requestKasbon(
  contractId: string,
  amount: number,
  reason: string,
  kasbonDate?: string,
): Promise<{ data?: Kasbon; error?: string }> {
  const params: Record<string, unknown> = {
    p_contract_id: contractId,
    p_amount: amount,
    p_reason: reason,
  };
  if (kasbonDate) params.p_kasbon_date = kasbonDate;

  const { data, error } = await supabase.rpc('request_kasbon', params);
  if (error) return { error: error.message };
  return { data: data as Kasbon };
}

/** Approve a kasbon request (admin/principal only) */
export async function approveKasbon(
  kasbonId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('approve_kasbon', {
    p_kasbon_id: kasbonId,
  });
  return { error: error?.message };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Format kasbon status for display */
export function kasbonStatusLabel(status: Kasbon['status']): string {
  switch (status) {
    case KasbonStatus.REQUESTED: return 'Diajukan';
    case KasbonStatus.APPROVED:  return 'Disetujui';
    case KasbonStatus.SETTLED:   return 'Terpotong';
    default:          return status;
  }
}

/** Format kasbon status color */
export function kasbonStatusColor(status: Kasbon['status']): string {
  switch (status) {
    case KasbonStatus.REQUESTED: return '#E65100'; // orange
    case KasbonStatus.APPROVED:  return '#1565C0'; // blue
    case KasbonStatus.SETTLED:   return '#3D8B40'; // green
    default:          return '#524E49';
  }
}
