// SANO - Pure helpers for site-event-analyze. No Supabase client, no provider call.

/**
 * Written to site_events.last_error when the per-project daily cap is spent.
 * The app shows "isi manual" when it sees this exact text
 * (tools/siteEventRules.ts AI_QUOTA_MESSAGE); siteEventDraftValidateTwin.test.ts
 * keeps the two identical.
 */
export const AI_QUOTA_MESSAGE =
  'Kuota analisis AI hari ini habis. Draf akan dibuat besok, atau isi manual.';

export const STT_FAILED_MESSAGE = 'Transkripsi gagal.';

/** Written to site_event_ai_runs.error when the invocation's deadline cut a provider call short. */
export const TIMEOUT_ERROR = 'timeout';

/** Spec §6 cost guard: analyses per project per Jakarta day when the secret is unset or unusable. */
export const DAILY_CAP_DEFAULT = 200;

/**
 * Reads SITE_EVENT_DAILY_CAP strictly, because it is the only control between a
 * mis-typed secret and an unbounded Anthropic bill.
 *
 * `Number('20O')` is NaN and every comparison against NaN is false, so a typo
 * would silently remove the cap; `Deno.env.get` returns `''` for a secret set to
 * empty and `Number('')` is 0, so the mirror typo would refuse every analysis
 * forever. Both fail closed here: digits only, at least 1, and anything else
 * falls back to the default with a log line. Never NaN, never 0.
 *
 * `invalid` is returned rather than logged so the helper stays pure; index.ts
 * logs once, at module load.
 */
export function parseDailyCap(raw: string | null | undefined): { cap: number; invalid: boolean } {
  if (raw === undefined || raw === null) return { cap: DAILY_CAP_DEFAULT, invalid: false };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { cap: DAILY_CAP_DEFAULT, invalid: true };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { cap: DAILY_CAP_DEFAULT, invalid: true };
  return { cap: parsed, invalid: false };
}

/** Spec §6 cost guard: at most 4 photos per call. */
export const MAX_ANALYSIS_PHOTOS = 4;
export const MAX_WORK_GROUP_NAMES = 30;
export const WORK_GROUP_NAME_MAX = 80;

/** Image media types the Messages API accepts. */
export const CLAUDE_IMAGE_MEDIA_TYPES: ReadonlyArray<string> = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface MediaRow {
  id: string;
  kind: string;
  role: string;
  storage_path: string;
  mime_type: string | null;
  sort_order: number;
  duration_s: number | null;
  bytes: number | null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** Asia/Jakarta is UTC+7 all year; Indonesia keeps no daylight saving. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Start of the current Asia/Jakarta day (UTC+7, no daylight saving) as a UTC ISO timestamp. */
export function startOfJakartaDayUtcIso(now: Date): string {
  const jakarta = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  const midnight = Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate());
  return new Date(midnight - JAKARTA_OFFSET_MS).toISOString();
}

const HARI: ReadonlyArray<string> = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN: ReadonlyArray<string> = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Today in Jakarta, spelled out for the prompt: "Jumat, 11 September 2026 (WIB)".
 *
 * The model cannot know the date, so "besok" and "hari Sabtu" have nothing to
 * count from unless the prompt says what today is. The names are hard-coded
 * rather than taken from Intl, because a Deno deployment carries whatever
 * locale data it carries and an English month name in an Indonesian prompt is
 * exactly the sort of small wrongness nobody notices.
 *
 * An unparseable timestamp says so instead of naming a day that might be wrong.
 */
export function jakartaTodayLabel(nowIso: string): string {
  const ms = Date.parse(nowIso);
  if (!Number.isFinite(ms)) return '(tanggal tidak diketahui)';
  const jakarta = new Date(ms + JAKARTA_OFFSET_MS);
  return `${HARI[jakarta.getUTCDay()]}, ${jakarta.getUTCDate()} ${BULAN[jakarta.getUTCMonth()]} ${jakarta.getUTCFullYear()} (WIB)`;
}

/** Context photo first, then close-ups by sort order; only types Claude accepts; at most `max`. */
export function selectAnalysisPhotos<T extends MediaRow>(
  media: T[],
  max: number = MAX_ANALYSIS_PHOTOS,
): { selected: T[]; skipped: number } {
  const photos = media.filter((m) => m.kind === 'photo' && (m.role === 'context' || m.role === 'closeup'));
  const usable = photos.filter((m) => CLAUDE_IMAGE_MEDIA_TYPES.includes(m.mime_type ?? 'image/jpeg'));
  const rank = (m: T) => (m.role === 'context' ? 0 : 1);
  const ordered = [...usable].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
  const selected = ordered.slice(0, max);
  return { selected, skipped: photos.length - selected.length };
}

export function findAudio<T extends MediaRow>(media: T[]): T | null {
  return media.find((m) => m.kind === 'audio') ?? null;
}

/**
 * OpenAI reads the audio format off the filename, so the wrong extension is a
 * rejected upload, not a worse transcript. Expo records m4a on iOS and Android
 * and webm on web; the map covers what those platforms actually report.
 */
const AUDIO_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** OpenAI detects the audio format from the filename, so it must carry the right extension. */
export function audioFilename(storagePath: string, mimeType: string | null): string {
  const last = storagePath.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
  if (ext) return `audio.${ext}`;
  // 'audio/webm;codecs=opus' is one of these types with a parameter attached.
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return `audio.${AUDIO_EXT_BY_MIME[type] ?? 'm4a'}`;
}

/** Client-supplied prompt hints: strings only, trimmed, unique, 80 characters, 30 at most. */
export function clampWorkGroupNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.replace(/\s+/g, ' ').trim().slice(0, WORK_GROUP_NAME_MAX);
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_WORK_GROUP_NAMES) break;
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Thrown when a provider call ran out of the invocation's time budget, so the
 * caller can record `TIMEOUT_ERROR` on the audit row instead of a generic
 * "AbortError" that reads like a bug.
 */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`${TIMEOUT_ERROR} setelah ${timeoutMs} ms`);
    this.name = 'ProviderTimeoutError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (err instanceof ProviderTimeoutError) return true;
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const budget = Math.max(1, Math.floor(timeoutMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ProviderTimeoutError(budget);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Postgres's jsonb parser rejects an unpaired UTF-16 surrogate outright (it
 * cannot represent a lone \uD800-\uDFFF as a Unicode scalar value), and a
 * model can echo one back verbatim from a transcript. `validate.ts` only
 * sanitises what becomes `ai_draft`; it never runs against the raw tool-call
 * input stored in `site_event_ai_runs.output`, the raw STT transcript, or a
 * `last_error` string built from provider text. Call this immediately before
 * each of those writes: it walks strings (recursing into arrays and plain
 * objects) and replaces any surrogate not part of a valid high+low pair, and
 * any U+0000, with U+FFFD; every other value (numbers, booleans, null,
 * already-paired surrogates such as emoji) survives unchanged.
 *
 * U+0000 matters as much as the surrogates: jsonb refuses it (22P05) and so
 * does a TEXT column, so one NUL in a tool call fails both the site_events
 * update and the site_event_ai_runs insert that would have recorded the spend.
 */
export function sanitizeJsonForPostgres<T>(value: T): T {
  if (typeof value === 'string') return sanitizeSurrogates(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonForPostgres(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeJsonForPostgres(val);
    }
    return out as unknown as T;
  }
  return value;
}

function sanitizeSurrogates(text: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0) {
      // jsonb rejects U+0000 outright (22P05) and TEXT refuses it too.
      out += '�';
      changed = true;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: valid only when immediately followed by a low surrogate.
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      } else {
        out += '�';
        changed = true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate with no preceding high surrogate: always unpaired here.
      out += '�';
      changed = true;
    } else {
      out += text[i];
    }
  }
  return changed ? out : text;
}
