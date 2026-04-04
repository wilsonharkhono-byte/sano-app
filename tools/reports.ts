// SANO — Report Generation & Export Service
// Centralized report logic for Gate 5. Generates data payloads for various report types.
// In production, PDF/Excel rendering would happen server-side via edge function.

import { supabase } from './supabase';
import { getPurchaseOrderDisplayNumber } from './purchaseOrders';
import { deriveBoqInstalledTotals, derivePoReceivedTotals, deriveMaterialBalance } from './derivation';
import { resolvePhotoUrl } from './storage';
import {
  CHANGE_TYPE_LABELS,
  COST_BEARER_LABELS,
  DECISION_LABELS,
  IMPACT_LABELS,
} from './siteChanges';
import type {
  BoqItem,
  PurchaseOrder,
  Milestone,
  WeeklyDigest,
  ReportExport,
} from './types';

// ── Report Types ────────────────────────────────────────────────────

export type ReportType =
  | 'progress_summary'
  | 'material_balance'
  | 'receipt_log'
  | 'site_change_log'
  | 'weekly_digest'
  | 'schedule_variance'
  | 'payroll_support_summary'
  | 'client_charge_report'
  | 'audit_list'
  | 'ai_usage_summary'
  | 'approval_sla_user'
  | 'operational_entry_discipline'
  | 'tool_usage_summary'
  | 'exception_handling_load';

export interface ReportFilters {
  date_from?: string;   // YYYY-MM-DD — filters by created_at
  date_to?: string;     // YYYY-MM-DD — inclusive end date
  boq_ids?: string[];   // restrict to specific BoQ item IDs
}

export interface ReportPayload {
  type: ReportType;
  title: string;
  generated_at: string;
  project_id: string;
  filters?: ReportFilters;
  data: unknown;
}

export interface ReportGenerationOptions {
  viewerRole?: string | null;
}

function toStartOfDay(date?: string): string | null {
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

function toEndOfDay(date?: string): string | null {
  if (!date) return null;
  return `${date}T23:59:59.999Z`;
}

async function getProfileDirectory(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { full_name: string; role: string }>();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', userIds);
  return new Map((data ?? []).map(profile => [profile.id, {
    full_name: profile.full_name,
    role: profile.role,
  }]));
}

function hoursBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Number((diffMs / 3600000).toFixed(2));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[mid - 1] + sorted[mid]) / 2)).toFixed(2));
  }
  return Number(sorted[mid].toFixed(2));
}

type ResolvedPhoto = {
  storage_path: string;
  photo_url: string;
  captured_at?: string | null;
  photo_kind?: string | null;
  photo_type?: string | null;
  gps_lat?: number | null;
  gps_lon?: number | null;
};

// ── Supabase Row Shapes ────────────────────────────────────────────
// Lightweight interfaces matching the `.select()` columns used below.
// Keeps callback parameters typed without requiring Supabase codegen.

/** Shared empty-result placeholder so we never need `as any` for fallback queries. */
type EmptyQueryResult<T = Record<string, unknown>> = { data: T[]; error: null };
function emptyResult<T = Record<string, unknown>>(): EmptyQueryResult<T> {
  return { data: [], error: null };
}

/** progress_entries row shape (generateProgressSummary) */
interface ProgressEntryRow {
  id: string;
  boq_item_id: string;
  quantity: number;
  unit: string;
  work_status: string;
  location: string | null;
  note: string | null;
  created_at: string;
  progress_photos: Array<{ storage_path: string; captured_at?: string | null }>;
}

/** receipts row shape (generateReceiptLog) */
interface ReceiptRow {
  id: string;
  po_id: string;
  vehicle_ref: string | null;
  gate3_flag: boolean;
  notes: string | null;
  created_at: string;
  receipt_lines: Array<{ material_name: string; quantity_actual: number; unit: string }>;
  receipt_photos: Array<{ photo_type: string; storage_path: string; gps_lat: number | null; gps_lon: number | null; created_at: string }>;
}

/** site_changes row shape (generateSiteChangeLog) */
interface SiteChangeRow {
  id: string;
  created_at: string;
  location: string | null;
  description: string | null;
  change_type: string;
  impact: string;
  is_urgent: boolean;
  decision: string;
  needs_owner_approval: boolean;
  estimator_note: string | null;
  resolution_note: string | null;
  reviewed_at: string | null;
  resolved_at: string | null;
  est_cost: number | null;
  cost_bearer: string | null;
  photo_urls: string[] | null;
  boq_items?: { code: string; label: string } | null;
  mandor_contracts?: { mandor_name: string } | null;
  profiles?: { full_name: string } | null;
}

/** Payroll/progress entry row (generatePayrollSupportSummary) */
interface PayrollEntryRow {
  id: string;
  created_at: string;
  boq_item_id: string;
  quantity: number;
  unit: string;
  location: string | null;
  note: string | null;
  reported_by: string;
  payroll_support: boolean;
}

/** BoQ lookup row (used in multiple reports) */
interface BoqLookupRow {
  id: string;
  code: string;
  label: string;
}

/** Profile lookup row (used in multiple reports) */
interface ProfileLookupRow {
  id: string;
  full_name: string;
}

/** VO entry row (generateClientChargeReport) */
interface VoEntryRow {
  id: string;
  created_at: string;
  location: string | null;
  description: string | null;
  requested_by_name: string | null;
  cause: string;
  est_material: number | null;
  est_cost: number | null;
  status: string;
}

/** Client-charge progress entry row */
interface ClientChargeEntryRow {
  id: string;
  created_at: string;
  boq_item_id: string;
  quantity: number;
  unit: string;
  location: string | null;
  note: string | null;
  reported_by: string;
  client_charge_support: boolean;
}

/** Audit case row (generateAuditList) */
interface AuditCaseRow {
  id: string;
  created_at: string;
  trigger_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  notes: string | null;
}

/** Material request header row (SLA / Exception reports) */
interface MRHeaderRow {
  requested_by: string;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  overall_status: string;
}

/** VO row for SLA/Exception reports */
interface VoSlaRow {
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  status: string;
}

/** MTN row for SLA/Exception reports */
interface MtnSlaRow {
  requested_by: string;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  status: string;
}

/** Approval task row */
interface ApprovalTaskRow {
  assigned_to: string;
  entity_type: string;
  action: string | null;
  created_at: string;
  acted_at: string | null;
}

/** Opname header row (SLA report) */
interface OpnameHeaderRow {
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  status: string;
}

/** Mandor attendance row (SLA report) */
interface AttendanceSlaRow {
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
  status: string;
}

/** Kasbon row (SLA report) */
interface KasbonSlaRow {
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  status: string;
}

/** Generic entity row with id + timestamp (used for photo ID extraction) */
interface EntityRow { id: string; created_at: string; [key: string]: unknown }

/** Operational entry discipline — row shapes for each module query */
interface OpsRequestRow { id: string; requested_by: string; created_at: string }
interface OpsReceiptRow { id: string; received_by: string; created_at: string }
interface OpsProgressRow { id: string; reported_by: string; created_at: string }
interface OpsDefectRow { id: string; reported_by: string; created_at: string; photo_path: string | null }
interface OpsVoRow { id: string; created_by: string; created_at: string; photo_path: string | null }
interface OpsReworkRow { id: string; created_by: string; created_at: string }
interface OpsMtnRow { id: string; requested_by: string; created_at: string; photo_path: string | null }
interface OpsAttendanceRow { id: string; recorded_by: string; created_at: string }
interface OpsKasbonRow { id: string; requested_by: string; created_at: string }

/** Photo reference row (for photo-backed verification) */
interface PhotoRefRow {
  [key: string]: string;
}

/** Report export row (tool usage summary) */
interface ReportExportRow {
  generated_by: string;
  report_type: string;
  generated_at: string;
}

/** AI chat log row (tool usage / AI usage reports) */
interface AiChatRow {
  user_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  user_role?: string;
}

/** Anomaly event row (audit / exception reports) */
interface AnomalyEventRow {
  id?: string;
  event_type: string;
  severity: string;
  created_at: string;
  entity_type?: string;
  entity_id?: string;
  description?: string;
}

/** Audit case row for exception report (minimal select) */
interface AuditCaseMinRow {
  trigger_type: string;
  status: string;
  created_at: string;
}

function assignSequenceCodes<T extends { id: string; created_at: string }>(items: T[], prefix: string) {
  const ordered = [...items].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
  });

  const codeMap = new Map(
    ordered.map((item, index) => [
      item.id,
      `${prefix}-${String(index + 1).padStart(3, '0')}`,
    ]),
  );

  return items.map(item => ({
    ...item,
    entry_code: codeMap.get(item.id) ?? `${prefix}-000`,
  }));
}

async function resolvePhotoCollection(
  rawPhotos: Array<{
    storage_path: string;
    captured_at?: string | null;
    photo_kind?: string | null;
    photo_type?: string | null;
    gps_lat?: number | null;
    gps_lon?: number | null;
  }>,
  fallbackPaths: Array<{
    storage_path: string | null | undefined;
    captured_at?: string | null;
    photo_kind?: string | null;
  }> = [],
): Promise<ResolvedPhoto[]> {
  const combined = [...rawPhotos];

  for (const fallback of fallbackPaths) {
    if (!fallback.storage_path) continue;
    if (!combined.some(photo => photo.storage_path === fallback.storage_path)) {
      combined.push({
        storage_path: fallback.storage_path,
        captured_at: fallback.captured_at ?? null,
        photo_kind: fallback.photo_kind ?? null,
      });
    }
  }

  const ordered = combined.sort((a, b) => {
    const aTime = a.captured_at ? new Date(a.captured_at).getTime() : 0;
    const bTime = b.captured_at ? new Date(b.captured_at).getTime() : 0;
    return aTime !== bTime ? aTime - bTime : a.storage_path.localeCompare(b.storage_path);
  });

  return Promise.all(ordered.map(async (photo) => ({
    ...photo,
    photo_url: await resolvePhotoUrl(photo.storage_path),
  })));
}

// ── Progress Summary ────────────────────────────────────────────────

export interface ProgressSummaryData {
  overall_progress: number;
  total_items: number;
  completed_items: number;
  in_progress_items: number;
  not_started_items: number;
  items: Array<{
    code: string;
    label: string;
    planned: number;
    installed: number;
    unit: string;
    progress: number;
  }>;
  entries: Array<{
    entry_id: string;
    boq_code: string;
    boq_label: string;
    quantity: number;
    unit: string;
    work_status: string;
    location: string | null;
    note: string | null;
    created_at: string;
    photos: Array<{
      storage_path: string;
      photo_url: string;
    }>;
  }>;
}

export async function generateProgressSummary(projectId: string): Promise<ReportPayload> {
  const totals = await deriveBoqInstalledTotals(projectId);
  const [{ data: items }, { data: entryRows }] = await Promise.all([
    supabase
      .from('boq_items')
      .select('*')
      .eq('project_id', projectId)
      .order('code'),
    supabase
      .from('progress_entries')
      .select('id, boq_item_id, quantity, unit, work_status, location, note, created_at, progress_photos(storage_path, captured_at)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
  ]);

  const boqItems: BoqItem[] = items ?? [];
  const totalMap = new Map(totals.map(t => [t.boq_item_id, t.total_installed]));
  const boqMap = new Map(boqItems.map(item => [item.id, item]));

  const enriched = boqItems.map(b => ({
    code: b.code,
    label: b.label,
    planned: b.planned,
    installed: totalMap.get(b.id) ?? b.installed,
    unit: b.unit,
    progress: b.planned > 0 ? Math.min(100, Math.round(((totalMap.get(b.id) ?? b.installed) / b.planned) * 100)) : 0,
  }));

  const overall = enriched.length > 0
    ? Math.round(enriched.reduce((s, i) => s + i.progress, 0) / enriched.length)
    : 0;

  const data: ProgressSummaryData = {
    overall_progress: overall,
    total_items: enriched.length,
    completed_items: enriched.filter(i => i.progress >= 100).length,
    in_progress_items: enriched.filter(i => i.progress > 0 && i.progress < 100).length,
    not_started_items: enriched.filter(i => i.progress === 0).length,
    items: enriched,
    entries: await Promise.all((entryRows ?? []).map(async (entry: ProgressEntryRow) => {
      const boq = boqMap.get(entry.boq_item_id);
      const rawPhotos = Array.isArray(entry.progress_photos) ? entry.progress_photos : [];
      const photos = await resolvePhotoCollection(rawPhotos);

      return {
        entry_id: entry.id,
        boq_code: boq?.code ?? '—',
        boq_label: boq?.label ?? '—',
        quantity: entry.quantity,
        unit: entry.unit,
        work_status: entry.work_status,
        location: entry.location,
        note: entry.note,
        created_at: entry.created_at,
        photos,
      };
    })),
  };

  return {
    type: 'progress_summary',
    title: 'Laporan Ringkasan Progres',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    data,
  };
}

// ── Material Balance ────────────────────────────────────────────────

export async function generateMaterialBalanceReport(projectId: string): Promise<ReportPayload> {
  const balances = await deriveMaterialBalance(projectId);

  return {
    type: 'material_balance',
    title: 'Laporan Material Balance',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    data: {
      total_materials: balances.length,
      over_received: balances.filter(b => b.received > b.planned).length,
      under_received: balances.filter(b => b.received < b.planned * 0.8).length,
      balances,
    },
  };
}

// ── Receipt Log ─────────────────────────────────────────────────────

export async function generateReceiptLog(projectId: string): Promise<ReportPayload> {
  const [poTotals, { data: pos }, { data: receipts }] = await Promise.all([
    derivePoReceivedTotals(projectId),
    supabase
      .from('purchase_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('ordered_date', { ascending: false }),
    supabase
      .from('receipts')
      .select('id, po_id, vehicle_ref, gate3_flag, notes, created_at, receipt_lines(material_name, quantity_actual, unit), receipt_photos(photo_type, storage_path, gps_lat, gps_lon, created_at)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
  ]);

  const entries = (pos ?? []).map((po: PurchaseOrder) => {
    const received = poTotals.find(t => t.po_id === po.id);
    return {
      po_number: getPurchaseOrderDisplayNumber(po),
      po_ref: po.boq_ref,
      supplier: po.supplier,
      material: po.material_name,
      ordered_qty: po.quantity,
      received_qty: received?.total_received ?? 0,
      receipt_count: received?.receipt_count ?? 0,
      unit: po.unit,
      unit_price: po.unit_price ?? null,
      status: po.status,
      ordered_date: po.ordered_date,
      last_receipt: received?.last_receipt_at ?? null,
    };
  });

  return {
    type: 'receipt_log',
    title: 'Log Penerimaan Material',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    data: {
      total_pos: entries.length,
      fully_received: entries.filter(e => e.status === 'FULLY_RECEIVED').length,
      entries,
      receipts: await Promise.all((receipts ?? []).map(async (receipt: ReceiptRow) => {
        const po = (pos ?? []).find((row: PurchaseOrder) => row.id === receipt.po_id);
        const lines = Array.isArray(receipt.receipt_lines) ? receipt.receipt_lines : [];
        const photos = await Promise.all(((Array.isArray(receipt.receipt_photos) ? receipt.receipt_photos : [])).map(async (photo: ReceiptRow['receipt_photos'][number]) => ({
          photo_type: photo.photo_type,
          storage_path: photo.storage_path,
          photo_url: await resolvePhotoUrl(photo.storage_path),
          captured_at: photo.created_at,
          gps_lat: photo.gps_lat,
          gps_lon: photo.gps_lon,
        })));

        return {
          receipt_id: receipt.id,
          po_number: po ? getPurchaseOrderDisplayNumber(po) : '—',
          po_ref: po?.boq_ref ?? '—',
          supplier: po?.supplier ?? '—',
          material_name: lines.map((line: ReceiptRow['receipt_lines'][number]) => line.material_name).filter(Boolean).join(', ') || po?.material_name || '—',
          quantity_actual: lines.reduce((sum, line) => sum + (line.quantity_actual ?? 0), 0),
          unit: lines[0]?.unit ?? po?.unit ?? '—',
          vehicle_ref: receipt.vehicle_ref,
          gate3_flag: receipt.gate3_flag,
          notes: receipt.notes,
          created_at: receipt.created_at,
          photos,
        };
      })),
    },
  };
}

// ── Site Change Log ─────────────────────────────────────────────────

export async function generateSiteChangeLog(
  projectId: string,
  filters: ReportFilters = {},
  options: ReportGenerationOptions = {},
): Promise<ReportPayload> {
  let query = supabase
    .from('site_changes')
    .select('*, boq_items(code, label), mandor_contracts(mandor_name), profiles!site_changes_reported_by_fkey(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const showCosts = options.viewerRole !== 'supervisor';
  const items = await Promise.all((rows ?? []).map(async (row: SiteChangeRow) => {
    const rawPhotoPaths = Array.isArray(row.photo_urls) ? row.photo_urls : [];
    const photos = await resolvePhotoCollection(
      [],
      rawPhotoPaths.map((storagePath: string) => ({
        storage_path: storagePath,
        captured_at: row.created_at,
      })),
    );

    const flags: string[] = [];
    if (row.is_urgent) flags.push('Urgent');
    if (row.impact === 'berat') flags.push('Impact Berat');
    if (row.needs_owner_approval) flags.push('Perlu Approval Owner');

    return {
      id: row.id,
      created_at: row.created_at,
      location: row.location,
      description: row.description,
      change_type: row.change_type,
      change_type_label: CHANGE_TYPE_LABELS[row.change_type as keyof typeof CHANGE_TYPE_LABELS] ?? row.change_type,
      boq_code: row.boq_items?.code ?? null,
      boq_label: row.boq_items?.label ?? null,
      mandor_name: row.mandor_contracts?.mandor_name ?? null,
      reporter_name: row.profiles?.full_name ?? null,
      impact: row.impact,
      impact_label: IMPACT_LABELS[row.impact as keyof typeof IMPACT_LABELS] ?? row.impact,
      is_urgent: Boolean(row.is_urgent),
      decision: row.decision,
      decision_label: DECISION_LABELS[row.decision as keyof typeof DECISION_LABELS] ?? row.decision,
      flags,
      needs_owner_approval: Boolean(row.needs_owner_approval),
      estimator_note: row.estimator_note ?? null,
      resolution_note: row.resolution_note ?? null,
      reviewed_at: row.reviewed_at ?? null,
      resolved_at: row.resolved_at ?? null,
      photos,
      ...(showCosts ? {
        est_cost: row.est_cost ?? null,
        cost_bearer: row.cost_bearer ?? null,
        cost_bearer_label: row.cost_bearer
          ? COST_BEARER_LABELS[row.cost_bearer as keyof typeof COST_BEARER_LABELS] ?? row.cost_bearer
          : null,
      } : {}),
    };
  }));

  const byTypeMap = (rows ?? []).reduce((map: Map<string, number>, row: SiteChangeRow) => {
    map.set(row.change_type, (map.get(row.change_type) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const byType = Array.from<[string, number]>(byTypeMap.entries()).map(([change_type, count]) => ({
    change_type,
    label: CHANGE_TYPE_LABELS[change_type as keyof typeof CHANGE_TYPE_LABELS] ?? change_type,
    count,
  })).sort((a, b) => b.count - a.count);

  const byDecisionMap = (rows ?? []).reduce((map: Map<string, number>, row: SiteChangeRow) => {
    map.set(row.decision, (map.get(row.decision) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const byDecision = Array.from<[string, number]>(byDecisionMap.entries()).map(([decision, count]) => ({
    decision,
    label: DECISION_LABELS[decision as keyof typeof DECISION_LABELS] ?? decision,
    count,
  })).sort((a, b) => b.count - a.count);

  const approvedCostTotal = (rows ?? []).reduce((sum: number, row: SiteChangeRow) => {
    if (row.decision !== 'disetujui') return sum;
    return sum + Number(row.est_cost ?? 0);
  }, 0);

  return {
    type: 'site_change_log',
    title: 'Laporan Catatan Perubahan',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      show_costs: showCosts,
      summary: {
        total_items: rows?.length ?? 0,
        pending: (rows ?? []).filter((row: SiteChangeRow) => row.decision === 'pending').length,
        disetujui: (rows ?? []).filter((row: SiteChangeRow) => row.decision === 'disetujui').length,
        ditolak: (rows ?? []).filter((row: SiteChangeRow) => row.decision === 'ditolak').length,
        selesai: (rows ?? []).filter((row: SiteChangeRow) => row.decision === 'selesai').length,
        urgent: (rows ?? []).filter((row: SiteChangeRow) => row.is_urgent).length,
        impact_berat: (rows ?? []).filter((row: SiteChangeRow) => row.impact === 'berat').length,
        approved_unresolved: (rows ?? []).filter((row: SiteChangeRow) => row.decision === 'disetujui' && !row.resolved_at).length,
        open_rework: (rows ?? []).filter((row: SiteChangeRow) => row.change_type === 'rework' && row.decision !== 'selesai').length,
        open_quality_notes: (rows ?? []).filter((row: SiteChangeRow) => row.change_type === 'catatan_mutu' && row.decision !== 'selesai').length,
        approved_cost_total: showCosts ? approvedCostTotal : null,
      },
      by_type: byType,
      by_decision: byDecision,
      items,
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Punch List ──────────────────────────────────────────────────────

// ── Schedule Variance ───────────────────────────────────────────────

export async function generateScheduleVariance(projectId: string): Promise<ReportPayload> {
  const { data: milestones } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', projectId)
    .order('planned_date');

  const today = new Date();
  const msList: Milestone[] = milestones ?? [];

  const items = msList.map(m => {
    const planned = new Date(m.planned_date);
    const daysOut = Math.round((planned.getTime() - today.getTime()) / 86400000);
    return {
      label: m.label,
      planned_date: m.planned_date,
      revised_date: m.revised_date,
      revision_reason: m.revision_reason,
      status: m.status,
      days_remaining: daysOut,
    };
  });

  return {
    type: 'schedule_variance',
    title: 'Laporan Varians Jadwal',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    data: {
      total_milestones: items.length,
      on_track: items.filter(i => i.status === 'ON_TRACK' || i.status === 'AHEAD').length,
      at_risk: items.filter(i => i.status === 'AT_RISK').length,
      delayed: items.filter(i => i.status === 'DELAYED').length,
      milestones: items,
    },
  };
}

// ── Weekly Digest ───────────────────────────────────────────────────

export async function generateWeeklyDigest(projectId: string): Promise<ReportPayload> {
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);

  // Count activities this week
  const { data: activities } = await supabase
    .from('activity_log')
    .select('type, flag')
    .eq('project_id', projectId)
    .gte('created_at', weekStart.toISOString())
    .lte('created_at', weekEnd.toISOString());

  const typeCounts: Record<string, number> = {};
  const flagCounts: Record<string, number> = {};
  (activities ?? []).forEach(a => {
    typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
    flagCounts[a.flag] = (flagCounts[a.flag] ?? 0) + 1;
  });

  // Progress delta
  const progressReport = await generateProgressSummary(projectId);

  const digest = {
    week_start: weekStart.toISOString().split('T')[0],
    week_end: weekEnd.toISOString().split('T')[0],
    total_activities: (activities ?? []).length,
    by_type: typeCounts,
    by_flag: flagCounts,
    overall_progress: (progressReport.data as ProgressSummaryData).overall_progress,
  };

  // Save to weekly_digests table
  await supabase.from('weekly_digests').insert({
    project_id: projectId,
    week_start: digest.week_start,
    week_end: digest.week_end,
    summary: digest,
  });

  return {
    type: 'weekly_digest',
    title: 'Rangkuman Mingguan',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    data: digest,
  };
}

// ── Payroll Support Summary ─────────────────────────────────────────
// Lists all progress entries flagged for payroll, grouped by worker/subcontractor

async function generatePayrollSupportSummary(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  let query = supabase
    .from('progress_entries')
    .select('id, created_at, boq_item_id, quantity, unit, location, note, reported_by, payroll_support')
    .eq('project_id', projectId)
    .eq('payroll_support', true)
    .order('created_at', { ascending: false });

  if (filters.date_from) query = query.gte('created_at', filters.date_from);
  if (filters.date_to)   query = query.lte('created_at', filters.date_to + 'T23:59:59');
  if (filters.boq_ids?.length) query = query.in('boq_item_id', filters.boq_ids);

  const { data: entries, error } = await query;
  if (error) throw new Error(error.message);

  const boqIds = Array.from(new Set((entries ?? []).map((entry: PayrollEntryRow) => entry.boq_item_id).filter(Boolean)));
  const reporterIds = Array.from(new Set((entries ?? []).map((entry: PayrollEntryRow) => entry.reported_by).filter(Boolean)));

  const [boqRes, profileRes] = await Promise.all([
    boqIds.length > 0
      ? supabase.from('boq_items').select('id, code, label').in('id', boqIds)
      : Promise.resolve(emptyResult<BoqLookupRow>()),
    reporterIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', reporterIds)
      : Promise.resolve(emptyResult<ProfileLookupRow>()),
  ]);

  if (boqRes.error) throw new Error(boqRes.error.message);
  if (profileRes.error) throw new Error(profileRes.error.message);

  const boqMap = new Map<string, { code: string; label: string }>(
    (boqRes.data ?? []).map((item: BoqLookupRow) => [item.id, { code: item.code ?? '—', label: item.label ?? '—' }]),
  );
  const profileMap = new Map((profileRes.data ?? []).map((item: ProfileLookupRow) => [item.id, item.full_name]));

  const normalizedEntries = (entries ?? []).map((entry: PayrollEntryRow) => {
    const boq = boqMap.get(entry.boq_item_id);
    return {
      ...entry,
      boq_code: boq?.code ?? '—',
      boq_label: boq?.label ?? '—',
      reporter_name: profileMap.get(entry.reported_by) ?? 'Supervisor',
    };
  });

  type NormalizedEntry = PayrollEntryRow & { boq_code: string; boq_label: string; reporter_name: string };
  const byReporterMap = new Map<string, { reporter_name: string; total_qty: number; entry_count: number; entries: NormalizedEntry[] }>();
  normalizedEntries.forEach((entry) => {
    const current: { reporter_name: string; total_qty: number; entry_count: number; entries: NormalizedEntry[] } = byReporterMap.get(entry.reporter_name) ?? {
      reporter_name: entry.reporter_name,
      total_qty: 0,
      entry_count: 0,
      entries: [],
    };
    current.total_qty += entry.quantity ?? 0;
    current.entry_count += 1;
    current.entries.push(entry);
    byReporterMap.set(entry.reporter_name, current);
  });

  const byReporter = Array.from(byReporterMap.values()).sort((a, b) => b.entry_count - a.entry_count);

  return {
    type: 'payroll_support_summary',
    title: 'Ringkasan Dukungan Penggajian',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      purpose: 'Dokumen pendukung untuk rekap penggajian pekerjaan lapangan yang ditandai payroll support.',
      total_entries: normalizedEntries.length,
      total_qty: normalizedEntries.reduce((sum: number, entry: NormalizedEntry) => sum + (entry.quantity ?? 0), 0),
      by_reporter: byReporter,
      entries: normalizedEntries,
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Client Charge Report ────────────────────────────────────────────
// VO items caused by client requests + progress entries tagged for client billing

async function generateClientChargeReport(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  // VO entries chargeable to client
  let voQuery = supabase
    .from('vo_entries')
    .select('id, created_at, location, description, requested_by_name, cause, est_material, est_cost, status')
    .eq('project_id', projectId)
    .eq('cause', 'client_request')
    .order('created_at', { ascending: false });

  if (filters.date_from) voQuery = voQuery.gte('created_at', filters.date_from);
  if (filters.date_to)   voQuery = voQuery.lte('created_at', filters.date_to + 'T23:59:59');

  // Progress entries tagged for client charging
  let peQuery = supabase
    .from('progress_entries')
    .select('id, created_at, boq_item_id, quantity, unit, location, note, reported_by, client_charge_support')
    .eq('project_id', projectId)
    .eq('client_charge_support', true)
    .order('created_at', { ascending: false });

  if (filters.date_from) peQuery = peQuery.gte('created_at', filters.date_from);
  if (filters.date_to)   peQuery = peQuery.lte('created_at', filters.date_to + 'T23:59:59');
  if (filters.boq_ids?.length) peQuery = peQuery.in('boq_item_id', filters.boq_ids);

  const [voRes, peRes] = await Promise.all([voQuery, peQuery]);
  if (voRes.error) throw new Error(voRes.error.message);
  if (peRes.error) throw new Error(peRes.error.message);

  const voEntries = voRes.data ?? [];
  const peEntries = peRes.data ?? [];

  const boqIds = Array.from(new Set(peEntries.map((entry: ClientChargeEntryRow) => entry.boq_item_id).filter(Boolean)));
  const reporterIds = Array.from(new Set(peEntries.map((entry: ClientChargeEntryRow) => entry.reported_by).filter(Boolean)));

  const [boqRes, profileRes] = await Promise.all([
    boqIds.length > 0
      ? supabase.from('boq_items').select('id, code, label').in('id', boqIds)
      : Promise.resolve(emptyResult<BoqLookupRow>()),
    reporterIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', reporterIds)
      : Promise.resolve(emptyResult<ProfileLookupRow>()),
  ]);

  if (boqRes.error) throw new Error(boqRes.error.message);
  if (profileRes.error) throw new Error(profileRes.error.message);

  const boqMap = new Map<string, { code: string; label: string }>(
    (boqRes.data ?? []).map((item: BoqLookupRow) => [item.id, { code: item.code ?? '—', label: item.label ?? '—' }]),
  );
  const profileMap = new Map((profileRes.data ?? []).map((item: ProfileLookupRow) => [item.id, item.full_name]));

  const normalizedProgressEntries = peEntries.map((entry: ClientChargeEntryRow) => {
    const boq = boqMap.get(entry.boq_item_id);
    return {
      ...entry,
      boq_code: boq?.code ?? '—',
      boq_label: boq?.label ?? '—',
      reporter_name: profileMap.get(entry.reported_by) ?? 'Supervisor',
    };
  });

  const voTotal = voEntries.reduce((s, v: VoEntryRow) => s + (v.est_cost ?? 0), 0);

  return {
    type: 'client_charge_report',
    title: 'Laporan Tagihan Klien',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      purpose: 'Ringkasan item yang berpotensi ditagihkan ke klien. Nilai final tetap dikonfirmasi office dari VO yang disetujui.',
      vo_charges: { items: voEntries, total_est_cost: voTotal },
      progress_support: {
        items: normalizedProgressEntries,
        total_entries: normalizedProgressEntries.length,
        total_qty: normalizedProgressEntries.reduce((sum, entry) => sum + (entry.quantity ?? 0), 0),
      },
      grand_total_est_cost: voTotal,
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Audit List ──────────────────────────────────────────────────────
// Anomaly events and open audit cases for compliance review

async function generateAuditList(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  let anomalyQuery = supabase
    .from('anomaly_events')
    .select('id, created_at, event_type, entity_type, entity_id, severity, description')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (filters.date_from) anomalyQuery = anomalyQuery.gte('created_at', filters.date_from);
  if (filters.date_to)   anomalyQuery = anomalyQuery.lte('created_at', filters.date_to + 'T23:59:59');

  let auditQuery = supabase
    .from('audit_cases')
    .select('id, created_at, trigger_type, entity_type, entity_id, status, notes')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (filters.date_from) auditQuery = auditQuery.gte('created_at', filters.date_from);
  if (filters.date_to)   auditQuery = auditQuery.lte('created_at', filters.date_to + 'T23:59:59');

  const [anomalyRes, auditRes] = await Promise.all([anomalyQuery, auditQuery]);

  // Tables may not exist yet during local testing — treat missing as empty
  const anomalies = anomalyRes.data ?? [];
  const auditCases = auditRes.data ?? [];

  const openAnomalies = anomalies;
  const openCases = auditCases.filter((c: AuditCaseRow) => c.status !== 'CLOSED');

  return {
    type: 'audit_list',
    title: 'Daftar Audit & Anomali',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      anomalies: {
        total: anomalies.length,
        open: openAnomalies.length,
        items: anomalies,
      },
      audit_cases: {
        total: auditCases.length,
        open: openCases.length,
        items: auditCases,
      },
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Report Export Record ────────────────────────────────────────────
// Records that a report was generated (for audit trail)

export async function recordReportExport(
  projectId: string,
  userId: string,
  reportType: ReportType,
  filters: object = {},
): Promise<void> {
  await supabase.from('report_exports').insert({
    project_id: projectId,
    report_type: reportType,
    filters,
    file_path: `exports/${projectId}/${reportType}_${Date.now()}.json`,
    generated_by: userId,
  });
}

// ── AI Usage Summary ────────────────────────────────────────────────

export async function generateAIUsageSummary(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  let query = supabase
    .from('ai_chat_log')
    .select('user_id, model, input_tokens, output_tokens, user_role, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  const { data: logs, error } = await query;

  if (error) {
    return {
      type: 'ai_usage_summary',
      title: 'Laporan Penggunaan AI per User',
      generated_at: new Date().toISOString(),
      project_id: projectId,
      filters,
      data: {
        summary: {
          total_interactions: 0,
          active_users: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_tokens: 0,
          haiku_count: 0,
          sonnet_count: 0,
        },
        users: [],
        usage_by_day: [],
        date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
        error: error.message,
      },
    };
  }

  const rows = logs ?? [];
  const userIds = Array.from(new Set(rows.map(row => row.user_id).filter(Boolean)));
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, role').in('id', userIds)
    : { data: [] as Array<{ id: string; full_name: string; role: string }> };

  const profileMap = new Map((profiles ?? []).map(profile => [profile.id, profile]));
  const userBuckets = new Map<string, {
    user_id: string;
    full_name: string;
    role: string;
    interaction_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    haiku_count: number;
    sonnet_count: number;
    active_days: Set<string>;
    last_used_at: string | null;
  }>();
  const dayBuckets = new Map<string, {
    date: string;
    interaction_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>();

  let totalInput = 0;
  let totalOutput = 0;
  let haikuCount = 0;
  let sonnetCount = 0;

  for (const row of rows) {
    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    const totalTokens = inputTokens + outputTokens;
    const dayKey = String(row.created_at ?? '').slice(0, 10);
    const profile = profileMap.get(row.user_id);

    totalInput += inputTokens;
    totalOutput += outputTokens;
    if (row.model === 'sonnet') sonnetCount += 1;
    else haikuCount += 1;

    if (!userBuckets.has(row.user_id)) {
      userBuckets.set(row.user_id, {
        user_id: row.user_id,
        full_name: profile?.full_name ?? 'User',
        role: profile?.role ?? row.user_role ?? '—',
        interaction_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        haiku_count: 0,
        sonnet_count: 0,
        active_days: new Set<string>(),
        last_used_at: null,
      });
    }

    const userBucket = userBuckets.get(row.user_id)!;
    userBucket.interaction_count += 1;
    userBucket.input_tokens += inputTokens;
    userBucket.output_tokens += outputTokens;
    userBucket.total_tokens += totalTokens;
    userBucket.active_days.add(dayKey);
    if (row.model === 'sonnet') userBucket.sonnet_count += 1;
    else userBucket.haiku_count += 1;
    if (!userBucket.last_used_at || row.created_at > userBucket.last_used_at) {
      userBucket.last_used_at = row.created_at;
    }

    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, {
        date: dayKey,
        interaction_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      });
    }

    const dayBucket = dayBuckets.get(dayKey)!;
    dayBucket.interaction_count += 1;
    dayBucket.input_tokens += inputTokens;
    dayBucket.output_tokens += outputTokens;
    dayBucket.total_tokens += totalTokens;
  }

  const users = Array.from(userBuckets.values())
    .map(user => ({
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role,
      interaction_count: user.interaction_count,
      input_tokens: user.input_tokens,
      output_tokens: user.output_tokens,
      total_tokens: user.total_tokens,
      haiku_count: user.haiku_count,
      sonnet_count: user.sonnet_count,
      active_days: user.active_days.size,
      last_used_at: user.last_used_at,
    }))
    .sort((a, b) => {
      if (b.total_tokens !== a.total_tokens) return b.total_tokens - a.total_tokens;
      return b.interaction_count - a.interaction_count;
    });

  const usageByDay = Array.from(dayBuckets.values())
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    type: 'ai_usage_summary',
    title: 'Laporan Penggunaan AI per User',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      summary: {
        total_interactions: rows.length,
        active_users: users.length,
        total_input_tokens: totalInput,
        total_output_tokens: totalOutput,
        total_tokens: totalInput + totalOutput,
        haiku_count: haikuCount,
        sonnet_count: sonnetCount,
      },
      users,
      usage_by_day: usageByDay,
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Approval SLA per User ───────────────────────────────────────────

export async function generateApprovalSLAUser(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);

  let requestQuery = supabase
    .from('material_request_headers')
    .select('requested_by, reviewed_by, created_at, reviewed_at, overall_status')
    .eq('project_id', projectId);
  let voQuery = supabase
    .from('vo_entries')
    .select('created_by, reviewed_by, created_at, reviewed_at, status')
    .eq('project_id', projectId);
  let mtnQuery = supabase
    .from('mtn_requests')
    .select('requested_by, reviewed_by, created_at, reviewed_at, status')
    .eq('project_id', projectId);
  let taskQuery = supabase
    .from('approval_tasks')
    .select('assigned_to, entity_type, action, created_at, acted_at')
    .eq('project_id', projectId);
  let opnameQuery = supabase
    .from('opname_headers')
    .select('submitted_at, verified_by, verified_at, approved_by, approved_at, status')
    .eq('project_id', projectId);
  let attendanceQuery = supabase
    .from('mandor_attendance')
    .select('created_at, verified_by, verified_at, status')
    .eq('project_id', projectId);
  let kasbonQuery = supabase
    .from('mandor_kasbon')
    .select('created_at, approved_by, approved_at, status')
    .eq('project_id', projectId);

  if (dateFrom) {
    requestQuery = requestQuery.gte('created_at', dateFrom);
    voQuery = voQuery.gte('created_at', dateFrom);
    mtnQuery = mtnQuery.gte('created_at', dateFrom);
    taskQuery = taskQuery.gte('created_at', dateFrom);
    opnameQuery = opnameQuery.gte('submitted_at', dateFrom);
    attendanceQuery = attendanceQuery.gte('created_at', dateFrom);
    kasbonQuery = kasbonQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    requestQuery = requestQuery.lte('created_at', dateTo);
    voQuery = voQuery.lte('created_at', dateTo);
    mtnQuery = mtnQuery.lte('created_at', dateTo);
    taskQuery = taskQuery.lte('created_at', dateTo);
    opnameQuery = opnameQuery.lte('submitted_at', dateTo);
    attendanceQuery = attendanceQuery.lte('created_at', dateTo);
    kasbonQuery = kasbonQuery.lte('created_at', dateTo);
  }

  const [
    requestRes,
    voRes,
    mtnRes,
    taskRes,
    opnameRes,
    attendanceRes,
    kasbonRes,
  ] = await Promise.all([
    requestQuery,
    voQuery,
    mtnQuery,
    taskQuery,
    opnameQuery,
    attendanceQuery,
    kasbonQuery,
  ]);

  const requestRows = requestRes.data ?? [];
  const voRows = voRes.data ?? [];
  const mtnRows = mtnRes.data ?? [];
  const taskRows = taskRes.data ?? [];
  const opnameRows = opnameRes.data ?? [];
  const attendanceRows = attendanceRes.data ?? [];
  const kasbonRows = kasbonRes.data ?? [];

  const events: Array<{
    user_id: string;
    entity: string;
    hours: number;
    completed_at: string;
  }> = [];
  const entityBuckets = new Map<string, number[]>();
  const pendingByQueue = [
    { label: 'Permintaan Material', count: requestRows.filter((row: MRHeaderRow) => !row.reviewed_at && ['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD'].includes(row.overall_status)).length },
    { label: 'VO Menunggu Review', count: voRows.filter((row: VoSlaRow) => !row.reviewed_at && row.status === 'AWAITING').length },
    { label: 'MTN Menunggu Review', count: mtnRows.filter((row: MtnSlaRow) => !row.reviewed_at && row.status === 'AWAITING').length },
    { label: 'Approval Task Pending', count: taskRows.filter((row: ApprovalTaskRow) => !row.action).length },
    { label: 'Opname Menunggu Verifikasi', count: opnameRows.filter((row: OpnameHeaderRow) => row.status === 'SUBMITTED').length },
    { label: 'Opname Menunggu Approval', count: opnameRows.filter((row: OpnameHeaderRow) => row.status === 'VERIFIED').length },
    { label: 'Attendance Draft', count: attendanceRows.filter((row: AttendanceSlaRow) => row.status === 'DRAFT').length },
    { label: 'Kasbon Requested', count: kasbonRows.filter((row: KasbonSlaRow) => row.status === 'REQUESTED').length },
  ];
  const assignedPending = new Map<string, number>();

  const pushEvent = (userId: string | null | undefined, entity: string, start?: string | null, end?: string | null) => {
    if (!userId) return;
    const hours = hoursBetween(start, end);
    if (hours == null || !end) return;
    events.push({ user_id: userId, entity, hours, completed_at: end });
    const bucket = entityBuckets.get(entity) ?? [];
    bucket.push(hours);
    entityBuckets.set(entity, bucket);
  };

  requestRows.forEach((row: MRHeaderRow) => pushEvent(row.reviewed_by, 'Permintaan Material', row.created_at, row.reviewed_at));
  voRows.forEach((row: VoSlaRow) => pushEvent(row.reviewed_by, 'VO', row.created_at, row.reviewed_at));
  mtnRows.forEach((row: MtnSlaRow) => pushEvent(row.reviewed_by, 'MTN', row.created_at, row.reviewed_at));
  taskRows.forEach((row: ApprovalTaskRow) => {
    if (!row.action) {
      assignedPending.set(row.assigned_to, (assignedPending.get(row.assigned_to) ?? 0) + 1);
      return;
    }
    pushEvent(row.assigned_to, `Task ${row.entity_type}`, row.created_at, row.acted_at);
  });
  opnameRows.forEach((row: OpnameHeaderRow) => {
    pushEvent(row.verified_by, 'Verifikasi Opname', row.submitted_at, row.verified_at);
    pushEvent(row.approved_by, 'Approval Opname', row.verified_at ?? row.submitted_at, row.approved_at);
  });
  attendanceRows.forEach((row: AttendanceSlaRow) => pushEvent(row.verified_by, 'Verifikasi Attendance', row.created_at, row.verified_at));
  kasbonRows.forEach((row: KasbonSlaRow) => pushEvent(row.approved_by, 'Approval Kasbon', row.created_at, row.approved_at));

  const userIds = Array.from(new Set([
    ...events.map(event => event.user_id),
    ...Array.from(assignedPending.keys()),
  ]));
  const profileMap = await getProfileDirectory(userIds);
  const userBuckets = new Map<string, {
    user_id: string;
    full_name: string;
    role: string;
    handled_events: number;
    hours: number[];
    over_24h: number;
    assigned_pending: number;
    last_acted_at: string | null;
    by_entity: Record<string, number>;
  }>();

  const ensureUser = (userId: string) => {
    if (!userBuckets.has(userId)) {
      const profile = profileMap.get(userId);
      userBuckets.set(userId, {
        user_id: userId,
        full_name: profile?.full_name ?? 'User',
        role: profile?.role ?? '—',
        handled_events: 0,
        hours: [],
        over_24h: 0,
        assigned_pending: assignedPending.get(userId) ?? 0,
        last_acted_at: null,
        by_entity: {},
      });
    }
    return userBuckets.get(userId)!;
  };

  events.forEach(event => {
    const bucket = ensureUser(event.user_id);
    bucket.handled_events += 1;
    bucket.hours.push(event.hours);
    bucket.by_entity[event.entity] = (bucket.by_entity[event.entity] ?? 0) + 1;
    if (event.hours > 24) bucket.over_24h += 1;
    if (!bucket.last_acted_at || event.completed_at > bucket.last_acted_at) {
      bucket.last_acted_at = event.completed_at;
    }
  });

  Array.from(assignedPending.keys()).forEach(userId => ensureUser(userId));

  const users = Array.from(userBuckets.values())
    .map(user => ({
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role,
      handled_events: user.handled_events,
      avg_hours: user.hours.length > 0 ? Number((user.hours.reduce((sum, value) => sum + value, 0) / user.hours.length).toFixed(2)) : 0,
      median_hours: median(user.hours),
      over_24h: user.over_24h,
      assigned_pending: user.assigned_pending,
      last_acted_at: user.last_acted_at,
      by_entity: user.by_entity,
    }))
    .sort((a, b) => {
      if (b.handled_events !== a.handled_events) return b.handled_events - a.handled_events;
      return a.avg_hours - b.avg_hours;
    });

  const allHours = events.map(event => event.hours);
  const entitySla = Array.from(entityBuckets.entries()).map(([entity, hours]) => ({
    entity,
    handled_events: hours.length,
    avg_hours: Number((hours.reduce((sum, value) => sum + value, 0) / Math.max(hours.length, 1)).toFixed(2)),
    median_hours: median(hours),
  })).sort((a, b) => b.handled_events - a.handled_events);

  return {
    type: 'approval_sla_user',
    title: 'Approval SLA per User',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      summary: {
        handled_events: events.length,
        active_reviewers: users.filter(user => user.handled_events > 0).length,
        avg_hours: allHours.length > 0 ? Number((allHours.reduce((sum, value) => sum + value, 0) / allHours.length).toFixed(2)) : 0,
        median_hours: median(allHours),
        over_24h: allHours.filter(value => value > 24).length,
        pending_items: pendingByQueue.reduce((sum, item) => sum + item.count, 0),
      },
      pending_by_queue: pendingByQueue,
      users,
      entity_sla: entitySla,
      note: 'SLA dihitung dari waktu submit/buat sampai review, verify, atau approve tercatat di sistem.',
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Operational Entry Discipline ────────────────────────────────────

export async function generateOperationalEntryDiscipline(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);

  let requestQuery = supabase.from('material_request_headers').select('id, requested_by, created_at').eq('project_id', projectId);
  let receiptQuery = supabase.from('receipts').select('id, received_by, created_at').eq('project_id', projectId);
  let progressQuery = supabase.from('progress_entries').select('id, reported_by, created_at').eq('project_id', projectId);
  let defectQuery = supabase.from('defects').select('id, reported_by, created_at, photo_path').eq('project_id', projectId);
  let voQuery = supabase.from('vo_entries').select('id, created_by, created_at, photo_path').eq('project_id', projectId);
  let reworkQuery = supabase.from('rework_entries').select('id, created_by, created_at').eq('project_id', projectId);
  let mtnQuery = supabase.from('mtn_requests').select('id, requested_by, created_at, photo_path').eq('project_id', projectId);
  let attendanceQuery = supabase.from('mandor_attendance').select('id, recorded_by, created_at').eq('project_id', projectId);
  let kasbonQuery = supabase.from('mandor_kasbon').select('id, requested_by, created_at').eq('project_id', projectId);

  if (dateFrom) {
    requestQuery = requestQuery.gte('created_at', dateFrom);
    receiptQuery = receiptQuery.gte('created_at', dateFrom);
    progressQuery = progressQuery.gte('created_at', dateFrom);
    defectQuery = defectQuery.gte('created_at', dateFrom);
    voQuery = voQuery.gte('created_at', dateFrom);
    reworkQuery = reworkQuery.gte('created_at', dateFrom);
    mtnQuery = mtnQuery.gte('created_at', dateFrom);
    attendanceQuery = attendanceQuery.gte('created_at', dateFrom);
    kasbonQuery = kasbonQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    requestQuery = requestQuery.lte('created_at', dateTo);
    receiptQuery = receiptQuery.lte('created_at', dateTo);
    progressQuery = progressQuery.lte('created_at', dateTo);
    defectQuery = defectQuery.lte('created_at', dateTo);
    voQuery = voQuery.lte('created_at', dateTo);
    reworkQuery = reworkQuery.lte('created_at', dateTo);
    mtnQuery = mtnQuery.lte('created_at', dateTo);
    attendanceQuery = attendanceQuery.lte('created_at', dateTo);
    kasbonQuery = kasbonQuery.lte('created_at', dateTo);
  }

  const [
    requestRes,
    receiptRes,
    progressRes,
    defectRes,
    voRes,
    reworkRes,
    mtnRes,
    attendanceRes,
    kasbonRes,
  ] = await Promise.all([
    requestQuery,
    receiptQuery,
    progressQuery,
    defectQuery,
    voQuery,
    reworkQuery,
    mtnQuery,
    attendanceQuery,
    kasbonQuery,
  ]);

  const requestRows = requestRes.data ?? [];
  const receiptRows = receiptRes.data ?? [];
  const progressRows = progressRes.data ?? [];
  const defectRows = defectRes.data ?? [];
  const voRows = voRes.data ?? [];
  const reworkRows = reworkRes.data ?? [];
  const mtnRows = mtnRes.data ?? [];
  const attendanceRows = attendanceRes.data ?? [];
  const kasbonRows = kasbonRes.data ?? [];

  const [progressPhotoRes, receiptPhotoRes, defectPhotoRes, voPhotoRes, reworkPhotoRes, mtnPhotoRes] = await Promise.all([
    progressRows.length > 0
      ? supabase.from('progress_photos').select('progress_entry_id').in('progress_entry_id', progressRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
    receiptRows.length > 0
      ? supabase.from('receipt_photos').select('receipt_id').in('receipt_id', receiptRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
    defectRows.length > 0
      ? supabase.from('defect_photos').select('defect_id').in('defect_id', defectRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
    voRows.length > 0
      ? supabase.from('vo_photos').select('vo_entry_id').in('vo_entry_id', voRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
    reworkRows.length > 0
      ? supabase.from('rework_photos').select('rework_entry_id').in('rework_entry_id', reworkRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
    mtnRows.length > 0
      ? supabase.from('mtn_photos').select('mtn_request_id').in('mtn_request_id', mtnRows.map((row: EntityRow) => row.id))
      : Promise.resolve(emptyResult<PhotoRefRow>()),
  ]);

  const progressPhotoSet = new Set((progressPhotoRes.data ?? []).map((row: PhotoRefRow) => row.progress_entry_id));
  const receiptPhotoSet = new Set((receiptPhotoRes.data ?? []).map((row: PhotoRefRow) => row.receipt_id));
  const defectPhotoSet = new Set((defectPhotoRes.data ?? []).map((row: PhotoRefRow) => row.defect_id));
  const voPhotoSet = new Set((voPhotoRes.data ?? []).map((row: PhotoRefRow) => row.vo_entry_id));
  const reworkPhotoSet = new Set((reworkPhotoRes.data ?? []).map((row: PhotoRefRow) => row.rework_entry_id));
  const mtnPhotoSet = new Set((mtnPhotoRes.data ?? []).map((row: PhotoRefRow) => row.mtn_request_id));

  const entries: Array<{
    user_id: string;
    module: string;
    created_at: string;
    photo_eligible: boolean;
    has_photo: boolean;
  }> = [];

  (requestRows as OpsRequestRow[]).forEach((row) => entries.push({ user_id: row.requested_by, module: 'Permintaan Material', created_at: row.created_at, photo_eligible: false, has_photo: false }));
  (receiptRows as OpsReceiptRow[]).forEach((row) => entries.push({ user_id: row.received_by, module: 'Penerimaan', created_at: row.created_at, photo_eligible: true, has_photo: receiptPhotoSet.has(row.id) }));
  (progressRows as OpsProgressRow[]).forEach((row) => entries.push({ user_id: row.reported_by, module: 'Progres', created_at: row.created_at, photo_eligible: true, has_photo: progressPhotoSet.has(row.id) }));
  (defectRows as OpsDefectRow[]).forEach((row) => entries.push({ user_id: row.reported_by, module: 'Cacat', created_at: row.created_at, photo_eligible: true, has_photo: Boolean(row.photo_path) || defectPhotoSet.has(row.id) }));
  (voRows as OpsVoRow[]).forEach((row) => entries.push({ user_id: row.created_by, module: 'VO', created_at: row.created_at, photo_eligible: true, has_photo: Boolean(row.photo_path) || voPhotoSet.has(row.id) }));
  (reworkRows as OpsReworkRow[]).forEach((row) => entries.push({ user_id: row.created_by, module: 'Rework', created_at: row.created_at, photo_eligible: true, has_photo: reworkPhotoSet.has(row.id) }));
  (mtnRows as OpsMtnRow[]).forEach((row) => entries.push({ user_id: row.requested_by, module: 'MTN', created_at: row.created_at, photo_eligible: true, has_photo: Boolean(row.photo_path) || mtnPhotoSet.has(row.id) }));
  (attendanceRows as OpsAttendanceRow[]).forEach((row) => entries.push({ user_id: row.recorded_by, module: 'Attendance', created_at: row.created_at, photo_eligible: false, has_photo: false }));
  (kasbonRows as OpsKasbonRow[]).forEach((row) => entries.push({ user_id: row.requested_by, module: 'Kasbon', created_at: row.created_at, photo_eligible: false, has_photo: false }));

  const userIds = Array.from(new Set(entries.map(entry => entry.user_id).filter(Boolean)));
  const profileMap = await getProfileDirectory(userIds);
  const moduleCounts = new Map<string, number>();
  const userBuckets = new Map<string, {
    user_id: string;
    full_name: string;
    role: string;
    total_entries: number;
    photo_eligible_entries: number;
    photo_backed_entries: number;
    active_days: Set<string>;
    last_activity: string | null;
    by_module: Record<string, number>;
  }>();

  const ensureUser = (userId: string) => {
    if (!userBuckets.has(userId)) {
      const profile = profileMap.get(userId);
      userBuckets.set(userId, {
        user_id: userId,
        full_name: profile?.full_name ?? 'User',
        role: profile?.role ?? '—',
        total_entries: 0,
        photo_eligible_entries: 0,
        photo_backed_entries: 0,
        active_days: new Set<string>(),
        last_activity: null,
        by_module: {},
      });
    }
    return userBuckets.get(userId)!;
  };

  entries.forEach(entry => {
    moduleCounts.set(entry.module, (moduleCounts.get(entry.module) ?? 0) + 1);
    const bucket = ensureUser(entry.user_id);
    bucket.total_entries += 1;
    bucket.by_module[entry.module] = (bucket.by_module[entry.module] ?? 0) + 1;
    bucket.active_days.add(String(entry.created_at).slice(0, 10));
    if (entry.photo_eligible) {
      bucket.photo_eligible_entries += 1;
      if (entry.has_photo) bucket.photo_backed_entries += 1;
    }
    if (!bucket.last_activity || entry.created_at > bucket.last_activity) {
      bucket.last_activity = entry.created_at;
    }
  });

  const users = Array.from(userBuckets.values())
    .map(user => ({
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role,
      total_entries: user.total_entries,
      active_days: user.active_days.size,
      photo_coverage_pct: user.photo_eligible_entries > 0
        ? Math.round((user.photo_backed_entries / user.photo_eligible_entries) * 100)
        : null,
      last_activity: user.last_activity,
      by_module: user.by_module,
    }))
    .sort((a, b) => b.total_entries - a.total_entries);

  const eligibleEntries = entries.filter(entry => entry.photo_eligible).length;
  const photoBackedEntries = entries.filter(entry => entry.photo_eligible && entry.has_photo).length;

  return {
    type: 'operational_entry_discipline',
    title: 'Disiplin Entry Operasional',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      summary: {
        total_entries: entries.length,
        active_users: users.length,
        photo_eligible_entries: eligibleEntries,
        photo_backed_entries: photoBackedEntries,
        photo_coverage_pct: eligibleEntries > 0 ? Math.round((photoBackedEntries / eligibleEntries) * 100) : 0,
      },
      by_module: Array.from(moduleCounts.entries()).map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count),
      users,
      note: 'Disiplin operasional dibaca dari konsistensi input lintas modul dan kelengkapan bukti foto pada form yang mendukung lampiran.',
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Tool Usage Summary ──────────────────────────────────────────────

export async function generateToolUsageSummary(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);

  let exportQuery = supabase
    .from('report_exports')
    .select('generated_by, report_type, generated_at')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false });
  let aiQuery = supabase
    .from('ai_chat_log')
    .select('user_id, model, input_tokens, output_tokens, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (dateFrom) {
    exportQuery = exportQuery.gte('generated_at', dateFrom);
    aiQuery = aiQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    exportQuery = exportQuery.lte('generated_at', dateTo);
    aiQuery = aiQuery.lte('created_at', dateTo);
  }

  const [exportRes, aiRes] = await Promise.all([exportQuery, aiQuery]);
  const exportRows = exportRes.data ?? [];
  const aiRows = aiRes.data ?? [];

  const userIds = Array.from(new Set([
    ...exportRows.map((row: ReportExportRow) => row.generated_by),
    ...aiRows.map((row: AiChatRow) => row.user_id),
  ].filter(Boolean)));
  const profileMap = await getProfileDirectory(userIds);
  const reportTypeCounts = new Map<string, number>();
  const userBuckets = new Map<string, {
    user_id: string;
    full_name: string;
    role: string;
    export_count: number;
    ai_chat_count: number;
    total_tokens: number;
    haiku_count: number;
    sonnet_count: number;
    last_seen: string | null;
  }>();

  const ensureUser = (userId: string) => {
    if (!userBuckets.has(userId)) {
      const profile = profileMap.get(userId);
      userBuckets.set(userId, {
        user_id: userId,
        full_name: profile?.full_name ?? 'User',
        role: profile?.role ?? '—',
        export_count: 0,
        ai_chat_count: 0,
        total_tokens: 0,
        haiku_count: 0,
        sonnet_count: 0,
        last_seen: null,
      });
    }
    return userBuckets.get(userId)!;
  };

  exportRows.forEach((row: ReportExportRow) => {
    reportTypeCounts.set(row.report_type, (reportTypeCounts.get(row.report_type) ?? 0) + 1);
    const bucket = ensureUser(row.generated_by);
    bucket.export_count += 1;
    if (!bucket.last_seen || row.generated_at > bucket.last_seen) {
      bucket.last_seen = row.generated_at;
    }
  });

  aiRows.forEach((row: AiChatRow) => {
    const bucket = ensureUser(row.user_id);
    bucket.ai_chat_count += 1;
    bucket.total_tokens += Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0);
    if (row.model === 'sonnet') bucket.sonnet_count += 1;
    else bucket.haiku_count += 1;
    if (!bucket.last_seen || row.created_at > bucket.last_seen) {
      bucket.last_seen = row.created_at;
    }
  });

  const users = Array.from(userBuckets.values())
    .sort((a, b) => {
      const aActivity = a.export_count + a.ai_chat_count;
      const bActivity = b.export_count + b.ai_chat_count;
      if (bActivity !== aActivity) return bActivity - aActivity;
      return b.total_tokens - a.total_tokens;
    });

  return {
    type: 'tool_usage_summary',
    title: 'Penggunaan Laporan & AI',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      summary: {
        total_exports: exportRows.length,
        export_users: new Set(exportRows.map((row: ReportExportRow) => row.generated_by)).size,
        total_ai_chats: aiRows.length,
        ai_users: new Set(aiRows.map((row: AiChatRow) => row.user_id)).size,
        total_ai_tokens: aiRows.reduce((sum: number, row: AiChatRow) => sum + Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0), 0),
      },
      top_report_types: Array.from(reportTypeCounts.entries()).map(([report_type, count]) => ({ report_type, count })).sort((a, b) => b.count - a.count),
      users,
      note: 'Report ini membaca penggunaan laporan export dan Asisten SANO. View dashboard murni belum di-log sebagai telemetry terpisah.',
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Exception Handling Load ─────────────────────────────────────────

export async function generateExceptionHandlingLoad(
  projectId: string,
  filters: ReportFilters = {},
): Promise<ReportPayload> {
  const dateFrom = toStartOfDay(filters.date_from);
  const dateTo = toEndOfDay(filters.date_to);

  let taskQuery = supabase
    .from('approval_tasks')
    .select('assigned_to, entity_type, action, created_at, acted_at')
    .eq('project_id', projectId);
  let requestQuery = supabase
    .from('material_request_headers')
    .select('requested_by, reviewed_by, created_at, reviewed_at, overall_status')
    .eq('project_id', projectId);
  let voQuery = supabase
    .from('vo_entries')
    .select('created_by, reviewed_by, created_at, reviewed_at, status')
    .eq('project_id', projectId);
  let mtnQuery = supabase
    .from('mtn_requests')
    .select('requested_by, reviewed_by, created_at, reviewed_at, status')
    .eq('project_id', projectId);
  let anomalyQuery = supabase
    .from('anomaly_events')
    .select('event_type, severity, created_at')
    .eq('project_id', projectId);
  let auditQuery = supabase
    .from('audit_cases')
    .select('trigger_type, status, created_at')
    .eq('project_id', projectId);

  if (dateFrom) {
    taskQuery = taskQuery.gte('created_at', dateFrom);
    requestQuery = requestQuery.gte('created_at', dateFrom);
    voQuery = voQuery.gte('created_at', dateFrom);
    mtnQuery = mtnQuery.gte('created_at', dateFrom);
    anomalyQuery = anomalyQuery.gte('created_at', dateFrom);
    auditQuery = auditQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    taskQuery = taskQuery.lte('created_at', dateTo);
    requestQuery = requestQuery.lte('created_at', dateTo);
    voQuery = voQuery.lte('created_at', dateTo);
    mtnQuery = mtnQuery.lte('created_at', dateTo);
    anomalyQuery = anomalyQuery.lte('created_at', dateTo);
    auditQuery = auditQuery.lte('created_at', dateTo);
  }

  const [taskRes, requestRes, voRes, mtnRes, anomalyRes, auditRes] = await Promise.all([
    taskQuery,
    requestQuery,
    voQuery,
    mtnQuery,
    anomalyQuery,
    auditQuery,
  ]);

  const taskRows = taskRes.data ?? [];
  const requestRows = requestRes.data ?? [];
  const voRows = voRes.data ?? [];
  const mtnRows = mtnRes.data ?? [];
  const anomalyRows = anomalyRes.data ?? [];
  const auditRows = auditRes.data ?? [];

  const userIds = Array.from(new Set([
    ...taskRows.map((row: ApprovalTaskRow) => row.assigned_to),
    ...requestRows.flatMap((row: MRHeaderRow) => [row.requested_by, row.reviewed_by]),
    ...voRows.flatMap((row: VoSlaRow) => [row.created_by, row.reviewed_by]),
    ...mtnRows.flatMap((row: MtnSlaRow) => [row.requested_by, row.reviewed_by]),
  ].filter((id): id is string => Boolean(id))));
  const profileMap = await getProfileDirectory(userIds);

  const users = new Map<string, {
    user_id: string;
    full_name: string;
    role: string;
    generated_count: number;
    handled_count: number;
    hold_reject_override: number;
    last_touch: string | null;
  }>();
  const ensureUser = (userId: string) => {
    if (!users.has(userId)) {
      const profile = profileMap.get(userId);
      users.set(userId, {
        user_id: userId,
        full_name: profile?.full_name ?? 'User',
        role: profile?.role ?? '—',
        generated_count: 0,
        handled_count: 0,
        hold_reject_override: 0,
        last_touch: null,
      });
    }
    return users.get(userId)!;
  };

  requestRows.forEach((row: MRHeaderRow) => {
    if (row.overall_status === 'AUTO_HOLD') {
      const creator = ensureUser(row.requested_by);
      creator.generated_count += 1;
      if (!creator.last_touch || row.created_at > creator.last_touch) creator.last_touch = row.created_at;
      if (row.reviewed_by) {
        const reviewer = ensureUser(row.reviewed_by);
        reviewer.handled_count += 1;
        reviewer.hold_reject_override += 1;
        if (!reviewer.last_touch || (row.reviewed_at && row.reviewed_at > reviewer.last_touch)) reviewer.last_touch = row.reviewed_at;
      }
    } else if (row.overall_status === 'REJECTED' && row.reviewed_by) {
      const reviewer = ensureUser(row.reviewed_by);
      reviewer.handled_count += 1;
      reviewer.hold_reject_override += 1;
      if (!reviewer.last_touch || (row.reviewed_at && row.reviewed_at > reviewer.last_touch)) reviewer.last_touch = row.reviewed_at;
    }
  });

  voRows.forEach((row: VoSlaRow) => {
    if (row.status === 'REJECTED') {
      const creator = ensureUser(row.created_by);
      creator.generated_count += 1;
      if (!creator.last_touch || row.created_at > creator.last_touch) creator.last_touch = row.created_at;
      if (row.reviewed_by) {
        const reviewer = ensureUser(row.reviewed_by);
        reviewer.handled_count += 1;
        reviewer.hold_reject_override += 1;
        if (!reviewer.last_touch || (row.reviewed_at && row.reviewed_at > reviewer.last_touch)) reviewer.last_touch = row.reviewed_at;
      }
    }
  });

  mtnRows.forEach((row: MtnSlaRow) => {
    if (row.status === 'REJECTED') {
      const creator = ensureUser(row.requested_by);
      creator.generated_count += 1;
      if (!creator.last_touch || row.created_at > creator.last_touch) creator.last_touch = row.created_at;
      if (row.reviewed_by) {
        const reviewer = ensureUser(row.reviewed_by);
        reviewer.handled_count += 1;
        reviewer.hold_reject_override += 1;
        if (!reviewer.last_touch || (row.reviewed_at && row.reviewed_at > reviewer.last_touch)) reviewer.last_touch = row.reviewed_at;
      }
    }
  });

  taskRows.forEach((row: ApprovalTaskRow) => {
    if (!['HOLD', 'REJECT', 'OVERRIDE'].includes(row.action ?? '')) return;
    const assignee = ensureUser(row.assigned_to);
    assignee.handled_count += 1;
    assignee.hold_reject_override += 1;
    if (!assignee.last_touch || (row.acted_at && row.acted_at > assignee.last_touch)) assignee.last_touch = row.acted_at;
  });

  return {
    type: 'exception_handling_load',
    title: 'Beban Penanganan Exception',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    filters,
    data: {
      summary: {
        auto_hold_requests: requestRows.filter((row: MRHeaderRow) => row.overall_status === 'AUTO_HOLD').length,
        rejected_requests: requestRows.filter((row: MRHeaderRow) => row.overall_status === 'REJECTED').length,
        rejected_vo: voRows.filter((row: VoSlaRow) => row.status === 'REJECTED').length,
        rejected_mtn: mtnRows.filter((row: MtnSlaRow) => row.status === 'REJECTED').length,
        hold_reject_override_actions: taskRows.filter((row: ApprovalTaskRow) => ['HOLD', 'REJECT', 'OVERRIDE'].includes(row.action ?? '')).length,
        anomalies_total: anomalyRows.length,
        anomalies_high_or_critical: anomalyRows.filter((row: AnomalyEventRow) => ['HIGH', 'CRITICAL'].includes(row.severity)).length,
        audit_cases_open: auditRows.filter((row: AuditCaseMinRow) => row.status !== 'CLOSED').length,
      },
      users: Array.from(users.values()).sort((a, b) => {
        if (b.handled_count !== a.handled_count) return b.handled_count - a.handled_count;
        return b.generated_count - a.generated_count;
      }),
      anomaly_breakdown: Array.from(
        anomalyRows.reduce((map: Map<string, number>, row: AnomalyEventRow) => {
          map.set(row.event_type, (map.get(row.event_type) ?? 0) + 1);
          return map;
        }, new Map<string, number>()).entries(),
      ).map(([event_type, count]) => ({ event_type, count })).sort((a, b) => b.count - a.count),
      audit_breakdown: Array.from(
        auditRows.reduce((map: Map<string, number>, row: any) => {
          map.set(`${row.trigger_type}::${row.status}`, (map.get(`${row.trigger_type}::${row.status}`) ?? 0) + 1);
          return map;
        }, new Map<string, number>()).entries(),
      ).map(([key, count]) => {
        const [trigger_type, status] = key.split('::');
        return { trigger_type, status, count };
      }).sort((a, b) => b.count - a.count),
      note: 'Report ini memisahkan exception yang dihasilkan proses dan exception yang benar-benar ditangani user lewat hold, reject, override, serta review exception.',
      date_range: { from: filters.date_from ?? null, to: filters.date_to ?? null },
    },
  };
}

// ── Master generate function ────────────────────────────────────────

export async function generateReport(
  projectId: string,
  type: ReportType,
  filters: ReportFilters = {},
  options: ReportGenerationOptions = {},
): Promise<ReportPayload> {
  switch (type) {
    case 'progress_summary':      return generateProgressSummary(projectId);
    case 'material_balance':      return generateMaterialBalanceReport(projectId);
    case 'receipt_log':           return generateReceiptLog(projectId);
    case 'site_change_log':       return generateSiteChangeLog(projectId, filters, options);
    case 'weekly_digest':         return generateWeeklyDigest(projectId);
    case 'schedule_variance':     return generateScheduleVariance(projectId);
    case 'payroll_support_summary': return generatePayrollSupportSummary(projectId, filters);
    case 'client_charge_report':  return generateClientChargeReport(projectId, filters);
    case 'audit_list':            return generateAuditList(projectId, filters);
    case 'ai_usage_summary':      return generateAIUsageSummary(projectId, filters);
    case 'approval_sla_user':     return generateApprovalSLAUser(projectId, filters);
    case 'operational_entry_discipline': return generateOperationalEntryDiscipline(projectId, filters);
    case 'tool_usage_summary':    return generateToolUsageSummary(projectId, filters);
    case 'exception_handling_load': return generateExceptionHandlingLoad(projectId, filters);
  }
}
