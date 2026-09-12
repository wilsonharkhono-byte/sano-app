// SANO - Offline capture queue drain loop (spec §7).
//
// Single-flight: only one drain runs at a time per process; a trigger that
// arrives mid-drain is coalesced into the drain already running rather than
// starting a second overlapping pass (drainAgainRequested).
//
// Oldest-first: within one pass, ready entries are processed in createdAt
// order, so a supervisor who reported three things in a row sees them land in
// the order they happened.
//
// The invoke step is deliberately hands-off: the worker calls
// invokeSiteEventAnalysis exactly once per drain-worthy pass through this
// entry and moves on regardless of the outcome (ok, daily-cap deferral, or a
// network error). It does not retry invoke itself. Three reasons: (1) the
// server already has the durable record by the time invoke runs (insert
// happens first), so nothing is lost if the call never lands; (2)
// SiteEventConfirmScreen's "Analisis ulang" (plan 2 task 13) already calls
// invokeSiteEventAnalysis(id, {force: true}) as the user-facing retry, and a
// background retry loop would race it; (3) retrying automatically on every
// foreground/network-regained trigger would pile up duplicate calls against
// the same event before the queue forgets about it, wasting calls against
// the per-project daily cap (spec §6) for no benefit, since the edge
// function already skips analysis when ai_draft exists unless forced.
//
// invokeSiteEventAnalysis never throws (it maps every error, including the
// edge function's 409 ANALYSIS_IN_PROGRESS claim-already-taken response and
// a spent-quota response, into a resolved AnalyzeResponse - see
// tools/siteEvents.ts). Both of those are treated as a successful kick-off
// here, same as any other non-ok outcome: the call landed, the server is
// already handling (or has already handled, or has deferred) the analysis,
// and there is nothing left for this queue entry to do but clean up. Only a
// thrown rejection (defensive) is caught separately, also without blocking
// cleanup.
//
// Stops on sign-out: stopCaptureQueueWorker clears the current user before
// any in-flight drain's next entry begins, so a signed-out session's queue is
// never touched by a drain that started before sign-out.

import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import {
  beginAttempt,
  bytesById,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markInserted,
  markUploaded,
  nextStep,
  recordFailure,
  retryEntry,
  toLocalMedia,
  toNewSiteEvent,
  type CaptureQueueEntry,
  type QueueAction,
} from './captureQueue';
import { deleteLocalMedia, loadQueue, removeEntry, saveEntry } from './captureQueueStore';
import { insertSiteEvent, invokeSiteEventAnalysis, uploadSiteEventMedia } from './siteEvents';

let currentUserId: string | null = null;
let draining = false;
let drainAgainRequested = false;
let appStateSub: { remove: () => void } | null = null;
let networkSub: { remove: () => void } | null = null;

/** App.tsx calls this once a session exists, with the signed-in profile's id. Idempotent for the same user. */
export function startCaptureQueueWorker(userId: string): void {
  if (currentUserId === userId) return;
  stopCaptureQueueWorker();
  currentUserId = userId;
  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  networkSub = attachNetworkListener();
  triggerDrain();
}

/** App.tsx calls this on sign-out. Any drain already running finishes its current step, then stops. */
export function stopCaptureQueueWorker(): void {
  currentUserId = null;
  appStateSub?.remove();
  appStateSub = null;
  networkSub?.remove();
  networkSub = null;
}

/** SiteEventCaptureScreen calls this right after enqueueing (task 4). Fire-and-forget on purpose: Kirim returns immediately. */
export function triggerDrain(): void {
  void drain();
}

/**
 * "Coba lagi" on the Beranda "Perlu perhatian" list (task 5): clears the
 * flag and failure count, then asks for an immediate drain. A no-op when the
 * entry is gone (already delivered by another drain) or unrecoverable, since
 * retrying a missing local file would only fail again the same way.
 */
export async function retryQueueEntry(userId: string, entryId: string): Promise<void> {
  const entries = await loadQueue(userId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  await saveEntry(retryEntry(entry, new Date().toISOString()));
  triggerDrain();
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active') triggerDrain();
}

function handleNetworkChange(state: { isConnected?: boolean | null }): void {
  if (state.isConnected) triggerDrain();
}

/**
 * expo-network's listener API is confirmed only once task 3 step 1 installs
 * the package and inspects its own type declarations (the repo pins the SDK
 * 54 version but did not have the module installed while this plan was
 * written). Guarded so a name mismatch degrades to "no network-regained
 * trigger" instead of a crash; the foreground and post-capture triggers
 * still cover the same ground on a short delay.
 */
function attachNetworkListener(): { remove: () => void } | null {
  const addListener = (Network as { addNetworkStateListener?: typeof Network.addNetworkStateListener })
    .addNetworkStateListener;
  if (typeof addListener !== 'function') {
    console.warn('[captureQueueWorker] expo-network has no addNetworkStateListener; relying on foreground and post-capture triggers.');
    return null;
  }
  return addListener(handleNetworkChange);
}

async function drain(): Promise<void> {
  if (!currentUserId) return;
  if (draining) {
    drainAgainRequested = true;
    return;
  }
  draining = true;
  const userId = currentUserId;
  try {
    do {
      drainAgainRequested = false;
      const now = Date.now();
      const entries = await loadQueue(userId);
      const runnable = entries
        .filter((e) => isReadyToAttempt(e, now))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const entry of runnable) {
        if (currentUserId !== userId) return; // signed out mid-pass
        await processEntry(userId, entry);
      }
    } while (drainAgainRequested && currentUserId === userId);
  } finally {
    draining = false;
  }
}

async function processEntry(userId: string, start: CaptureQueueEntry): Promise<void> {
  let entry = start;
  while (currentUserId === userId) {
    const step = nextStep(entry);
    if (step.kind === 'none') break;
    const startedAt = new Date().toISOString();
    entry = beginAttempt(entry, startedAt);
    await saveEntry(entry);
    try {
      entry = await runStep(userId, entry, step);
    } catch (err) {
      entry = recordFailure(entry, describeStepError(step, err), new Date().toISOString());
      await saveEntry(entry);
      return;
    }
    await saveEntry(entry);
  }
  if (entry.state === 'done') {
    await removeEntry(userId, entry.id);
  }
}

async function runStep(userId: string, entry: CaptureQueueEntry, step: QueueAction): Promise<CaptureQueueEntry> {
  const now = new Date().toISOString();
  switch (step.kind) {
    case 'upload': {
      const item = entry.media.find((m) => m.id === step.mediaId);
      if (!item) return markUploaded(entry, step.mediaId, null, now); // defensive; nextStep only asks for media that exists
      const result = await uploadSiteEventMedia({ id: entry.id, projectId: entry.projectId, media: [toLocalMedia(item)] });
      if (result.error) throw new Error(result.error);
      return markUploaded(entry, item.id, result.bytesById[item.id] ?? null, now);
    }
    case 'insert': {
      const result = await insertSiteEvent(toNewSiteEvent(entry), bytesById(entry));
      if (result.error) throw new Error(result.error);
      return markInserted(entry, now);
    }
    case 'invoke': {
      try {
        const result = await invokeSiteEventAnalysis(entry.id, { workGroupNames: entry.workGroupNames });
        if (!result.ok) {
          console.warn('[captureQueueWorker] analysis deferred for', entry.id, result.code, result.error);
        }
      } catch (err) {
        console.warn('[captureQueueWorker] analysis invoke failed for', entry.id, (err as Error).message);
      }
      return markAnalysisRequested(entry, now);
    }
    case 'cleanup': {
      await deleteLocalMedia(userId, entry.id);
      return markCleanedUp(entry, now);
    }
    case 'none':
      return entry;
  }
}

const STEP_LABEL: Record<Exclude<QueueAction['kind'], 'none'>, string> = {
  upload: 'Unggah berkas',
  insert: 'Simpan kejadian',
  invoke: 'Jalankan analisis',
  cleanup: 'Bersihkan berkas lokal',
};

function describeStepError(step: QueueAction, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const label = step.kind === 'none' ? 'Langkah' : STEP_LABEL[step.kind];
  return `${label} gagal: ${message}`;
}
