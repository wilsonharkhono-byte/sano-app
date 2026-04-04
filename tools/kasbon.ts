/**
 * Kasbon (Cash Advance) Tools
 *
 * CRUD and RPC wrappers for the mandor kasbon ledger.
 * Kasbon lifecycle: REQUESTED → APPROVED → SETTLED (auto on opname approval)
 */

import type { Kasbon, KasbonAging } from './types';
import { KasbonStatus } from './constants';
import { fetchAllByField, fetchView, rpcNumeric, rpcWithError } from './queryHelpers';

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all kasbon entries for a contract, ordered by date desc */
export async function getKasbonByContract(contractId: string): Promise<Kasbon[]> {
  return fetchAllByField<Kasbon>('mandor_kasbon', 'contract_id', contractId, 'kasbon_date');
}

/** Get all kasbon entries for a project */
export async function getKasbonByProject(projectId: string): Promise<Kasbon[]> {
  return fetchAllByField<Kasbon>('mandor_kasbon', 'project_id', projectId, 'created_at');
}

/** Get unsettled (APPROVED) kasbon total for a contract */
export async function getUnsettledKasbonTotal(contractId: string): Promise<number> {
  return rpcNumeric('get_unsettled_kasbon_total', { p_contract_id: contractId });
}

/** Get aging kasbon for principal dashboard alerts */
export async function getKasbonAging(projectId: string): Promise<KasbonAging[]> {
  return fetchView<KasbonAging>('v_kasbon_aging', 'project_id', projectId, 'age_days');
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

  return rpcWithError<Kasbon>('request_kasbon', params);
}

/** Approve a kasbon request (admin/principal only) */
export async function approveKasbon(
  kasbonId: string,
): Promise<{ error?: string }> {
  const result = await rpcWithError('approve_kasbon', { p_kasbon_id: kasbonId });
  return { error: result.error };
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
