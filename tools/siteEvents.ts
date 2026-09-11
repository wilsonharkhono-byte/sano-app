// SANO - Site events client module.
//
// Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §3, §5, §6, §7.
//
// The online capture path is three steps, exported separately on purpose:
//   uploadSiteEventMedia → insertSiteEvent → invokeSiteEventAnalysis
// createSiteEventWithMedia runs them in sequence for this release. Plan 3's
// offline queue replaces only that orchestration. Each step is already safe to
// retry: ids are generated on the phone, a duplicate upload counts as success,
// and both inserts are ON CONFLICT DO NOTHING.
//
// Media is uploaded BEFORE the row exists, so a failed transcription can never
// lose the recording, and the analysis is never invoked for an event that is
// not in the database yet.

import { randomUUID } from 'expo-crypto';
import { supabase } from './supabase';
import { readUploadBody, resolvePhotoUrl, SITE_MEDIA_PATH_PREFIX } from './storage';
import { SITE_EVENT_MAX_CLOSEUPS, SITE_MEDIA_BUCKET } from './constants';
import { normalizeTitle, validateConfirmInput, type ConfirmInput } from './siteEventRules';
import { buildWorkGroups, type GroupableItem } from './boqWorkGroups';
import type {
  SiteEvent,
  SiteEventMedia,
  SiteEventMediaKind,
  SiteEventMediaRole,
  SiteEventStatus,
} from './types';

/** Matches the site-media bucket's file_size_limit in migration 097. */
export const SITE_EVENT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const SITE_EVENT_ANALYZE_FUNCTION = 'site-event-analyze';
const MAX_WORK_GROUP_HINTS = 30;

export function newSiteEventId(): string {
  return randomUUID();
}

// ─── Capture shape ───────────────────────────────────────────────────────────

export interface LocalSiteEventMedia {
  /** Client-generated; also the file name in storage. */
  id: string;
  localUri: string;
  kind: SiteEventMediaKind;
  role: SiteEventMediaRole;
  mimeType: string;
  ext: string;
  durationS: number | null;
  sortOrder: number;
  capturedAt: string;
}

export interface NewSiteEvent {
  id: string;
  projectId: string;
  roomId: string;
  reporterId: string;
  /** The gate chip left selected at capture: a hint for the AI, not a confirmed gate. */
  gateCode: string | null;
  rawText: string | null;
  capturedAt: string;
  media: LocalSiteEventMedia[];
}

type MediaCarrier = Pick<NewSiteEvent, 'id' | 'projectId' | 'media'>;

export function siteEventMediaPath(projectId: string, eventId: string, mediaId: string, ext: string): string {
  return `site-events/${projectId}/${eventId}/${mediaId}.${ext.replace(/^\./, '').toLowerCase()}`;
}

export function validateNewSiteEvent(input: NewSiteEvent): string | null {
  const photos = input.media.filter((m) => m.kind === 'photo');
  const contexts = photos.filter((m) => m.role === 'context');
  if (contexts.length === 0) return 'Foto konteks wajib diambil.';
  if (contexts.length > 1) return 'Foto konteks hanya satu.';
  if (photos.filter((m) => m.role === 'closeup').length > SITE_EVENT_MAX_CLOSEUPS) {
    return `Close-up maksimal ${SITE_EVENT_MAX_CLOSEUPS} foto.`;
  }
  if (input.media.filter((m) => m.kind === 'audio').length > 1) return 'Rekaman suara hanya satu.';
  if (input.media.some((m) => m.role === 'closure')) {
    return 'Foto penutupan dikirim saat menandai selesai, bukan saat melapor.';
  }
  return null;
}

/** Exactly the columns migration 097 lets a client insert. */
export function buildEventRow(input: NewSiteEvent): Record<string, unknown> {
  const note = input.rawText ? input.rawText.trim() : '';
  return {
    id: input.id,
    project_id: input.projectId,
    room_id: input.roomId,
    reporter_id: input.reporterId,
    status: 'pending_analysis',
    gate_code: input.gateCode,
    raw_text: note ? note : null,
    captured_at: input.capturedAt,
  };
}

export function buildMediaRows(input: MediaCarrier, bytesById: Record<string, number | null>): Record<string, unknown>[] {
  return input.media.map((m) => ({
    id: m.id,
    event_id: input.id,
    kind: m.kind,
    role: m.role,
    storage_path: siteEventMediaPath(input.projectId, input.id, m.id, m.ext),
    mime_type: m.mimeType,
    duration_s: m.kind === 'photo' ? null : m.durationS,
    bytes: bytesById[m.id] ?? null,
    sort_order: m.sortOrder,
    captured_at: m.capturedAt,
  }));
}

/** storage-js reports an existing object as 409 in `status`, `statusCode` or only in the message. */
export function isDuplicateUploadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  return (
    e.status === 409 ||
    e.statusCode === '409' ||
    e.statusCode === 409 ||
    (typeof e.message === 'string' && /already exists/i.test(e.message))
  );
}

export const RPC_ERROR_COPY: ReadonlyArray<[string, string]> = [
  ['SITE_EVENT_NOT_FOUND', 'Kejadian tidak ditemukan.'],
  ['SITE_EVENT_AUTH', 'Anda tidak ditugaskan ke proyek ini.'],
  ['SITE_EVENT_STATE', 'Kejadian ini sudah dikonfirmasi atau dibuang. Muat ulang halaman.'],
  ['SITE_EVENT_TYPE', 'Pilih jenis kejadian.'],
  ['SITE_EVENT_TITLE', 'Judul wajib 1 sampai 80 karakter.'],
  ['SITE_EVENT_SUMMARY', 'Ringkasan maksimal 300 karakter.'],
  ['SITE_EVENT_IMPACT', 'Dampak lanjutan maksimal 300 karakter.'],
  ['SITE_EVENT_GATE', 'Gerbang yang dipilih sudah tidak aktif. Pilih gerbang lain.'],
  ['SITE_EVENT_STEP', 'Langkah yang dipilih sudah tidak aktif. Pilih langkah lain.'],
  ['SITE_EVENT_STEP_NOT_IN_GATE', 'Langkah yang dipilih bukan bagian dari gerbang ini. Pilih ulang langkahnya.'],
  ['SITE_EVENT_OWNER_REQUIRED', 'Pemilik dan tenggat wajib diisi untuk jenis ini.'],
  ['SITE_EVENT_OWNER_NOT_MEMBER', 'Pemilik harus anggota tim proyek.'],
  ['SITE_EVENT_DUE', 'Tenggat tidak boleh sebelum hari ini.'],
  ['SITE_EVENT_RELATED', 'Kejadian terkait harus kejadian lain di proyek yang sama.'],
  ['SITE_EVENT_VO_NO_EVIDENCE', 'VO hanya bisa dikonfirmasi bila ada kutipan dasar.'],
  ['SITE_EVENT_VO_WITHOUT_CHANGE', 'Catatan Perubahan untuk VO gagal dibuat. Coba lagi.'],
  ['SITE_EVENT_NOT_OPEN', 'Hanya kejadian terbuka yang bisa ditandai selesai.'],
  ['SITE_EVENT_CLOSURE_NOTE', 'Catatan penutupan maksimal 500 karakter.'],
  ['SITE_EVENT_HUMAN_FIELDS', 'Perubahan ini hanya bisa dilakukan lewat Konfirmasi atau Selesai.'],
  ['SITE_EVENT_AI_COLUMNS', 'Kolom hasil AI tidak boleh diubah dari aplikasi.'],
  ['SITE_EVENT_MEDIA_PATH', 'Lokasi berkas media tidak sesuai kejadian.'],
];

/** Matches `CODE:` exactly, so SITE_EVENT_OWNER_REQUIRED and SITE_EVENT_OWNER_NOT_MEMBER never collide. */
export function mapSiteEventRpcError(message: string | null | undefined): string {
  const text = message ?? '';
  for (const [code, copy] of RPC_ERROR_COPY) {
    if (text.includes(`${code}:`)) return copy;
  }
  return text ? `Gagal menyimpan: ${text}` : 'Gagal menyimpan. Coba lagi.';
}

/** Up to 30 of the project's own work-group labels, as vocabulary hints for the model. */
export function workGroupHints(items: GroupableItem[]): string[] {
  const names: string[] = [];
  for (const group of buildWorkGroups(items)) {
    const label = group.label.trim();
    if (!label || names.includes(label)) continue;
    names.push(label);
    if (names.length >= MAX_WORK_GROUP_HINTS) break;
  }
  return names;
}

// ─── The three pipeline steps ────────────────────────────────────────────────

export async function uploadSiteEventMedia(
  input: MediaCarrier,
): Promise<{ bytesById: Record<string, number | null>; error?: string }> {
  const bytesById: Record<string, number | null> = {};
  for (const m of input.media) {
    const label = m.kind === 'audio' ? 'suara' : 'foto';
    let body: Blob | ArrayBuffer;
    try {
      const read = await readUploadBody(m.localUri, SITE_EVENT_MEDIA_MAX_BYTES);
      body = read.body;
      bytesById[m.id] = read.bytes;
    } catch (err) {
      return { bytesById, error: `Berkas ${label} tidak bisa dibaca: ${(err as Error).message}` };
    }
    const path = siteEventMediaPath(input.projectId, input.id, m.id, m.ext);
    const { error } = await supabase.storage
      .from(SITE_MEDIA_BUCKET)
      .upload(path, body, { contentType: m.mimeType, upsert: false });
    if (error && !isDuplicateUploadError(error)) {
      return { bytesById, error: `Unggah ${label} gagal: ${error.message}` };
    }
  }
  return { bytesById };
}

export async function insertSiteEvent(
  input: NewSiteEvent,
  bytesById: Record<string, number | null> = {},
): Promise<{ error?: string }> {
  const { error: eventError } = await supabase
    .from('site_events')
    .upsert(buildEventRow(input), { onConflict: 'id', ignoreDuplicates: true });
  if (eventError) return { error: mapSiteEventRpcError(eventError.message) };

  const rows = buildMediaRows(input, bytesById);
  if (rows.length === 0) return {};
  const { error: mediaError } = await supabase
    .from('site_event_media')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (mediaError) return { error: mapSiteEventRpcError(mediaError.message) };
  return {};
}

export interface AnalyzeResponse {
  ok: boolean;
  code?: string;
  error?: string | null;
  message?: string;
  status?: SiteEventStatus;
  transcribed?: boolean;
  analyzed?: boolean;
  confidence?: string;
  attempts?: number;
}

export async function invokeSiteEventAnalysis(
  eventId: string,
  opts: { force?: boolean; workGroupNames?: string[] } = {},
): Promise<AnalyzeResponse> {
  const { data, error } = await supabase.functions.invoke<AnalyzeResponse>(SITE_EVENT_ANALYZE_FUNCTION, {
    body: {
      event_id: eventId,
      force: opts.force === true,
      work_group_names: (opts.workGroupNames ?? []).slice(0, MAX_WORK_GROUP_HINTS),
    },
  });
  if (error) {
    // FunctionsHttpError carries the Response as `context` (functions-js
    // FunctionsClient.js:137); the function always answers with JSON.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as AnalyzeResponse | null;
        if (payload && typeof payload === 'object') return { ...payload, ok: false };
      } catch {
        // fall through to the generic message
      }
    }
    return {
      ok: false,
      code: 'INVOKE_FAILED',
      error: 'Analisis AI belum bisa dijalankan. Coba "Analisis ulang" sebentar lagi.',
    };
  }
  return data ?? { ok: false, code: 'EMPTY', error: 'Server tidak mengembalikan jawaban.' };
}

/**
 * The online path for this release: upload, insert, then start the analysis
 * WITHOUT awaiting it. The caller gets control back as soon as the event is
 * safely stored; `analysis` settles later and is only used for a toast.
 */
export async function createSiteEventWithMedia(
  input: NewSiteEvent,
  opts: { workGroupNames?: string[] } = {},
): Promise<{ eventId: string; error?: string; analysis: Promise<AnalyzeResponse> | null }> {
  const invalid = validateNewSiteEvent(input);
  if (invalid) return { eventId: input.id, error: invalid, analysis: null };

  const uploaded = await uploadSiteEventMedia(input);
  if (uploaded.error) return { eventId: input.id, error: uploaded.error, analysis: null };

  const inserted = await insertSiteEvent(input, uploaded.bytesById);
  if (inserted.error) return { eventId: input.id, error: inserted.error, analysis: null };

  const analysis = invokeSiteEventAnalysis(input.id, { workGroupNames: opts.workGroupNames });
  return { eventId: input.id, analysis };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export interface SiteEventWithMedia extends SiteEvent {
  media: SiteEventMedia[];
  room_name: string | null;
  room_floor: string | null;
  owner_name: string | null;
  reporter_name: string | null;
}

// One string literal on purpose (the ROOM_COLUMNS / readBackUpdate.ts rule):
// a concatenated select string types every row as GenericStringError under
// supabase-js 2.100, forcing a double cast through `unknown`. Do not split it.
const EVENT_SELECT =
  '*, site_event_media(*), rooms(room_name, floor), owner:profiles!site_events_owner_id_fkey(full_name), reporter:profiles!site_events_reporter_id_fkey(full_name)';

export async function getSiteEvent(eventId: string): Promise<SiteEventWithMedia | null> {
  const { data, error } = await supabase.from('site_events').select(EVENT_SELECT).eq('id', eventId).maybeSingle();
  if (error) {
    console.warn('getSiteEvent failed:', error.message);
    return null;
  }
  if (!data) return null;
  const row = data as SiteEvent & {
    site_event_media?: SiteEventMedia[] | null;
    rooms?: { room_name?: string; floor?: string | null } | null;
    owner?: { full_name?: string } | null;
    reporter?: { full_name?: string } | null;
  };
  const { site_event_media, rooms, owner, reporter, ...event } = row;
  return {
    ...(event as SiteEvent),
    media: [...(site_event_media ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    room_name: rooms?.room_name ?? null,
    room_floor: rooms?.floor ?? null,
    owner_name: owner?.full_name ?? null,
    reporter_name: reporter?.full_name ?? null,
  };
}

export type OpenEventSummary = Pick<SiteEvent, 'id' | 'project_id' | 'title' | 'event_type' | 'due_date' | 'is_blocking'>;

/** The release-1 duplicate protection (spec §5.2): what is already open in this room. */
export async function listOpenEventsForRoom(roomId: string, limit = 3): Promise<OpenEventSummary[]> {
  const { data, error } = await supabase
    .from('site_events')
    .select('id, project_id, title, event_type, due_date, is_blocking')
    .eq('room_id', roomId)
    .eq('status', 'open')
    .order('confirmed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('listOpenEventsForRoom failed:', error.message);
    return [];
  }
  return (data ?? []) as OpenEventSummary[];
}

export interface DraftEventSummary {
  id: string;
  status: SiteEventStatus;
  /** The AI's proposed title; null until a draft exists. */
  draft_title: string | null;
  captured_at: string;
  last_error: string | null;
  analysis_attempts: number;
  ai_confidence: string | null;
  room_name: string | null;
}

/** "Draf menunggu" on Beranda: this reporter's events that still need a human. */
export async function listDraftEvents(projectId: string, reporterId: string): Promise<DraftEventSummary[]> {
  const { data, error } = await supabase
    .from('site_events')
    .select('id, status, draft_title:ai_draft->>title, captured_at, last_error, analysis_attempts, ai_confidence, rooms(room_name)')
    .eq('project_id', projectId)
    .eq('reporter_id', reporterId)
    .in('status', ['pending_analysis', 'draft'])
    .order('captured_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20);
  if (error) {
    console.warn('listDraftEvents failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<DraftEventSummary, 'room_name'> & { rooms?: { room_name?: string } | null };
    return {
      id: r.id,
      status: r.status,
      draft_title: r.draft_title ?? null,
      captured_at: r.captured_at,
      last_error: r.last_error,
      analysis_attempts: r.analysis_attempts,
      ai_confidence: r.ai_confidence,
      room_name: r.rooms?.room_name ?? null,
    };
  });
}

/** The gate the room was last tagged with, from v_room_board; the capture default (spec §5.2). */
export async function getRoomLastGate(roomId: string): Promise<string | null> {
  const { data, error } = await supabase.from('v_room_board').select('last_gate_code').eq('room_id', roomId).maybeSingle();
  if (error) return null;
  return (data as { last_gate_code?: string | null } | null)?.last_gate_code ?? null;
}

// ─── Human writes ────────────────────────────────────────────────────────────

export interface ConfirmSiteEventResult {
  event_id: string;
  status: 'open';
  vo_flag: string;
  site_change_id: string | null;
  ai_used: boolean;
  notified: boolean;
}

export function buildConfirmRpcArgs(eventId: string, input: ConfirmInput): Record<string, unknown> {
  const summary = input.summary.trim();
  const impact = input.downstreamImpact.trim();
  const trimmedTranscript = (input.transcriptEdited ?? '').trim();
  const edited = trimmedTranscript ? trimmedTranscript : null;
  return {
    p_event_id: eventId,
    p_event_type: input.eventType,
    p_gate_code: input.gateCode,
    p_step_code: input.gateCode ? input.stepCode : null,
    p_title: normalizeTitle(input.title),
    p_summary: summary ? summary : null,
    p_owner_id: input.ownerId,
    p_due_date: input.dueDate,
    p_downstream_impact: impact ? impact : null,
    p_is_blocking: input.isBlocking,
    p_vo_confirm: input.voConfirm,
    p_related_event_id: input.relatedEventId,
    p_transcript_edited: edited,
  };
}

export async function confirmSiteEvent(
  eventId: string,
  input: ConfirmInput,
): Promise<{ result?: ConfirmSiteEventResult; error?: string; errors?: string[] }> {
  const validation = validateConfirmInput(input);
  if (!validation.ok) return { errors: validation.errors, error: validation.errors[0] };

  const { data, error } = await supabase.rpc('confirm_site_event', buildConfirmRpcArgs(eventId, input));
  if (error) return { error: mapSiteEventRpcError(error.message) };
  return { result: data as ConfirmSiteEventResult };
}

/** "Selesai" (spec §5.5). The closure photo is optional; it is uploaded and recorded before the RPC. */
export async function closeSiteEvent(params: {
  eventId: string;
  projectId: string;
  note: string;
  closurePhoto?: LocalSiteEventMedia | null;
}): Promise<{ error?: string }> {
  if (params.closurePhoto) {
    const carrier: MediaCarrier = {
      id: params.eventId,
      projectId: params.projectId,
      media: [{ ...params.closurePhoto, kind: 'photo', role: 'closure' }],
    };
    const uploaded = await uploadSiteEventMedia(carrier);
    if (uploaded.error) return { error: uploaded.error };
    const { error: mediaError } = await supabase
      .from('site_event_media')
      .upsert(buildMediaRows(carrier, uploaded.bytesById), { onConflict: 'id', ignoreDuplicates: true });
    if (mediaError) return { error: mapSiteEventRpcError(mediaError.message) };
  }

  const note = params.note.trim();
  const { error } = await supabase.rpc('close_site_event', {
    p_event_id: params.eventId,
    p_closure_note: note ? note : null,
  });
  if (error) return { error: mapSiteEventRpcError(error.message) };
  return {};
}

/** "Buang": a status, never a delete (spec §1.1 rule 3). Media rows and files stay. */
export async function discardSiteEvent(eventId: string): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('site_events')
    .update({ status: 'discarded' })
    .eq('id', eventId)
    .in('status', ['pending_analysis', 'draft'])
    .select('id');
  if (error) return { error: mapSiteEventRpcError(error.message) };
  if (!data || data.length === 0) {
    return { error: 'Kejadian tidak ditemukan, bukan milik Anda, atau sudah tidak bisa dibuang.' };
  }
  return {};
}

/** The supervisor's transcript correction, saved before "Analisis ulang" so the function reads it. */
export async function saveTranscriptEdit(eventId: string, text: string): Promise<{ error?: string }> {
  const trimmed = text.trim();
  const value = trimmed ? trimmed : null;
  const { data, error } = await supabase
    .from('site_events')
    .update({ transcript_edited: value })
    .eq('id', eventId)
    .in('status', ['pending_analysis', 'draft'])
    .select('id');
  if (error) return { error: mapSiteEventRpcError(error.message) };
  if (!data || data.length === 0) {
    return { error: 'Kejadian tidak ditemukan, bukan milik Anda, atau transkrip sudah tidak bisa diubah.' };
  }
  return {};
}

/** A signed URL for one site-media object, or null when it cannot be signed. */
export async function signedMediaUrl(storagePath: string): Promise<string | null> {
  const url = await resolvePhotoUrl(`${SITE_MEDIA_PATH_PREFIX}${storagePath}`);
  return url ? url : null;
}
