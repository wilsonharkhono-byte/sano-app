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
// Per-entry lock (inFlight): single-flight keeps two PASSES apart; this keeps
// a drain step and a "Coba lagi" tap apart on the same ENTRY. Without it a
// tap's pre-tap snapshot could be written back after the drain delivered and
// purged that entry, and the app would then tell a supervisor to re-file a
// report that already landed.
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
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  markInserted,
  markUploaded,
  mediaCarrierId,
  nextStep,
  recordFailure,
  retryEntry,
  toLocalMedia,
  toNewSiteEvent,
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
  type QueueAction,
} from './captureQueue';
import { deleteLocalMedia, loadQueue, removeEntry, saveEntry } from './captureQueueStore';
import {
  closeSiteEventRpc,
  insertClosureMedia,
  insertSiteEvent,
  invokeSiteEventAnalysis,
  lookupSiteEventCloser,
  uploadSiteEventMedia,
  type SiteEventErrorKind,
} from './siteEvents';

let currentUserId: string | null = null;
let draining = false;
let drainAgainRequested = false;
let appStateSub: { remove: () => void } | null = null;
let networkSub: { remove: () => void } | null = null;

/**
 * The entries a drain step or a "Coba lagi" is currently mid-write on.
 *
 * saveEntry is a blind whole-record overwrite, so without this a double-tapped
 * "Coba lagi" could write its pre-tap snapshot back AFTER the drain delivered
 * the report and purged it - resurrecting an entry whose local files are
 * already gone. The next load would find them missing, flag the entry
 * unrecoverable, and tell the supervisor "Laporan tidak bisa dikirim; buang
 * dan laporkan ulang" about a report that DID land. The re-file would carry a
 * fresh id, so the app's own advice would be what put two records of one
 * observation on the server. Both writers take this lock, and retryQueueEntry
 * re-reads the entry inside it, so a stale snapshot is never written.
 */
const inFlight = new Set<string>();

/**
 * The last network state we were told about. `lastConnected` is the edge
 * detector for the network trigger (only false/unknown → true starts a pass);
 * `lastInternetReachable === false` means the device is attached to something
 * that is not carrying traffic - a captive-portal Wi-Fi, a dead cell - where
 * every attempt fails for a reason that has nothing to do with the report.
 */
let lastConnected: boolean | null = null;
let lastInternetReachable: boolean | null = null;

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
  // A request left over from the signed-out user must not decide whether the
  // NEXT user's queue gets drained (drain's finally re-arms on it), and the
  // network edge detector has to start from "unknown" so the first connected
  // event after a handover still counts as an edge.
  drainAgainRequested = false;
  lastConnected = null;
  lastInternetReachable = null;
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
 *
 * The entry is re-read INSIDE the lock, so the second of two rapid taps
 * either finds the lock held (the drain owns the entry; asking for a drain is
 * all that is left to do) or takes it and finds the entry already delivered
 * and gone. Neither writes the snapshot it read before the drain ran.
 */
export async function retryQueueEntry(userId: string, entryId: string): Promise<void> {
  if (inFlight.has(entryId)) {
    triggerDrain();
    return;
  }
  inFlight.add(entryId);
  try {
    const entry = (await loadQueue(userId)).find((e) => e.id === entryId);
    if (!entry) return; // delivered and purged while we waited: nothing to resurrect
    await saveEntry(retryEntry(entry, new Date().toISOString()));
  } finally {
    inFlight.delete(entryId);
  }
  triggerDrain();
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active') triggerDrain();
}

/**
 * Edge-triggered, not level-triggered. Android fires this listener on every
 * transport and signal change, and each event that lands between passes costs
 * a full loadQueue (an orphan sweep, a getAllKeys, a read per entry, a stat
 * per pending file) - a repeated, wholly wasted disk scan while a supervisor
 * walks a site. Only false-or-unknown → true starts a pass.
 *
 * `isInternetReachable === false` is the captive-portal case: attached to a
 * network that carries nothing. Starting a pass there would fail every step
 * for a reason that has nothing to do with the report. Only `=== false`
 * counts as a negative answer, since the field is optional.
 */
function handleNetworkChange(state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }): void {
  const connected = state.isConnected === true;
  const wasConnected = lastConnected;
  lastConnected = connected;
  lastInternetReachable = state.isInternetReachable ?? null;
  if (!connected || wasConnected === true) return;
  if (state.isInternetReachable === false) return;
  triggerDrain();
}

/**
 * One native call per pass, never trusted enough to stop the queue: a probe
 * that throws or is unavailable answers "usable" and the pass runs, because
 * a failed probe is not evidence of no signal.
 *
 * Deliberately does NOT write lastConnected: that variable is the listener's
 * own edge detector, and priming it from a probe would swallow the very next
 * connected event - the one that means "signal is back, drain now".
 */
async function hasUsableConnection(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** True only when the device has told us, positively, that nothing is getting through. */
function deviceSaysOffline(): boolean {
  return lastConnected === false || lastInternetReachable === false;
}

/**
 * Kept as belt-and-braces rather than removed now that expo-network is
 * installed and `addNetworkStateListener` is confirmed present
 * (node_modules/expo-network/build/Network.d.ts): the package is an OTA-able
 * dependency, and a missing export should degrade to "no network-regained
 * trigger" - the foreground and post-capture triggers still cover the same
 * ground on a short delay - rather than crash the app at sign-in.
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
      // Asked before any entry is touched, so a pass started while the device
      // is offline burns none of the five attempts an entry gets.
      if (!(await hasUsableConnection())) return;
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
    // A shared-phone handover (A signs out, B signs in) leaves B's coalesced
    // request behind: the loop above exits on `currentUserId !== userId`, or
    // returns outright from inside the for, without ever serving it. Re-arm
    // here so B's queue - reports carried over from B's last shift - drains
    // now rather than waiting for a network event or B's next capture.
    if (drainAgainRequested && currentUserId) {
      drainAgainRequested = false;
      void drain();
    }
  }
}

async function processEntry(userId: string, start: CaptureQueueEntry): Promise<void> {
  if (inFlight.has(start.id)) return; // a "Coba lagi" is mid-write for this entry; next pass
  inFlight.add(start.id);
  try {
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
        entry = recordStepFailure(entry, step, err);
        await saveEntry(entry);
        return;
      }
      await saveEntry(entry);
    }
    if (entry.state === 'done') {
      await removeEntry(userId, entry.id);
    }
  } finally {
    inFlight.delete(start.id);
  }
}

/**
 * A step that failed while the device itself says nothing is getting through
 * is evidence about the signal, not about the report. It is still recorded -
 * the supervisor should see what happened, and the backoff clock should still
 * move - but it does not count toward the five strikes that put a report on
 * the "Perlu perhatian" list, so walking through a dead spot five times never
 * asks a supervisor to act on a report with nothing wrong with it.
 *
 * A permanent refusal is exempt from the exemption: it reached the server and
 * came back with a decision, so the offline reading cannot explain it.
 */
function recordStepFailure(entry: CaptureQueueEntry, step: QueueAction, err: unknown): CaptureQueueEntry {
  const kind = err instanceof StepFailure ? err.kind : 'transient';
  const failed = recordFailure(entry, describeStepError(step, err), new Date().toISOString(), kind);
  if (kind === 'permanent' || !deviceSaysOffline()) return failed;
  return { ...failed, consecutiveFailures: entry.consecutiveFailures, needsAttention: entry.needsAttention };
}

/** Carries tools/siteEvents.ts's `kind` from the step that failed to the machine's failure accounting. */
class StepFailure extends Error {
  readonly kind: SiteEventErrorKind;

  constructor(message: string, kind: SiteEventErrorKind | undefined) {
    super(message);
    this.name = 'StepFailure';
    this.kind = kind ?? 'transient';
  }
}

async function runStep(userId: string, entry: CaptureQueueEntry, step: QueueAction): Promise<CaptureQueueEntry> {
  const now = new Date().toISOString();
  switch (step.kind) {
    case 'upload': {
      const item = entry.media.find((m) => m.id === step.mediaId);
      if (!item) return markUploaded(entry, step.mediaId, null, now); // defensive; nextStep only asks for media that exists
      // A close job's media belongs in its EVENT's folder, not under the job id:
      // 097's path guard refuses a media row outside site-events/{projectId}/{eventId}/.
      const result = await uploadSiteEventMedia({ id: mediaCarrierId(entry), projectId: entry.projectId, media: [toLocalMedia(item)] });
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markUploaded(entry, item.id, result.bytesById[item.id] ?? null, now);
    }
    case 'insert': {
      const job = asCapture(entry, step);
      const result = await insertSiteEvent(toNewSiteEvent(job), bytesById(job));
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markInserted(job, now);
    }
    case 'invoke': {
      const job = asCapture(entry, step);
      try {
        const result = await invokeSiteEventAnalysis(job.id, { workGroupNames: job.workGroupNames });
        if (!result.ok) {
          console.warn('[captureQueueWorker] analysis deferred for', job.id, result.code, result.error);
        }
      } catch (err) {
        console.warn('[captureQueueWorker] analysis invoke failed for', job.id, (err as Error).message);
      }
      return markAnalysisRequested(job, now);
    }
    case 'insert_media': {
      const job = asClose(entry, step);
      const result = await insertClosureMedia(
        { id: job.eventId, projectId: job.projectId, media: job.media.map(toLocalMedia) },
        bytesById(job),
      );
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markClosureMediaInserted(job, now);
    }
    case 'close': {
      const job = asClose(entry, step);
      const result = await closeSiteEventRpc(job.eventId, job.note);
      // Somebody closed it first. An outcome, not a failure: no strike, no
      // lastError, and nextStep never asks for the RPC again (closure spec §4.4).
      if ('notOpen' in result) return markCloseOutcome(job, 'not_open', now);
      if ('error' in result) throw new StepFailure(result.error, result.kind);
      return markCloseOutcome(job, 'closed', now);
    }
    case 'lookup_closer': {
      const job = asClose(entry, step);
      const result = await lookupSiteEventCloser(job.eventId);
      if ('error' in result) throw new StepFailure(result.error, result.kind);
      return markClosedElsewhere(job, result, now);
    }
    case 'cleanup': {
      try {
        await deleteLocalMedia(userId, entry.id);
      } catch (err) {
        // The server already has what this job delivered by the time cleanup
        // runs. A locked file or an unmounted SD card must not re-label it as
        // "menunggu sinyal" - which is what recording this as a step failure
        // would do, and there would be no way out of it: discardEntryLocally
        // refuses a delivered job, and "Coba lagi" would only re-run the same
        // failing delete. The store's orphan sweep collects the directory on a
        // later loadQueue instead.
        console.warn('[captureQueueWorker] local cleanup failed for', entry.id, (err as Error).message);
      }
      return markCleanedUp(entry, now);
    }
    case 'none':
      return entry;
  }
}

/** nextStep never mixes kinds; a mismatch here is a bug, reported permanently rather than retried forever. */
function asCapture(entry: CaptureQueueEntry, step: QueueAction): CaptureJob {
  if (entry.kind !== 'capture') throw new StepFailure(`Langkah ${step.kind} bukan untuk penutupan kejadian.`, 'permanent');
  return entry;
}

function asClose(entry: CaptureQueueEntry, step: QueueAction): CloseJob {
  if (entry.kind !== 'close') throw new StepFailure(`Langkah ${step.kind} bukan untuk laporan baru.`, 'permanent');
  return entry;
}

const STEP_LABEL: Record<Exclude<QueueAction['kind'], 'none'>, string> = {
  upload: 'Unggah berkas',
  insert: 'Simpan kejadian',
  invoke: 'Jalankan analisis',
  insert_media: 'Simpan foto penutupan',
  close: 'Tandai selesai',
  lookup_closer: 'Baca status kejadian',
  cleanup: 'Bersihkan berkas lokal',
};

function describeStepError(step: QueueAction, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const label = step.kind === 'none' ? 'Langkah' : STEP_LABEL[step.kind];
  return `${label} gagal: ${message}`;
}
