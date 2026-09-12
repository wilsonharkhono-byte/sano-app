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

/** Back to the shape tools/siteEvents.ts's upload/insert functions take. Valid before cleanup only. */
export function toNewSiteEvent(entry: CaptureQueueEntry): NewSiteEvent {
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

function assertTransition(from: QueueState, to: QueueState): void {
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

/** Call before starting I/O for a step, so attempts/lastAttemptAt reflect reality even if the app is killed mid-step. */
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

export function recordFailure(entry: CaptureQueueEntry, error: string, now: string): CaptureQueueEntry {
  assertTransition(entry.state, 'failed');
  const consecutiveFailures = entry.consecutiveFailures + 1;
  return {
    ...entry,
    state: 'failed',
    consecutiveFailures,
    lastError: error,
    lastAttemptAt: now,
    needsAttention: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}

/** "Coba lagi": clears the flag and the failure count so nextStep is asked again. Safe to call on any state. */
export function retryEntry(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  if (entry.unrecoverable) return entry;
  const state = deriveState(entry);
  assertTransition(entry.state, state);
  return { ...entry, state, needsAttention: false, consecutiveFailures: 0, lastError: null, lastAttemptAt: now };
}

/** Set by captureQueueStore.ts's load-time recovery pass when a needed local file is gone. */
export function markUnrecoverable(entry: CaptureQueueEntry, reason: string): CaptureQueueEntry {
  return { ...entry, unrecoverable: true, needsAttention: true, lastError: reason };
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
