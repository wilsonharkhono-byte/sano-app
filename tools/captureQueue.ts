// SANO - Offline capture queue: pure state machine (spec §7; closure spec
// 2026-09-26 §4). No I/O, no imports beyond types, so it needs no mocks and
// runs identically on native and web. captureQueueStore.ts persists entries;
// captureQueueWorker.ts drives them through this machine by calling
// tools/siteEvents.ts.
//
// Two job kinds share one store, one worker and one Beranda card:
//   * 'capture' - a new report: upload media, insert the event, kick off the
//     analysis, clean up. Progress is three booleans (eventInserted,
//     analysisRequested, localCleanedUp) plus a per-file `uploaded` flag.
//   * 'close' - "Selesai" on an open event: upload the closure photo (if any),
//     insert its media row, call close_site_event, and, when the server says
//     the event was no longer open, read who closed it. Progress is
//     mediaInserted, closeOutcome, closedElsewhere and localCleanedUp.
// Each flag is backed by one separately retryable network call. `state` is
// always DERIVED from that progress (deriveCaptureState / deriveCloseState),
// never set directly, so state and progress can never disagree. A transition
// table per kind still guards every state change: the derivation is trusted to
// pick a valid target, but assertTransition is the one place that would catch
// a bug in it turning into silent data corruption instead of a thrown error.

import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';
// SiteEventMediaKind/Role are declared in tools/types.ts (plan 2 task 2) and
// only used structurally inside siteEvents.ts's own interfaces there, never
// re-exported from that file - so they are imported from their actual home.
import type { SiteEventMediaKind, SiteEventMediaRole } from './types';

export type QueueState =
  | 'queued'
  | 'uploading'
  | 'analyzing'
  | 'draft_ready'
  | 'closing'
  | 'done'
  | 'superseded'
  | 'failed';

export type QueueJobKind = 'capture' | 'close';

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

/** Fields every job carries, whatever its kind. */
interface QueueJobBase {
  /**
   * Schema version this record was written under (see CAPTURE_QUEUE_ENTRY_VERSION
   * and upgradeEntry below). This project ships JS-only fixes via OTA
   * (`eas update --branch preview`), so a phone can load a new bundle while
   * AsyncStorage still holds entries written by the old shape - this field is
   * what lets the store detect that instead of crashing on a mismatched entry.
   */
  version: 2;
  /** A capture job: the same id as the eventual site_events row (spec §7). A close job: a fresh uuid. */
  id: string;
  /** The signed-in profile this entry belongs to. A shared phone must not mix supervisors (§7). */
  ownerId: string;
  projectId: string;
  media: QueueMediaItem[];
  state: QueueState;
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
   * action left is discardEntryLocally.
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

export interface CaptureJob extends QueueJobBase {
  kind: 'capture';
  roomId: string;
  reporterId: string;
  gateCode: string | null;
  rawText: string | null;
  capturedAt: string;
  /** Work-group name hints captured at enqueue time, so a later drain doesn't need boqItems loaded. */
  workGroupNames: string[];
  eventInserted: boolean;
  analysisRequested: boolean;
}

/** Who the server says closed the event, when this job's own close found it already closed. */
export interface ClosedElsewhere {
  closedByName: string | null;
  closedAt: string;
}

export interface CloseJob extends QueueJobBase {
  kind: 'close';
  /** The event being closed. The job's own `id` is a fresh uuid, never this (closure spec §4.1). */
  eventId: string;
  roomId: string;
  /** Rendered on the Beranda card, which must work with no signal. */
  eventTitle: string;
  /** Exactly what close_site_event receives: the trimmed note, or null. */
  note: string | null;
  mediaInserted: boolean;
  closeOutcome: null | 'closed' | 'not_open';
  closedElsewhere: ClosedElsewhere | null;
}

export type CaptureQueueEntry = CaptureJob | CloseJob;

// ─── Versioning / safe reload ────────────────────────────────────────────────

/** Bump this whenever an entry's shape changes in a way an old reader can't safely load as-is. */
export const CAPTURE_QUEUE_ENTRY_VERSION = 2 as const;

/**
 * Validates a value loaded from persistence, or returns null if it isn't one
 * this code understands. A record with no `version` field, or version 1, is a
 * capture job written before close jobs existed: it is validated with the v1
 * rules and returned as `{ ...raw, version: 2, kind: 'capture' }` - the kind is
 * SET, never read from the record - so every report queued before this
 * release drains exactly as before. A version 2 record validates by its
 * `kind`. Anything else is refused rather than guessed at; the store leaves a
 * refused record in storage untouched and excludes it from the load.
 */
export function upgradeEntry(raw: unknown): CaptureQueueEntry | null {
  if (!isRecord(raw)) return null;
  const version = raw.version ?? 1;
  if (version === 1) {
    if (!isValidCaptureFields(raw)) return null;
    return { ...(raw as unknown as Omit<CaptureJob, 'version' | 'kind'>), version: 2, kind: 'capture' };
  }
  if (version !== 2) return null;
  if (raw.kind === 'capture') return isValidCaptureFields(raw) ? (raw as unknown as CaptureJob) : null;
  if (raw.kind === 'close') return isValidCloseFields(raw) ? (raw as unknown as CloseJob) : null;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const CAPTURE_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'draft_ready', 'done', 'failed'];
const CLOSE_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'closing', 'done', 'superseded', 'failed'];

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

function isValidBookkeeping(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.ownerId === 'string' &&
    typeof value.projectId === 'string' &&
    Array.isArray(value.media) &&
    value.media.every(isValidMediaItem) &&
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

/** The v1 rules, unchanged: a capture record from before close jobs existed passes exactly these. */
function isValidCaptureFields(value: Record<string, unknown>): boolean {
  return (
    isValidBookkeeping(value) &&
    typeof value.roomId === 'string' &&
    typeof value.reporterId === 'string' &&
    isStringOrNull(value.gateCode) &&
    isStringOrNull(value.rawText) &&
    typeof value.capturedAt === 'string' &&
    Array.isArray(value.workGroupNames) &&
    value.workGroupNames.every((n) => typeof n === 'string') &&
    typeof value.state === 'string' &&
    CAPTURE_STATES.includes(value.state as QueueState) &&
    typeof value.eventInserted === 'boolean' &&
    typeof value.analysisRequested === 'boolean'
  );
}

function isValidClosedElsewhere(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value) && isStringOrNull(value.closedByName) && typeof value.closedAt === 'string';
}

function isValidCloseFields(value: Record<string, unknown>): boolean {
  return (
    isValidBookkeeping(value) &&
    (value.media as unknown[]).length <= 1 &&
    typeof value.eventId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.eventTitle === 'string' &&
    isStringOrNull(value.note) &&
    typeof value.state === 'string' &&
    CLOSE_STATES.includes(value.state as QueueState) &&
    typeof value.mediaInserted === 'boolean' &&
    (value.closeOutcome === null || value.closeOutcome === 'closed' || value.closeOutcome === 'not_open') &&
    isValidClosedElsewhere(value.closedElsewhere)
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

function toQueueMedia(m: LocalSiteEventMedia): QueueMediaItem {
  return {
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
  };
}

export function enqueueCapture(params: NewCaptureParams): CaptureJob {
  const { event } = params;
  return {
    version: CAPTURE_QUEUE_ENTRY_VERSION,
    kind: 'capture',
    id: event.id,
    ownerId: params.ownerId,
    projectId: event.projectId,
    roomId: event.roomId,
    reporterId: event.reporterId,
    gateCode: event.gateCode,
    rawText: event.rawText,
    capturedAt: event.capturedAt,
    media: event.media.map(toQueueMedia),
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

export interface NewCloseParams {
  /** A fresh client uuid for the JOB, never the event id (closure spec §4.1). */
  id: string;
  ownerId: string;
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  /** The note as typed; stored trimmed, or null when blank - exactly what the RPC receives. */
  note: string;
  /** Zero or one closure photo. Its localUri must already point at the queue's own copy. */
  closurePhoto: LocalSiteEventMedia | null;
  nowIso: string;
}

export function enqueueClose(params: NewCloseParams): CloseJob {
  const note = params.note.trim();
  return {
    version: CAPTURE_QUEUE_ENTRY_VERSION,
    kind: 'close',
    id: params.id,
    ownerId: params.ownerId,
    projectId: params.projectId,
    eventId: params.eventId,
    roomId: params.roomId,
    eventTitle: params.eventTitle,
    note: note ? note : null,
    media: params.closurePhoto
      ? [toQueueMedia({ ...params.closurePhoto, kind: 'photo', role: 'closure' })]
      : [],
    state: 'queued',
    mediaInserted: false,
    closeOutcome: null,
    closedElsewhere: null,
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
export function toNewSiteEvent(entry: CaptureJob): NewSiteEvent {
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

/**
 * The storage folder a job's media belongs in. A capture job's id IS the
 * event id; a close job's is not, and 097's path guard refuses any media row
 * outside site-events/{projectId}/{eventId}/.
 */
export function mediaCarrierId(entry: CaptureQueueEntry): string {
  return entry.kind === 'close' ? entry.eventId : entry.id;
}

/** { mediaId: bytes } for buildMediaRows/insertSiteEvent, straight from what upload already recorded. */
export function bytesById(entry: CaptureQueueEntry): Record<string, number | null> {
  return Object.fromEntries(entry.media.map((m) => [m.id, m.bytes]));
}

// ─── State derivation and the transition tables ──────────────────────────────

function deriveCaptureState(
  entry: Pick<CaptureJob, 'media' | 'eventInserted' | 'analysisRequested' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return 'done';
  if (entry.analysisRequested) return 'draft_ready';
  if (entry.eventInserted) return 'analyzing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

function deriveCloseState(
  entry: Pick<CloseJob, 'media' | 'mediaInserted' | 'closeOutcome' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return entry.closeOutcome === 'not_open' ? 'superseded' : 'done';
  if (entry.closeOutcome !== null || entry.mediaInserted || entry.media.length === 0) return 'closing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

function deriveState(entry: CaptureQueueEntry): Exclude<QueueState, 'failed'> {
  return entry.kind === 'close' ? deriveCloseState(entry) : deriveCaptureState(entry);
}

/**
 * Every legal (from, to) pair, per kind. 'failed' can resume into whatever the
 * derivation says fits the entry's actual progress, because a step can fail
 * at any point; every forward state can also fail. 'done' and 'superseded'
 * are terminal. A capture job never enters 'closing' or 'superseded', and a
 * close job never enters 'analyzing' or 'draft_ready'.
 */
const CAPTURE_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'failed'],
  uploading: ['uploading', 'analyzing', 'failed'],
  analyzing: ['analyzing', 'draft_ready', 'failed'],
  draft_ready: ['draft_ready', 'done', 'failed'],
  failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
  done: [],
  closing: [],
  superseded: [],
};

const CLOSE_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'closing', 'failed'],
  uploading: ['uploading', 'closing', 'failed'],
  closing: ['closing', 'done', 'superseded', 'failed'],
  failed: ['queued', 'uploading', 'closing'],
  done: [],
  superseded: [],
  analyzing: [],
  draft_ready: [],
};

export class IllegalQueueTransitionError extends Error {
  constructor(from: QueueState, to: QueueState, kind: QueueJobKind) {
    super(`captureQueue: illegal ${kind} transition ${from} -> ${to}`);
    this.name = 'IllegalQueueTransitionError';
  }
}

/**
 * Exported so a test can pin both tables down exhaustively against literal
 * copies of the intended tables. `kind` defaults to 'capture', which keeps
 * every two-argument call written before close jobs existed meaning the same.
 */
export function assertTransition(from: QueueState, to: QueueState, kind: QueueJobKind = 'capture'): void {
  if (from === to) return;
  const table = kind === 'close' ? CLOSE_TRANSITIONS : CAPTURE_TRANSITIONS;
  if (!table[from].includes(to)) {
    throw new IllegalQueueTransitionError(from, to, kind);
  }
}

function withProgress<E extends CaptureQueueEntry>(entry: E, now: string, patch: Partial<CaptureJob> | Partial<CloseJob>): E {
  const next = { ...entry, ...patch } as E;
  const state = deriveState(next);
  assertTransition(entry.state, state, entry.kind);
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
  | { kind: 'insert_media' }
  | { kind: 'close' }
  | { kind: 'lookup_closer' }
  | { kind: 'cleanup' }
  | { kind: 'none' };

/**
 * Pure "what next", independent of timing. The worker gates on
 * isReadyToAttempt(entry, now) before calling this, so a backing-off or
 * flagged entry is simply not asked.
 */
export function nextStep(entry: CaptureQueueEntry): QueueAction {
  if (entry.state === 'done' || entry.state === 'superseded' || entry.unrecoverable || entry.needsAttention) {
    return { kind: 'none' };
  }
  return entry.kind === 'close' ? nextCloseStep(entry) : nextCaptureStep(entry);
}

function nextCaptureStep(entry: CaptureJob): QueueAction {
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (!entry.eventInserted) return { kind: 'insert' };
  if (!entry.analysisRequested) return { kind: 'invoke' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

/**
 * Upload, then the media row, then the RPC. After an outcome of `not_open`
 * the job reads who closed the event before cleaning up, so the card can say
 * so; the RPC is never asked again once any outcome is recorded.
 */
function nextCloseStep(entry: CloseJob): QueueAction {
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (entry.media.length > 0 && !entry.mediaInserted) return { kind: 'insert_media' };
  if (entry.closeOutcome === null) return { kind: 'close' };
  if (entry.closeOutcome === 'not_open' && entry.closedElsewhere === null) return { kind: 'lookup_closer' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

// ─── Attempt bookkeeping ──────────────────────────────────────────────────────

/**
 * Call before starting I/O for a step, so attempts/lastAttemptAt reflect
 * reality even if the app is killed mid-step. lastAttemptAt is deliberately
 * written again by whichever mutator ends the attempt - the two writes
 * bracket one attempt (start, then end) and neither is redundant.
 */
export function beginAttempt<E extends CaptureQueueEntry>(entry: E, now: string): E {
  return { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now };
}

export function markUploaded<E extends CaptureQueueEntry>(entry: E, mediaId: string, bytes: number | null, now: string): E {
  const media = entry.media.map((m) => (m.id === mediaId ? { ...m, uploaded: true, bytes } : m));
  return withProgress(entry, now, { media });
}

export function markInserted(entry: CaptureJob, now: string): CaptureJob {
  return withProgress(entry, now, { eventInserted: true });
}

/**
 * The invoke step's own outcome (ok, deferred by the daily cap, or a network
 * error) is deliberately NOT distinguished here: the queue hands off after
 * one best-effort attempt either way. See captureQueueWorker.ts's module
 * comment for why retrying invoke is not the queue's job.
 */
export function markAnalysisRequested(entry: CaptureJob, now: string): CaptureJob {
  return withProgress(entry, now, { analysisRequested: true });
}

export function markClosureMediaInserted(entry: CloseJob, now: string): CloseJob {
  return withProgress(entry, now, { mediaInserted: true });
}

/**
 * `not_open` is an outcome, not a failure: somebody closed the event first.
 * No strike, no lastError, and the RPC is never called for this job again.
 */
export function markCloseOutcome(entry: CloseJob, outcome: 'closed' | 'not_open', now: string): CloseJob {
  return withProgress(entry, now, { closeOutcome: outcome });
}

export function markClosedElsewhere(entry: CloseJob, closedElsewhere: ClosedElsewhere, now: string): CloseJob {
  return withProgress(entry, now, { closedElsewhere });
}

export function markCleanedUp<E extends CaptureQueueEntry>(entry: E, now: string): E {
  return withProgress(entry, now, { localCleanedUp: true });
}

/**
 * `kind` (default 'transient') classifies whether the failure is worth
 * retrying on its own; existing two-argument call sites keep today's
 * behaviour exactly.
 *
 * - 'transient': a network drop, timeout, or 5xx - the same request may
 *   simply succeed on the next attempt. Backs off and retries,
 *   flagging for attention only after MAX_CONSECUTIVE_FAILURES in a row.
 * - 'permanent': a response that retrying cannot fix - an auth/RLS refusal,
 *   a SITE_EVENT_* refusal from an RPC, or any other 4xx that encodes a
 *   decision rather than a transient hiccup. A permanent failure sets
 *   needsAttention immediately, without waiting for five strikes, but - like
 *   every other failure - never deletes the entry; the person still has to
 *   act on it by hand ("Coba lagi" / "Buang" / "Batalkan").
 */
export function recordFailure<E extends CaptureQueueEntry>(
  entry: E,
  error: string,
  now: string,
  kind: 'transient' | 'permanent' = 'transient',
): E {
  assertTransition(entry.state, 'failed', entry.kind);
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
export function retryEntry<E extends CaptureQueueEntry>(entry: E, now: string): E {
  if (entry.unrecoverable) return entry;
  const state = deriveState(entry);
  assertTransition(entry.state, state, entry.kind);
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
 * A close job that can never send: close_site_event answered NOT_OPEN, then
 * reading the event's status was refused for good (the row is hidden from this
 * user, or its status is not done). Retrying repeats the same refusal, and
 * cancelling would hide that the server already answered, so the only thing
 * left is for the person to read it and dismiss it (acknowledgeCloseEntry).
 * It is not pending (captureQueueStore.ts's pendingCloseFor means "will still
 * try") and not superseded (nobody's name or time was read).
 */
export function isCloseStatusUnreadable(job: Pick<CloseJob, 'closeOutcome' | 'lastFailureKind'>): boolean {
  return job.closeOutcome === 'not_open' && job.lastFailureKind === 'permanent';
}

/**
 * True while the job still needs a local file the OS may purge: a capture job
 * until its event is inserted (upload always finishes before insert), a close
 * job until its closure photo is uploaded.
 */
export function needsLocalMedia(entry: CaptureQueueEntry): boolean {
  return entry.kind === 'close' ? entry.media.some((m) => !m.uploaded) : !entry.eventInserted;
}

/**
 * Set by captureQueueStore.ts's load-time recovery pass when a needed local
 * file is gone. Throws once nothing local is needed any more (a capture job
 * whose event is inserted, a close job whose photo is uploaded): marking such
 * a job locally discardable would hide something the server already has.
 */
export function markUnrecoverable<E extends CaptureQueueEntry>(entry: E, reason: string): E {
  if (!needsLocalMedia(entry)) {
    throw new Error(
      entry.kind === 'close'
        ? 'captureQueue: markUnrecoverable called on a close job whose photo is already uploaded; there is no local file left to lose.'
        : 'captureQueue: markUnrecoverable called on an entry whose event is already inserted; the server already knows about it, so it must not be marked locally discardable.',
    );
  }
  const state = deriveState(entry);
  assertTransition(entry.state, state, entry.kind);
  return { ...entry, state, unrecoverable: true, needsAttention: true, lastError: reason };
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/** 30s, 60s, 120s, 240s, 480s, capped at 15 min. Field signal is intermittent, not down for good. */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30_000 * 2 ** (consecutiveFailures - 1), 15 * 60 * 1000);
}

export function isReadyToAttempt(entry: CaptureQueueEntry, nowMs: number): boolean {
  if (entry.state === 'done' || entry.state === 'superseded' || entry.needsAttention || entry.unrecoverable) return false;
  if (entry.state !== 'failed' || !entry.lastAttemptAt) return true;
  return nowMs - new Date(entry.lastAttemptAt).getTime() >= backoffMs(entry.consecutiveFailures);
}

// ─── Beranda summary selectors ────────────────────────────────────────────────

const WAITING_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'closing', 'failed'];

export function waitingCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => WAITING_STATES.includes(e.state)).length;
}

export function draftReadyCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.state === 'draft_ready').length;
}

export function attentionCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.needsAttention).length;
}
