/**
 * The drain loop's job is orchestration, not logic: the state machine
 * (captureQueue.ts) and the persistence (captureQueueStore.ts) are already
 * separately tested, so what matters here is call ORDER, that a failed step
 * stops only its own entry, that invoke never blocks cleanup, that a
 * concurrent trigger does not run two overlapping passes, and that signing
 * out stops the worker touching that user's entries again.
 */
let appStateHandler: ((state: string) => void) | null = null;
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      appStateHandler = cb;
      return { remove: jest.fn(() => { appStateHandler = null; }) };
    }),
  },
}));

type NetState = { isConnected?: boolean | null; isInternetReachable?: boolean | null };
let networkHandler: ((state: NetState) => void) | null = null;
let networkListenerAvailable = true;
/** What getNetworkStateAsync answers the once-per-pass probe with. */
let probedState: NetState = { isConnected: true, isInternetReachable: true };
jest.mock(
  'expo-network',
  () => ({
    addNetworkStateListener: (cb: (state: NetState) => void) => {
      if (!networkListenerAvailable) return undefined; // simulates an SDK where the export is missing
      networkHandler = cb;
      return { remove: jest.fn(() => { networkHandler = null; }) };
    },
    getNetworkStateAsync: jest.fn(async () => probedState),
  }),
  { virtual: true },
);

const calls: string[] = [];
const store = new Map<string, import('../captureQueue').CaptureQueueEntry>();

jest.mock('../captureQueueStore', () => ({
  loadQueue: jest.fn(async (userId: string) => {
    calls.push(`loadQueue:${userId}`);
    return [...store.values()].filter((e) => e.ownerId === userId);
  }),
  saveEntry: jest.fn(async (entry: import('../captureQueue').CaptureQueueEntry) => {
    calls.push(`saveEntry:${entry.id}:${entry.state}`);
    store.set(entry.id, entry);
  }),
  removeEntry: jest.fn(async (userId: string, entryId: string) => {
    calls.push(`removeEntry:${entryId}`);
    store.delete(entryId);
  }),
  deleteLocalMedia: jest.fn(async (userId: string, entryId: string) => {
    calls.push(`deleteLocalMedia:${entryId}`);
  }),
}));

const upload = jest.fn();
const insert = jest.fn();
const invoke = jest.fn();
jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: (...args: unknown[]) => upload(...args),
  insertSiteEvent: (...args: unknown[]) => insert(...args),
  invokeSiteEventAnalysis: (...args: unknown[]) => invoke(...args),
}));

import { enqueueCapture, recordFailure, type CaptureQueueEntry } from '../captureQueue';
import { deleteLocalMedia } from '../captureQueueStore';
import {
  retryQueueEntry,
  startCaptureQueueWorker,
  stopCaptureQueueWorker,
  triggerDrain,
} from '../captureQueueWorker';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'u1';

const photo = (id: string, sortOrder: number, capturedAt: string) => ({
  id, localUri: `file:///q/${id}.jpg`, kind: 'photo' as const, role: sortOrder === 0 ? ('context' as const) : ('closeup' as const),
  mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder, capturedAt,
});

const event = (id: string, capturedAt: string, files = 1): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: 'B', rawText: null, capturedAt,
  media: Array.from({ length: files }, (_, i) => photo(`${id}-m${i + 1}`, i, capturedAt)),
});

function seed(id: string, createdAt: string, opts: { files?: number; owner?: string } = {}): CaptureQueueEntry {
  const owner = opts.owner ?? USER;
  const entry = enqueueCapture({
    event: event(id, createdAt, opts.files ?? 1),
    ownerId: owner,
    workGroupNames: [],
    nowIso: createdAt,
  });
  store.set(id, entry);
  return entry;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  store.clear();
  appStateHandler = null;
  networkHandler = null;
  networkListenerAvailable = true;
  probedState = { isConnected: true, isInternetReachable: true };
  upload.mockReset().mockResolvedValue({ bytesById: { 'e1-m1': 100 } });
  insert.mockReset().mockResolvedValue({});
  invoke.mockReset().mockResolvedValue({ ok: true, code: 'ANALYZED', status: 'draft' });
  stopCaptureQueueWorker();
});

afterEach(() => {
  stopCaptureQueueWorker();
});

describe('a full pass', () => {
  it('walks one entry through upload, insert, invoke, cleanup, and purges it once done', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalledWith({ id: 'e1', projectId: 'p1', media: [expect.objectContaining({ id: 'e1-m1' })] });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { 'e1-m1': 100 });
    expect(invoke).toHaveBeenCalledWith('e1', { workGroupNames: [] });
    expect(calls).toContain('deleteLocalMedia:e1');
    expect(calls).toContain('removeEntry:e1');
    expect(store.has('e1')).toBe(false);
  });

  it('processes entries oldest first', async () => {
    seed('e2', '2026-09-11T02:00:02.000Z');
    seed('e1', '2026-09-11T02:00:01.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();
    const order = calls.filter((c) => c.startsWith('saveEntry:')).map((c) => c.split(':')[1]);
    expect(order[0]).toBe('e1');
  });
});

describe('failure', () => {
  it('records the failure and moves on to the next entry, without touching insert', async () => {
    upload.mockResolvedValueOnce({ bytesById: {}, error: 'jaringan turun' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    expect(insert).not.toHaveBeenCalled();
    const saved = store.get('e1')!;
    expect(saved.state).toBe('failed');
    expect(saved.lastError).toMatch(/Unggah berkas gagal: jaringan turun/);
    expect(saved.consecutiveFailures).toBe(1);
  });

  it('a deferred or failed invoke never blocks cleanup', async () => {
    invoke.mockResolvedValueOnce({ ok: false, code: 'QUOTA_EXCEEDED', error: 'Kuota habis' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(calls).toContain('removeEntry:e1');
  });

  it('an invoke call that throws is also swallowed, not turned into a queue failure', async () => {
    invoke.mockRejectedValueOnce(new Error('network down'));
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(calls).toContain('removeEntry:e1');
  });
});

describe('skips entries that are not ready', () => {
  it('never asks the store to save a needsAttention entry', async () => {
    let flagged = seed('e1', '2026-09-11T02:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      upload.mockResolvedValueOnce({ bytesById: {}, error: 'gagal' });
      // Backoff is real wall-clock in the module (captureQueue.ts's
      // isReadyToAttempt takes an explicit `now`, but the worker always
      // passes Date.now()); back-date the stored attempt so each loop
      // iteration is immediately ready instead of waiting out 30s+ for real.
      flagged.lastAttemptAt = new Date(0).toISOString();
      store.set('e1', flagged);
      startCaptureQueueWorker(USER);
      // eslint-disable-next-line no-await-in-loop
      await flush();
      // eslint-disable-next-line no-await-in-loop
      await flush();
      stopCaptureQueueWorker();
      flagged = store.get('e1')!;
    }
    expect(flagged.needsAttention).toBe(true);
    calls.length = 0;
    startCaptureQueueWorker(USER);
    await flush();
    expect(calls.filter((c) => c.startsWith('saveEntry:'))).toEqual([]);
  });
});

describe('single-flight', () => {
  it('coalesces a trigger that arrives mid-drain into the pass already running, not a second overlapping one', async () => {
    let resolveUpload!: (v: { bytesById: Record<string, number>; error?: string }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush(); // loadQueue has run once, upload is now pending
    const loadsBeforeSecondTrigger = calls.filter((c) => c.startsWith('loadQueue:')).length;
    triggerDrain(); // arrives while the first pass is still awaiting upload
    resolveUpload({ bytesById: { 'e1-m1': 1 } });
    await flush();
    await flush();
    await flush();
    // The coalesced trigger causes at most one extra loadQueue at the end of
    // the running pass, never a second drain racing the first.
    const loadsAfter = calls.filter((c) => c.startsWith('loadQueue:')).length;
    expect(loadsAfter).toBeGreaterThan(loadsBeforeSecondTrigger);
    expect(calls).toContain('removeEntry:e1');
  });
});

describe('sign-out mid-drain', () => {
  it('stops touching the previous user once stopCaptureQueueWorker runs, mid-pass', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    seed('e2', '2026-09-11T02:00:01.000Z');
    let resolveUpload!: (v: { bytesById: Record<string, number>; error?: string }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    startCaptureQueueWorker(USER);
    await flush(); // e1's upload is in flight
    stopCaptureQueueWorker();
    resolveUpload({ bytesById: { 'e1-m1': 1 } });
    await flush();
    await flush();
    await flush();
    // e1's in-flight step is allowed to finish and save, but nothing beyond
    // that (e2, or e1's later steps) runs once signed out.
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('retryQueueEntry', () => {
  it('clears the flag and drains again, on the "Coba lagi" path', async () => {
    let entry = seed('e1', '2026-09-11T02:00:00.000Z');
    entry = recordFailure(entry, 'gagal', new Date(0).toISOString());
    entry = { ...entry, needsAttention: true, consecutiveFailures: 5 };
    store.set('e1', entry);
    startCaptureQueueWorker(USER); // the worker must already be running for triggerDrain to do anything

    await retryQueueEntry(USER, 'e1');
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalled();
    expect(calls).toContain('removeEntry:e1');
  });

  it('does nothing for an entry that no longer exists', async () => {
    await expect(retryQueueEntry(USER, 'ghost')).resolves.toBeUndefined();
    expect(calls.filter((c) => c.startsWith('saveEntry:'))).toEqual([]);
  });
});

describe('triggers', () => {
  it('drains again when the app returns to the foreground', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    const before = calls.filter((c) => c.startsWith('loadQueue:')).length;
    appStateHandler?.('active');
    await flush();
    expect(calls.filter((c) => c.startsWith('loadQueue:')).length).toBeGreaterThan(before);
  });

  it('drains again when the network reports connected', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    const before = calls.filter((c) => c.startsWith('loadQueue:')).length;
    networkHandler?.({ isConnected: true });
    await flush();
    expect(calls.filter((c) => c.startsWith('loadQueue:')).length).toBeGreaterThan(before);
  });

  it('degrades without crashing when expo-network has no listener export', async () => {
    networkListenerAvailable = false;
    expect(() => startCaptureQueueWorker(USER)).not.toThrow();
    expect(networkHandler).toBeNull();
  });

  it('starting twice for the same user does not resubscribe', async () => {
    const rn = require('react-native');
    startCaptureQueueWorker(USER);
    const callsAfterFirst = (rn.AppState.addEventListener as jest.Mock).mock.calls.length;
    startCaptureQueueWorker(USER);
    expect((rn.AppState.addEventListener as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('a retry cannot resurrect a report the drain delivered (C1)', () => {
  /**
   * saveEntry is a blind whole-record overwrite, so a "Coba lagi" that reads
   * the entry, waits, and writes its snapshot back after the drain delivered
   * and purged that entry would put a zombie in storage - pointing at media
   * files that are already deleted. The next load flags it unrecoverable and
   * tells the supervisor to buang dan laporkan ulang: the app's own advice
   * producing a duplicate of a report that DID land.
   */
  it('writes nothing at all while the drain owns the entry', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    let resolveUpload!: (v: { bytesById: Record<string, number> }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    startCaptureQueueWorker(USER);
    await flush(); // the drain is inside e1's upload, holding the entry

    calls.length = 0;
    await retryQueueEntry(USER, 'e1');
    expect(calls.filter((c) => c.startsWith('saveEntry:'))).toEqual([]);

    resolveUpload({ bytesById: { 'e1-m1': 1 } });
    await flush();
    await flush();
    await flush();

    // Delivered exactly once, and nothing was written after it was purged.
    expect(store.has('e1')).toBe(false);
    const afterRemoval = calls.slice(calls.indexOf('removeEntry:e1') + 1);
    expect(afterRemoval.filter((c) => c.startsWith('saveEntry:e1'))).toEqual([]);
  });

  it('takes the lock for the first of two taps in the same tick, and the second writes nothing', async () => {
    let entry = seed('e1', '2026-09-11T02:00:00.000Z');
    entry = recordFailure(entry, 'jaringan turun', new Date(0).toISOString());
    entry = { ...entry, needsAttention: true, consecutiveFailures: 5 };
    store.set('e1', entry);

    // The worker is deliberately still stopped here, so triggerDrain is a
    // no-op and the only writes in this window are the taps' own.
    await Promise.all([retryQueueEntry(USER, 'e1'), retryQueueEntry(USER, 'e1')]);
    // Exactly one of the two taps cleared the flag; the other found the lock
    // held and only asked for a drain.
    expect(calls.filter((c) => c.startsWith('saveEntry:e1')).length).toBe(1);

    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();
    expect(store.has('e1')).toBe(false);
    const afterRemoval = calls.slice(calls.indexOf('removeEntry:e1') + 1);
    expect(afterRemoval.filter((c) => c.startsWith('saveEntry:e1'))).toEqual([]);
  });
});

describe('a failed local cleanup never re-labels a delivered report (I2)', () => {
  it('completes the entry and purges it even when deleteLocalMedia throws', async () => {
    (deleteLocalMedia as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('SD card unmounted');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    // The event is already on the server; a failed local delete must not turn
    // it back into "menunggu sinyal" - a state the entry could never leave,
    // since discardEntryLocally refuses an inserted entry and "Coba lagi"
    // would only re-run the same failing delete.
    expect(calls).toContain('removeEntry:e1');
    expect(store.has('e1')).toBe(false);
    expect(calls.filter((c) => c.endsWith(':failed'))).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('user switch mid-drain (I3)', () => {
  it("drains the incoming user's queue instead of dropping their coalesced request", async () => {
    seed('a1', '2026-09-11T02:00:00.000Z');
    seed('b1', '2026-09-11T02:00:01.000Z', { owner: 'u2' });
    let resolveUpload!: (v: { bytesById: Record<string, number> }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    startCaptureQueueWorker(USER);
    await flush(); // A's upload is in flight

    startCaptureQueueWorker('u2'); // shared phone: A signs out, B signs in
    resolveUpload({ bytesById: { 'a1-m1': 1 } });
    await flush();
    await flush();
    await flush();
    await flush();

    // B's queue - reports carried over from B's last shift - drains now,
    // rather than idling until a network event or B's next capture.
    expect(calls).toContain('loadQueue:u2');
    expect(calls).toContain('removeEntry:b1');
    expect(store.has('a1')).toBe(true); // A signed out mid-pass; their entry is left alone
  });
});

describe('permanent vs transient failures (I4)', () => {
  it('flags a permanent refusal at once instead of spending five attempts on it', async () => {
    upload.mockResolvedValueOnce({
      bytesById: {},
      error: 'new row violates row-level security policy',
      kind: 'permanent',
    });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    const saved = store.get('e1')!;
    expect(saved.lastFailureKind).toBe('permanent');
    expect(saved.consecutiveFailures).toBe(1);
    expect(saved.needsAttention).toBe(true);
  });

  it('keeps a transient failure on the five-strike budget', async () => {
    upload.mockResolvedValueOnce({ bytesById: {}, error: 'Network request failed', kind: 'transient' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    const saved = store.get('e1')!;
    expect(saved.lastFailureKind).toBe('transient');
    expect(saved.needsAttention).toBe(false);
  });

  it('treats an unclassified failure as transient', async () => {
    upload.mockResolvedValueOnce({ bytesById: {}, error: 'something nobody mapped' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    expect(store.get('e1')!.lastFailureKind).toBe('transient');
  });
});

describe('the network trigger is edge-triggered (I5)', () => {
  const loads = () => calls.filter((c) => c.startsWith('loadQueue:')).length;

  it('starts a pass on false-or-unknown to connected, and ignores repeats of connected', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    const before = loads();
    networkHandler?.({ isConnected: true, isInternetReachable: true });
    await flush();
    const afterFirst = loads();
    expect(afterFirst).toBeGreaterThan(before);

    // Android fires this listener on every transport and signal change; each
    // repeat that reached the drain would cost a whole store scan for nothing.
    networkHandler?.({ isConnected: true, isInternetReachable: true });
    await flush();
    expect(loads()).toBe(afterFirst);

    networkHandler?.({ isConnected: false });
    await flush();
    expect(loads()).toBe(afterFirst);

    networkHandler?.({ isConnected: true, isInternetReachable: true });
    await flush();
    expect(loads()).toBeGreaterThan(afterFirst);
  });

  it('ignores a captive-portal network: connected, but nothing gets through', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    const before = loads();
    networkHandler?.({ isConnected: true, isInternetReachable: false });
    await flush();
    expect(loads()).toBe(before);
  });

  it('skips the whole pass when the device says there is no connection, burning no attempt', async () => {
    probedState = { isConnected: false, isInternetReachable: false };
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    expect(calls).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(store.get('e1')!.consecutiveFailures).toBe(0);
  });

  it('does not count a step that failed after the connection dropped toward the five strikes', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    let resolveUpload!: (v: { bytesById: Record<string, number>; error?: string }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    startCaptureQueueWorker(USER);
    await flush(); // the upload is in flight

    networkHandler?.({ isConnected: false, isInternetReachable: false }); // signal dies mid-upload
    resolveUpload({ bytesById: {}, error: 'Network request failed' });
    await flush();
    await flush();

    const saved = store.get('e1')!;
    // Recorded honestly - the supervisor can see what happened, and the
    // backoff clock still moved - but a dead spot walked through five times
    // must not add up to "Perlu perhatian" on a report with nothing wrong.
    expect(saved.state).toBe('failed');
    expect(saved.lastError).toMatch(/Network request failed/);
    expect(saved.consecutiveFailures).toBe(0);
    expect(saved.needsAttention).toBe(false);
  });
});

describe('resuming a multi-file entry (I7)', () => {
  it('persists each file as it lands and re-uploads only the one that failed', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z', { files: 2 });
    upload.mockImplementation(async (input: { media: Array<{ id: string }> }) => {
      const id = input.media[0].id;
      return id === 'e1-m2'
        ? { bytesById: {}, error: 'jaringan turun' }
        : { bytesById: { [id]: 10 } };
    });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    // One call per file, not one call carrying both: a process kill between
    // them has to leave the first file's done-marker on disk.
    expect(upload).toHaveBeenCalledTimes(2);
    const saved = store.get('e1')!;
    expect(saved.media.map((m) => m.uploaded)).toEqual([true, false]);
    expect(saved.media[0].bytes).toBe(10);
    expect(insert).not.toHaveBeenCalled();

    // Next pass: the finished file is not uploaded again.
    upload.mockImplementation(async (input: { media: Array<{ id: string }> }) => ({
      bytesById: { [input.media[0].id]: 10 },
    }));
    store.set('e1', { ...saved, lastAttemptAt: new Date(0).toISOString() });
    upload.mockClear();
    triggerDrain();
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ media: [expect.objectContaining({ id: 'e1-m2' })] }));
    expect(calls).toContain('removeEntry:e1');
  });
});

describe('a 409 ANALYSIS_IN_PROGRESS kick-off (I7)', () => {
  it('counts as kicked off: cleanup still runs and nothing is recorded as a failure', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      code: 'ANALYSIS_IN_PROGRESS',
      error: 'Sedang dianalisis oleh proses lain.',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(calls).toContain('deleteLocalMedia:e1');
    expect(calls).toContain('removeEntry:e1');
    expect(calls.filter((c) => c.endsWith(':failed'))).toEqual([]);
    warn.mockRestore();
  });
});

describe('single-flight, pinned (I7)', () => {
  it('never overlaps two passes: the mid-pass trigger is coalesced, a later one starts a fresh pass', async () => {
    let inUpload = 0;
    let maxInUpload = 0;
    upload.mockImplementation(async (input: { media: Array<{ id: string }> }) => {
      inUpload += 1;
      maxInUpload = Math.max(maxInUpload, inUpload);
      await flush(); // a real yield: an overlapping pass would get in here
      inUpload -= 1;
      return { bytesById: { [input.media[0].id]: 1 } };
    });
    seed('e1', '2026-09-11T02:00:00.000Z');
    seed('e2', '2026-09-11T02:00:01.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    triggerDrain(); // arrives while the first pass is still on e1

    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    // Two overlapping passes would have uploaded e1 and e2 at the same time,
    // since the per-entry lock only keeps them off the SAME entry.
    expect(maxInUpload).toBe(1);
    expect(upload).toHaveBeenCalledTimes(2);
    // One pass, one coalesced re-loop at its end - and nothing more.
    const loadsAfterCoalesce = calls.filter((c) => c.startsWith('loadQueue:')).length;
    expect(loadsAfterCoalesce).toBe(2);

    triggerDrain(); // after the pass ended: a fresh pass, not a coalesced one
    await flush();
    expect(calls.filter((c) => c.startsWith('loadQueue:')).length).toBe(3);
    expect(store.size).toBe(0);
  });
});
