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

export async function markOpnamePaid(
  headerId: string,
  paymentReference?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_opname_paid', {
    p_header_id: headerId,
    p_payment_reference: paymentReference ?? null,
  });
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
// Built from mandor_contracts + opname_headers + mandor_kasbon
// (replaces the deleted v_labor_payment_summary view)

export async function getLaborPaymentSummary(
  projectId: string,
): Promise<LaborPaymentSummary[]> {
  const [contractsRes, opnameRes, kasbonRes, ratesRes] = await Promise.all([
    supabase
      .from('mandor_contracts')
      .select('id, mandor_name, trade_categories')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('mandor_name'),
    supabase
      .from('opname_headers')
      .select('contract_id, week_number, opname_date, status, gross_total, retention_amount, net_this_week, kasbon')
      .eq('project_id', projectId)
      .in('status', ['APPROVED', 'PAID']),
    supabase
      .from('mandor_kasbon')
      .select('contract_id, amount')
      .eq('project_id', projectId)
      .in('status', ['REQUESTED', 'APPROVED']),
    supabase
      .from('mandor_contract_rates')
      .select('contract_id, contracted_rate, boq_labor_rate')
      .in('contract_id',
        (await supabase.from('mandor_contracts').select('id').eq('project_id', projectId).eq('is_active', true))
          .data?.map(c => c.id) ?? [],
      ),
  ]);

  const contracts = contractsRes.data ?? [];
  const opnames = opnameRes.data ?? [];
  const kasbons = kasbonRes.data ?? [];
  const rates = ratesRes.data ?? [];

  // Group rates by contract for budget calc
  const ratesByContract = new Map<string, { contracted: number; boq: number }>();
  for (const r of rates) {
    const prev = ratesByContract.get(r.contract_id) ?? { contracted: 0, boq: 0 };
    prev.contracted += Number(r.contracted_rate ?? 0);
    prev.boq += Number(r.boq_labor_rate ?? 0);
    ratesByContract.set(r.contract_id, prev);
  }

  return contracts.map(c => {
    const contractOpnames = opnames.filter(o => o.contract_id === c.id);
    const contractKasbons = kasbons.filter(k => k.contract_id === c.id);

    const totalGross = contractOpnames.reduce((s, o) => s + Number(o.gross_total ?? 0), 0);
    const totalRetention = contractOpnames.reduce((s, o) => s + Number(o.retention_amount ?? 0), 0);
    const totalPaid = contractOpnames.reduce((s, o) => s + Number(o.net_this_week ?? 0), 0);
    const totalKasbon = contractKasbons.reduce((s, k) => s + Number(k.amount ?? 0), 0);
    const budgets = ratesByContract.get(c.id) ?? { contracted: 0, boq: 0 };

    const latest = contractOpnames
      .sort((a, b) => (b.opname_date ?? '').localeCompare(a.opname_date ?? ''))
      [0];
    const variancePct = budgets.boq > 0
      ? Math.round(((budgets.contracted - budgets.boq) / budgets.boq) * 1000) / 10
      : 0;

    return {
      project_id: projectId,
      contract_id: c.id,
      mandor_name: c.mandor_name,
      trade_categories: c.trade_categories ?? [],
      approved_opname_count: contractOpnames.length,
      total_gross: totalGross,
      total_retention: totalRetention,
      total_paid: totalPaid,
      total_kasbon: totalKasbon,
      total_boq_labor_budget: budgets.boq,
      total_contracted_budget: budgets.contracted,
      contract_vs_boq_variance_pct: variancePct,
      latest_approved_week: latest?.week_number ?? null,
      latest_approved_date: latest?.opname_date ?? null,
    } as LaborPaymentSummary;
  });
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
