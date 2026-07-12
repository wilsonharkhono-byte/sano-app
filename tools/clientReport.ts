// SANO — Client Progress Report assembly
// Aggregates the Daily Site Log + existing quantitative data into a curated
// draft, renders numbering, and freezes a snapshot on issue.
// NOTE: 'client_progress_report' is intentionally NOT a ReportType — this path
// never routes through generateReport()/exportReportToPdf().

import { supabase } from './supabase';
import type { MilestoneStatus } from './types';
import { aggregatePeriod } from './dailySiteLogs';
import { resolvePhotoUrl } from './storage';
import { computeOverallProgress } from './progressMath';
import { dayRangeWIB } from './timeWindow';

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

// Task 3.5: `cutoffIsoExclusive` is an EXCLUSIVE upper bound ("installed
// strictly before this instant") rather than the old inclusive `lte`. Callers
// pass a WIB-day-boundary instant from tools/timeWindow.ts — an exclusive
// boundary composes correctly with "as of end of day X WIB" (== strictly
// before the start of day X+1 WIB) without the old 23:59:59-literal gap.
export async function installedAsOf(projectId: string, cutoffIsoExclusive: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select('boq_item_id, quantity, created_at')
    .eq('project_id', projectId)
    .lt('created_at', cutoffIsoExclusive);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.boq_item_id, (map.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0));
  }
  return map;
}

// Task 3.2: delegates to the shared volume-weighted formula
// (tools/progressMath.ts) — this "as of" variant keeps its own semantics
// (installed is read from a point-in-time progress_entries snapshot, not the
// live boq_items.installed column) but the AGGREGATION math is now the same
// one function every surface uses, so the weekly delta hint reconciles with
// the Progress Summary report / Beranda / Laporan overall %.
function overallProgress(
  boqItems: Array<{ id: string; planned: number; superseded_at?: string | null }>,
  installed: Map<string, number>,
): number {
  return computeOverallProgress(
    boqItems.map((b) => ({
      planned: b.planned,
      installed: installed.get(b.id) ?? 0,
      superseded_at: b.superseded_at,
    })),
  );
}

export async function computeWeeklyProgressDelta(
  projectId: string,
  boqItems: Array<{ id: string; planned: number; superseded_at?: string | null }>,
  startIso: string,
  endIso: string,
): Promise<number> {
  // Task 3.5: overall progress as of midnight WIB opening the period start vs.
  // end-of-day WIB of the period end. `dayRangeWIB` gives fromIso = start of
  // `startIso`'s WIB day and toIso = the EXCLUSIVE end of `endIso`'s WIB day
  // (== start of the next day WIB) — both are exactly the exclusive cutoffs
  // `installedAsOf` now expects, so "as of end of day" lands on the same
  // boundary as every other report's date window instead of a bespoke
  // offset-less `T23:59:59` literal.
  const { fromIso: periodStartWib, toIso: periodEndExclusiveWib } = dayRangeWIB(startIso, endIso);
  const [atStart, atEnd] = await Promise.all([
    installedAsOf(projectId, periodStartWib),
    installedAsOf(projectId, periodEndExclusiveWib),
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

// Task 3.7: true-max revision counter. ClientReportBuilderScreen's history
// list can hand back ANY revision row the user tapped (not necessarily the
// newest one for that report_no) — trusting `viewing.meta.revision + 1` can
// therefore recreate a revision number that already exists. Query the actual
// max instead. Also reused by issueClientReport's retry-on-conflict below.
export async function nextRevisionNo(projectId: string, reportNo: number): Promise<number> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('revision')
    .eq('project_id', projectId)
    .eq('report_no', reportNo)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.revision ?? 0) + 1;
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505';
}

// Bounded retries for the report-numbering race (Task 3.7): two concurrent
// "Terbitkan" taps can both read the same max(report_no) (or max(revision))
// during draft assembly and then race to insert. Migration 075 adds a hard
// UNIQUE index on (project_id, report_no, revision) so a collision surfaces
// LOUDLY as a Postgres unique-violation (23505) instead of silently minting
// a duplicate — this loop catches that violation and retries with a freshly
// recomputed number. Works even without 075 applied (the insert would then
// just succeed with a duplicate number, same as before this fix) — 075 is
// what turns the (rare) silent dupe into a loud, retried conflict.
const MAX_REPORT_ISSUE_ATTEMPTS = 5;

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
  const isRevision = (draft.revision ?? 1) > 1;
  let reportNo = draft.reportNo;
  let revision = draft.revision ?? 1;
  // Starts out literally `draft` (not a copy) so the common, uncontested path
  // inserts the exact snapshot the caller built. Only rebuilt after a retry,
  // once reportNo/revision have actually changed from what the caller passed.
  let snapshot: ClientReportDraft = draft;

  for (let attempt = 1; attempt <= MAX_REPORT_ISSUE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('client_progress_reports')
      .insert({
        project_id: projectId,
        report_no: reportNo,
        revision,
        kind: draft.kind,
        period_start: draft.periodStart,
        period_end: draft.periodEnd,
        status_label: draft.statusLabel,
        weather: draft.weather,
        crew_total: draft.crewTotal,
        crew_breakdown: draft.crewBreakdown,
        safety_incidents: draft.safetyIncidents,
        next_plan: draft.nextPlan,
        snapshot,                              // frozen rendered content
        issued_at: new Date().toISOString(),
        issued_by: userId,
      })
      .select('id')
      .single();

    if (!error && data) {
      await recordClientProgressReportExport(projectId, userId, {
        kind: draft.kind,
        report_no: reportNo,
        revision,
      });
      return { id: data.id };
    }

    // Anything other than a unique-violation on (project_id, report_no,
    // revision) — migration 075 — is a real failure; surface it immediately.
    // Same on the final attempt: stop retrying and surface the conflict.
    if (!error || !isUniqueViolation(error) || attempt === MAX_REPORT_ISSUE_ATTEMPTS) {
      throw error ?? new Error('Client report issue failed');
    }

    // Lost the race: someone else took this (report_no, revision) between
    // our read and our insert. Recompute the true max and try again — bump
    // report_no for a brand-new report, or revision for an explicit re-issue
    // (Buat Revisi) of an existing report_no.
    if (isRevision) {
      revision = await nextRevisionNo(projectId, reportNo);
    } else {
      reportNo = await assignNextReportNo(projectId);
    }
    snapshot = { ...draft, reportNo, revision };
  }

  throw new Error('Client report issue failed after retries');
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
