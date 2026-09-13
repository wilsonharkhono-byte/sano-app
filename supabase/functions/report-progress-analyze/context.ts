// supabase/functions/report-progress-analyze/context.ts
// SANO — pure derivations from database rows for the link stage. No I/O, so
// every rule here has a Deno test: which snapshot entries become lines, how
// the frozen line_text splits back into area/note for the prompt, which photo
// paths the function may read with the service role, and how the continuity
// rows become prompt context.
import type { PromptLine, RecentLink } from './prompt.ts';
import { photoPathFromSignedUrl } from './util.ts';

export const LINE_SEPARATOR = ' :: ';
export const PHOTOS_BUCKET = 'photos';
export const SITE_MEDIA_BUCKET = 'site-media';
export const SITE_MEDIA_PREFIX = `${SITE_MEDIA_BUCKET}:`;

export interface FrozenLine { id: string; line_index: number; status: string; line_text: string }
export interface SnapshotLine { index: number; area: string; note: string; text: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One entry per snapshot.updates[] element, in order; a malformed entry becomes empty text, never a gap. */
export function linesFromSnapshot(snapshot: unknown): SnapshotLine[] {
  const updates = isRecord(snapshot) && Array.isArray(snapshot.updates) ? snapshot.updates : [];
  return updates.map((u, index) => {
    const r = (isRecord(u) ? u : {}) as { area?: unknown; note?: unknown };
    const area = typeof r.area === 'string' ? r.area : '';
    const note = typeof r.note === 'string' ? r.note : '';
    return { index, area, note, text: `${area}${LINE_SEPARATOR}${note}` };
  });
}

/**
 * The frozen client_report_lines.line_text is the single source for both the
 * prompt and quote validation (spec §5.1), so a snapshot edited after issue
 * cannot make the model quote text the validator never sees.
 */
export function promptLinesFromFrozen(lines: FrozenLine[]): PromptLine[] {
  return lines.map((l) => {
    const i = l.line_text.indexOf(LINE_SEPARATOR);
    return i >= 0
      ? { index: l.line_index, area: l.line_text.slice(0, i), note: l.line_text.slice(i + LINE_SEPARATOR.length) }
      : { index: l.line_index, area: l.line_text, note: '' };
  });
}

/** Mirrors tools/storage.ts storageTargetForPath for the two buckets a report can reference. */
export function storageTarget(path: string): { bucket: string; path: string } {
  return path.startsWith(SITE_MEDIA_PREFIX)
    ? { bucket: SITE_MEDIA_BUCKET, path: path.slice(SITE_MEDIA_PREFIX.length) }
    : { bucket: PHOTOS_BUCKET, path };
}

/**
 * The snapshot is member-editable (migration 051), so a photo path in it is
 * untrusted. The service role may only read the folders the app itself writes
 * report photos into, and only for THIS project: the builder's
 * client-report/<projectId>/, the daily log's daily-log/<projectId>/, and the
 * private bucket's site-events/<projectId>/.
 */
export function isPhotoPathInProject(path: string, projectId: string): boolean {
  if (!projectId || path.includes('..')) return false;
  const target = storageTarget(path);
  const allowed = target.bucket === SITE_MEDIA_BUCKET
    ? [`site-events/${projectId}/`]
    : [`client-report/${projectId}/`, `daily-log/${projectId}/`];
  return allowed.some((prefix) => target.path.startsWith(prefix) && target.path.length > prefix.length);
}

/** Hero first, then thumbs; the stored path is preferred, else it is recovered from the signed URL. */
export function photoRefsFromSnapshot(snapshot: unknown, projectId: string, max: number): { refs: string[]; outOfScope: number } {
  const s = (isRecord(snapshot) ? snapshot : {}) as { hero?: unknown; thumbs?: unknown };
  const candidates = [s.hero, ...(Array.isArray(s.thumbs) ? s.thumbs : [])]
    .filter(isRecord)
    .map((p) => (typeof p.path === 'string' && p.path ? p.path : photoPathFromSignedUrl(typeof p.url === 'string' ? p.url : null)))
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const refs: string[] = [];
  let outOfScope = 0;
  for (const candidate of candidates) {
    if (isPhotoPathInProject(candidate, projectId)) refs.push(candidate);
    else outOfScope += 1;
  }
  return { refs: refs.slice(0, max), outOfScope };
}

/** Continuity rows (embedded select) → prompt context, newest first, capped. */
export function recentFromRows(rows: unknown[], max: number): RecentLink[] {
  return rows
    .map((row) => {
      const r = (isRecord(row) ? row : {}) as Record<string, unknown>;
      const boq = r.boq_items as { code?: string } | Array<{ code?: string }> | null | undefined;
      const code = Array.isArray(boq) ? boq[0]?.code : boq?.code;
      const rep = r.client_progress_reports as { period_end?: string } | Array<{ period_end?: string }> | null | undefined;
      const periodEnd = Array.isArray(rep) ? rep[0]?.period_end : rep?.period_end;
      return code && periodEnd
        ? {
            period_end: periodEnd,
            code,
            stage: typeof r.stage === 'string' ? r.stage : null,
            activity_state: typeof r.activity_state === 'string' ? r.activity_state : 'LANJUT',
            text: typeof r.line_text === 'string' ? r.line_text : '',
          }
        : null;
    })
    .filter((r): r is RecentLink => r !== null)
    .sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0))
    .slice(0, max);
}
