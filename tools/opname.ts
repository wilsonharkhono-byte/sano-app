/**
 * SANO — Opname (Weekly Progress Payment) Tool
 *
 * Handles:
 *  - Mandor contract CRUD
 *  - Opname header + line CRUD
 *  - Approval workflow (DRAFT → SUBMITTED → VERIFIED → APPROVED → PAID)
 *  - Payment waterfall computation
 *  - Excel opname sheet export (matching mandor's expected format)
 */

import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { TradeCategory } from './laborTrade';

// ─── DEPRECATION NOTICE ──────────────────────────────────────────────────────
// Client-side payment computation functions in this file are DEPRECATED.
// Use tools/opnameRpc.ts instead, which calls Postgres RPCs directly.
// Kept here for backward compatibility during migration.
//
// Deprecated functions (still work via RPC, but prefer opnameRpc.ts):
//   updateOpnameLine      → use opnameRpc.updateOpnameLineProgress
//   submitOpname          → use opnameRpc.submitOpname
//   verifyOpname          → use opnameRpc.verifyOpname
//   approveOpname         → use opnameRpc.approveOpname
//   markOpnamePaid        → use opnameRpc.markOpnamePaid
// ─────────────────────────────────────────────────────────────────────────────

export {
  updateOpnameLineProgress,
  submitOpname as submitOpnameRpc,
  verifyOpname as verifyOpnameRpc,
  approveOpname as approveOpnameRpc,
  markOpnamePaid as markOpnamePaidRpc,
  // getOpnameProgressFlags is defined locally below — use opnameRpc.ts for new callers
  getLaborPaymentSummary,
  refreshPriorPaid,
} from './opnameRpc';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MandorContract {
  id: string;
  project_id: string;
  mandor_name: string;
  trade_categories: TradeCategory[];
  retention_pct: number;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface MandorContractRate {
  id: string;
  contract_id: string;
  boq_item_id: string;
  contracted_rate: number;
  boq_labor_rate: number;
  unit: string;
  notes: string | null;
  // Joined
  boq_label?: string;
  boq_volume?: number;
  variance_pct?: number;
}

export interface OpnameHeader {
  id: string;
  project_id: string;
  contract_id: string;
  week_number: number;
  opname_date: string;
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'APPROVED' | 'PAID';
  submitted_by: string | null;
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verifier_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  gross_total: number;
  retention_pct: number;
  retention_amount: number;
  net_to_date: number;
  prior_paid: number;
  kasbon: number;
  net_this_week: number;
  created_at: string;
  // Joined
  mandor_name?: string;
}

export interface OpnameLine {
  id: string;
  header_id: string;
  boq_item_id: string;
  description: string;
  unit: string;
  budget_volume: number;
  contracted_rate: number;
  boq_labor_rate: number;
  cumulative_pct: number;
  verified_pct: number | null;
  prev_cumulative_pct: number;
  this_week_pct: number;
  cumulative_amount: number;
  this_week_amount: number;
  is_tdk_acc: boolean;
  tdk_acc_reason: string | null;
  notes: string | null;
}

export interface OpnameProgressFlag {
  line_id: string;
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  claimed_progress_pct: number;
  field_progress_pct: number;
  variance_pct: number;
  variance_flag: 'OK' | 'WARNING' | 'HIGH';
}

export interface OpnameSummary {
  gross_total: number;
  retention_pct: number;
  retention_amount: number;
  net_to_date: number;
  prior_paid: number;
  kasbon: number;
  net_this_week: number;
}

// ─── Mandor Contract CRUD ─────────────────────────────────────────────────

export async function getMandorContracts(projectId: string): Promise<MandorContract[]> {
  const { data } = await supabase
    .from('mandor_contracts')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('mandor_name');
  return (data ?? []) as MandorContract[];
}

export async function createMandorContract(
  projectId: string,
  createdBy: string,
  mandorName: string,
  tradeCategories: TradeCategory[],
  retentionPct: number,
  notes?: string,
): Promise<MandorContract | null> {
  const { data } = await supabase
    .from('mandor_contracts')
    .insert({
      project_id: projectId,
      mandor_name: mandorName,
      trade_categories: tradeCategories,
      retention_pct: retentionPct,
      notes: notes ?? null,
      created_by: createdBy,
    })
    .select()
    .single();
  return (data ?? null) as MandorContract | null;
}

export async function updateMandorContract(
  contractId: string,
  updates: Partial<Pick<MandorContract, 'mandor_name' | 'trade_categories' | 'retention_pct' | 'notes'>>,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('mandor_contracts')
    .update(updates)
    .eq('id', contractId);
  return { error: error?.message };
}

// ─── Contract Rates CRUD ──────────────────────────────────────────────────

export async function getContractRates(contractId: string): Promise<MandorContractRate[]> {
  const { data } = await supabase
    .from('mandor_contract_rates')
    .select(`
      *,
      boq_items(label, planned, unit)
    `)
    .eq('contract_id', contractId)
    .order('boq_items(label)');

  return (data ?? []).map(r => ({
    ...r,
    boq_label: r.boq_items?.label,
    boq_volume: r.boq_items?.planned,
    variance_pct: r.boq_labor_rate > 0
      ? ((r.contracted_rate - r.boq_labor_rate) / r.boq_labor_rate) * 100
      : null,
  })) as MandorContractRate[];
}

export async function upsertContractRate(
  contractId: string,
  boqItemId: string,
  contractedRate: number,
  boqLaborRate: number,
  unit: string,
  notes?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('mandor_contract_rates')
    .upsert({
      contract_id: contractId,
      boq_item_id: boqItemId,
      contracted_rate: contractedRate,
      boq_labor_rate: boqLaborRate,
      unit,
      notes: notes ?? null,
    }, { onConflict: 'contract_id,boq_item_id' });
  return { error: error?.message };
}

// ─── Opname Header CRUD ───────────────────────────────────────────────────

export async function getOpnameHeaders(
  projectId: string,
  contractId?: string,
): Promise<OpnameHeader[]> {
  let q = supabase
    .from('opname_headers')
    .select('*, mandor_contracts(mandor_name)')
    .eq('project_id', projectId)
    .order('week_number', { ascending: false });

  if (contractId) q = q.eq('contract_id', contractId);

  const { data } = await q;
  return (data ?? []).map(h => ({
    ...h,
    mandor_name: h.mandor_contracts?.mandor_name,
  })) as OpnameHeader[];
}

export async function createOpnameHeader(
  projectId: string,
  contractId: string,
  weekNumber: number,
  opnameDate: string,
  retentionPct: number,
): Promise<OpnameHeader | null> {
  // Auto-compute prior_paid from all previous APPROVED/PAID opnames
  const { data: priorData } = await supabase
    .rpc('get_prior_paid', { p_contract_id: contractId, p_week_number: weekNumber });
  const priorPaid = priorData ?? 0;

  const { data } = await supabase
    .from('opname_headers')
    .insert({
      project_id: projectId,
      contract_id: contractId,
      week_number: weekNumber,
      opname_date: opnameDate,
      retention_pct: retentionPct,
      prior_paid: priorPaid,
      status: 'DRAFT',
    })
    .select()
    .single();
  return (data ?? null) as OpnameHeader | null;
}

// ─── Opname Lines CRUD ────────────────────────────────────────────────────

export async function getOpnameLines(headerId: string): Promise<OpnameLine[]> {
  const { data } = await supabase
    .from('opname_lines')
    .select('*')
    .eq('header_id', headerId)
    .order('description');
  return (data ?? []) as OpnameLine[];
}

export async function getOpnameProgressFlags(headerId: string): Promise<OpnameProgressFlag[]> {
  const { data } = await supabase
    .from('v_opname_progress_reconciliation')
    .select('line_id, boq_item_id, boq_code, boq_label, claimed_progress_pct, field_progress_pct, variance_pct, variance_flag')
    .eq('header_id', headerId)
    .neq('variance_flag', 'OK')
    .order('variance_pct', { ascending: false });

  return (data ?? []) as OpnameProgressFlag[];
}

/**
 * Initialise lines for a new opname — one line per BoQ item in the mandor's scope.
 * Auto-fills prev_cumulative_pct, contracted_rate, boq_labor_rate from prior data.
 */
export async function initOpnameLines(
  headerId: string,
  contractId: string,
  weekNumber: number,
): Promise<{ count: number; error?: string }> {
  // Get all BoQ items this mandor has rates for
  const { data: rates } = await supabase
    .from('mandor_contract_rates')
    .select(`
      boq_item_id, contracted_rate, boq_labor_rate, unit,
      boq_items(label, planned)
    `)
    .eq('contract_id', contractId);

  if (!rates?.length) return { count: 0, error: 'Belum ada item rates untuk mandor ini.' };

  const lines = [];
  for (const rate of rates) {
    const boqItem = rate.boq_items as any;

    // Get prev cumulative %
    const { data: prevPct } = await supabase.rpc('get_prev_line_pct', {
      p_contract_id: contractId,
      p_boq_item_id: rate.boq_item_id,
      p_week_number: weekNumber,
    });

    lines.push({
      header_id: headerId,
      boq_item_id: rate.boq_item_id,
      description: boqItem?.label ?? '',
      unit: rate.unit,
      budget_volume: boqItem?.planned ?? 0,
      contracted_rate: rate.contracted_rate,
      boq_labor_rate: rate.boq_labor_rate,
      cumulative_pct: prevPct ?? 0,  // default = carry over from last week
      prev_cumulative_pct: prevPct ?? 0,
      cumulative_amount: 0,
      this_week_amount: 0,
      is_tdk_acc: false,
    });
  }

  const { error } = await supabase.from('opname_lines').insert(lines);
  return { count: lines.length, error: error?.message };
}

/**
 * Update a single opname line's progress % and recompute amounts.
 * Also recomputes the header totals.
 */
export async function updateOpnameLine(
  lineId: string,
  _headerId: string,
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

// ─── Approval workflow ────────────────────────────────────────────────────

export async function submitOpname(
  headerId: string,
  _submittedBy: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('submit_opname', {
    p_header_id: headerId,
  });
  return { error: error?.message };
}

export async function verifyOpname(
  headerId: string,
  _verifiedBy: string,
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
  _approvedBy: string,
  kasbon: number,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('approve_opname', {
    p_header_id: headerId,
    p_kasbon: kasbon,
  });
  return { error: error?.message };
}

export async function markOpnamePaid(headerId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_opname_paid', {
    p_header_id: headerId,
  });
  return { error: error?.message };
}

// ─── Excel Export ─────────────────────────────────────────────────────────

/**
 * Generate opname Excel sheet matching the Embong Kenongo template format.
 * Returns an ArrayBuffer for download/share.
 */
export async function exportOpnameToExcel(
  headerId: string,
  projectName: string,
  ownerName: string,
  location: string,
): Promise<ArrayBuffer> {
  const [headerRes, linesRes] = await Promise.all([
    supabase.from('opname_headers')
      .select('*, mandor_contracts(mandor_name, retention_pct)')
      .eq('id', headerId)
      .single(),
    supabase.from('opname_lines')
      .select('*')
      .eq('header_id', headerId)
      .order('description'),
  ]);

  const header = headerRes.data as any;
  const lines = (linesRes.data ?? []) as OpnameLine[];
  const mandorName = header?.mandor_contracts?.mandor_name ?? '';

  const wb = XLSX.utils.book_new();
  const sheetName = `OPM${header.week_number}`;

  // Build rows
  const rows: any[][] = [];

  // ── Header block ──────────────────────────────────────────────────────
  rows.push(['OPNAME PEKERJAAN FISIK']);
  rows.push([]);
  rows.push(['Pemilik', `: ${ownerName}`]);
  rows.push(['Lokasi', `: ${location}`]);
  rows.push(['Tgl', `: ${new Date(header.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, '', '', `Opname Minggu ke: ${header.week_number}`]);
  rows.push([]);
  rows.push(['No.', 'Uraian Pekerjaan', '', 'Vol', 'Sat', 'H. Satuan (Rp)', 'Progress (%)', 'Selesai (Rp)', 'Prog. Lalu (%)', 'Delta (%)']);
  rows.push([]);

  // ── Line items ────────────────────────────────────────────────────────
  let itemNum = 0;
  for (const line of lines) {
    itemNum++;
    const effectivePct = (line.verified_pct ?? line.cumulative_pct) / 100;
    const prevPct = line.prev_cumulative_pct / 100;
    const thisPct = Math.max(0, effectivePct - prevPct);
    const selesai = line.is_tdk_acc ? 0 : line.cumulative_amount;

    rows.push([
      itemNum,
      line.description,
      '',
      line.budget_volume,
      line.unit,
      line.contracted_rate,
      effectivePct,
      selesai,
      prevPct,
      thisPct,
      line.is_tdk_acc ? 'TDK ACC' : '',
      line.tdk_acc_reason ?? '',
    ]);
  }

  rows.push([]);

  // ── Payment waterfall ─────────────────────────────────────────────────
  const dataStartRow = 9; // 1-based row where item data starts
  const dataEndRow = dataStartRow + lines.length - 1;
  const selesaiCol = 'H'; // column H = Selesai (Rp)

  rows.push(['', '', '', '', '', '', 'Total Pekerjaan', header.gross_total]);
  rows.push(['', '', '', '', '', '', `Retensi ${header.retention_pct}%`, -header.retention_amount]);
  rows.push(['', '', '', '', '', '', 'Yang Dibayarkan s/d Minggu Ini', header.net_to_date]);
  rows.push(['', '', '', '', '', '', 'Yang Dibayarkan s/d Minggu Lalu', -header.prior_paid]);
  rows.push(['', '', '', '', '', '', 'Kasbon', -header.kasbon]);
  rows.push([]);
  rows.push(['', '', '', '', '', '', 'SISA BAYAR MINGGU INI', header.net_this_week]);
  rows.push([]);

  // ── Signature block ───────────────────────────────────────────────────
  rows.push([`Dibuat Oleh,`, '', '', 'Diperiksa,', '', '', 'Disetujui,']);
  rows.push([]);
  rows.push([]);
  rows.push([]);
  rows.push([mandorName, '', '', '(Estimator)', '', '', '(Admin)']);
  rows.push(['Mandor']);

  // ── Create worksheet ──────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 5 },   // A: No
    { wch: 40 },  // B: Uraian
    { wch: 3 },   // C: (merge)
    { wch: 10 },  // D: Vol
    { wch: 6 },   // E: Sat
    { wch: 18 },  // F: H.Satuan
    { wch: 13 },  // G: Progress%
    { wch: 18 },  // H: Selesai
    { wch: 13 },  // I: Prog.Lalu
    { wch: 10 },  // J: Delta
    { wch: 10 },  // K: TDK ACC flag
    { wch: 25 },  // L: TDK ACC reason
  ];

  // Number formats
  const rp = (cell: string) => {
    if (ws[cell]) ws[cell].z = '#,##0';
  };
  const pct = (cell: string) => {
    if (ws[cell]) ws[cell].z = '0%';
  };

  // Format data rows
  for (let i = 0; i < lines.length; i++) {
    const row = dataStartRow + i; // 1-based
    rp(XLSX.utils.encode_cell({ r: row - 1, c: 5 })); // H.Satuan
    rp(XLSX.utils.encode_cell({ r: row - 1, c: 7 })); // Selesai
    pct(XLSX.utils.encode_cell({ r: row - 1, c: 6 })); // Progress%
    pct(XLSX.utils.encode_cell({ r: row - 1, c: 8 })); // Prog.Lalu
    pct(XLSX.utils.encode_cell({ r: row - 1, c: 9 })); // Delta
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return buffer;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function computePaymentSummary(
  grossTotal: number,
  retentionPct: number,
  priorPaid: number,
  kasbon: number,
): OpnameSummary {
  const retention = grossTotal * (retentionPct / 100);
  const netToDate = grossTotal - retention;
  const netThisWeek = Math.max(0, netToDate - priorPaid - kasbon);
  return {
    gross_total: grossTotal,
    retention_pct: retentionPct,
    retention_amount: retention,
    net_to_date: netToDate,
    prior_paid: priorPaid,
    kasbon,
    net_this_week: netThisWeek,
  };
}

export function formatRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}
