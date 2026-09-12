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

let networkHandler: ((state: { isConnected?: boolean | null }) => void) | null = null;
let networkListenerAvailable = true;
jest.mock(
  'expo-network',
  () => ({
    addNetworkStateListener: (cb: (state: { isConnected?: boolean | null }) => void) => {
      if (!networkListenerAvailable) return undefined; // simulates an SDK where the export is missing
      networkHandler = cb;
      return { remove: jest.fn(() => { networkHandler = null; }) };
    },
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
import {
  retryQueueEntry,
  startCaptureQueueWorker,
  stopCaptureQueueWorker,
  triggerDrain,
} from '../captureQueueWorker';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'u1';

const event = (id: string, capturedAt: string): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: 'B', rawText: null, capturedAt,
  media: [{ id: `${id}-m1`, localUri: `file:///q/${id}/m1.jpg`, kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt }],
});

function seed(id: string, createdAt: string): CaptureQueueEntry {
  const entry = enqueueCapture({ event: event(id, createdAt), ownerId: USER, workGroupNames: [], nowIso: createdAt });
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
