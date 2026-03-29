/**
 * SANO — Opname RPC Wrapper
 *
 * Thin client that calls Postgres RPCs for all opname operations.
 * No payment computation happens in TypeScript.
 * Replaces client-side logic from tools/opname.ts.
 */

import { supabase } from './supabase';
import type { OpnameProgressFlag } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LaborPaymentSummary {
  project_id: string;
  contract_id: string;
  mandor_name: string;
  trade_categories: string[];
  approved_opname_count: number;
  total_gross: number;
  total_retention: number;
  total_paid: number;
  total_kasbon: number;
  total_boq_labor_budget: number;
  total_contracted_budget: number;
  contract_vs_boq_variance_pct: number;
  latest_approved_week: number | null;
  latest_approved_date: string | null;
}

// ─── Line Updates ──────────────────────────────────────────────────────────

export async function updateOpnameLineProgress(
  lineId: string,
  updates: {
    cumulative_pct?: number;
    verified_pct?: number | null;
    is_tdk_acc?: boolean;
    tdk_acc_reason?: string | null;
    notes?: string | null;
  },
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('update_opname_line_progress', {
    p_line_id: lineId,
    p_cumulative_pct: updates.cumulative_pct ?? null,
    p_verified_pct: updates.verified_pct ?? null,
    p_is_tdk_acc: updates.is_tdk_acc ?? null,
    p_tdk_acc_reason: updates.tdk_acc_reason ?? null,
    p_notes: updates.notes ?? null,
  });
  return { error: error?.message };
}

// ─── Status Transitions ────────────────────────────────────────────────────

export async function submitOpname(headerId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('submit_opname', { p_header_id: headerId });
  return { error: error?.message };
}

export async function verifyOpname(
  headerId: string,
  notes?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('verify_opname', {
    p_header_id: headerId,
    p_notes: notes ?? null,
  });
  return { error: error?.message };
}

export async function approveOpname(
  headerId: string,
  kasbon: number,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('approve_opname', {
    p_header_id: headerId,
    p_kasbon: kasbon,
  });
  return { error: error?.message };
}

export async function markOpnamePaid(headerId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_opname_paid', { p_header_id: headerId });
  return { error: error?.message };
}

// ─── Progress Reconciliation ───────────────────────────────────────────────

export async function getOpnameProgressFlags(
  headerId: string,
): Promise<OpnameProgressFlag[]> {
  const { data } = await supabase
    .from('v_opname_progress_reconciliation')
    .select('line_id, boq_item_id, boq_code, boq_label, claimed_progress_pct, field_progress_pct, variance_pct, variance_flag')
    .eq('header_id', headerId)
    .neq('variance_flag', 'OK')
    .order('variance_pct', { ascending: false });

  return (data ?? []) as OpnameProgressFlag[];
}

// ─── Gate 5: Labor Payment Summary ─────────────────────────────────────────

export async function getLaborPaymentSummary(
  projectId: string,
): Promise<LaborPaymentSummary[]> {
  const { data } = await supabase
    .from('v_labor_payment_summary')
    .select('*')
    .eq('project_id', projectId)
    .order('mandor_name');

  return (data ?? []) as LaborPaymentSummary[];
}

// ─── Refresh Prior Paid ────────────────────────────────────────────────────

export async function refreshPriorPaid(
  headerId: string,
): Promise<{ prior_paid: number; error?: string }> {
  const { data, error } = await supabase.rpc('refresh_prior_paid', {
    p_header_id: headerId,
  });
  return { prior_paid: data ?? 0, error: error?.message };
}
