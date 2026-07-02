// SANO — Client Progress Report assembly
// Aggregates the Daily Site Log + existing quantitative data into a curated
// draft, renders numbering, and freezes a snapshot on issue.
// NOTE: 'client_progress_report' is intentionally NOT a ReportType — this path
// never routes through generateReport()/exportReportToPdf().

import { supabase } from './supabase';
import type { MilestoneStatus } from './types';
import { aggregatePeriod } from './dailySiteLogs';
import { resolvePhotoUrl } from './storage';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  ON_TRACK: 'Sesuai Jadwal',
  AHEAD: 'Lebih Cepat',
  AT_RISK: 'Perlu Perhatian',
  DELAYED: 'Terlambat',
  COMPLETE: 'Selesai',
};

// Worst-first severity for rolling many milestone statuses into one label.
const SEVERITY: MilestoneStatus[] = ['DELAYED', 'AT_RISK', 'ON_TRACK', 'AHEAD', 'COMPLETE'];

export function mapMilestoneStatusToLabel(status: MilestoneStatus): string {
  return STATUS_LABELS[status] ?? 'Sesuai Jadwal';
}

export function deriveProjectStatusLabel(statuses: MilestoneStatus[]): string {
  if (statuses.length === 0) return 'Sesuai Jadwal';
  for (const s of SEVERITY) {
    if (statuses.includes(s)) return mapMilestoneStatusToLabel(s);
  }
  return 'Sesuai Jadwal';
}

export async function installedAsOf(projectId: string, isoDateEnd: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select('boq_item_id, quantity, created_at')
    .eq('project_id', projectId)
    .lte('created_at', isoDateEnd);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.boq_item_id, (map.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0));
  }
  return map;
}

function overallProgress(boqItems: Array<{ id: string; planned: number }>, installed: Map<string, number>): number {
  const withPlan = boqItems.filter((b) => b.planned > 0);
  if (withPlan.length === 0) return 0;
  const sum = withPlan.reduce((s, b) => s + Math.min(100, ((installed.get(b.id) ?? 0) / b.planned) * 100), 0);
  return sum / withPlan.length;
}

export async function computeWeeklyProgressDelta(
  projectId: string,
  boqItems: Array<{ id: string; planned: number }>,
  startIso: string,
  endIso: string,
): Promise<number> {
  // Overall progress as of midnight opening the period start vs. end-of-day of the period end.
  const [atStart, atEnd] = await Promise.all([
    installedAsOf(projectId, `${startIso}T00:00:00`),
    installedAsOf(projectId, `${endIso}T23:59:59`),
  ]);
  return overallProgress(boqItems, atEnd) - overallProgress(boqItems, atStart);
}

export async function assignNextReportNo(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('report_no')
    .eq('project_id', projectId)
    .order('report_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.report_no ?? 0) + 1;
}

export async function recordClientProgressReportExport(
  projectId: string,
  userId: string,
  filters: Record<string, unknown>,
): Promise<void> {
  // Columns mirror recordReportExport (tools/reports.ts). report_type is a plain
  // string here (NOT the ReportType enum) — this path stays out of that union.
  const { error } = await supabase.from('report_exports').insert({
    project_id: projectId,
    report_type: 'client_progress_report',
    filters,
    file_path: `exports/${projectId}/client_progress_report_${Date.now()}.json`,
    generated_by: userId,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// AssembleParams + ClientReportDraft types
// ---------------------------------------------------------------------------

export interface AssembleParams {
  projectId: string;
  kind: 'harian' | 'mingguan';
  periodStart: string;   // YYYY-MM-DD
  periodEnd: string;     // YYYY-MM-DD (== start for harian)
  projectName: string;
  clientName: string | null;
  milestoneStatuses: MilestoneStatus[];
}

export interface ClientReportUpdate {
  date: string;   // formatted display date, e.g. '14 Jun' (not ISO)
  area: string;
  note: string;
}
export interface ClientReportPhoto { url: string; caption: string; date: string; }

export interface ClientReportDraft {
  kind: 'harian' | 'mingguan';
  reportNo: number;
  revision?: number;             // 1 by default; a re-issue of the same reportNo bumps this
  periodStart: string;
  periodEnd: string;
  projectName: string;
  clientName: string | null;
  subtitle: string;              // curator-typed (no projects column)
  statusLabel: string;
  weather: string | null;
  crewTotal: number | null;
  crewBreakdown: string | null;
  safetyIncidents: number;
  nextPlan: string;              // curator-typed
  updates: ClientReportUpdate[];
  hero: ClientReportPhoto | null;
  thumbs: ClientReportPhoto[];
}

function fmtCaptionDate(iso: string): string {
  if (!iso) return '';
  // "2026-06-14" -> "14 Jun" (Indonesian short month)
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const [, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return `${d} ${months[(m ?? 1) - 1]}`;
}

export async function assembleClientReportDraft(params: AssembleParams): Promise<ClientReportDraft> {
  const agg = await aggregatePeriod(params.projectId, params.periodStart, params.periodEnd);
  const reportNo = await assignNextReportNo(params.projectId);

  const photos = await Promise.all(
    agg.featuredPhotos.map(async (p: { storage_path: string; caption: string | null; log_date: string }) => ({
      url: await resolvePhotoUrl(p.storage_path),
      caption: p.caption ?? '',
      date: fmtCaptionDate(p.log_date),
    })),
  );

  return {
    kind: params.kind,
    reportNo,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    projectName: params.projectName,
    clientName: params.clientName,
    subtitle: '',
    statusLabel: deriveProjectStatusLabel(params.milestoneStatuses),
    weather: agg.weather,
    crewTotal: agg.crewTotal,
    crewBreakdown: agg.crewBreakdown,
    safetyIncidents: agg.safetyIncidents,
    nextPlan: '',
    updates: agg.highlights.map((h: { log_date: string; area: string; note: string }) => ({ date: fmtCaptionDate(h.log_date), area: h.area, note: h.note })),
    hero: photos.length > 0 ? photos[0] : null,
    thumbs: photos.slice(1),
  };
}

export async function issueClientReport(
  draft: ClientReportDraft,
  projectId: string,
  userId: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .insert({
      project_id: projectId,
      report_no: draft.reportNo,
      revision: draft.revision ?? 1,
      kind: draft.kind,
      period_start: draft.periodStart,
      period_end: draft.periodEnd,
      status_label: draft.statusLabel,
      weather: draft.weather,
      crew_total: draft.crewTotal,
      crew_breakdown: draft.crewBreakdown,
      safety_incidents: draft.safetyIncidents,
      next_plan: draft.nextPlan,
      snapshot: draft,                       // frozen rendered content
      issued_at: new Date().toISOString(),
      issued_by: userId,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Client report issue failed');

  await recordClientProgressReportExport(projectId, userId, {
    kind: draft.kind,
    report_no: draft.reportNo,
    revision: draft.revision ?? 1,
  });
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// Issued-report archive (Riwayat Laporan)
// ---------------------------------------------------------------------------
// Issued reports are immutable: the UI only ever re-renders the frozen
// `snapshot`. A correction is a NEW row with the same report_no and
// revision + 1 — earlier revisions stay stored and viewable.

export interface IssuedClientReport {
  id: string;
  report_no: number;
  revision: number;
  kind: 'harian' | 'mingguan';
  period_start: string;
  period_end: string;
  issued_at: string | null;
  issued_by_name: string | null;
}

export async function listClientReports(projectId: string): Promise<IssuedClientReport[]> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('id, report_no, revision, kind, period_start, period_end, issued_at, profiles(full_name)')
    .eq('project_id', projectId)
    .order('report_no', { ascending: false })
    .order('revision', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    report_no: row.report_no,
    revision: row.revision ?? 1,
    kind: row.kind,
    period_start: row.period_start,
    period_end: row.period_end,
    issued_at: row.issued_at ?? null,
    issued_by_name: row.profiles?.full_name ?? null,
  }));
}

export async function getClientReportSnapshot(reportId: string): Promise<ClientReportDraft | null> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('snapshot')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  return (data?.snapshot as ClientReportDraft) ?? null;
}
