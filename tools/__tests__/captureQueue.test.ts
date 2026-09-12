import {
  MAX_CONSECUTIVE_FAILURES,
  IllegalQueueTransitionError,
  attentionCount,
  backoffMs,
  beginAttempt,
  bytesById,
  draftReadyCount,
  enqueueCapture,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markInserted,
  markUnrecoverable,
  markUploaded,
  nextStep,
  queueBadgeText,
  recordFailure,
  retryEntry,
  toNewSiteEvent,
  waitingCount,
  type CaptureQueueEntry,
} from '../captureQueue';
import type { NewSiteEvent } from '../siteEvents';

const NOW = '2026-09-11T03:00:00.000Z';

const event = (over: Partial<NewSiteEvent> = {}): NewSiteEvent => ({
  id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: 'B', rawText: 'Nat retak',
  capturedAt: '2026-09-11T02:00:00.000Z',
  media: [
    { id: 'm1', localUri: 'file:///q/e1/m1.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' },
    { id: 'm2', localUri: 'file:///q/e1/m2.m4a', kind: 'audio', role: 'audio', mimeType: 'audio/mp4', ext: 'm4a', durationS: 8.2, sortOrder: 0, capturedAt: '2026-09-11T02:00:05.000Z' },
  ],
  ...over,
});

const fresh = (): CaptureQueueEntry => enqueueCapture({ event: event(), ownerId: 'u1', workGroupNames: ['Finishing Lantai 2'], nowIso: NOW });

describe('enqueueCapture', () => {
  it('starts queued, no progress, both media not yet uploaded', () => {
    const e = fresh();
    expect(e).toMatchObject({
      id: 'e1', ownerId: 'u1', state: 'queued', eventInserted: false, analysisRequested: false,
      localCleanedUp: false, attempts: 0, consecutiveFailures: 0, needsAttention: false, unrecoverable: false,
    });
    expect(e.media.map((m) => [m.id, m.uploaded, m.bytes])).toEqual([['m1', false, null], ['m2', false, null]]);
  });
});

describe('nextStep', () => {
  it('walks upload (one file at a time) -> insert -> invoke -> cleanup -> none', () => {
    let e = fresh();
    expect(nextStep(e)).toEqual({ kind: 'upload', mediaId: 'm1' });
    e = markUploaded(e, 'm1', 1234, NOW);
    expect(nextStep(e)).toEqual({ kind: 'upload', mediaId: 'm2' });
    e = markUploaded(e, 'm2', 5678, NOW);
    expect(nextStep(e)).toEqual({ kind: 'insert' });
    e = markInserted(e, NOW);
    expect(nextStep(e)).toEqual({ kind: 'invoke' });
    e = markAnalysisRequested(e, NOW);
    expect(nextStep(e)).toEqual({ kind: 'cleanup' });
    e = markCleanedUp(e, NOW);
    expect(e.state).toBe('done');
    expect(nextStep(e)).toEqual({ kind: 'none' });
  });

  it('gives none for a flagged or unrecoverable entry, without inspecting progress', () => {
    const attention = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);
    expect(nextStep(attention)).toEqual({ kind: 'none' });
    const gone = markUnrecoverable(fresh(), 'Berkas lokal hilang.');
    expect(nextStep(gone)).toEqual({ kind: 'none' });
  });
});

function recordFailures(entry: CaptureQueueEntry, n: number): CaptureQueueEntry {
  let e = entry;
  for (let i = 0; i < n; i++) e = recordFailure(e, `gagal ${i}`, NOW);
  return e;
}

describe('state derives from progress, never set directly', () => {
  it('moves to uploading the moment any one file lands, not only when all do', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    expect(e.state).toBe('uploading');
  });

  it('reaches analyzing right after insert, before invoke is attempted', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    expect(e.state).toBe('analyzing');
  });

  it('reaches draft_ready once analysis was requested, even before cleanup runs', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    e = markAnalysisRequested(e, NOW);
    expect(e.state).toBe('draft_ready');
    expect(e.localCleanedUp).toBe(false);
  });
});

describe('failure accounting', () => {
  it('counts consecutive failures and flags for attention at exactly 5, never before', () => {
    let e = fresh();
    for (let i = 1; i <= 4; i++) {
      e = recordFailure(e, `jaringan turun ${i}`, NOW);
      expect(e.needsAttention).toBe(false);
      expect(e.consecutiveFailures).toBe(i);
    }
    e = recordFailure(e, 'jaringan turun 5', NOW);
    expect(e.needsAttention).toBe(true);
    expect(e.consecutiveFailures).toBe(5);
    expect(e.state).toBe('failed');
    expect(e.lastError).toBe('jaringan turun 5');
  });

  it('never removes or discards the entry on failure, however many times', () => {
    const e = recordFailures(fresh(), 20);
    expect(e.consecutiveFailures).toBe(20);
    expect(e.media).toHaveLength(2);
    expect(e.id).toBe('e1');
  });

  it('a success anywhere resets the consecutive counter and clears the flag', () => {
    let e = recordFailures(fresh(), 4);
    e = markUploaded(e, 'm1', 10, NOW);
    expect(e).toMatchObject({ consecutiveFailures: 0, needsAttention: false, lastError: null });
  });

  it('"Coba lagi" clears the flag and resumes exactly where progress left off', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = recordFailures(e, MAX_CONSECUTIVE_FAILURES);
    expect(e.needsAttention).toBe(true);
    const retried = retryEntry(e, '2026-09-11T04:00:00.000Z');
    expect(retried).toMatchObject({ state: 'uploading', needsAttention: false, consecutiveFailures: 0, lastError: null });
    expect(nextStep(retried)).toEqual({ kind: 'upload', mediaId: 'm2' });
  });

  it('retryEntry is a no-op on an unrecoverable entry', () => {
    const e = markUnrecoverable(fresh(), 'Berkas lokal hilang.');
    expect(retryEntry(e, NOW)).toBe(e);
  });
});

describe('illegal transitions', () => {
  it('refuses to go backwards from a further-along state', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    // Simulate a caller that forgot insert happened and re-asserts 'uploading' progress only.
    expect(() => markCleanedUp({ ...e, analysisRequested: false, localCleanedUp: false, eventInserted: false }, NOW))
      .toThrow(IllegalQueueTransitionError);
  });
});

describe('backoff', () => {
  it('doubles from 30s, capped at 15 minutes', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(4)).toBe(240_000);
    expect(backoffMs(5)).toBe(480_000);
    expect(backoffMs(10)).toBe(900_000);
  });

  it('is ready immediately when never attempted, and only after backoff elapses when failed', () => {
    let e = fresh();
    expect(isReadyToAttempt(e, Date.parse(NOW))).toBe(true);
    e = recordFailure(e, 'timeout', NOW);
    const justAfter = Date.parse(NOW) + 1000;
    const afterBackoff = Date.parse(NOW) + backoffMs(1);
    expect(isReadyToAttempt(e, justAfter)).toBe(false);
    expect(isReadyToAttempt(e, afterBackoff)).toBe(true);
  });

  it('is never ready when done, flagged, or unrecoverable', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 1, NOW);
    e = markUploaded(e, 'm2', 1, NOW);
    e = markInserted(e, NOW);
    e = markAnalysisRequested(e, NOW);
    e = markCleanedUp(e, NOW);
    expect(isReadyToAttempt(e, Date.parse(NOW) + 999_999)).toBe(false);
    const flagged = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);
    expect(isReadyToAttempt(flagged, Date.parse(NOW) + 999_999)).toBe(false);
    const gone = markUnrecoverable(fresh(), 'hilang');
    expect(isReadyToAttempt(gone, Date.parse(NOW) + 999_999)).toBe(false);
  });
});

describe('beginAttempt', () => {
  it('bumps attempts and lastAttemptAt without touching progress or state', () => {
    const e = fresh();
    const started = beginAttempt(e, NOW);
    expect(started).toMatchObject({ attempts: 1, lastAttemptAt: NOW, state: 'queued' });
    expect(beginAttempt(started, NOW).attempts).toBe(2);
  });
});

describe('conversions', () => {
  it('rebuilds a NewSiteEvent from progress, valid up to cleanup', () => {
    const e = fresh();
    expect(toNewSiteEvent(e)).toEqual(event());
  });

  it('reads back the bytes recorded at upload time', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 111, NOW);
    e = markUploaded(e, 'm2', 222, NOW);
    expect(bytesById(e)).toEqual({ m1: 111, m2: 222 });
  });
});

describe('Beranda selectors', () => {
  it('counts waiting as queued, uploading, analyzing or failed; ready as draft_ready; attention as flagged', () => {
    const queued = fresh();
    let uploading = fresh();
    uploading = markUploaded(uploading, 'm1', 1, NOW);
    let ready = fresh();
    ready = markUploaded(ready, 'm1', 1, NOW);
    ready = markUploaded(ready, 'm2', 1, NOW);
    ready = markInserted(ready, NOW);
    ready = markAnalysisRequested(ready, NOW);
    const flagged = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);

    const all = [queued, uploading, ready, flagged];
    expect(waitingCount(all)).toBe(3); // queued, uploading, flagged(failed)
    expect(draftReadyCount(all)).toBe(1); // ready
    expect(attentionCount(all)).toBe(1); // flagged
  });

  it('builds the exact Indonesian badge line, hiding whichever part is zero, and null when both are', () => {
    expect(queueBadgeText([])).toBeNull();
    const waitingOnly = [fresh()];
    expect(queueBadgeText(waitingOnly)).toBe('Antrean: 1 menunggu sinyal');
    let ready = fresh();
    ready = markUploaded(ready, 'm1', 1, NOW);
    ready = markUploaded(ready, 'm2', 1, NOW);
    ready = markInserted(ready, NOW);
    ready = markAnalysisRequested(ready, NOW);
    expect(queueBadgeText([ready])).toBe('Antrean: 1 draf siap dikonfirmasi');
    expect(queueBadgeText([fresh(), ready])).toBe('Antrean: 1 menunggu sinyal, 1 draf siap dikonfirmasi');
  });
});
