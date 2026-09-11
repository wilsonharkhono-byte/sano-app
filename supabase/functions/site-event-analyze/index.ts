// SANO - site-event-analyze edge function.
//
// Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §6, §12, §13.
// Plan: docs/superpowers/plans/2026-09-10-site-event-capture-ai.md (task 7).
//
// POST { event_id: uuid, force?: boolean, work_group_names?: string[] }
// with the caller's JWT in the Authorization header.
//
// Order of trust (spec §13): verify the JWT with the anon client, read the event
// through the caller's RLS, confirm project membership or an office role, and
// only then create the service-role client. Nothing is read with the service
// role before that.
//
// Writes only transcript, ai_draft, ai_confidence, ai_mismatch, ai_model,
// status (pending_analysis → draft), last_error and analysis_attempts, plus one
// site_event_ai_runs row per stage attempted. Migration 097 refuses those writes
// from any client; the service role is trusted, so stages.ts and the jest static
// test are the guard on this side.
//
// Secrets (supabase secrets set): ANTHROPIC_API_KEY, OPENAI_API_KEY, optional
// SITE_EVENT_MODEL (default claude-sonnet-5) and SITE_EVENT_DAILY_CAP (default
// 200). SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY come from
// the runtime.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateSiteEventDraft } from './validate.ts';
import {
  buildClaudeRequest,
  buildSystemPrompt,
  buildUserPrompt,
  readClaudeResponse,
  type ClaudeImage,
  type PromptContext,
  type PromptGate,
  type PromptStep,
} from './prompt.ts';
import { transcriptionPrompt } from './glossary.ts';
import { claudeCostUsd, transcribeCostUsd, type ClaudeUsage } from './cost.ts';
import {
  AI_QUOTA_MESSAGE,
  STT_FAILED_MESSAGE,
  audioFilename,
  bytesToBase64,
  clampWorkGroupNames,
  fetchWithTimeout,
  findAudio,
  isUuid,
  jakartaTodayLabel,
  sanitizeJsonForPostgres,
  selectAnalysisPhotos,
  sha256Hex,
  startOfJakartaDayUtcIso,
  truncate,
  type MediaRow,
} from './util.ts';
import {
  buildRunRow,
  claimUpdate,
  decideStages,
  effectiveTranscript,
  failureUpdate,
  quotaUpdate,
  successUpdate,
  transcriptSource,
  type RunRow,
} from './stages.ts';

const MODEL = Deno.env.get('SITE_EVENT_MODEL') ?? 'claude-sonnet-5';
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const DAILY_CAP = Number(Deno.env.get('SITE_EVENT_DAILY_CAP') ?? '200');
const MEDIA_BUCKET = 'site-media';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
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

interface EventRow {
  id: string;
  project_id: string;
  room_id: string;
  status: string;
  gate_code: string | null;
  raw_text: string | null;
  transcript: string | null;
  transcript_edited: string | null;
  ai_draft: unknown | null;
  analysis_attempts: number;
}

/**
 * The one place a site_event_ai_runs row reaches the database. Sanitised here
 * rather than at each call site, so no future stage can forget it: `row.output`
 * carries the model's raw tool-call input or provider response body, and
 * Postgres's jsonb parser rejects an unpaired UTF-16 surrogate outright.
 */
async function writeRun(admin: SupabaseClient, row: RunRow): Promise<void> {
  const { error } = await admin.from('site_event_ai_runs').insert(sanitizeJsonForPostgres(row));
  if (error) console.error('site-event-analyze: run row insert failed:', error.message);
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD', error: 'Gunakan POST.' }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, code: 'CONFIG', error: 'Konfigurasi Supabase di server tidak lengkap.' }, 500);
  }
  if (!ANTHROPIC_API_KEY || !OPENAI_API_KEY) {
    return json({ ok: false, code: 'CONFIG', error: 'Kunci API AI belum dikonfigurasi di server.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, code: 'AUTH', error: 'Tidak ada otorisasi.' }, 401);

  let body: { event_id?: unknown; force?: unknown; work_group_names?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: 'BAD_REQUEST', error: 'Body harus JSON.' }, 400);
  }
  if (!isUuid(body.event_id)) return json({ ok: false, code: 'BAD_REQUEST', error: 'event_id tidak valid.' }, 400);
  const eventId = body.event_id;
  const force = body.force === true;
  const workGroupNames = clampWorkGroupNames(body.work_group_names);

  // ── 1. Who is calling, and may they touch this event? Caller's JWT, caller's RLS.
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: authError } = await caller.auth.getUser();
  if (authError || !userData?.user) return json({ ok: false, code: 'AUTH', error: 'Sesi tidak valid.' }, 401);

  const { data: visible } = await caller.from('site_events').select('id, project_id').eq('id', eventId).maybeSingle();
  if (!visible) {
    return json({ ok: false, code: 'NOT_FOUND', error: 'Kejadian tidak ditemukan atau Anda tidak punya akses.' }, 404);
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
    return await analyzeEvent(admin, eventId, force, workGroupNames);
  } catch (err) {
    console.error('site-event-analyze: unexpected error', err);
    return json({ ok: false, code: 'UNEXPECTED', error: truncate(`Kesalahan tak terduga: ${(err as Error).message}`, 300) }, 500);
  }
}

async function analyzeEvent(
  admin: SupabaseClient,
  eventId: string,
  force: boolean,
  workGroupNames: string[],
): Promise<Response> {
  const { data: evData, error: evError } = await admin
    .from('site_events')
    .select('id, project_id, room_id, status, gate_code, raw_text, transcript, transcript_edited, ai_draft, analysis_attempts')
    .eq('id', eventId)
    .single();
  if (evError || !evData) return json({ ok: false, code: 'NOT_FOUND', error: 'Kejadian tidak ditemukan.' }, 404);
  const ev = evData as EventRow;

  const { data: mediaData } = await admin
    .from('site_event_media')
    .select('id, kind, role, storage_path, mime_type, sort_order, duration_s, bytes')
    .eq('event_id', ev.id)
    .order('sort_order', { ascending: true });
  const media = (mediaData ?? []) as MediaRow[];
  const audio = findAudio(media);

  const decision = decideStages(ev, audio !== null, force);
  if (!decision.run) {
    return json(
      { ok: decision.code === 'NOTHING_TO_DO', code: decision.code, message: decision.message, status: ev.status },
      decision.httpStatus,
    );
  }

  // ── Claim the attempt before spending any provider budget. A conditional
  //    update on id + project_id + the row's own analysis_attempts + status
  //    only succeeds for one caller: two concurrent POSTs for the same event
  //    (a double-tap, or a client retry racing the original) cannot both
  //    reach OpenAI/Claude. Zero rows back means someone else already claimed
  //    it, or a human confirmed/discarded the event in the meantime.
  const { data: claimedRows, error: claimError } = await admin
    .from('site_events')
    .update(sanitizeJsonForPostgres(claimUpdate(ev)))
    .eq('id', ev.id)
    .eq('project_id', ev.project_id)
    .eq('analysis_attempts', ev.analysis_attempts)
    .in('status', ['pending_analysis', 'draft'])
    .select('id');
  if (claimError || !claimedRows || claimedRows.length === 0) {
    return json({ ok: false, error: 'Analisis sedang berjalan atau sudah selesai. Muat ulang.' }, 409);
  }

  // ── Stage 1: transcription. Runs even when the analysis quota is spent, so a
  //    supervisor authoring by hand can still read what they said.
  let transcript = ev.transcript;
  let sttError: string | null = null;
  let transcribed = false;

  if (decision.transcribe && audio) {
    const prompt = transcriptionPrompt();
    const promptHash = await sha256Hex(prompt);
    const inputSummary = { mime_type: audio.mime_type, bytes: audio.bytes, duration_s: audio.duration_s };
    const started = Date.now();
    try {
      const { data: blob, error: downloadError } = await admin.storage.from(MEDIA_BUCKET).download(audio.storage_path);
      if (downloadError || !blob) throw new Error(`audio tidak bisa diunduh: ${downloadError?.message ?? 'kosong'}`);

      const form = new FormData();
      form.append('file', blob, audioFilename(audio.storage_path, audio.mime_type));
      form.append('model', TRANSCRIBE_MODEL);
      form.append('language', 'id');
      form.append('prompt', prompt);
      form.append('response_format', 'json');

      const resp = await fetchWithTimeout(
        'https://api.openai.com/v1/audio/transcriptions',
        { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form },
        60_000,
      );
      const payload = (await resp.json().catch(() => null)) as {
        text?: unknown;
        usage?: { type?: string; input_tokens?: number; output_tokens?: number; seconds?: number };
        error?: { message?: string };
      } | null;
      if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${payload?.error?.message ?? 'tanpa pesan'}`);
      const rawText = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!rawText) throw new Error('transkrip kosong');
      // The transcript is written to site_events.transcript raw, and OpenAI's
      // text is otherwise unvalidated: sanitise before this write, same as
      // every other jsonb/text write carrying model-derived text.
      const text = sanitizeJsonForPostgres(rawText);

      const { data: transcriptRows, error: saveError } = await admin
        .from('site_events')
        .update(sanitizeJsonForPostgres({ transcript: text }))
        .eq('id', ev.id)
        .in('status', ['pending_analysis', 'draft'])
        .select('id');
      if (saveError) throw new Error(`transkrip tidak tersimpan: ${saveError.message}`);
      if (!transcriptRows || transcriptRows.length === 0) {
        throw new Error('transkrip tidak tersimpan: kejadian sudah berubah status');
      }
      transcript = text;
      transcribed = true;

      const seconds = audio.duration_s ?? (payload?.usage?.type === 'duration' ? payload.usage.seconds ?? null : null);
      await writeRun(admin, buildRunRow({
        eventId: ev.id, stage: 'transcribe', model: TRANSCRIBE_MODEL, promptHash, inputSummary,
        output: { text }, tokensIn: payload?.usage?.input_tokens, tokensOut: payload?.usage?.output_tokens,
        costUsd: transcribeCostUsd(seconds), latencyMs: Date.now() - started, status: 'ok', error: null,
      }));
    } catch (err) {
      // sttError becomes site_events.last_error below (and, on stage 2, is
      // folded into failureUpdate's last_error too), so it is sanitised at
      // the point it is built, not at each place it is later used.
      sttError = sanitizeJsonForPostgres(truncate(`${STT_FAILED_MESSAGE} ${(err as Error).message}`, 300));
      await writeRun(admin, buildRunRow({
        eventId: ev.id, stage: 'transcribe', model: TRANSCRIBE_MODEL, promptHash, inputSummary,
        output: null, tokensIn: null, tokensOut: null, costUsd: null,
        latencyMs: Date.now() - started, status: 'error', error: sttError,
      }));
    }
  }

  if (!decision.analyze) {
    if (sttError) {
      const { data: errorRows, error } = await admin
        .from('site_events')
        .update(sanitizeJsonForPostgres({ last_error: sttError }))
        .eq('id', ev.id)
        .in('status', ['pending_analysis', 'draft'])
        .select('id');
      if (error) console.error('site-event-analyze: last_error write failed:', error.message);
      else if (!errorRows || errorRows.length === 0) {
        console.error('site-event-analyze: last_error write touched no row (event status changed)');
      }
    }
    return json({ ok: sttError === null, code: sttError ? 'TRANSCRIBE_ERROR' : 'TRANSCRIBED', error: sttError, transcribed, analyzed: false, status: ev.status });
  }

  // ── Cost guard (spec §6): per-project daily cap on analysis calls.
  const { count, error: capError } = await admin
    .from('site_event_ai_runs')
    .select('id, site_events!inner(project_id)', { count: 'exact', head: true })
    .eq('site_events.project_id', ev.project_id)
    .eq('stage', 'analyze')
    .gte('created_at', startOfJakartaDayUtcIso(new Date()));
  if (capError) {
    return json({ ok: false, code: 'CAP_CHECK_FAILED', error: 'Kuota AI tidak bisa diperiksa. Coba lagi sebentar.', transcribed });
  }
  if ((count ?? 0) >= DAILY_CAP) {
    await admin.from('site_events').update(sanitizeJsonForPostgres(quotaUpdate())).eq('id', ev.id).in('status', ['pending_analysis', 'draft']);
    return json({ ok: false, code: 'DAILY_CAP', error: AI_QUOTA_MESSAGE, transcribed });
  }

  // ── Stage 2 context: room, project, active gates and steps, open events.
  const [roomRes, projectRes, gatesRes, stepsRes, openRes] = await Promise.all([
    admin.from('rooms').select('room_name, floor, area_type').eq('id', ev.room_id).single(),
    admin.from('projects').select('name, phase').eq('id', ev.project_id).single(),
    admin.from('gate_refs').select('code, name_id, short_label, description').eq('active', true).order('sort_order'),
    admin.from('gate_step_refs').select('code, gate_code, name_id, description').eq('active', true)
      .order('gate_code').order('sort_order'),
    admin.from('site_events').select('id, title').eq('room_id', ev.room_id).eq('status', 'open')
      .neq('id', ev.id).not('title', 'is', null).order('confirmed_at', { ascending: false }).limit(10),
  ]);
  if (roomRes.error || projectRes.error || !roomRes.data || !projectRes.data) {
    return json({ ok: false, code: 'CONTEXT', error: 'Konteks ruangan atau proyek tidak bisa dimuat.' }, 500);
  }
  const gates = (gatesRes.data ?? []) as PromptGate[];
  const steps = (stepsRes.data ?? []) as PromptStep[];
  const openEvents = (openRes.data ?? []) as PromptContext['openEvents'];

  // Photos go as stored: the client caps them at 1280 px (plan decision 3).
  const { selected, skipped } = selectAnalysisPhotos(media);
  const images: ClaudeImage[] = [];
  const photoRoles: PromptContext['photoRoles'] = [];
  let photoFailures = 0;
  for (const photo of selected) {
    const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(photo.storage_path);
    if (error || !blob) {
      photoFailures += 1;
      continue;
    }
    images.push({ mediaType: photo.mime_type ?? 'image/jpeg', data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    photoRoles.push(photo.role === 'context' ? 'context' : 'closeup');
  }

  const transcriptText = effectiveTranscript(ev.transcript_edited, transcript);
  const ctx: PromptContext = {
    projectName: projectRes.data.name,
    projectPhase: projectRes.data.phase ?? 'STRUKTUR',
    todayLabel: jakartaTodayLabel(new Date().toISOString()),
    roomName: roomRes.data.room_name,
    roomFloor: roomRes.data.floor,
    roomAreaType: roomRes.data.area_type ?? 'general',
    captureGateCode: ev.gate_code,
    gates,
    steps,
    openEvents,
    workGroupNames,
    rawText: ev.raw_text,
    transcript: transcriptText,
    transcriptSource: transcriptSource(ev.transcript_edited, transcript),
    transcriptionFailed: sttError !== null,
    photoRoles,
  };

  const system = buildSystemPrompt();
  const userText = buildUserPrompt(ctx);
  const promptHash = await sha256Hex(`${system}\n${userText}`);
  const inputSummary = {
    photo_count: images.length,
    photos_skipped: skipped + photoFailures,
    transcript_chars: transcriptText?.length ?? 0,
    raw_text_chars: ev.raw_text?.length ?? 0,
    gate_count: gates.length,
    step_count: steps.length,
    open_event_count: openEvents.length,
    work_group_count: workGroupNames.length,
    transcription_failed: sttError !== null,
    force,
  };
  const started = Date.now();

  const fail = async (status: 'rejected' | 'error', message: string, output: unknown, usage: ClaudeUsage | null) => {
    // message may carry provider or model-derived text (an API error string,
    // or a validator reason quoting the model's own field); sanitise before it
    // reaches last_error, same rule as the transcript and the run row's output.
    const safeMessage = sanitizeJsonForPostgres(message);
    await writeRun(admin, buildRunRow({
      eventId: ev.id, stage: 'analyze', model: MODEL, promptHash, inputSummary, output,
      tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens, costUsd: claudeCostUsd(MODEL, usage),
      latencyMs: Date.now() - started, status, error: safeMessage,
    }));
    await admin
      .from('site_events')
      .update(sanitizeJsonForPostgres(failureUpdate(safeMessage, sttError)))
      .eq('id', ev.id)
      .in('status', ['pending_analysis', 'draft']);
    return json({
      ok: false,
      code: status === 'rejected' ? 'ANALYSIS_REJECTED' : 'ANALYSIS_ERROR',
      error: safeMessage,
      transcribed,
      attempts: ev.analysis_attempts + 1,
    });
  };

  // ── Stage 2: one forced tool call (claude-api skill; plan decision 4).
  let resp: Response | null = null;
  let data: unknown = null;
  try {
    resp = await fetchWithTimeout(
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
      120_000,
    );
    data = await resp.json().catch(() => null);
  } catch (err) {
    return fail('error', truncate(`Analisis AI gagal: ${(err as Error).message}`, 300), null, null);
  }

  const usage = (data as { usage?: ClaudeUsage } | null)?.usage ?? null;
  if (!resp.ok) {
    const apiMessage = (data as { error?: { message?: string } } | null)?.error?.message ?? 'tanpa pesan';
    return fail('error', truncate(`Analisis AI gagal (HTTP ${resp.status}): ${apiMessage}`, 300), data, usage);
  }

  const outcome = readClaudeResponse(data);
  if (outcome.kind === 'refusal') {
    // The API may name why it refused (stop_details.category); record it so a
    // human reading last_error / the run row does not have to guess.
    const category = outcome.category ? ` (${outcome.category})` : '';
    return fail('rejected', `AI menolak menganalisis kiriman ini${category}. Isi kejadian secara manual.`, data, usage);
  }
  if (outcome.kind === 'no_tool') {
    return fail(
      'rejected',
      `AI tidak mengembalikan draf (stop_reason ${outcome.stopReason ?? 'kosong'}).`,
      { stop_reason: outcome.stopReason, content_types: outcome.contentTypes },
      usage,
    );
  }

  const result = validateSiteEventDraft(outcome.input, {
    gateCodes: gates.map((g) => g.code),
    steps: steps.map((s) => ({ code: s.code, gate_code: s.gate_code })),
    openEventIds: openEvents.map((e) => e.id),
    transcript: transcriptText,
    rawText: ev.raw_text,
    transcriptionFailed: sttError !== null,
  });
  if (!result.ok) {
    return fail('rejected', truncate(`Hasil AI tidak valid: ${result.reason}`, 300), outcome.input, usage);
  }

  const { data: savedRows, error: saveError } = await admin
    .from('site_events')
    .update(sanitizeJsonForPostgres(successUpdate(ev, result.draft, MODEL, sttError)))
    .eq('id', ev.id)
    .in('status', ['pending_analysis', 'draft'])
    .select('id');
  // A guard-blocked update (e.g. a human confirmed the event in the race
  // window) returns no error and zero rows — indistinguishable from success
  // unless the row count is checked. Treat that the same as a real saveError:
  // never report ANALYZED for a draft that was not actually persisted.
  const persisted = !saveError && !!savedRows && savedRows.length > 0;
  const persistError = saveError ? saveError.message : 'kejadian sudah berubah status';

  await writeRun(admin, buildRunRow({
    eventId: ev.id, stage: 'analyze', model: MODEL, promptHash, inputSummary, output: outcome.input,
    tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens, costUsd: claudeCostUsd(MODEL, usage),
    latencyMs: Date.now() - started, status: persisted ? 'ok' : 'error',
    error: persisted ? null : `draf valid tetapi tidak tersimpan: ${persistError}`,
  }));
  if (!persisted) {
    return json({ ok: false, code: 'SAVE_FAILED', error: truncate(`Draf AI tidak tersimpan: ${persistError}`, 300) }, 500);
  }

  return json({
    ok: true,
    code: 'ANALYZED',
    status: 'draft',
    transcribed,
    analyzed: true,
    confidence: result.draft.confidence,
    dropped: result.dropped.length,
    error: sttError,
  });
}

if (import.meta.main) {
  Deno.serve(handle);
}
