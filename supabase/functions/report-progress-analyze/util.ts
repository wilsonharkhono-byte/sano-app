// supabase/functions/report-progress-analyze/util.ts
// SANO — pure helpers for report-progress-analyze. Copied from
// site-event-analyze/util.ts where noted; photoPathFromSignedUrl is a twin of
// tools/clientReportPhotos.ts (jest: reportProgressTwins.test.ts).

/** Written verbatim to the response `error` on a quota block. */
export const AI_QUOTA_MESSAGE = 'Kuota tautan AI hari ini habis. Tautkan manual atau coba besok.';
/** Written to progress_ai_runs.error when the shared deadline cut a call short. */
export const TIMEOUT_ERROR = 'timeout';
/** Links per project per Jakarta day: ~2 reports a day plus retries plus Plan B prefills. */
export const DAILY_CAP_DEFAULT = 60;

export function parseDailyCap(raw: string | null | undefined): { cap: number; invalid: boolean } {
  if (raw === undefined || raw === null) return { cap: DAILY_CAP_DEFAULT, invalid: false };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { cap: DAILY_CAP_DEFAULT, invalid: true };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return { cap: DAILY_CAP_DEFAULT, invalid: true };
  return { cap: parsed, invalid: false };
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, no DST

/** The UTC instant at which the current Jakarta day began. */
export function startOfJakartaDayUtcIso(now: Date): string {
  const shifted = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  const dayStartShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(dayStartShifted - JAKARTA_OFFSET_MS).toISOString();
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** "Jumat, 11 September 2026 (WIB)" — hard-coded names, not Intl (Deno's ICU may be stripped). */
export function jakartaTodayLabel(nowIso: string): string {
  const shifted = new Date(new Date(nowIso).getTime() + JAKARTA_OFFSET_MS);
  return `${HARI[shifted.getUTCDay()]}, ${shifted.getUTCDate()} ${BULAN[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()} (WIB)`;
}

/** `iso` is YYYY-MM-DD; returns YYYY-MM-DD `days` earlier (calendar arithmetic, no time zone). */
export function isoDaysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

export class ProviderTimeoutError extends Error {
  constructor(budgetMs: number) {
    super(`provider call exceeded ${budgetMs} ms`);
    this.name = 'ProviderTimeoutError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (err instanceof ProviderTimeoutError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
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

export function photoPathFromSignedUrl(url: string | null | undefined): string | null {
  const PHOTOS_BUCKET = 'photos';
  /** `/storage/v1/object/{sign|public|authenticated}/<bucket>/<object path>` — query and fragment excluded. */
  const STORAGE_OBJECT_RE = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?#]+)\/([^?#]+)/;
  if (!url) return null;
  const match = STORAGE_OBJECT_RE.exec(url);
  if (!match) return null;
  let bucket: string;
  let objectPath: string;
  try {
    bucket = decodeURIComponent(match[1]);
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!objectPath) return null;
  return bucket === PHOTOS_BUCKET ? objectPath : `${bucket}:${objectPath}`;
}

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
      out += '\uFFFD';
      changed = true;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: valid only when immediately followed by a low surrogate.
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      } else {
        out += '\uFFFD';
        changed = true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Low surrogate with no preceding high surrogate: always unpaired here.
      out += '\uFFFD';
      changed = true;
    } else {
      out += text[i];
    }
  }
  return changed ? out : text;
}

/**
 * A provider refusal no other report or retry can fix: the API key is wrong
 * or revoked, it lacks permission, or the account has no credit. A back-link
 * run should stop at the first one instead of failing every report the same way.
 */
export function isAccountLevelProviderError(status: number, payload: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const error = (payload as { error?: { type?: unknown; message?: unknown } } | null)?.error;
  const type = typeof error?.type === 'string' ? error.type : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  return type === 'authentication_error' || type === 'permission_error' || /credit balance/i.test(message);
}
