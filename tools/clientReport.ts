// SANO — Client Progress Report assembly
// Aggregates the Daily Site Log + existing quantitative data into a curated
// draft, renders numbering, and freezes a snapshot on issue.
// NOTE: 'client_progress_report' is intentionally NOT a ReportType — this path
// never routes through generateReport()/exportReportToPdf().

import { supabase } from './supabase';
import type { MilestoneStatus, ProjectPhase } from './types';
import { aggregatePeriod } from './dailySiteLogs';
import { listRooms } from './rooms';
import { listGateRefs } from './gateRefs';
import { tagLinesByRoom, roomNameById } from './clientReportRooms';
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

// Postgres 23505 is the primary signal. Also match on the constraint name
// from migration 075 as a fallback — future-proofs against a driver/proxy
// that loses the error `code` field but keeps `message`, and against other
// unique constraints on this table being (mis)read as a numbering race if
// their message happens to omit a code. Named-constraint match stays scoped
// to THIS constraint specifically, so it won't paper over unrelated
// violations the way a bare "any 23505" fallback would.
const NUMBERING_CONSTRAINT_NAME = 'uq_client_progress_reports_no_revision';

function isUniqueViolation(error: any): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return typeof error.message === 'string' && error.message.includes(NUMBERING_CONSTRAINT_NAME);
}

// Operator-facing message for when the numbering race never resolves inside
// the retry budget — swapped in for the raw Postgres 23505 copy, which is
// meaningless to a non-technical user tapping "Terbitkan". The raw error is
// still logged via console.warn below so the real cause isn't lost.
const REPORT_NUMBER_CONFLICT_MESSAGE = 'Nomor laporan bentrok berulang — coba lagi.';

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
  /** projects.phase (096). Omitted reads as STRUKTUR, which is the pre-096 behaviour. */
  phase?: ProjectPhase;
}

export interface ClientReportUpdate {
  date: string;   // formatted display date, e.g. '14 Jun' (not ISO)
  area: string;
  note: string;
  /**
   * Room tags, set only in a room phase (spec §10.2). The renderer groups
   * `updates` by these at print time, so the ONE list the builder edits is the
   * ONE list that reaches the client PDF. `roomLabel` is the room NAME plus its
   * floor and `gateLabel` the sanctioned gate chip - both are client-safe
   * strings frozen here, never re-read at render time, so an issued report
   * survives a room rename. `roomId` is a grouping key and the builder's picker
   * value; nothing prints it. Absent on a Struktur draft, which carries exactly
   * the three fields above and renders exactly as it did before.
   */
  roomId?: string | null;
  roomLabel?: string | null;
  gateLabel?: string | null;
}
export interface ClientReportPhoto {
  url: string;
  /**
   * Storage path behind `url`, in resolvePhotoUrl's form (bare for the photos
   * bucket, `site-media:<path>` for the private bucket). Absent on snapshots
   * frozen before Plan A; tools/clientReportPhotos.ts recovers it from the
   * signed URL. Renderers re-sign from this, never from the stored URL.
   */
  path?: string | null;
  caption: string;
  date: string;
  /**
   * Room NAME only, and only in a room phase: the figure legend prints
   * "Figur 3 · Kamar Mandi Utama" (spec §10.2). Absent when the photo carries
   * no room, which prints exactly as it did before. Nothing internal - no
   * owner, no due date, no flag - has a home on this type.
   */
  room?: string | null;
}

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
  /**
   * 096. Absent on every snapshot frozen before the Finishing mode shipped;
   * the renderer treats absent and 'STRUKTUR' identically, so an issued report
   * re-renders exactly as it was sent.
   */
  phase?: ProjectPhase;
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

  const phase: ProjectPhase = params.phase ?? 'STRUKTUR';
  const roomMode = phase === 'FINISHING' || phase === 'SERAH_TERIMA';

  // Rooms and gates are read ONLY in a room phase: a Struktur project makes
  // exactly the two queries it made before this change.
  const [rooms, gates] = roomMode
    ? await Promise.all([listRooms(params.projectId, { includeInactive: true }), listGateRefs()])
    : [[], []];
  const roomNames = roomNameById(rooms);

  const photos = await Promise.all(
    agg.featuredPhotos.map(async (p: { storage_path: string; caption: string | null; log_date: string; room_id?: string | null }) => ({
      url: await resolvePhotoUrl(p.storage_path),
      path: p.storage_path,
      caption: p.caption ?? '',
      date: fmtCaptionDate(p.log_date),
      ...(roomMode && p.room_id && roomNames.has(p.room_id) ? { room: roomNames.get(p.room_id)! } : {}),
    })),
  );

  // ONE list, in both phases. A room phase orders it by room (floor, then
  // sort_order, Area Umum last) and stamps each line with its room and gate
  // LABELS; the renderer rebuilds the printed room blocks from exactly this
  // list, so every edit, deletion and addition the curator makes in the builder
  // reaches the client PDF. A Struktur draft carries the three plain fields it
  // always did.
  const updates: ClientReportUpdate[] = roomMode
    ? tagLinesByRoom(
        agg.highlights.map((h: { log_date: string; area: string; note: string; room_id?: string | null; gate_code?: string | null }) => ({
          date: fmtCaptionDate(h.log_date), area: h.area, note: h.note,
          room_id: h.room_id ?? null, gate_code: h.gate_code ?? null,
        })),
        rooms,
        gates,
      )
    : agg.highlights.map((h) => ({ date: fmtCaptionDate(h.log_date), area: h.area, note: h.note }));

  return {
    // Conditional spread, not `phase: roomMode ? phase : undefined`: an
    // explicit undefined is a PRESENT key in memory and a MISSING one after
    // JSON.stringify, and `'phase' in draft` is the cheapest check a reviewer
    // has. A Struktur draft carries neither key, exactly as before.
    ...(roomMode ? { phase } : {}),
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
    updates,
    hero: photos.length > 0 ? photos[0] : null,
    thumbs: photos.slice(1),
  };
}

export async function issueClientReport(
  draft: ClientReportDraft,
  projectId: string,
  userId: string,
): Promise<{ id: string; reportNo: number; revision: number }> {
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
      // Return the number ACTUALLY inserted, not draft.reportNo/revision —
      // a lost race + successful retry above may have bumped both, and the
      // caller (ClientReportBuilderScreen) toasts these values so the
      // operator sees the true issued number, not the stale pre-retry one.
      return { id: data.id, reportNo, revision };
    }

    if (!error || !isUniqueViolation(error)) {
      // A real failure unrelated to the numbering race — surface immediately.
      throw error ?? new Error('Client report issue failed');
    }

    if (attempt === MAX_REPORT_ISSUE_ATTEMPTS) {
      // The numbering race never resolved inside the retry budget. The raw
      // Postgres 23505 copy is meaningless to whoever tapped "Terbitkan" —
      // log it for diagnosis and surface a plain-language operator message
      // instead.
      console.warn('[issueClientReport] report numbering conflict persisted after retries', error);
      throw new Error(REPORT_NUMBER_CONFLICT_MESSAGE);
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
