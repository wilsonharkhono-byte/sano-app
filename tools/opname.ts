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
import type { ParsedBoqItem, ParsedWorkbook } from './excelParser';

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
  payment_mode: 'borongan' | 'harian' | 'campuran';
  daily_rate: number;
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
  boq_code?: string;
  boq_label?: string;
  boq_volume?: number;
  variance_pct?: number;
}

interface ContractRateCandidateRow {
  boq_item_id: string;
  boq_code?: string | null;
  boq_label?: string | null;
  unit?: string | null;
  budget_volume?: number | null;
  labor_rate_per_unit?: number | null;
}

interface AggregatedContractRateCandidate {
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  unit: string;
  budget_volume: number;
  labor_rate_per_unit: number;
}

type ImportedRateSource = 'labor_breakdown' | 'internal_unit_price' | 'client_unit_price';

export interface ContractRateImportMatch {
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  contracted_rate: number;
  boq_labor_rate: number;
  unit: string;
  source_row: number;
  source_field: ImportedRateSource;
}

export interface ContractRateImportPlan {
  matches: ContractRateImportMatch[];
  unmatchedItems: string[];
  unmatchedCount: number;
  skippedNoPrice: number;
  duplicateMatches: string[];
  sourceCounts: Record<ImportedRateSource, number>;
}

type OpnameProgressMatchBy = 'boq_code' | 'description';

export interface ImportedOpnameProgressRow {
  boq_code: string;
  description: string;
  progress_pct: number;
  source_row: number;
}

export interface OpnameProgressImportMatch {
  line_id: string;
  header_id: string;
  boq_item_id: string;
  boq_code: string;
  description: string;
  progress_pct: number;
  source_row: number;
  match_by: OpnameProgressMatchBy;
}

export interface OpnameProgressImportPlan {
  matches: OpnameProgressImportMatch[];
  unmatchedRows: string[];
  unmatchedCount: number;
  skippedNoProgress: number;
  invalidProgressRows: string[];
  duplicateMatches: string[];
  matchCounts: Record<OpnameProgressMatchBy, number>;
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
  payment_type: 'borongan' | 'harian';
  harian_total: number;
  week_start: string | null;
  week_end: string | null;
  created_at: string;
  // Joined
  mandor_name?: string;
}

export interface OpnameLine {
  id: string;
  header_id: string;
  boq_item_id: string;
  description: string;
  boq_code?: string;
  boq_label?: string;
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

export type HarianAllocationScope = 'boq_item' | 'general_support' | 'rework' | 'site_overhead';

export interface HarianCostAllocation {
  id: string;
  header_id: string;
  project_id: string;
  contract_id: string;
  boq_item_id: string | null;
  allocation_scope: HarianAllocationScope;
  allocation_pct: number;
  ai_suggested_pct: number | null;
  ai_reason: string | null;
  supervisor_note: string | null;
  estimator_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  boq_code?: string;
  boq_label?: string;
  boq_unit?: string;
}

export interface HarianAllocationBoqCandidate {
  id: string;
  code: string;
  label: string;
  unit: string;
  planned: number;
  progress: number;
  labor_rate_per_unit: number;
}

export interface HarianAllocationSuggestion {
  allocation_scope: HarianAllocationScope;
  boq_item_id: string | null;
  boq_code?: string;
  boq_label?: string;
  suggested_pct: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface HarianAllocationSummary {
  allocatedPct: number;
  remainingPct: number;
  allocatedAmount: number;
  remainingAmount: number;
}

// ── Supabase Row Shapes (avoid `any` on query results) ───────────────────

/** Row from mandor_contract_rates with joined boq_items */
interface ContractRateRow {
  boq_item_id: string;
  contracted_rate: number;
  boq_labor_rate: number;
  unit: string;
  boq_items?: { code: string; label: string; planned: number; unit: string } | null;
  [key: string]: unknown;
}

/** Row from v_labor_boq_rates */
interface LaborBoqRateRow {
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  unit: string;
  budget_volume: number;
  labor_rate_per_unit: number;
}

/** Row from opname_lines with joined boq_items */
interface OpnameLineRow {
  boq_items?: { code: string; label: string } | null;
  [key: string]: unknown;
}

/** Row from harian_cost_allocations with joined boq_items */
interface HarianAllocationRow {
  allocation_pct: number | string;
  ai_suggested_pct: number | string | null;
  boq_items?: { code: string; label: string; unit: string } | null;
  [key: string]: unknown;
}

/** Row from worker_attendance_entries (export spreadsheet) */
interface AttendanceExportRow {
  worker_id: string;
  worker_name: string;
  is_present: boolean;
  regular_pay: number;
  overtime_pay: number;
  day_total: number;
  attendance_date: string;
}

/** Row from harian_cost_allocations (export spreadsheet) */
interface AllocationExportRow {
  allocation_scope: string;
  allocation_pct: number | string;
  supervisor_note: string | null;
  estimator_note: string | null;
  boq_items?: { code: string; label: string } | null;
}

/** Row from opname_headers with joined mandor_contracts */
interface OpnameHeaderRow {
  week_number: number;
  week_start: string;
  week_end: string;
  opname_date: string;
  payment_type: string;
  contract_id: string;
  status: string;
  harian_total: number;
  prior_paid: number;
  kasbon: number;
  net_this_week: number;
  gross_total: number;
  retention_pct: number;
  retention_amount: number;
  net_to_date: number;
  mandor_contracts?: { mandor_name: string; retention_pct?: number } | null;
  [key: string]: unknown;
}

/** Row from boq_items for harian allocation candidates */
interface BoqCandidateRow {
  id: string;
  code: string;
  label: string;
  unit: string;
  planned: number;
  progress: number;
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
  paymentMode?: 'borongan' | 'harian' | 'campuran',
  dailyRate?: number,
): Promise<MandorContract | null> {
  const { data } = await supabase
    .from('mandor_contracts')
    .insert({
      project_id: projectId,
      mandor_name: mandorName,
      trade_categories: tradeCategories,
      retention_pct: retentionPct,
      notes: notes ?? null,
      payment_mode: paymentMode ?? 'borongan',
      daily_rate: dailyRate ?? 0,
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
  const [{ data: contract }, { data: existingRows }] = await Promise.all([
    supabase
      .from('mandor_contracts')
      .select('project_id, trade_categories')
      .eq('id', contractId)
      .single(),
    supabase
      .from('mandor_contract_rates')
      .select(`
        *,
        boq_items(code, label, planned, unit)
      `)
      .eq('contract_id', contractId),
  ]);

  const existing = ((existingRows ?? []) as ContractRateRow[]).map(row => ({
    ...row,
    boq_code: row.boq_items?.code ?? '',
    boq_label: row.boq_items?.label ?? '',
    boq_volume: Number(row.boq_items?.planned ?? 0),
    unit: row.unit ?? row.boq_items?.unit ?? '',
  })) as MandorContractRate[];

  const tradeCategories = ((contract?.trade_categories ?? []) as TradeCategory[]).filter(Boolean);
  let laborRows: ContractRateCandidateRow[] = [];
  if (contract?.project_id && tradeCategories.length > 0) {
    const { data: boqRows } = await supabase
      .from('boq_items')
      .select('id')
      .eq('project_id', contract.project_id);

    const boqIds = (boqRows ?? []).map((row: { id: string }) => row.id);
    if (boqIds.length > 0) {
      const { data } = await supabase
        .from('v_labor_boq_rates')
        .select('boq_item_id, boq_code, boq_label, unit, budget_volume, labor_rate_per_unit')
        .in('trade_category', tradeCategories)
        .in('boq_item_id', boqIds);
      laborRows = ((data ?? []) as LaborBoqRateRow[]).map(row => ({
        boq_item_id: row.boq_item_id,
        boq_code: row.boq_code ?? '',
        boq_label: row.boq_label ?? '',
        unit: row.unit ?? '',
        budget_volume: Number(row.budget_volume ?? 0),
        labor_rate_per_unit: Number(row.labor_rate_per_unit ?? 0),
      }));
    }
  }

  return mergeContractRates(contractId, existing, laborRows)
    .map(rate => ({
      ...rate,
      variance_pct: rate.boq_labor_rate > 0
        ? ((rate.contracted_rate - rate.boq_labor_rate) / rate.boq_labor_rate) * 100
        : undefined,
    }))
    .sort((a, b) =>
      (a.boq_code ?? '').localeCompare(b.boq_code ?? '', 'id')
      || (a.boq_label ?? '').localeCompare(b.boq_label ?? '', 'id')
    );
}

export function mergeContractRates(
  contractId: string,
  existing: MandorContractRate[],
  laborRows: ContractRateCandidateRow[],
): MandorContractRate[] {
  const aggregatedCandidates = new Map<string, AggregatedContractRateCandidate>();
  for (const row of laborRows) {
    const current = aggregatedCandidates.get(row.boq_item_id);
    if (current) {
      current.labor_rate_per_unit += Number(row.labor_rate_per_unit ?? 0);
      current.boq_code ||= row.boq_code ?? '';
      current.boq_label ||= row.boq_label ?? '';
      current.unit ||= row.unit ?? '';
      if (!(current.budget_volume > 0)) {
        current.budget_volume = Number(row.budget_volume ?? 0);
      }
      continue;
    }

    aggregatedCandidates.set(row.boq_item_id, {
      boq_item_id: row.boq_item_id,
      boq_code: row.boq_code ?? '',
      boq_label: row.boq_label ?? '',
      unit: row.unit ?? '',
      budget_volume: Number(row.budget_volume ?? 0),
      labor_rate_per_unit: Number(row.labor_rate_per_unit ?? 0),
    });
  }

  const merged = new Map<string, MandorContractRate>();
  for (const rate of existing) {
    merged.set(rate.boq_item_id, {
      ...rate,
      contract_id: contractId,
      contracted_rate: Number(rate.contracted_rate ?? 0),
      boq_labor_rate: Number(rate.boq_labor_rate ?? 0),
      boq_volume: Number(rate.boq_volume ?? 0),
      unit: rate.unit ?? '',
      boq_code: rate.boq_code ?? '',
      boq_label: rate.boq_label ?? '',
    });
  }

  for (const row of aggregatedCandidates.values()) {
    const current = merged.get(row.boq_item_id);
    if (current) {
      if (Number(current.boq_labor_rate ?? 0) <= 0 && row.labor_rate_per_unit > 0) {
        current.boq_labor_rate = row.labor_rate_per_unit;
      }
      current.boq_code ||= row.boq_code;
      current.boq_label ||= row.boq_label;
      current.unit ||= row.unit;
      if (!(Number(current.boq_volume ?? 0) > 0)) {
        current.boq_volume = row.budget_volume;
      }
      continue;
    }

    merged.set(row.boq_item_id, {
      id: `${contractId}:${row.boq_item_id}`,
      contract_id: contractId,
      boq_item_id: row.boq_item_id,
      contracted_rate: 0,
      boq_labor_rate: row.labor_rate_per_unit,
      unit: row.unit,
      notes: null,
      boq_code: row.boq_code,
      boq_label: row.boq_label,
      boq_volume: row.budget_volume,
      variance_pct: undefined,
    });
  }

  return Array.from(merged.values());
}

function normalizeContractMatchText(value?: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[()@\-\/\\'"]/g, ' ')
    .replace(/[–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeContractCode(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

function normalizeSpreadsheetHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[().:/\\_\-]/g, ' ')
    .replace(/[–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocalizedNumber(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, '');
  if (!trimmed) return trimmed;

  if (trimmed.includes(',') && trimmed.includes('.')) {
    if (trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')) {
      return trimmed.replace(/\./g, '').replace(',', '.');
    }
    return trimmed.replace(/,/g, '');
  }

  if (trimmed.includes(',')) return trimmed.replace(',', '.');
  return trimmed;
}

function parseImportedProgressValue(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const hasPercentSign = raw.includes('%');
  const numeric = parseFloat(normalizeLocalizedNumber(raw.replace(/%/g, '')));
  if (!Number.isFinite(numeric)) return null;

  let progressPct = numeric;
  if (!hasPercentSign && progressPct > 0 && progressPct < 1) {
    progressPct *= 100;
  }

  if (progressPct < 0 || progressPct > 100) return null;
  return Math.round(progressPct * 100) / 100;
}

function formatImportRowLabel(row: { source_row: number; boq_code?: string; description?: string }): string {
  const code = row.boq_code?.trim();
  const description = row.description?.trim();
  const summary = [code, description].filter(Boolean).join(' · ');
  return `baris ${row.source_row}${summary ? ` (${summary})` : ''}`;
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = new Set(aliases);
  return headers.findIndex(header => {
    if (!header) return false;
    if (normalizedAliases.has(header)) return true;
    return aliases.some(alias => header.includes(alias));
  });
}

const OPNAME_CODE_HEADER_ALIASES = [
  'kode',
  'kode boq',
  'boq code',
  'code',
  'item code',
];

const OPNAME_DESCRIPTION_HEADER_ALIASES = [
  'uraian pekerjaan',
  'uraian',
  'deskripsi pekerjaan',
  'deskripsi',
  'pekerjaan',
  'item pekerjaan',
  'description',
  'label',
];

const OPNAME_PROGRESS_HEADER_ALIASES = [
  'progress',
  'progress %',
  'progress kumulatif',
  'progress klaim',
  'progress claim',
  'progress persen',
  'progress percent',
  'progress (%)',
  'progres',
  'progres %',
  'progres kumulatif',
  'progres (%)',
  'persentase',
  'persentase progress',
  'persentase progres',
];

function deriveImportedContractRate(item: ParsedBoqItem): { rate: number; source: ImportedRateSource | null } {
  const laborRate = Number(item.costBreakdown?.labor ?? 0);
  if (laborRate > 0) return { rate: laborRate, source: 'labor_breakdown' };

  const internalUnitPrice = Number(item.internalUnitPrice ?? 0);
  if (internalUnitPrice > 0) return { rate: internalUnitPrice, source: 'internal_unit_price' };

  const clientUnitPrice = Number(item.clientUnitPrice ?? 0);
  if (clientUnitPrice > 0) return { rate: clientUnitPrice, source: 'client_unit_price' };

  return { rate: 0, source: null };
}

export function buildContractRateImportPlan(
  currentRates: MandorContractRate[],
  parsed: ParsedWorkbook,
): ContractRateImportPlan {
  const byCode = new Map<string, MandorContractRate>();
  const byLabel = new Map<string, MandorContractRate[]>();

  for (const rate of currentRates) {
    const codeKey = normalizeContractCode(rate.boq_code);
    if (codeKey) byCode.set(codeKey, rate);

    const labelKey = normalizeContractMatchText(rate.boq_label);
    if (!labelKey) continue;
    const list = byLabel.get(labelKey) ?? [];
    list.push(rate);
    byLabel.set(labelKey, list);
  }

  const matches = new Map<string, ContractRateImportMatch>();
  const unmatchedItems: string[] = [];
  const duplicateMatches: string[] = [];
  const sourceCounts: Record<ImportedRateSource, number> = {
    labor_breakdown: 0,
    internal_unit_price: 0,
    client_unit_price: 0,
  };
  let skippedNoPrice = 0;

  for (const item of parsed.boqItems) {
    const imported = deriveImportedContractRate(item);
    if (!imported.source || imported.rate <= 0) {
      skippedNoPrice++;
      continue;
    }

    const codeKey = normalizeContractCode(item.code);
    const labelKey = normalizeContractMatchText(item.label);
    let target = codeKey ? byCode.get(codeKey) ?? null : null;

    if (!target && labelKey) {
      const labelMatches = byLabel.get(labelKey) ?? [];
      if (labelMatches.length === 1) {
        target = labelMatches[0];
      } else if (labelMatches.length > 1) {
        unmatchedItems.push(`${item.code} ${item.label} (label ganda)`.trim());
        continue;
      }
    }

    if (!target) {
      unmatchedItems.push(`${item.code} ${item.label}`.trim());
      continue;
    }

    if (matches.has(target.boq_item_id)) {
      duplicateMatches.push(`${item.code} ${item.label}`.trim());
      continue;
    }

    matches.set(target.boq_item_id, {
      boq_item_id: target.boq_item_id,
      boq_code: target.boq_code ?? item.code,
      boq_label: target.boq_label ?? item.label,
      contracted_rate: imported.rate,
      boq_labor_rate: Number(target.boq_labor_rate ?? 0),
      unit: target.unit || item.unit,
      source_row: item.sourceRow,
      source_field: imported.source,
    });
    sourceCounts[imported.source] += 1;
  }

  return {
    matches: Array.from(matches.values()).sort((a, b) =>
      a.boq_code.localeCompare(b.boq_code, 'id') || a.boq_label.localeCompare(b.boq_label, 'id')
    ),
    unmatchedItems,
    unmatchedCount: unmatchedItems.length,
    skippedNoPrice,
    duplicateMatches,
    sourceCounts,
  };
}

export async function applyContractRateImport(
  contractId: string,
  matches: ContractRateImportMatch[],
): Promise<{ importedCount: number; error?: string }> {
  if (!matches.length) return { importedCount: 0 };

  const { error } = await supabase
    .from('mandor_contract_rates')
    .upsert(
      matches.map(match => ({
        contract_id: contractId,
        boq_item_id: match.boq_item_id,
        contracted_rate: match.contracted_rate,
        boq_labor_rate: match.boq_labor_rate,
        unit: match.unit,
        notes: null,
      })),
      { onConflict: 'contract_id,boq_item_id' },
    );

  return { importedCount: matches.length, error: error?.message };
}

export function parseOpnameProgressWorkbook(
  input: ArrayBuffer,
  fallbackSheetName?: string,
): ImportedOpnameProgressRow[] {
  const workbook = XLSX.read(input, { type: 'array' });
  const sheetNames = workbook.SheetNames.length > 0
    ? workbook.SheetNames
    : (fallbackSheetName ? [fallbackSheetName] : []);

  let rows: (string | number)[][] = [];
  let headerRowIndex = -1;
  let codeCol = -1;
  let descriptionCol = -1;
  let progressCol = -1;

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const candidateRows = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    for (let index = 0; index < Math.min(candidateRows.length, 30); index++) {
      const headerCells = (candidateRows[index] ?? []).map(cell => normalizeSpreadsheetHeader(cell));
      const detectedCodeCol = findHeaderIndex(headerCells, OPNAME_CODE_HEADER_ALIASES);
      const detectedDescriptionCol = findHeaderIndex(headerCells, OPNAME_DESCRIPTION_HEADER_ALIASES);
      const detectedProgressCol = findHeaderIndex(headerCells, OPNAME_PROGRESS_HEADER_ALIASES);

      if (detectedProgressCol >= 0 && (detectedDescriptionCol >= 0 || detectedCodeCol >= 0)) {
        rows = candidateRows;
        headerRowIndex = index;
        codeCol = detectedCodeCol;
        descriptionCol = detectedDescriptionCol;
        progressCol = detectedProgressCol;
        break;
      }
    }

    if (headerRowIndex >= 0) break;
  }

  if (headerRowIndex < 0 || progressCol < 0 || (descriptionCol < 0 && codeCol < 0) || rows.length === 0) {
    return [];
  }

  const importedRows: ImportedOpnameProgressRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const row = rows[index] ?? [];
    const boqCode = codeCol >= 0 ? String(row[codeCol] ?? '').trim() : '';
    const description = descriptionCol >= 0 ? String(row[descriptionCol] ?? '').trim() : '';
    const progressPct = parseImportedProgressValue(row[progressCol]);

    if (!boqCode && !description) continue;
    if (progressPct == null) {
      importedRows.push({
        boq_code: boqCode,
        description,
        progress_pct: Number.NaN,
        source_row: index + 1,
      });
      continue;
    }

    importedRows.push({
      boq_code: boqCode,
      description,
      progress_pct: progressPct,
      source_row: index + 1,
    });
  }

  return importedRows;
}

export function buildOpnameProgressImportPlan(
  lines: OpnameLine[],
  importedRows: ImportedOpnameProgressRow[],
): OpnameProgressImportPlan {
  const byCode = new Map<string, OpnameLine>();
  const byDescription = new Map<string, OpnameLine[]>();

  for (const line of lines) {
    const codeKey = normalizeContractCode(line.boq_code);
    if (codeKey && !byCode.has(codeKey)) {
      byCode.set(codeKey, line);
    }

    const descriptionKeys = new Set([
      normalizeContractMatchText(line.description),
      normalizeContractMatchText(line.boq_label),
    ].filter(Boolean));

    for (const descriptionKey of descriptionKeys) {
      const list = byDescription.get(descriptionKey) ?? [];
      list.push(line);
      byDescription.set(descriptionKey, list);
    }
  }

  const matches = new Map<string, OpnameProgressImportMatch>();
  const unmatchedRows: string[] = [];
  const duplicateMatches: string[] = [];
  const invalidProgressRows: string[] = [];
  const matchCounts: Record<OpnameProgressMatchBy, number> = {
    boq_code: 0,
    description: 0,
  };
  let skippedNoProgress = 0;

  for (const row of importedRows) {
    if (Number.isNaN(row.progress_pct)) {
      const hasProgressCell = String(row.description ?? '').trim() || String(row.boq_code ?? '').trim();
      if (hasProgressCell) {
        invalidProgressRows.push(formatImportRowLabel(row));
      } else {
        skippedNoProgress++;
      }
      continue;
    }

    let target: OpnameLine | null = null;
    let matchBy: OpnameProgressMatchBy | null = null;

    const codeKey = normalizeContractCode(row.boq_code);
    if (codeKey) {
      target = byCode.get(codeKey) ?? null;
      if (target) matchBy = 'boq_code';
    }

    if (!target) {
      const descriptionKey = normalizeContractMatchText(row.description);
      if (descriptionKey) {
        const descriptionMatches = byDescription.get(descriptionKey) ?? [];
        if (descriptionMatches.length === 1) {
          target = descriptionMatches[0];
          matchBy = 'description';
        } else if (descriptionMatches.length > 1) {
          unmatchedRows.push(`${formatImportRowLabel(row)} · label cocok ke beberapa item`);
          continue;
        }
      }
    }

    if (!target || !matchBy) {
      unmatchedRows.push(`${formatImportRowLabel(row)} · item tidak ditemukan`);
      continue;
    }

    if (matches.has(target.id)) {
      duplicateMatches.push(formatImportRowLabel(row));
      continue;
    }

    matches.set(target.id, {
      line_id: target.id,
      header_id: target.header_id,
      boq_item_id: target.boq_item_id,
      boq_code: target.boq_code ?? row.boq_code,
      description: target.description,
      progress_pct: Math.max(target.prev_cumulative_pct, Math.min(100, row.progress_pct)),
      source_row: row.source_row,
      match_by: matchBy,
    });
    matchCounts[matchBy] += 1;
  }

  return {
    matches: Array.from(matches.values()).sort((a, b) =>
      a.boq_code.localeCompare(b.boq_code, 'id') || a.description.localeCompare(b.description, 'id')
    ),
    unmatchedRows,
    unmatchedCount: unmatchedRows.length,
    skippedNoProgress,
    invalidProgressRows,
    duplicateMatches,
    matchCounts,
  };
}

export async function applyOpnameProgressImport(
  matches: OpnameProgressImportMatch[],
  targetField: 'cumulative_pct' | 'verified_pct',
): Promise<{ importedCount: number; error?: string }> {
  let importedCount = 0;

  for (const match of matches) {
    const { error } = await updateOpnameLine(match.line_id, match.header_id, {
      [targetField]: match.progress_pct,
    });

    if (error) {
      return {
        importedCount,
        error: `${formatImportRowLabel(match)} gagal disimpan: ${error}`,
      };
    }

    importedCount += 1;
  }

  return { importedCount };
}

export async function hasConfiguredContractRates(contractId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('mandor_contract_rates')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId);

  if (error) return false;
  return (count ?? 0) > 0;
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
    .select('*, boq_items(code, label)')
    .eq('header_id', headerId)
    .order('description');
  return ((data ?? []) as OpnameLineRow[]).map(row => ({
    ...row,
    boq_code: row.boq_items?.code ?? undefined,
    boq_label: row.boq_items?.label ?? (row as Record<string, unknown>).description,
  })) as OpnameLine[];
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
    const boqItem = rate.boq_items as unknown as ContractRateRow['boq_items'];

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

// ─── Approval workflow (DEPRECATED — use opnameRpc.ts instead) ────────────

/** @deprecated Use `submitOpname` from `opnameRpc.ts` instead. */
export async function submitOpname(
  headerId: string,
  _submittedBy: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('submit_opname', {
    p_header_id: headerId,
  });
  return { error: error?.message };
}

/** @deprecated Use `verifyOpname` from `opnameRpc.ts` instead. */
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

/** @deprecated Use `approveOpname` from `opnameRpc.ts` instead. */
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

/** @deprecated Use `markOpnamePaid` from `opnameRpc.ts` instead. */
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

// ─── Harian Cost Allocations ────────────────────────────────────────────────

export async function getHarianAllocationBoqCandidates(
  contractId: string,
): Promise<HarianAllocationBoqCandidate[]> {
  const { data: contract } = await supabase
    .from('mandor_contracts')
    .select('project_id, trade_categories')
    .eq('id', contractId)
    .single();

  if (!contract?.project_id) return [];

  const { data: boqRows } = await supabase
    .from('boq_items')
    .select('id, code, label, unit, planned, progress')
    .eq('project_id', contract.project_id)
    .order('code');

  const tradeCategories = ((contract.trade_categories ?? []) as TradeCategory[]).filter(Boolean);
  const baseCandidates = ((boqRows ?? []) as BoqCandidateRow[]).map(row => ({
    id: row.id,
    code: row.code ?? '',
    label: row.label ?? '',
    unit: row.unit ?? '',
    planned: Number(row.planned ?? 0),
    progress: Number(row.progress ?? 0),
    labor_rate_per_unit: 0,
  })) as HarianAllocationBoqCandidate[];

  if (!tradeCategories.length || !baseCandidates.length) {
    return baseCandidates;
  }

  const { data: laborRows } = await supabase
    .from('v_labor_boq_rates')
    .select('boq_item_id, labor_rate_per_unit')
    .in('trade_category', tradeCategories)
    .in('boq_item_id', baseCandidates.map(candidate => candidate.id));

  const laborMap = new Map<string, number>();
  for (const row of (laborRows ?? []) as LaborBoqRateRow[]) {
    const current = laborMap.get(row.boq_item_id) ?? 0;
    laborMap.set(row.boq_item_id, current + Number(row.labor_rate_per_unit ?? 0));
  }

  const filtered = baseCandidates
    .filter(candidate => laborMap.size === 0 || laborMap.has(candidate.id))
    .map(candidate => ({
      ...candidate,
      labor_rate_per_unit: laborMap.get(candidate.id) ?? 0,
    }));

  return filtered.sort((a, b) => (
    a.code.localeCompare(b.code, 'id') || a.label.localeCompare(b.label, 'id')
  ));
}

export async function getHarianCostAllocations(
  headerId: string,
): Promise<HarianCostAllocation[]> {
  const { data } = await supabase
    .from('harian_cost_allocations')
    .select('*, boq_items(code, label, unit)')
    .eq('header_id', headerId)
    .order('created_at');

  return ((data ?? []) as HarianAllocationRow[]).map(row => ({
    ...row,
    allocation_pct: Number(row.allocation_pct ?? 0),
    ai_suggested_pct: row.ai_suggested_pct == null ? null : Number(row.ai_suggested_pct),
    boq_code: row.boq_items?.code ?? undefined,
    boq_label: row.boq_items?.label ?? undefined,
    boq_unit: row.boq_items?.unit ?? undefined,
  })) as HarianCostAllocation[];
}

export async function saveHarianCostAllocation(params: {
  id?: string;
  headerId: string;
  projectId: string;
  contractId: string;
  userId: string;
  boqItemId?: string | null;
  allocationScope: HarianAllocationScope;
  allocationPct: number;
  aiSuggestedPct?: number | null;
  aiReason?: string | null;
  supervisorNote?: string | null;
  estimatorNote?: string | null;
}): Promise<{ data?: HarianCostAllocation; error?: string }> {
  const payload = {
    header_id: params.headerId,
    project_id: params.projectId,
    contract_id: params.contractId,
    boq_item_id: params.allocationScope === 'boq_item' ? (params.boqItemId ?? null) : null,
    allocation_scope: params.allocationScope,
    allocation_pct: params.allocationPct,
    ai_suggested_pct: params.aiSuggestedPct ?? null,
    ai_reason: params.aiReason ?? null,
    supervisor_note: params.supervisorNote ?? null,
    estimator_note: params.estimatorNote ?? null,
    updated_by: params.userId,
  };

  if (params.id) {
    const { data, error } = await supabase
      .from('harian_cost_allocations')
      .update(payload)
      .eq('id', params.id)
      .select('*, boq_items(code, label, unit)')
      .single();
    if (error) return { error: error.message };
    const row = data as unknown as HarianAllocationRow;
    return {
      data: {
        ...row,
        allocation_pct: Number(row.allocation_pct ?? 0),
        ai_suggested_pct: row.ai_suggested_pct == null ? null : Number(row.ai_suggested_pct),
        boq_code: row.boq_items?.code ?? undefined,
        boq_label: row.boq_items?.label ?? undefined,
        boq_unit: row.boq_items?.unit ?? undefined,
      } as HarianCostAllocation,
    };
  }

  const { data, error } = await supabase
    .from('harian_cost_allocations')
    .insert({
      ...payload,
      created_by: params.userId,
    })
    .select('*, boq_items(code, label, unit)')
    .single();

  if (error) return { error: error.message };
  const row = data as unknown as HarianAllocationRow;
  return {
    data: {
      ...row,
      allocation_pct: Number(row.allocation_pct ?? 0),
      ai_suggested_pct: row.ai_suggested_pct == null ? null : Number(row.ai_suggested_pct),
      boq_code: row.boq_items?.code ?? undefined,
      boq_label: row.boq_items?.label ?? undefined,
      boq_unit: row.boq_items?.unit ?? undefined,
    } as HarianCostAllocation,
  };
}

export async function deleteHarianCostAllocation(
  allocationId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('harian_cost_allocations')
    .delete()
    .eq('id', allocationId);
  return { error: error?.message };
}

export function summarizeHarianCostAllocations(
  allocations: HarianCostAllocation[],
  grossTotal: number,
): HarianAllocationSummary {
  const allocatedPct = Math.round(
    allocations.reduce((sum, allocation) => sum + Number(allocation.allocation_pct ?? 0), 0) * 100,
  ) / 100;
  const remainingPct = Math.max(0, Math.round((100 - allocatedPct) * 100) / 100);
  const allocatedAmount = grossTotal * (allocatedPct / 100);
  const remainingAmount = Math.max(0, grossTotal - allocatedAmount);

  return {
    allocatedPct,
    remainingPct,
    allocatedAmount,
    remainingAmount,
  };
}

export async function applyHarianAiSuggestions(params: {
  headerId: string;
  projectId: string;
  contractId: string;
  userId: string;
  existingAllocations: HarianCostAllocation[];
  suggestions: HarianAllocationSuggestion[];
}): Promise<{ appliedCount: number; error?: string }> {
  const existingByTarget = new Map<string, HarianCostAllocation>();
  for (const allocation of params.existingAllocations) {
    const key = allocation.allocation_scope === 'boq_item'
      ? `boq:${allocation.boq_item_id}`
      : `scope:${allocation.allocation_scope}`;
    existingByTarget.set(key, allocation);
  }

  for (const allocation of params.existingAllocations) {
    const { error } = await saveHarianCostAllocation({
      id: allocation.id,
      headerId: allocation.header_id,
      projectId: allocation.project_id,
      contractId: allocation.contract_id,
      userId: params.userId,
      boqItemId: allocation.boq_item_id,
      allocationScope: allocation.allocation_scope,
      allocationPct: Number(allocation.allocation_pct ?? 0),
      aiSuggestedPct: null,
      aiReason: null,
      supervisorNote: allocation.supervisor_note,
      estimatorNote: allocation.estimator_note,
    });
    if (error) return { appliedCount: 0, error };
  }

  let appliedCount = 0;
  for (const suggestion of params.suggestions) {
    const key = suggestion.allocation_scope === 'boq_item'
      ? `boq:${suggestion.boq_item_id}`
      : `scope:${suggestion.allocation_scope}`;
    const existing = existingByTarget.get(key);
    const { error } = await saveHarianCostAllocation({
      id: existing?.id,
      headerId: params.headerId,
      projectId: params.projectId,
      contractId: params.contractId,
      userId: params.userId,
      boqItemId: suggestion.boq_item_id,
      allocationScope: suggestion.allocation_scope,
      allocationPct: Number(existing?.allocation_pct ?? 0),
      aiSuggestedPct: suggestion.suggested_pct,
      aiReason: suggestion.reason,
      supervisorNote: existing?.supervisor_note ?? null,
      estimatorNote: existing?.estimator_note ?? null,
    });
    if (error) return { appliedCount, error };
    appliedCount += 1;
  }

  return { appliedCount };
}

// ─── Excel Export ─────────────────────────────────────────────────────────

/**
 * Generate opname Excel sheet matching the Embong Kenongo template format.
 * Branches on payment_type:
 *   borongan → physical work items with progress %; harian → worker attendance summary.
 * Returns a base64-encoded XLSX payload for download/share.
 */
export async function exportOpnameToExcel(
  headerId: string,
  projectName: string,
  ownerName: string,
  location: string,
): Promise<string> {
  const headerRes = await supabase.from('opname_headers')
    .select('*, mandor_contracts(mandor_name, retention_pct)')
    .eq('id', headerId)
    .single();

  const header = headerRes.data as unknown as OpnameHeaderRow;
  const mandorName = header?.mandor_contracts?.mandor_name ?? '';
  const wb = XLSX.utils.book_new();
  const sheetName = `OPM${header.week_number}`;

  // Branch on payment_type
  if (header.payment_type === 'harian') {
    // ════════════════════════════════════════════════════════════════════════
    // HARIAN: Worker attendance summary (no line items, just attendance totals)
    // ════════════════════════════════════════════════════════════════════════

    const attendanceRes = await supabase.from('worker_attendance_entries')
      .select('worker_id, worker_name, is_present, regular_pay, overtime_pay, day_total, attendance_date')
      .eq('contract_id', header.contract_id)
      .gte('attendance_date', header.week_start)
      .lte('attendance_date', header.week_end)
      .order('attendance_date, worker_name');

    const allocationRes = await supabase.from('harian_cost_allocations')
      .select('allocation_scope, allocation_pct, supervisor_note, estimator_note, boq_items(code, label)')
      .eq('header_id', headerId)
      .order('created_at');

    const attendance = (attendanceRes.data ?? []) as AttendanceExportRow[];
    const allocations = (allocationRes.data ?? []) as unknown as AllocationExportRow[];

    const rows: (string | number | boolean | null)[][] = [];
    rows.push(['OPNAME HARIAN - UPAH PEKERJA']);
    rows.push([]);
    rows.push(['Pemilik', `: ${ownerName}`]);
    rows.push(['Lokasi', `: ${location}`]);
    rows.push(['Periode', `: ${header.week_start} s/d ${header.week_end}`]);
    rows.push(['Tgl Opname', `: ${new Date(header.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`]);
    rows.push([]);
    rows.push(['Nama Pekerja', 'Hadir', 'Tarif Harian', 'Lembur', 'Total']);
    rows.push([]);

    // Group by worker
    const workerMap = new Map<string, { present: number; regularPay: number; overtimePay: number; total: number }>();
    for (const rec of attendance) {
      if (!workerMap.has(rec.worker_name)) {
        workerMap.set(rec.worker_name, { present: 0, regularPay: 0, overtimePay: 0, total: 0 });
      }
      const w = workerMap.get(rec.worker_name)!;
      if (rec.is_present) {
        w.present += 1;
        w.regularPay += rec.regular_pay ?? 0;
        w.overtimePay += rec.overtime_pay ?? 0;
        w.total += rec.day_total ?? 0;
      }
    }

    for (const [workerName, data] of Array.from(workerMap.entries())) {
      rows.push([
        workerName,
        data.present,
        data.regularPay,
        data.overtimePay,
        data.total,
      ]);
    }

    rows.push([]);
    rows.push(['RINGKASAN PEMBAYARAN']);
    rows.push(['Total Upah Harian', header.harian_total]);
    rows.push(['Dibayarkan Minggu Lalu', -header.prior_paid]);
    rows.push(['Kasbon', -header.kasbon]);
    rows.push([]);
    rows.push(['SISA BAYAR MINGGU INI', header.net_this_week]);
    rows.push([]);

    rows.push(['ALOKASI BIAYA HARIAN']);
    rows.push(['Target', 'Alokasi (%)', 'Nominal', 'Catatan Supervisor', 'Catatan Estimator']);

    const scopeLabels: Record<string, string> = {
      general_support: 'Support Umum',
      rework: 'Rework / Punchlist',
      site_overhead: 'Overhead Lapangan',
    };
    for (const allocation of allocations) {
      const target = allocation.allocation_scope === 'boq_item'
        ? `${allocation.boq_items?.code ?? ''} — ${allocation.boq_items?.label ?? 'BoQ'}`
        : (scopeLabels[allocation.allocation_scope] ?? allocation.allocation_scope);
      const pct = Number(allocation.allocation_pct ?? 0);
      rows.push([
        target,
        pct,
        (header.gross_total ?? 0) * (pct / 100),
        allocation.supervisor_note ?? '',
        allocation.estimator_note ?? '',
      ]);
    }
    rows.push([]);

    // Signature block
    rows.push([`Dibuat Oleh,`, '', 'Diperiksa,', '', 'Disetujui,']);
    rows.push([]);
    rows.push([]);
    rows.push([mandorName, '', '(Estimator)', '', '(Admin)']);
    rows.push(['Mandor']);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 32 }, // A
      { wch: 12 }, // B
      { wch: 18 }, // C
      { wch: 28 }, // D
      { wch: 28 }, // E
    ];

    const rp = (cell: string) => {
      if (ws[cell]) ws[cell].z = '#,##0';
    };
    // Format currency columns for worker rows
    for (let i = 9; i < 9 + workerMap.size; i++) {
      rp(XLSX.utils.encode_cell({ r: i - 1, c: 2 })); // Tarif Harian
      rp(XLSX.utils.encode_cell({ r: i - 1, c: 3 })); // Lembur
      rp(XLSX.utils.encode_cell({ r: i - 1, c: 4 })); // Total
    }

    const allocationStartRow = 9 + workerMap.size + 8;
    for (let i = allocationStartRow; i < allocationStartRow + allocations.length; i++) {
      if (ws[XLSX.utils.encode_cell({ r: i - 1, c: 1 })]) ws[XLSX.utils.encode_cell({ r: i - 1, c: 1 })].z = '0.00';
      rp(XLSX.utils.encode_cell({ r: i - 1, c: 2 }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  } else {
    // ════════════════════════════════════════════════════════════════════════
    // BORONGAN: Physical work items with progress % (existing logic)
    // ════════════════════════════════════════════════════════════════════════

    const linesRes = await supabase.from('opname_lines')
      .select('*')
      .eq('header_id', headerId)
      .order('description');

    const lines = (linesRes.data ?? []) as OpnameLine[];

    const rows: (string | number | boolean | null)[][] = [];
    rows.push(['OPNAME PEKERJAAN FISIK']);
    rows.push([]);
    rows.push(['Pemilik', `: ${ownerName}`]);
    rows.push(['Lokasi', `: ${location}`]);
    rows.push(['Tgl', `: ${new Date(header.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, '', '', `Opname Minggu ke: ${header.week_number}`]);
    rows.push([]);
    rows.push(['No.', 'Uraian Pekerjaan', '', 'Vol', 'Sat', 'H. Satuan (Rp)', 'Progress (%)', 'Selesai (Rp)', 'Prog. Lalu (%)', 'Delta (%)']);
    rows.push([]);

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
    rows.push(['', '', '', '', '', '', 'Total Pekerjaan', header.gross_total]);
    rows.push(['', '', '', '', '', '', `Retensi ${header.retention_pct}%`, -header.retention_amount]);
    rows.push(['', '', '', '', '', '', 'Yang Dibayarkan s/d Minggu Ini', header.net_to_date]);
    rows.push(['', '', '', '', '', '', 'Yang Dibayarkan s/d Minggu Lalu', -header.prior_paid]);
    rows.push(['', '', '', '', '', '', 'Kasbon', -header.kasbon]);
    rows.push([]);
    rows.push(['', '', '', '', '', '', 'SISA BAYAR MINGGU INI', header.net_this_week]);
    rows.push([]);

    rows.push([`Dibuat Oleh,`, '', '', 'Diperiksa,', '', '', 'Disetujui,']);
    rows.push([]);
    rows.push([]);
    rows.push([]);
    rows.push([mandorName, '', '', '(Estimator)', '', '', '(Admin)']);
    rows.push(['Mandor']);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 }, { wch: 40 }, { wch: 3 }, { wch: 10 }, { wch: 6 },
      { wch: 18 }, { wch: 13 }, { wch: 18 }, { wch: 13 }, { wch: 10 },
      { wch: 10 }, { wch: 25 },
    ];

    const rp = (cell: string) => {
      if (ws[cell]) ws[cell].z = '#,##0';
    };
    const pct = (cell: string) => {
      if (ws[cell]) ws[cell].z = '0%';
    };

    const dataStartRow = 9;
    for (let i = 0; i < lines.length; i++) {
      const row = dataStartRow + i;
      rp(XLSX.utils.encode_cell({ r: row - 1, c: 5 }));
      rp(XLSX.utils.encode_cell({ r: row - 1, c: 7 }));
      pct(XLSX.utils.encode_cell({ r: row - 1, c: 6 }));
      pct(XLSX.utils.encode_cell({ r: row - 1, c: 8 }));
      pct(XLSX.utils.encode_cell({ r: row - 1, c: 9 }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
}

export async function exportOpnameProgressTemplate(
  headerId: string,
): Promise<string> {
  const [headerRes, linesRes] = await Promise.all([
    supabase.from('opname_headers')
      .select('*, mandor_contracts(mandor_name)')
      .eq('id', headerId)
      .single(),
    supabase.from('opname_lines')
      .select('*, boq_items(code, label)')
      .eq('header_id', headerId),
  ]);

  const header = headerRes.data as unknown as OpnameHeaderRow;
  const mandorName = header?.mandor_contracts?.mandor_name ?? '';
  const lines = ((linesRes.data ?? []) as unknown as (OpnameLine & OpnameLineRow)[])
    .map(row => ({
      ...row,
      boq_code: row.boq_items?.code ?? '',
      boq_label: row.boq_items?.label ?? row.description ?? '',
    }))
    .sort((a, b) =>
      String(a.boq_code ?? '').localeCompare(String(b.boq_code ?? ''), 'id')
      || String(a.boq_label ?? '').localeCompare(String(b.boq_label ?? ''), 'id')
    );

  const rows: (string | number | boolean | null)[][] = [];
  rows.push(['TEMPLATE IMPORT PROGRESS OPNAME']);
  rows.push(['Isi kolom "Progress (%)" lalu upload kembali di layar Opname.']);
  rows.push(['Sistem akan mencocokkan item dengan Kode BoQ dulu, lalu Uraian Pekerjaan.']);
  rows.push(['Status', header?.status ?? '-', '', 'Minggu', header?.week_number ?? '-', '', 'Mandor', mandorName]);
  rows.push(['Tanggal Opname', header?.opname_date ?? '-', '', 'Jumlah Item', lines.length]);
  rows.push([]);
  rows.push([
    'Kode BoQ',
    'Uraian Pekerjaan',
    'Progress (%)',
    'Progress App Saat Ini (%)',
    'Progress Minggu Lalu (%)',
    'Unit',
    'Volume',
    'Harga Satuan (Rp)',
  ]);

  for (const line of lines) {
    const currentPct = Number(line.verified_pct ?? line.cumulative_pct ?? 0);
    rows.push([
      line.boq_code ?? '',
      line.description ?? line.boq_label ?? '',
      currentPct,
      currentPct,
      Number(line.prev_cumulative_pct ?? 0),
      line.unit ?? '',
      Number(line.budget_volume ?? 0),
      Number(line.contracted_rate ?? 0),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 44 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
  ];

  const moneyColumns = [7];
  const pctColumns = [2, 3, 4];
  const headerRowIndex = 7;
  const dataStartRowIndex = headerRowIndex + 1;

  for (let rowIndex = dataStartRowIndex; rowIndex < dataStartRowIndex + lines.length; rowIndex++) {
    for (const columnIndex of pctColumns) {
      const cell = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (ws[cell]) ws[cell].z = '0.00';
    }
    for (const columnIndex of moneyColumns) {
      const cell = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (ws[cell]) ws[cell].z = '#,##0';
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Progress');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
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
