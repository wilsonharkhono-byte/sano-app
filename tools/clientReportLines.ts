// tools/clientReportLines.ts
// SANO — client_report_lines: the link of each issued-report line to a BoQ
// row and stage (migration 101, spec §5.1). The edge function writes ai_*;
// people write the decision. Nothing here writes progress.
import { supabase } from './supabase';
import { activityStateLabel, stageLabel } from './progressClaims/stages';
import type { ActivityState, LinkConfidence, ReportLineStage } from './reportLineDraftValidate';

export const REPORT_PROGRESS_FUNCTION = 'report-progress-analyze';

export type ReportLineStatus = 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED';

export interface ClientReportLine {
  id: string;
  report_id: string;
  line_index: number;
  line_text: string;
  boq_item_id: string | null;
  stage: ReportLineStage | null;
  activity_state: ActivityState | null;
  status: ReportLineStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  ai_boq_item_id: string | null;
  ai_stage: ReportLineStage | null;
  ai_activity_state: ActivityState | null;
  ai_confidence: LinkConfidence | null;
  ai_quote: string | null;
  ai_model: string | null;
  ai_run_id: string | null;
}

export interface LinkResponse {
  ok: boolean;
  code?: string;
  error?: string | null;
  lines?: number;
  written?: number;
  suggested?: number;
  low?: number;
  dropped?: number;
}

/** RLS filtering the row to nothing must read as a refusal, never as success. */
const NOT_VISIBLE_MESSAGE = 'Baris tidak ditemukan atau Anda tidak ditugaskan ke proyek ini.';

export async function listReportLines(reportId: string): Promise<ClientReportLine[]> {
  const { data, error } = await supabase
    .from('client_report_lines')
    .select('id, report_id, line_index, line_text, boq_item_id, stage, activity_state, status, confirmed_by, confirmed_at, ai_boq_item_id, ai_stage, ai_activity_state, ai_confidence, ai_quote, ai_model, ai_run_id')
    .eq('report_id', reportId)
    .order('line_index');
  if (error) throw error;
  return (data ?? []) as ClientReportLine[];
}

/** Local session read, no round trip; the trigger re-stamps confirmed_by from auth.uid() anyway. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function updateLine(lineId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('client_report_lines').update(patch).eq('id', lineId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(NOT_VISIBLE_MESSAGE);
}

/** The supervisor's decision: a row, a stage (optional), a state. Only human fields are written. */
export async function confirmReportLine(
  lineId: string,
  input: { boqItemId: string; stage: ReportLineStage | null; activityState: ActivityState },
): Promise<void> {
  await updateLine(lineId, {
    boq_item_id: input.boqItemId,
    stage: input.stage,
    activity_state: input.activityState,
    status: 'CONFIRMED',
    confirmed_by: await currentUserId(),
    confirmed_at: new Date().toISOString(),
  });
}

export async function dismissReportLine(lineId: string): Promise<void> {
  await updateLine(lineId, {
    boq_item_id: null, stage: null, activity_state: null, status: 'DISMISSED',
    confirmed_by: await currentUserId(), confirmed_at: new Date().toISOString(),
  });
}

export async function reopenReportLine(lineId: string): Promise<void> {
  await updateLine(lineId, { boq_item_id: null, stage: null, activity_state: null, status: 'SUGGESTED', confirmed_by: null, confirmed_at: null });
}

/** "Konfirmasi semua saran" — migration 101 confirm_report_lines_bulk; returns the count confirmed. */
export async function confirmSuggestedLines(reportId: string): Promise<number> {
  const { data, error } = await supabase.rpc('confirm_report_lines_bulk', { p_report_id: reportId });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function invokeReportLink(reportId: string, opts: { force?: boolean } = {}): Promise<LinkResponse> {
  const { data, error } = await supabase.functions.invoke<LinkResponse>(REPORT_PROGRESS_FUNCTION, {
    body: { stage: 'link', report_id: reportId, force: opts.force === true },
  });
  if (error) {
    // FunctionsHttpError carries the Response as `context`; the function always answers with JSON.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as LinkResponse | null;
        if (payload && typeof payload === 'object') return { ...payload, ok: false };
      } catch {
        // fall through to the generic message
      }
    }
    return { ok: false, code: 'INVOKE_FAILED', error: 'Tautan AI belum bisa dijalankan. Coba lagi sebentar lagi.' };
  }
  return data ?? { ok: false, code: 'EMPTY', error: 'Server tidak mengembalikan jawaban.' };
}

/**
 * Issued reports that have at least one update line and no line rows yet.
 * Used by the office back-link button. A report with zero updates can never
 * be linked, so it is not "unlinked".
 */
export async function listUnlinkedReports(projectId: string): Promise<Array<{ id: string; report_no: number; revision: number }>> {
  const { data, error } = await supabase
    .from('client_progress_reports')
    .select('id, report_no, revision, updates:snapshot->updates, client_report_lines(count)')
    .eq('project_id', projectId)
    .order('report_no');
  if (error) throw error;
  type Row = { id: string; report_no: number; revision: number | null; updates: unknown; client_report_lines: unknown };
  const lineCount = (v: unknown): number => {
    if (!Array.isArray(v)) return 0;
    const first = v[0] as { count?: unknown } | undefined;
    return typeof first?.count === 'number' ? first.count : v.length;
  };
  return ((data ?? []) as Row[])
    .filter((r) => Array.isArray(r.updates) && r.updates.length > 0 && lineCount(r.client_report_lines) === 0)
    .map((r) => ({ id: r.id, report_no: r.report_no, revision: r.revision ?? 1 }));
}

/** Codes that mean the whole run should stop, not just this report. */
const BACKLINK_STOP_CODES: ReadonlySet<string> = new Set(['DAILY_CAP', 'AUTH', 'CONFIG', 'CAP_CHECK_FAILED', 'INVOKE_FAILED', 'NO_BOQ', 'FORBIDDEN']);

export interface BacklinkResult {
  ok: number;
  failed: number;
  /** Reports another caller is linking right now (LINK_IN_PROGRESS): neither a failure nor a reason to stop. */
  skipped: number;
  /** The code that stopped the run early, or null when every report was attempted. */
  stoppedBy: string | null;
  firstError: string | null;
}

/**
 * Link old reports one at a time (spec §8): each call is one model round-trip
 * and the daily cap counts them, so a parallel burst would race both the cap
 * and the lease. Stops on the first error that is not specific to one report.
 */
export async function backlinkReports(
  reportIds: string[],
  opts: { onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean } = {},
): Promise<BacklinkResult> {
  const result: BacklinkResult = { ok: 0, failed: 0, skipped: 0, stoppedBy: null, firstError: null };
  for (let i = 0; i < reportIds.length; i += 1) {
    if (opts.shouldStop?.()) { result.stoppedBy = 'CANCELLED'; break; }
    const res = await invokeReportLink(reportIds[i]);
    if (res.ok) result.ok += 1;
    else if (res.code === 'LINK_IN_PROGRESS') result.skipped += 1;
    else {
      result.failed += 1;
      if (!result.firstError) result.firstError = res.error ?? res.code ?? null;
      if (res.code && BACKLINK_STOP_CODES.has(res.code)) { result.stoppedBy = res.code; break; }
    }
    opts.onProgress?.(i + 1, reportIds.length);
  }
  return result;
}

// ─── Pure helpers (jest) ──────────────────────────────────────────────────

export interface LineSummary {
  total: number;
  confirmed: number;
  suggested: number;
  dismissed: number;
  /** SUGGESTED lines the bulk RPC would accept: a row and high/medium confidence. */
  suggestedReady: number;
  /** SUGGESTED lines the model never reached (no ai_model): the AI run failed or was skipped. */
  aiMissing: number;
}

export function summarizeLines(lines: ClientReportLine[]): LineSummary {
  const s: LineSummary = { total: lines.length, confirmed: 0, suggested: 0, dismissed: 0, suggestedReady: 0, aiMissing: 0 };
  for (const l of lines) {
    if (l.status === 'CONFIRMED') s.confirmed += 1;
    else if (l.status === 'DISMISSED') s.dismissed += 1;
    else {
      s.suggested += 1;
      if (l.ai_boq_item_id && (l.ai_confidence === 'high' || l.ai_confidence === 'medium')) s.suggestedReady += 1;
      if (!l.ai_model) s.aiMissing += 1;
    }
  }
  return s;
}

const CONFIDENCE_LABELS: Record<LinkConfidence, string> = { high: 'yakin', medium: 'cukup yakin', low: 'ragu' };

export function suggestionLabel(line: ClientReportLine, codeOf: (boqItemId: string | null) => string | null): string {
  if (line.status === 'CONFIRMED') {
    return `${codeOf(line.boq_item_id) ?? '?'} · ${stageLabel(line.stage)} · ${activityStateLabel(line.activity_state)}`;
  }
  if (line.status === 'DISMISSED') return 'Tidak terkait';
  if (!line.ai_model) return 'Belum ada saran AI';
  const confidence = CONFIDENCE_LABELS[line.ai_confidence ?? 'low'];
  if (!line.ai_boq_item_id) return `AI tidak menemukan baris BoQ (${confidence})`;
  return `Saran: ${codeOf(line.ai_boq_item_id) ?? '?'} · ${stageLabel(line.ai_stage)} · ${activityStateLabel(line.ai_activity_state)} (${confidence})`;
}
