import {
  CAPTURE_QUEUE_ENTRY_VERSION,
  MAX_CONSECUTIVE_FAILURES,
  IllegalQueueTransitionError,
  assertTransition,
  attentionCount,
  backoffMs,
  beginAttempt,
  bytesById,
  draftReadyCount,
  enqueueCapture,
  enqueueClose,
  isCloseStatusUnreadable,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  markInserted,
  markUnrecoverable,
  markUploaded,
  mediaCarrierId,
  nextStep,
  recordFailure,
  retryEntry,
  toNewSiteEvent,
  upgradeEntry,
  waitingCount,
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
  type QueueState,
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

const fresh = (): CaptureJob => enqueueCapture({ event: event(), ownerId: 'u1', workGroupNames: ['Finishing Lantai 2'], nowIso: NOW });

describe('enqueueCapture', () => {
  it('starts queued, no progress, both media not yet uploaded', () => {
    const e = fresh();
    expect(e).toMatchObject({
      id: 'e1', version: 2, kind: 'capture', ownerId: 'u1', state: 'queued', eventInserted: false, analysisRequested: false,
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

function recordFailures<E extends CaptureQueueEntry>(entry: E, n: number): E {
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

describe('failure classification', () => {
  it('defaults to transient, keeping two-argument behaviour exactly as before', () => {
    const e = recordFailure(fresh(), 'jaringan turun', NOW);
    expect(e).toMatchObject({ consecutiveFailures: 1, needsAttention: false, lastFailureKind: 'transient' });
  });

  it('flags a permanent failure for attention immediately, without waiting for 5 strikes', () => {
    const e = recordFailure(fresh(), 'Proyek tidak lagi ditugaskan.', NOW, 'permanent');
    expect(e).toMatchObject({
      state: 'failed', consecutiveFailures: 1, needsAttention: true, lastFailureKind: 'permanent',
    });
  });

  it('never deletes the entry on a permanent failure - it stays put like any other', () => {
    const e = recordFailure(fresh(), 'Akses ditolak.', NOW, 'permanent');
    expect(e.id).toBe('e1');
    expect(e.media).toHaveLength(2);
    expect(nextStep(e)).toEqual({ kind: 'none' });
  });

  it('a subsequent success clears lastFailureKind along with the rest of the failure bookkeeping', () => {
    let e = recordFailure(fresh(), 'timeout', NOW, 'permanent');
    e = markUploaded(e, 'm1', 10, NOW);
    expect(e.lastFailureKind).toBeUndefined();
  });
});

describe('markUnrecoverable precondition', () => {
  it('throws once the event is already inserted, instead of silently discarding a server-known event', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    expect(() => markUnrecoverable(e, 'Berkas lokal hilang.')).toThrow();
  });

  it('still works pre-insert, deriving state the same way the other mutators do', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    const gone = markUnrecoverable(e, 'Berkas lokal hilang.');
    expect(gone).toMatchObject({ state: 'uploading', unrecoverable: true, needsAttention: true, lastError: 'Berkas lokal hilang.' });
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

describe('assertTransition exhaustiveness', () => {
  const QUEUE_STATES: QueueState[] = ['queued', 'uploading', 'analyzing', 'draft_ready', 'closing', 'done', 'superseded', 'failed'];

  // Hand-copied from ALLOWED_TRANSITIONS in captureQueue.ts, deliberately NOT
  // imported from there - the point of this table is to catch a future,
  // accidental loosening of the real one (e.g. `queued` growing a stray
  // `'done'` entry). Importing the real table would make this test tautological.
  const EXPECTED_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
    queued: ['uploading', 'failed'],
    uploading: ['uploading', 'analyzing', 'failed'],
    analyzing: ['analyzing', 'draft_ready', 'failed'],
    draft_ready: ['draft_ready', 'done', 'failed'],
    failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
    done: [],
    closing: [],
    superseded: [],
  };

  const allPairs: Array<[QueueState, QueueState]> = QUEUE_STATES.flatMap((from) =>
    QUEUE_STATES.map((to): [QueueState, QueueState] => [from, to]),
  );

  it.each(allPairs)('from %s to %s', (from, to) => {
    // A self-transition is always a no-op, regardless of the table (assertTransition
    // returns early on from === to before consulting ALLOWED_TRANSITIONS at all).
    const allowed = from === to || EXPECTED_TRANSITIONS[from].includes(to);
    if (allowed) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertTransition(from, to)).toThrow(IllegalQueueTransitionError);
    }
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

  it('refuses to rebuild a NewSiteEvent once local files are already cleaned up', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    e = markAnalysisRequested(e, NOW);
    e = markCleanedUp(e, NOW);
    expect(() => toNewSiteEvent(e)).toThrow();
  });
});

describe('versioning / upgradeEntry', () => {
  /** A record exactly as a v1 build wrote it: no `kind`, version 1. */
  const v1Record = (): Record<string, unknown> => {
    const { kind: _kind, ...rest } = fresh();
    return { ...rest, version: 1 };
  };

  it('exports the current version as 2', () => {
    expect(CAPTURE_QUEUE_ENTRY_VERSION).toBe(2);
  });

  it('upgrades a v1 record to version 2, kind capture, keeping every field', () => {
    const raw = v1Record();
    expect(upgradeEntry(raw)).toEqual({ ...raw, version: 2, kind: 'capture' });
  });

  it('treats a legacy record with no version field as v1 and upgrades it the same way', () => {
    const { version: _version, ...legacy } = v1Record();
    expect(upgradeEntry(legacy)).toEqual({ ...legacy, version: 2, kind: 'capture' });
  });

  it('sets kind on a v1 record, never reads it from the record', () => {
    expect(upgradeEntry({ ...v1Record(), kind: 'close' })).toMatchObject({ kind: 'capture', version: 2 });
  });

  it('round-trips a well-formed v2 capture and a v2 close unchanged', () => {
    const capture = fresh();
    expect(upgradeEntry(capture)).toEqual(capture);
    const close = freshClose();
    expect(upgradeEntry(close)).toEqual(close);
  });

  it('refuses a future version, an unknown kind, and a close record missing eventId', () => {
    expect(upgradeEntry({ ...fresh(), version: 3 })).toBeNull();
    expect(upgradeEntry({ ...fresh(), kind: 'reopen' })).toBeNull();
    const { eventId: _eventId, ...noEvent } = freshClose();
    expect(upgradeEntry(noEvent)).toBeNull();
  });

  it('refuses a close record carrying two photos or a malformed outcome', () => {
    const close = freshClose();
    expect(upgradeEntry({ ...close, media: [...close.media, { ...close.media[0], id: 'm9' }] })).toBeNull();
    expect(upgradeEntry({ ...close, closeOutcome: 'maybe' })).toBeNull();
    expect(upgradeEntry({ ...close, closedElsewhere: { closedByName: 'A' } })).toBeNull();
  });

  it('refuses non-objects and objects missing a required field', () => {
    expect(upgradeEntry(null)).toBeNull();
    expect(upgradeEntry(undefined)).toBeNull();
    expect(upgradeEntry('e1')).toBeNull();
    expect(upgradeEntry({})).toBeNull();
    const e = fresh();
    const { id: _id, ...missingId } = e;
    expect(upgradeEntry(missingId)).toBeNull();
  });

  it('refuses an entry whose media array is corrupted', () => {
    const e = fresh();
    expect(upgradeEntry({ ...e, media: [{ id: 'm1' }] })).toBeNull();
  });

  it('refuses an entry with an unrecognised state value', () => {
    const e = fresh();
    expect(upgradeEntry({ ...e, state: 'exploding' })).toBeNull();
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
});

// ─── Close jobs (closure spec 2026-09-26 §4) ─────────────────────────────────

const closurePhoto = {
  id: 'cm1', localUri: 'file:///q/job1/cm1.jpg', kind: 'photo' as const, role: 'closure' as const,
  mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW,
};

function freshClose(over: { photo?: boolean; note?: string } = {}): CloseJob {
  return enqueueClose({
    id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian',
    note: over.note ?? '  Sudah ditambal  ', closurePhoto: over.photo === false ? null : closurePhoto, nowIso: NOW,
  });
}

describe('enqueueClose', () => {
  it('starts queued with its own id, the event id kept apart, the note trimmed and the photo as a closure photo', () => {
    const job = freshClose();
    expect(job).toMatchObject({
      version: 2, kind: 'close', id: 'job1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian',
      note: 'Sudah ditambal', state: 'queued', mediaInserted: false, closeOutcome: null, closedElsewhere: null,
      localCleanedUp: false, attempts: 0, needsAttention: false, unrecoverable: false,
    });
    expect(job.media).toEqual([{ ...closurePhoto, uploaded: false, bytes: null }]);
  });

  it('stores a blank note as null, exactly what the RPC receives', () => {
    expect(freshClose({ note: ' \n\t ' }).note).toBeNull();
  });

  it('forces kind photo and role closure on whatever the form handed in', () => {
    const job = enqueueClose({
      id: 'j', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'T', note: '',
      closurePhoto: { ...closurePhoto, role: 'context' }, nowIso: NOW,
    });
    expect(job.media[0]).toMatchObject({ kind: 'photo', role: 'closure' });
  });

  it("uploads into the event's folder, not the job's", () => {
    expect(mediaCarrierId(freshClose())).toBe('ev1');
    expect(mediaCarrierId(fresh())).toBe('e1');
  });
});

describe('nextStep for a close job', () => {
  it('with a photo: upload -> insert_media -> close -> cleanup -> done', () => {
    let j = freshClose();
    expect(nextStep(j)).toEqual({ kind: 'upload', mediaId: 'cm1' });
    j = markUploaded(j, 'cm1', 2048, NOW);
    expect(j.state).toBe('uploading');
    expect(nextStep(j)).toEqual({ kind: 'insert_media' });
    j = markClosureMediaInserted(j, NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'close' });
    j = markCloseOutcome(j, 'closed', NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
    j = markCleanedUp(j, NOW);
    expect(j.state).toBe('done');
    expect(nextStep(j)).toEqual({ kind: 'none' });
  });

  it('without a photo: straight to close', () => {
    let j = freshClose({ photo: false });
    expect(nextStep(j)).toEqual({ kind: 'close' });
    j = markCloseOutcome(j, 'closed', NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
  });

  it('through not_open: no failure recorded, the closer read once, the RPC never asked again, ends superseded', () => {
    let j = markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW);
    expect(j).toMatchObject({ closeOutcome: 'not_open', consecutiveFailures: 0, lastError: null, needsAttention: false });
    expect(nextStep(j)).toEqual({ kind: 'lookup_closer' });
    j = markClosedElsewhere(j, { closedByName: 'Budi', closedAt: '2026-09-17T07:05:00.000Z' }, NOW);
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
    j = markCleanedUp(j, NOW);
    expect(j.state).toBe('superseded');
    expect(j.closedElsewhere).toEqual({ closedByName: 'Budi', closedAt: '2026-09-17T07:05:00.000Z' });
    expect(nextStep(j)).toEqual({ kind: 'none' });
  });

  it('a failed lookup resumes at the lookup, not at the RPC', () => {
    let j = markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW);
    j = recordFailure(j, 'Baca status kejadian gagal: jaringan turun', NOW);
    expect(j.state).toBe('failed');
    const retried = retryEntry(j, NOW);
    expect(retried.state).toBe('closing');
    expect(nextStep(retried)).toEqual({ kind: 'lookup_closer' });
  });
});

describe('superseded is terminal, closing is waiting', () => {
  const superseded = (): CloseJob => markCleanedUp(
    markClosedElsewhere(markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW), { closedByName: null, closedAt: NOW }, NOW),
    NOW,
  );

  it('a superseded job is neither ready to attempt nor counted as waiting', () => {
    const j = superseded();
    expect(isReadyToAttempt(j, Date.parse(NOW) + 999_999)).toBe(false);
    expect(waitingCount([j])).toBe(0);
  });

  it('a close job that is still closing counts as waiting for signal', () => {
    const j = markClosureMediaInserted(markUploaded(freshClose(), 'cm1', 1, NOW), NOW);
    expect(j.state).toBe('closing');
    expect(waitingCount([j])).toBe(1);
  });
});

describe('markUnrecoverable per kind', () => {
  it('flags a close job whose photo is not uploaded yet', () => {
    const j = markUnrecoverable(freshClose(), 'Foto penutupan hilang.');
    expect(j).toMatchObject({ unrecoverable: true, needsAttention: true, lastError: 'Foto penutupan hilang.', state: 'queued' });
  });

  it('throws once the close photo is uploaded, and for a close job with no photo at all', () => {
    expect(() => markUnrecoverable(markUploaded(freshClose(), 'cm1', 1, NOW), 'x')).toThrow();
    expect(() => markUnrecoverable(freshClose({ photo: false }), 'x')).toThrow();
  });

  it('still keys a capture job on eventInserted', () => {
    expect(markUnrecoverable(fresh(), 'x').unrecoverable).toBe(true);
    const inserted = markInserted(markUploaded(markUploaded(fresh(), 'm1', 1, NOW), 'm2', 1, NOW), NOW);
    expect(() => markUnrecoverable(inserted, 'x')).toThrow();
  });
});

/**
 * NOT_OPEN, then the status read refused for good (the row is hidden from this
 * user, or its status is not done): no step can ever send this job, and
 * nothing it could say about who closed the event would be true.
 */
describe('isCloseStatusUnreadable', () => {
  const notOpen = (): CloseJob => markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW);

  it('holds after NOT_OPEN and a permanent status-read failure', () => {
    expect(isCloseStatusUnreadable(recordFailure(notOpen(), 'x', NOW, 'permanent'))).toBe(true);
  });

  it('does not hold while the status read may still succeed, or before any outcome', () => {
    expect(isCloseStatusUnreadable(notOpen())).toBe(false);
    expect(isCloseStatusUnreadable(recordFailure(notOpen(), 'x', NOW, 'transient'))).toBe(false);
    expect(isCloseStatusUnreadable(recordFailure(freshClose({ photo: false }), 'x', NOW, 'permanent'))).toBe(false);
  });
});

describe('close transition table, exhaustively', () => {
  const STATES: QueueState[] = ['queued', 'uploading', 'analyzing', 'draft_ready', 'closing', 'done', 'superseded', 'failed'];
  // Hand-copied from CLOSE_TRANSITIONS in captureQueue.ts, deliberately NOT
  // imported, for the same reason as the capture table above.
  const EXPECTED: Record<QueueState, ReadonlyArray<QueueState>> = {
    queued: ['uploading', 'closing', 'failed'],
    uploading: ['uploading', 'closing', 'failed'],
    closing: ['closing', 'done', 'superseded', 'failed'],
    failed: ['queued', 'uploading', 'closing'],
    done: [],
    superseded: [],
    analyzing: [],
    draft_ready: [],
  };
  const pairs: Array<[QueueState, QueueState]> = STATES.flatMap((from) =>
    STATES.map((to): [QueueState, QueueState] => [from, to]),
  );

  it.each(pairs)('from %s to %s', (from, to) => {
    const allowed = from === to || EXPECTED[from].includes(to);
    if (allowed) {
      expect(() => assertTransition(from, to, 'close')).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, 'close')).toThrow(IllegalQueueTransitionError);
    }
  });
});
