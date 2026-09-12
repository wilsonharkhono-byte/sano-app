// SANO - Offline capture queue: pure state machine (spec §7). No I/O, no
// imports beyond types, so it needs no mocks and runs identically on native
// and web. captureQueueStore.ts persists entries; captureQueueWorker.ts
// drives them through this machine by calling tools/siteEvents.ts.
//
// Progress is tracked with three booleans (eventInserted, analysisRequested,
// localCleanedUp) plus a per-file `uploaded` flag, because each is backed by
// a separately retryable network call. `state` is always DERIVED from that
// progress (deriveState), never set directly, so state and progress can never
// disagree. An explicit transition table still guards every state change:
// deriveState is trusted to pick a valid target, but assertTransition is the
// one place that would catch a bug in deriveState turning into silent data
// corruption instead of a thrown error caught by a test.

import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';
// SiteEventMediaKind/Role are declared in tools/types.ts (plan 2 task 2) and
// only used structurally inside siteEvents.ts's own interfaces there, never
// re-exported from that file - so they are imported from their actual home.
import type { SiteEventMediaKind, SiteEventMediaRole } from './types';

export type QueueState = 'queued' | 'uploading' | 'analyzing' | 'draft_ready' | 'done' | 'failed';

/** Spec §7: "After 5 consecutive failed attempts the entry is flagged for manual attention." */
export const MAX_CONSECUTIVE_FAILURES = 5;

export interface QueueMediaItem {
  id: string;
  localUri: string;
  role: SiteEventMediaRole;
  kind: SiteEventMediaKind;
  mimeType: string;
  ext: string;
  durationS: number | null;
  sortOrder: number;
  capturedAt: string;
  uploaded: boolean;
  /** Filled in once uploaded, from readUploadBody's byte count; null until then. */
  bytes: number | null;
}

export interface CaptureQueueEntry {
  /**
   * Schema version this record was written under (see CAPTURE_QUEUE_ENTRY_VERSION
   * and upgradeEntry below). This project ships JS-only fixes via OTA
   * (`eas update --branch preview`), so a phone can load a new bundle while
   * AsyncStorage still holds entries written by the old shape — this field is
   * what lets the store detect that instead of crashing on a mismatched entry.
   */
  version: 1;
  /** Same id as the eventual site_events row (spec §7: "client uuid, same id as the event"). */
  id: string;
  /** The signed-in profile this entry belongs to. A shared phone must not mix supervisors (§7). */
  ownerId: string;
  projectId: string;
  roomId: string;
  reporterId: string;
  gateCode: string | null;
  rawText: string | null;
  capturedAt: string;
  media: QueueMediaItem[];
  /** Work-group name hints captured at enqueue time, so a later drain doesn't need boqItems loaded. */
  workGroupNames: string[];
  state: QueueState;
  eventInserted: boolean;
  analysisRequested: boolean;
  localCleanedUp: boolean;
  createdAt: string;
  attempts: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  needsAttention: boolean;
  /**
   * True when a needed local file was found missing on load (temp URI purged
   * by the OS before it could be uploaded). Nothing can resume it; the only
   * action left is discardEntryLocally. Always false once eventInserted is
   * true, because upload always finishes before insert is attempted.
   */
  unrecoverable: boolean;
  /**
   * Classification of the most recent recordFailure call (see recordFailure's
   * JSDoc for what counts as which). Absent on entries that have never failed
   * and on legacy entries loaded before this field existed - callers should
   * treat a missing value the same as 'transient'.
   */
  lastFailureKind?: 'transient' | 'permanent';
}

// ─── Versioning / safe reload ────────────────────────────────────────────────

/** Bump this whenever CaptureQueueEntry's shape changes in a way an old reader can't safely load as-is. */
export const CAPTURE_QUEUE_ENTRY_VERSION = 1 as const;

/**
 * Validates a value loaded from persistence into a CaptureQueueEntry, or
 * returns null if it isn't one this code understands. A legacy entry with no
 * `version` field (everything written before this field existed) is treated
 * as version 1, since that was the only shape in use. Any other version, or
 * anything missing a required field or holding the wrong type for one, is
 * refused rather than guessed at - the store is expected to route a null
 * back into "this entry can't be loaded" handling instead of crashing on it
 * or silently working with a corrupted shape.
 */
export function upgradeEntry(raw: unknown): CaptureQueueEntry | null {
  if (!isRecord(raw)) return null;
  const version = raw.version ?? 1;
  if (version !== 1) return null;
  if (!isValidV1Entry(raw)) return null;
  return { ...(raw as Omit<CaptureQueueEntry, 'version'>), version: 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const QUEUE_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'draft_ready', 'done', 'failed'];

function isValidMediaItem(value: unknown): value is QueueMediaItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.localUri === 'string' &&
    typeof value.role === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.ext === 'string' &&
    (value.durationS === null || typeof value.durationS === 'number') &&
    typeof value.sortOrder === 'number' &&
    typeof value.capturedAt === 'string' &&
    typeof value.uploaded === 'boolean' &&
    (value.bytes === null || typeof value.bytes === 'number')
  );
}

function isValidV1Entry(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.ownerId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.reporterId === 'string' &&
    isStringOrNull(value.gateCode) &&
    isStringOrNull(value.rawText) &&
    typeof value.capturedAt === 'string' &&
    Array.isArray(value.media) &&
    value.media.every(isValidMediaItem) &&
    Array.isArray(value.workGroupNames) &&
    value.workGroupNames.every((n) => typeof n === 'string') &&
    typeof value.state === 'string' &&
    QUEUE_STATES.includes(value.state as QueueState) &&
    typeof value.eventInserted === 'boolean' &&
    typeof value.analysisRequested === 'boolean' &&
    typeof value.localCleanedUp === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.attempts === 'number' &&
    typeof value.consecutiveFailures === 'number' &&
    isStringOrNull(value.lastError) &&
    isStringOrNull(value.lastAttemptAt) &&
    typeof value.needsAttention === 'boolean' &&
    typeof value.unrecoverable === 'boolean' &&
    (value.lastFailureKind === undefined || value.lastFailureKind === 'transient' || value.lastFailureKind === 'permanent')
  );
}

// ─── Building an entry ───────────────────────────────────────────────────────

export interface NewCaptureParams {
  /** The NewSiteEvent captureModel.ts already builds (plan 2 task 12); media localUri must already
   *  point at the queue's permanent per-entry copies (captureQueueStore.ts copies them in
   *  before this is called), not the camera's or recorder's own temp files. */
  event: NewSiteEvent;
  ownerId: string;
  workGroupNames: string[];
  nowIso: string;
}

export function enqueueCapture(params: NewCaptureParams): CaptureQueueEntry {
  const { event } = params;
  return {
    version: CAPTURE_QUEUE_ENTRY_VERSION,
    id: event.id,
    ownerId: params.ownerId,
    projectId: event.projectId,
    roomId: event.roomId,
    reporterId: event.reporterId,
    gateCode: event.gateCode,
    rawText: event.rawText,
    capturedAt: event.capturedAt,
    media: event.media.map((m) => ({
      id: m.id,
      localUri: m.localUri,
      role: m.role,
      kind: m.kind,
      mimeType: m.mimeType,
      ext: m.ext,
      durationS: m.durationS,
      sortOrder: m.sortOrder,
      capturedAt: m.capturedAt,
      uploaded: false,
      bytes: null,
    })),
    workGroupNames: params.workGroupNames,
    state: 'queued',
    eventInserted: false,
    analysisRequested: false,
    localCleanedUp: false,
    createdAt: params.nowIso,
    attempts: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptAt: null,
    needsAttention: false,
    unrecoverable: false,
  };
}

/**
 * Back to the shape tools/siteEvents.ts's upload/insert functions take.
 * Valid before cleanup only: throws if called once localCleanedUp is true,
 * because at that point media[].localUri points at files the store has
 * already deleted and there is nothing left to rebuild an upload/insert from.
 */
export function toNewSiteEvent(entry: CaptureQueueEntry): NewSiteEvent {
  if (entry.localCleanedUp) {
    throw new Error(
      'captureQueue: toNewSiteEvent called on an entry whose local files were already cleaned up.',
    );
  }
  return {
    id: entry.id,
    projectId: entry.projectId,
    roomId: entry.roomId,
    reporterId: entry.reporterId,
    gateCode: entry.gateCode,
    rawText: entry.rawText,
    capturedAt: entry.capturedAt,
    media: entry.media.map(toLocalMedia),
  };
}

export function toLocalMedia(item: QueueMediaItem): LocalSiteEventMedia {
  return {
    id: item.id,
    localUri: item.localUri,
    kind: item.kind,
    role: item.role,
    mimeType: item.mimeType,
    ext: item.ext,
    durationS: item.durationS,
    sortOrder: item.sortOrder,
    capturedAt: item.capturedAt,
  };
}

/** { mediaId: bytes } for buildMediaRows/insertSiteEvent, straight from what upload already recorded. */
export function bytesById(entry: CaptureQueueEntry): Record<string, number | null> {
  return Object.fromEntries(entry.media.map((m) => [m.id, m.bytes]));
}

// ─── State derivation and the transition table ───────────────────────────────

function deriveState(
  entry: Pick<CaptureQueueEntry, 'media' | 'eventInserted' | 'analysisRequested' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return 'done';
  if (entry.analysisRequested) return 'draft_ready';
  if (entry.eventInserted) return 'analyzing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

/**
 * Every legal (from, to) pair. 'failed' can resume into whatever deriveState
 * says fits the entry's actual progress, because a step can fail at any
 * point; every forward state can also fail. 'done' is terminal: nothing is
 * auto-discarded (spec §7), but once local copies are gone and the server has
 * the event, there is nothing left for THIS module to retry.
 */
const ALLOWED_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'failed'],
  uploading: ['uploading', 'analyzing', 'failed'],
  analyzing: ['analyzing', 'draft_ready', 'failed'],
  draft_ready: ['draft_ready', 'done', 'failed'],
  failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
  done: [],
};

export class IllegalQueueTransitionError extends Error {
  constructor(from: QueueState, to: QueueState) {
    super(`captureQueue: illegal transition ${from} -> ${to}`);
    this.name = 'IllegalQueueTransitionError';
  }
}

/**
 * Exported (in addition to being used internally by withProgress/retryEntry)
 * so a test can pin ALLOWED_TRANSITIONS down exhaustively against a literal
 * copy of the intended table, instead of only proving one hand-picked illegal
 * case throws.
 */
export function assertTransition(from: QueueState, to: QueueState): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalQueueTransitionError(from, to);
  }
}

function withProgress(entry: CaptureQueueEntry, now: string, patch: Partial<CaptureQueueEntry>): CaptureQueueEntry {
  const next = { ...entry, ...patch };
  const state = deriveState(next);
  assertTransition(entry.state, state);
  return {
    ...next,
    state,
    consecutiveFailures: 0,
    needsAttention: false,
    lastError: null,
    lastFailureKind: undefined,
    lastAttemptAt: now,
  };
}

// ─── What to do next ──────────────────────────────────────────────────────────

export type QueueAction =
  | { kind: 'upload'; mediaId: string }
  | { kind: 'insert' }
  | { kind: 'invoke' }
  | { kind: 'cleanup' }
  | { kind: 'none' };

/**
 * Pure "what next", independent of timing. The worker gates on
 * isReadyToAttempt(entry, now) before calling this, so a backing-off or
 * flagged entry is simply not asked.
 */
export function nextStep(entry: CaptureQueueEntry): QueueAction {
  if (entry.state === 'done' || entry.unrecoverable || entry.needsAttention) return { kind: 'none' };
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (!entry.eventInserted) return { kind: 'insert' };
  if (!entry.analysisRequested) return { kind: 'invoke' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

// ─── Attempt bookkeeping ──────────────────────────────────────────────────────

/**
 * Call before starting I/O for a step, so attempts/lastAttemptAt reflect
 * reality even if the app is killed mid-step. lastAttemptAt is deliberately
 * written again by whichever mutator ends the attempt (markUploaded /
 * markInserted / markAnalysisRequested / markCleanedUp / recordFailure) - the
 * two writes bracket one attempt (start, then end) and neither is redundant.
 */
export function beginAttempt(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now };
}

export function markUploaded(entry: CaptureQueueEntry, mediaId: string, bytes: number | null, now: string): CaptureQueueEntry {
  const media = entry.media.map((m) => (m.id === mediaId ? { ...m, uploaded: true, bytes } : m));
  return withProgress(entry, now, { media });
}

export function markInserted(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { eventInserted: true });
}

/**
 * The invoke step's own outcome (ok, deferred by the daily cap, or a network
 * error) is deliberately NOT distinguished here: the queue hands off after
 * one best-effort attempt either way. See captureQueueWorker.ts's module
 * comment for why retrying invoke is not the queue's job.
 */
export function markAnalysisRequested(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { analysisRequested: true });
}

export function markCleanedUp(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { localCleanedUp: true });
}

/**
 * `kind` (default 'transient') classifies whether the failure is worth
 * retrying on its own; existing two-argument call sites keep today's
 * behaviour exactly.
 *
 * - 'transient': a network drop, timeout, or 5xx - the same request may
 *   simply succeed on the next attempt. Backs off and retries as before,
 *   flagging for attention only after MAX_CONSECUTIVE_FAILURES in a row.
 * - 'permanent': a response that retrying cannot fix - an auth/RLS refusal
 *   (e.g. a supervisor's project assignment was revoked mid-flight, per this
 *   project's "Supervisor assignment gap" history), the project no longer
 *   being assigned to this device, or any other 4xx that encodes a decision
 *   rather than a transient hiccup. The worker should classify by the
 *   server's response, not by guessing: 401/403/a resource-gone 404-class
 *   refusal => 'permanent'; network errors, timeouts, and 5xx => 'transient'.
 *   A permanent failure sets needsAttention immediately, without waiting for
 *   five strikes, but - like every other failure - never deletes the entry;
 *   the supervisor still has to act on it by hand ("Coba lagi" / discard).
 */
export function recordFailure(
  entry: CaptureQueueEntry,
  error: string,
  now: string,
  kind: 'transient' | 'permanent' = 'transient',
): CaptureQueueEntry {
  assertTransition(entry.state, 'failed');
  const consecutiveFailures = entry.consecutiveFailures + 1;
  return {
    ...entry,
    state: 'failed',
    consecutiveFailures,
    lastError: error,
    lastFailureKind: kind,
    lastAttemptAt: now,
    needsAttention: kind === 'permanent' || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}

/** "Coba lagi": clears the flag and the failure count so nextStep is asked again. Safe to call on any state. */
export function retryEntry(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  if (entry.unrecoverable) return entry;
  const state = deriveState(entry);
  assertTransition(entry.state, state);
  return {
    ...entry,
    state,
    needsAttention: false,
    consecutiveFailures: 0,
    lastError: null,
    lastFailureKind: undefined,
    lastAttemptAt: now,
  };
}

/**
 * Set by captureQueueStore.ts's load-time recovery pass when a needed local
 * file is gone. Routed through the same precondition discipline as the other
 * mutators: throws if eventInserted is already true (upload always finishes
 * before insert is attempted, so a post-insert call here would mean marking
 * an event the server already knows about as locally discardable - exactly
 * the class of bug this module prefers to throw on rather than silently
 * corrupt), and re-derives state via deriveState/assertTransition rather than
 * trusting the caller's entry.state, even though the progress flags this
 * function touches (none) mean the derived state is normally unchanged.
 */
export function markUnrecoverable(entry: CaptureQueueEntry, reason: string): CaptureQueueEntry {
  if (entry.eventInserted) {
    throw new Error(
      'captureQueue: markUnrecoverable called on an entry whose event is already inserted; the server already knows about it, so it must not be marked locally discardable.',
    );
  }
  const state = deriveState(entry);
  assertTransition(entry.state, state);
  return { ...entry, state, unrecoverable: true, needsAttention: true, lastError: reason };
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/** 30s, 60s, 120s, 240s, 480s, capped at 15 min. Field signal is intermittent, not down for good. */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30_000 * 2 ** (consecutiveFailures - 1), 15 * 60 * 1000);
}

export function isReadyToAttempt(entry: CaptureQueueEntry, nowMs: number): boolean {
  if (entry.state === 'done' || entry.needsAttention || entry.unrecoverable) return false;
  if (entry.state !== 'failed' || !entry.lastAttemptAt) return true;
  return nowMs - new Date(entry.lastAttemptAt).getTime() >= backoffMs(entry.consecutiveFailures);
}

// ─── Beranda summary selectors ────────────────────────────────────────────────

const WAITING_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'failed'];

export function waitingCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => WAITING_STATES.includes(e.state)).length;
}

export function draftReadyCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.state === 'draft_ready').length;
}

export function attentionCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.needsAttention).length;
}

/** "Antrean: N menunggu sinyal, M draf siap dikonfirmasi" (spec §7), each part hidden when zero, or null when both are. */
export function queueBadgeText(entries: ReadonlyArray<CaptureQueueEntry>): string | null {
  const waiting = waitingCount(entries);
  const ready = draftReadyCount(entries);
  if (waiting === 0 && ready === 0) return null;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} menunggu sinyal`);
  if (ready > 0) parts.push(`${ready} draf siap dikonfirmasi`);
  return `Antrean: ${parts.join(', ')}`;
}
