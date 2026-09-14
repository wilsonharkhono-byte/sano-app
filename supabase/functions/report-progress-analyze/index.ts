// supabase/functions/report-progress-analyze/index.ts
// SANO — link the lines of an issued client report to BoQ work-area rows and
// stages (Plan A). Copies site-event-analyze's trust order, audit-row writer,
// daily cap and Claude call shape. The function never writes progress: it
// writes client_report_lines.ai_* (a suggestion the supervisor confirms) and
// one progress_ai_runs row per call.
//
// Serialization: client_progress_reports.link_claimed_at is a lease (LINK_CLAIM
// TTL) taken before any provider spend and released on every exit, so two
// callers — a double-tap, or a forced re-run racing a first run — cannot both
// reach Claude for the same report. The line rows are upserted idempotently
// (unique report_id + line_index) and ai_* is only ever written on lines still
// SUGGESTED, so a supervisor's decision always wins.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateReportLineLinks } from './validate.ts';
import { buildClaudeRequest, buildSystemPrompt, buildUserPrompt, readClaudeResponse, type ClaudeImage, type LinkPromptContext } from './prompt.ts';
import { claudeCostUsd, type ClaudeUsage } from './cost.ts';
import {
  leaseFreeFilter, linesFromSnapshot, photoRefsFromSnapshot, promptLinesFromFrozen, recentFromRows, storageTarget, type FrozenLine,
} from './context.ts';
import {
  AI_QUOTA_MESSAGE, TIMEOUT_ERROR, bytesToBase64, fetchWithTimeout, isTimeoutError, isUuid, isoDaysBefore,
  jakartaTodayLabel, parseDailyCap, sanitizeJsonForPostgres, sha256Hex, startOfJakartaDayUtcIso, truncate,
} from './util.ts';

const MODEL = Deno.env.get('REPORT_PROGRESS_MODEL') ?? 'claude-opus-5';
const DAILY_CAP_SETTING = parseDailyCap(Deno.env.get('REPORT_PROGRESS_DAILY_CAP'));
if (DAILY_CAP_SETTING.invalid) {
  console.error(`report-progress-analyze: REPORT_PROGRESS_DAILY_CAP is not a positive integer; using ${DAILY_CAP_SETTING.cap}.`);
}
const DAILY_CAP = DAILY_CAP_SETTING.cap;

/** Hero + up to seven thumbs; a daily report carries 5–10 photos in practice. */
const MAX_LINK_PHOTOS = 8;
/** Messages API limit: 5 MB per image after base64; 3.5 MB raw is ~4.7 MB encoded. */
const MAX_IMAGE_BYTES = 3_500_000;
/** The whole request must stay under the API's 32 MB; 20 MB raw ≈ 27 MB encoded leaves room for the text. */
const MAX_TOTAL_IMAGE_BYTES = 20_000_000;
const CONTINUITY_DAYS = 14;
const MAX_RECENT_LINKS = 60;

const DEADLINE_MS = 110_000;
const CLAUDE_BUDGET_MS = 90_000;
const MIN_PROVIDER_BUDGET_MS = 20_000;
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 529]);

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ReportRow {
  id: string;
  project_id: string;
  report_no: number;
  revision: number | null;
  kind: string;
  period_start: string;
  period_end: string;
  snapshot: unknown;
}

interface BoqRow {
  id: string;
  code: string;
  label: string;
  chapter: string | null;
  sub_chapter: string | null;
  unit: string;
  planned: number;
}

interface RunRow {
  project_id: string;
  report_id: string;
  claim_id: null;
  stage: 'link';
  model: string;
  prompt_hash: string;
  input_summary: Record<string, unknown>;
  output: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  latency_ms: number;
  status: 'ok' | 'rejected' | 'error';
  error: string | null;
}

const toInt = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

/** The one place a progress_ai_runs row reaches the database. Returns the row id, or null. */
async function writeRun(admin: SupabaseClient, row: RunRow): Promise<string | null> {
  const { data, error } = await admin.from('progress_ai_runs').insert(sanitizeJsonForPostgres(row)).select('id').single();
  if (error || !data) {
    console.error(`report-progress-analyze: run row insert failed for report ${row.report_id} (status ${row.status}):`, error?.message);
    return null;
  }
  return data.id as string;
}

/** One POST with at most one retry, only on the statuses that mean "try again in a moment". */
async function postWithRetry(
  url: string,
  init: RequestInit,
  budgetMs: number,
  remainingMs: () => number,
): Promise<{ resp: Response; payload: unknown; attempts: number }> {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const resp = await fetchWithTimeout(url, init, Math.min(budgetMs, Math.max(1_000, remainingMs())));
    const payload = await resp.json().catch(() => null);
    if (resp.ok || attempts >= 2 || !RETRYABLE_STATUS.has(resp.status)) return { resp, payload, attempts };
    const retryAfter = Number(resp.headers.get('retry-after'));
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 5_000) : 1_500;
    if (remainingMs() - backoffMs < MIN_PROVIDER_BUDGET_MS) return { resp, payload, attempts };
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD', error: 'Gunakan POST.' }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, code: 'CONFIG', error: 'Konfigurasi Supabase di server tidak lengkap.' }, 500);
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, code: 'CONFIG', error: 'Kunci API AI belum dikonfigurasi di server.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, code: 'AUTH', error: 'Tidak ada otorisasi.' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: 'BAD_REQUEST', error: 'Body harus JSON.' }, 400);
  }
  if (!isRecord(body)) return json({ ok: false, code: 'BAD_REQUEST', error: 'Body harus objek JSON.' }, 400);
  if (body.stage !== 'link') return json({ ok: false, code: 'BAD_REQUEST', error: 'stage harus "link".' }, 400);
  if (!isUuid(body.report_id)) return json({ ok: false, code: 'BAD_REQUEST', error: 'report_id tidak valid.' }, 400);
  const reportId = body.report_id;
  const force = body.force === true;

  // ── 1. Who is calling, and may they see this report? Caller's JWT, caller's RLS.
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: authError } = await caller.auth.getUser();
  if (authError || !userData?.user) return json({ ok: false, code: 'AUTH', error: 'Sesi tidak valid.' }, 401);

  const { data: visible } = await caller.from('client_progress_reports').select('id, project_id').eq('id', reportId).maybeSingle();
  if (!visible) {
    return json({ ok: false, code: 'NOT_FOUND', error: 'Laporan tidak ditemukan atau Anda tidak punya akses.' }, 404);
  }
  const [memberRes, officeRes] = await Promise.all([
    caller.rpc('is_project_member', { p_project_id: visible.project_id }),
    caller.rpc('is_office_role'),
  ]);
  if (memberRes.data !== true && officeRes.data !== true) {
    return json({ ok: false, code: 'FORBIDDEN', error: 'Anda tidak ditugaskan ke proyek ini.' }, 403);
  }

  // ── 2. Only now, the service role.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    return await linkReport(admin, reportId, force);
  } catch (err) {
    console.error('report-progress-analyze: unexpected error', err);
    return json({ ok: false, code: 'UNEXPECTED', error: truncate(`Kesalahan tak terduga: ${(err as Error).message}`, 300) }, 500);
  }
}

async function linkReport(admin: SupabaseClient, reportId: string, force: boolean): Promise<Response> {
  const deadline = Date.now() + DEADLINE_MS;
  const remainingMs = () => deadline - Date.now();

  const { data: report, error: reportError } = await admin
    .from('client_progress_reports')
    .select('id, project_id, report_no, revision, kind, period_start, period_end, snapshot')
    .eq('id', reportId)
    .single<ReportRow>();
  if (reportError || !report) return json({ ok: false, code: 'NOT_FOUND', error: 'Laporan tidak ditemukan.' }, 404);

  const snapshotLines = linesFromSnapshot(report.snapshot);
  if (snapshotLines.length === 0) return json({ ok: true, code: 'NO_LINES', lines: 0 });

  const [projectRes, rowsRes] = await Promise.all([
    admin.from('projects').select('name').eq('id', report.project_id).single(),
    admin.from('boq_items').select('id, code, label, chapter, sub_chapter, unit, planned')
      .eq('project_id', report.project_id).is('superseded_at', null).gt('planned', 0).order('sort_order'),
  ]);
  if (projectRes.error || !projectRes.data) return json({ ok: false, code: 'CONTEXT', error: 'Proyek tidak bisa dimuat.' }, 500);
  // A failed query must not read as "the project has no BoQ" — that message tells
  // the supervisor the estimator has not published, which would be false.
  if (rowsRes.error) return json({ ok: false, code: 'CONTEXT', error: 'Baris BoQ tidak bisa dimuat. Coba lagi.' }, 500);
  const rows = (rowsRes.data ?? []) as BoqRow[];
  if (rows.length === 0) {
    return json({ ok: false, code: 'NO_BOQ', error: 'Proyek belum punya baris BoQ terbit; tautan tidak bisa dibuat.' });
  }

  // ── Cost guard: per-project daily cap on link calls, read BEFORE the lease.
  const { count, error: capError } = await admin
    .from('progress_ai_runs')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', report.project_id)
    .eq('stage', 'link')
    .gte('created_at', startOfJakartaDayUtcIso(new Date()));
  if (capError) return json({ ok: false, code: 'CAP_CHECK_FAILED', error: 'Kuota AI tidak bisa diperiksa. Coba lagi sebentar.' });
  if ((count ?? 0) >= DAILY_CAP) return json({ ok: false, code: 'DAILY_CAP', error: AI_QUOTA_MESSAGE });

  // ── Lease: one linker per report. A conditional UPDATE only succeeds for one
  //    caller; a lease older than the TTL belongs to a killed isolate and may
  //    be taken over. Released on every exit below.
  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const { data: leased, error: leaseError } = await admin
    .from('client_progress_reports')
    .update({ link_claimed_at: claimedAt })
    .eq('id', report.id)
    .or(leaseFreeFilter(now))
    .select('id');
  // A failed statement is not a busy lease (e.g. migration 101 not pasted yet).
  if (leaseError) {
    return json({ ok: false, code: 'CONTEXT', error: truncate(`Kunci tautan tidak bisa diambil: ${leaseError.message}`, 300) }, 500);
  }
  if (!leased || leased.length === 0) {
    return json({ ok: false, code: 'LINK_IN_PROGRESS', error: 'Tautan AI sedang berjalan untuk laporan ini. Tunggu sebentar lalu muat ulang.' }, 409);
  }

  try {
    return await linkLeased(admin, report, String(projectRes.data.name ?? ''), rows, snapshotLines, force, remainingMs);
  } finally {
    // Release only our own lease: if this run outlived the TTL and another
    // caller took over, their value must survive.
    const { error } = await admin
      .from('client_progress_reports')
      .update({ link_claimed_at: null })
      .eq('id', report.id)
      .eq('link_claimed_at', claimedAt);
    if (error) console.error(`report-progress-analyze: lease release failed for report ${report.id}:`, error.message);
  }
}

async function linkLeased(
  admin: SupabaseClient,
  report: ReportRow,
  projectName: string,
  rows: BoqRow[],
  snapshotLines: ReturnType<typeof linesFromSnapshot>,
  force: boolean,
  remainingMs: () => number,
): Promise<Response> {
  // ── Line rows: idempotent on (report_id, line_index). New rows get their text
  //    frozen now; existing rows keep theirs (spec §5.1).
  const { data: inserted, error: insertError } = await admin
    .from('client_report_lines')
    .upsert(
      snapshotLines.map((l) => ({ report_id: report.id, line_index: l.index, line_text: sanitizeJsonForPostgres(l.text) })),
      { onConflict: 'report_id,line_index', ignoreDuplicates: true },
    )
    .select('id');
  if (insertError) {
    return json({ ok: false, code: 'CLAIM_FAILED', error: truncate(`Baris tautan tidak bisa dibuat: ${insertError.message}`, 300) }, 500);
  }
  const { data: existing, error: existingError } = await admin
    .from('client_report_lines').select('id, line_index, status, line_text').eq('report_id', report.id).order('line_index');
  if (existingError || !existing) return json({ ok: false, code: 'CONTEXT', error: 'Baris tautan tidak bisa dibaca.' }, 500);
  const existingLines = existing as FrozenLine[];
  if ((inserted?.length ?? 0) === 0 && !force) return json({ ok: true, code: 'ALREADY_LINKED', lines: existingLines.length });
  const targets = existingLines.filter((l) => l.status === 'SUGGESTED');
  if (targets.length === 0) return json({ ok: true, code: 'NOTHING_TO_SUGGEST', lines: existingLines.length });

  // ── Continuity: the last 14 days of links the supervisor confirmed, newest first.
  const cutoff = isoDaysBefore(report.period_end, CONTINUITY_DAYS);
  const { data: recentRows, error: recentError } = await admin
    .from('client_report_lines')
    .select('line_text, stage, activity_state, boq_items!client_report_lines_boq_item_id_fkey(code), client_progress_reports!inner(project_id, period_end)')
    .eq('status', 'CONFIRMED')
    .eq('client_progress_reports.project_id', report.project_id)
    .gte('client_progress_reports.period_end', cutoff)
    .neq('report_id', report.id)
    .order('confirmed_at', { ascending: false })
    .limit(200);
  const recent = recentFromRows(recentRows ?? [], MAX_RECENT_LINKS);

  // ── Photos: only this project's own folders (context.ts), hero first; each
  //    ≤ 3.5 MB, all together ≤ 20 MB raw; over-sized or unreadable ones are
  //    skipped and counted, never sent.
  const { refs: photoRefs, outOfScope: photosOutOfScope } = photoRefsFromSnapshot(report.snapshot, report.project_id, MAX_LINK_PHOTOS);
  const downloads = await Promise.all(photoRefs.map(async (ref) => {
    const target = storageTarget(ref);
    const { data: blob, error } = await admin.storage.from(target.bucket).download(target.path);
    return error || !blob ? null : blob;
  }));
  const images: ClaudeImage[] = [];
  let photoFailures = 0;
  let photosTooLarge = 0;
  let totalBytes = 0;
  for (const blob of downloads) {
    if (!blob) {
      photoFailures += 1;
      continue;
    }
    if (blob.size > MAX_IMAGE_BYTES || totalBytes + blob.size > MAX_TOTAL_IMAGE_BYTES) {
      photosTooLarge += 1;
      continue;
    }
    totalBytes += blob.size;
    images.push({ mediaType: blob.type || 'image/jpeg', data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }

  const ctx: LinkPromptContext = {
    projectName,
    todayLabel: jakartaTodayLabel(new Date().toISOString()),
    reportLabel: `#${report.report_no}${(report.revision ?? 1) > 1 ? ` R${report.revision}` : ''}`,
    periodLabel: report.period_start === report.period_end ? report.period_start : `${report.period_start} – ${report.period_end}`,
    rows,
    lines: promptLinesFromFrozen(existingLines),
    recent,
    photoCount: images.length,
  };
  const system = buildSystemPrompt();
  const userText = buildUserPrompt(ctx);
  const promptHash = await sha256Hex(`${system}\n${userText}`);
  const inputSummary: Record<string, unknown> = {
    line_count: existingLines.length,
    target_count: targets.length,
    row_count: rows.length,
    recent_count: recent.length,
    recent_error: recentError ? true : false,
    photo_count: images.length,
    photos_out_of_scope: photosOutOfScope,
    photos_unreadable: photoFailures,
    photos_too_large: photosTooLarge,
    provider_attempts: 0,
    force,
  };
  const started = Date.now();

  const fail = async (status: 'rejected' | 'error', message: string, output: unknown, usage: ClaudeUsage | null, runError?: string) => {
    const safeMessage = sanitizeJsonForPostgres(message);
    await writeRun(admin, {
      project_id: report.project_id, report_id: report.id, claim_id: null, stage: 'link', model: MODEL,
      prompt_hash: promptHash, input_summary: inputSummary, output: output ?? null,
      tokens_in: toInt(usage?.input_tokens), tokens_out: toInt(usage?.output_tokens),
      cost_usd: claudeCostUsd(MODEL, usage), latency_ms: Date.now() - started,
      status, error: truncate(runError ?? safeMessage, 500),
    });
    return json({ ok: false, code: status === 'rejected' ? 'LINK_REJECTED' : 'LINK_ERROR', error: safeMessage, lines: existingLines.length });
  };

  if (remainingMs() < MIN_PROVIDER_BUDGET_MS) {
    return await fail('error', 'Waktu habis sebelum model dipanggil. Coba lagi.', null, null, TIMEOUT_ERROR);
  }

  // ── One forced tool call.
  let resp: Response;
  let data: unknown;
  try {
    const call = await postWithRetry(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildClaudeRequest(MODEL, system, userText, images)),
      },
      CLAUDE_BUDGET_MS,
      remainingMs,
    );
    resp = call.resp;
    data = call.payload;
    inputSummary.provider_attempts = call.attempts;
  } catch (err) {
    if (isTimeoutError(err)) {
      return await fail('error', 'Tautan AI gagal: batas waktu habis. Coba lagi.', null, null, TIMEOUT_ERROR);
    }
    return await fail('error', truncate(`Tautan AI gagal: ${(err as Error).message}`, 300), null, null);
  }

  const usage = (data as { usage?: ClaudeUsage } | null)?.usage ?? null;
  if (!resp.ok) {
    const apiMessage = (data as { error?: { message?: string } } | null)?.error?.message ?? 'tanpa pesan';
    return await fail('error', truncate(`Tautan AI gagal (HTTP ${resp.status}): ${apiMessage}`, 300), data, usage);
  }

  const outcome = readClaudeResponse(data);
  if (outcome.kind === 'refusal') {
    const category = outcome.category ? ` (${outcome.category})` : '';
    return await fail('rejected', `AI menolak memproses laporan ini${category}. Tautkan manual.`, data, usage);
  }
  if (outcome.kind === 'no_tool') {
    return await fail('rejected', `AI tidak mengembalikan tautan (stop_reason ${outcome.stopReason ?? 'kosong'}).`,
      { stop_reason: outcome.stopReason, content_types: outcome.contentTypes }, usage);
  }

  // Quotes validate against the FROZEN line text, the same text the prompt showed.
  const result = validateReportLineLinks(outcome.input, {
    lines: existingLines.map((l) => ({ index: l.line_index, text: l.line_text })),
    boqCodes: rows.map((r) => r.code),
  });
  if (!result.ok) {
    return await fail('rejected', truncate(`Hasil AI tidak valid: ${result.reason}`, 300), outcome.input, usage);
  }

  // ── Audit row first; no suggestion is written without a run row to point at
  //    ("show your work" is the contract, and the row is what the cap counts).
  const runId = await writeRun(admin, {
    project_id: report.project_id, report_id: report.id, claim_id: null, stage: 'link', model: MODEL,
    prompt_hash: promptHash, input_summary: { ...inputSummary, dropped: result.dropped.length },
    output: { links: result.links, dropped: result.dropped },
    tokens_in: toInt(usage?.input_tokens), tokens_out: toInt(usage?.output_tokens),
    cost_usd: claudeCostUsd(MODEL, usage), latency_ms: Date.now() - started, status: 'ok', error: null,
  });
  if (!runId) {
    return json({ ok: false, code: 'SAVE_FAILED', error: 'Catatan audit AI tidak tersimpan; saran tidak ditulis. Coba lagi.', lines: existingLines.length }, 500);
  }

  const codeToId = new Map(rows.map((r) => [r.code, r.id] as const));
  const targetIndexes = new Set(targets.map((t) => t.line_index));
  let written = 0;
  const writeErrors: string[] = [];
  for (const link of result.links) {
    if (!targetIndexes.has(link.line_index)) continue;
    const { data: updated, error } = await admin
      .from('client_report_lines')
      .update(sanitizeJsonForPostgres({
        ai_boq_item_id: link.boq_item_code ? (codeToId.get(link.boq_item_code) ?? null) : null,
        ai_stage: link.stage,
        ai_activity_state: link.activity_state,
        ai_confidence: link.confidence,
        ai_quote: link.quote,
        ai_model: MODEL,
        ai_run_id: runId,
      }))
      .eq('report_id', report.id)
      .eq('line_index', link.line_index)
      .eq('status', 'SUGGESTED')
      .select('id');
    if (error) writeErrors.push(error.message);
    else if (updated && updated.length > 0) written += 1;
  }
  if (writeErrors.length > 0) {
    await admin.from('progress_ai_runs').update({ status: 'error', error: truncate(`saran tidak tersimpan: ${writeErrors.join('; ')}`, 500) }).eq('id', runId);
  }

  return json({
    ok: writeErrors.length === 0,
    code: writeErrors.length === 0 ? 'LINKED' : 'SAVE_FAILED',
    lines: existingLines.length,
    written,
    suggested: result.links.filter((l) => l.boq_item_code !== null).length,
    low: result.links.filter((l) => l.confidence === 'low').length,
    dropped: result.dropped.length,
    error: writeErrors.length === 0 ? null : truncate(writeErrors.join('; '), 300),
  });
}

if (import.meta.main) {
  Deno.serve(handle);
}
