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

/** Start of the current Asia/Jakarta day (UTC+7, no daylight saving) as a UTC ISO timestamp. */
export function startOfJakartaDayUtcIso(now: Date): string {
  const offsetMs = 7 * 60 * 60 * 1000;
  const jakarta = new Date(now.getTime() + offsetMs);
  const midnight = Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate());
  return new Date(midnight - offsetMs).toISOString();
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

/** OpenAI detects the audio format from the filename, so it must carry the right extension. */
export function audioFilename(storagePath: string, mimeType: string | null): string {
  const last = storagePath.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
  if (ext) return `audio.${ext}`;
  return mimeType === 'audio/webm' ? 'audio.webm' : 'audio.m4a';
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

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
