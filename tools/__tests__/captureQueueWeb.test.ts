/**
 * captureQueueStore.ts and captureQueueWorker.ts each degrade to Platform.OS
 * === 'web' separately (their own test files' "web backend" blocks, and the
 * worker's tests never touching Platform at all because they mock the store
 * directly). This test runs them TOGETHER on the real web backend, the same
 * way the app actually uses them: enqueue, drain, reach draft_ready then
 * done, with no AsyncStorage or filesystem call at any point. Proves the two
 * modules' web branches actually compose, not just that each one in
 * isolation avoids native APIs.
 *
 * Two cases go beyond captureQueue-offline-queue plan's own fenced test:
 *  - two concurrent enqueueNewCapture calls for the same user both surviving
 *    to drain, standing in for the read-modify-write index race the store's
 *    per-key redesign (commit f6ae236) closed on native - the web backend's
 *    in-memory Map was never subject to that exact bug, but the invariant
 *    "two concurrent enqueues for one user never clobber each other" is the
 *    same one this suite should keep proving on both backends;
 *  - a 409 ANALYSIS_IN_PROGRESS kick-off (invokeSiteEventAnalysis resolves
 *    with ok: false rather than throwing) still drains to draft_ready and
 *    then done, per captureQueueWorker.ts's module comment: any resolved,
 *    non-throwing outcome from that call counts as "kicked off".
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock(
  'expo-network',
  () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }),
  { virtual: true },
);

const fsCalls: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => {
    fsCalls.push('mkdir');
  }),
  copyAsync: jest.fn(async () => {
    fsCalls.push('copy');
  }),
  deleteAsync: jest.fn(async () => {
    fsCalls.push('delete');
  }),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  // Not called on the web path (loadQueue returns before sweepOrphanedFiles
  // on Platform.OS === 'web'); mocked anyway so an accidental native-path
  // call would be caught by the fsCalls assertion instead of throwing on an
  // undefined export.
  readDirectoryAsync: jest.fn(async () => {
    fsCalls.push('readDir');
    return [];
  }),
}));

const storageCalls: string[] = [];
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => {
    storageCalls.push('getItem');
    return null;
  }),
  setItem: jest.fn(async () => {
    storageCalls.push('setItem');
  }),
  removeItem: jest.fn(async () => {
    storageCalls.push('removeItem');
  }),
  // scanEntryIds calls this on the native path only; included so a mistaken
  // native-path call on web is caught rather than throwing "not a function".
  getAllKeys: jest.fn(async () => {
    storageCalls.push('getAllKeys');
    return [];
  }),
}));

const upload = jest.fn();
const insert = jest.fn();
const invoke = jest.fn();
const insertClosure = jest.fn();
const closeRpc = jest.fn();
jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: (...args: unknown[]) => upload(...args),
  insertSiteEvent: (...args: unknown[]) => insert(...args),
  invokeSiteEventAnalysis: (...args: unknown[]) => invoke(...args),
  insertClosureMedia: (...args: unknown[]) => insertClosure(...args),
  closeSiteEventRpc: (...args: unknown[]) => closeRpc(...args),
}));

import {
  enqueueCloseJob,
  enqueueNewCapture,
  loadQueue,
  subscribeToQueue,
  __clearWebStoreForTests,
} from '../captureQueueStore';
import { startCaptureQueueWorker, stopCaptureQueueWorker } from '../captureQueueWorker';
import type { CaptureQueueEntry } from '../captureQueue';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'web-user';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEvent(id: string): NewSiteEvent {
  return {
    id,
    projectId: 'p1',
    roomId: 'r1',
    reporterId: USER,
    gateCode: null,
    rawText: 'Catatan web',
    capturedAt: '2026-09-11T02:00:00.000Z',
    media: [
      {
        id: `${id}-m1`,
        localUri: `blob:https://sano-app.vercel.app/${id}`,
        kind: 'photo',
        role: 'context',
        mimeType: 'image/jpeg',
        ext: 'jpg',
        durationS: null,
        sortOrder: 0,
        capturedAt: '2026-09-11T02:00:00.000Z',
      },
    ],
  };
}

const event = makeEvent('e1');

beforeEach(() => {
  __clearWebStoreForTests();
  fsCalls.length = 0;
  storageCalls.length = 0;
  upload.mockReset();
  insert.mockReset();
  invoke.mockReset();
  upload.mockImplementation(async (input: { media: Array<{ id: string }> }) => ({
    bytesById: Object.fromEntries(input.media.map((m) => [m.id, 42])),
  }));
  insert.mockImplementation(async () => ({}));
  invoke.mockImplementation(async () => ({ ok: true, code: 'ANALYZED', status: 'draft' }));
  insertClosure.mockReset().mockImplementation(async () => ({}));
  closeRpc.mockReset().mockImplementation(async () => ({ ok: true }));
  stopCaptureQueueWorker();
});

afterEach(() => {
  stopCaptureQueueWorker();
});

it('drains a web capture end to end in memory, touching neither AsyncStorage nor the filesystem', async () => {
  await enqueueNewCapture({ userId: USER, event, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
  startCaptureQueueWorker(USER);
  await flush();
  await flush();
  await flush();

  expect(fsCalls).toEqual([]);
  expect(storageCalls).toEqual([]);
  // The web store purges a 'done' entry the same way native does, so after a
  // successful drain the queue is empty - the app relies on plan 2's server
  // read (listDraftEvents) from that point on, exactly as on native.
  expect(await loadQueue(USER)).toEqual([]);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('forgets everything once the in-memory store is cleared, standing in for a closed tab', async () => {
  await enqueueNewCapture({ userId: USER, event, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
  expect((await loadQueue(USER)).length).toBe(1);
  __clearWebStoreForTests();
  expect(await loadQueue(USER)).toEqual([]);
});

it('delivers both entries when two enqueueNewCapture calls for the same user race each other', async () => {
  // Fired together (not awaited one after another) so both writes to the
  // web backend's per-user Map are in flight at once - the same shape of
  // race that used to lose an id from the native index array before the
  // store's per-key redesign (commit f6ae236). The web Map keys each entry
  // by its own id, so nothing should be lost here either.
  await Promise.all([
    enqueueNewCapture({ userId: USER, event: makeEvent('race-1'), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
    enqueueNewCapture({ userId: USER, event: makeEvent('race-2'), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
  ]);
  expect((await loadQueue(USER)).map((e) => e.id).sort()).toEqual(['race-1', 'race-2']);

  startCaptureQueueWorker(USER);
  await flush();
  await flush();
  await flush();
  await flush();
  await flush();

  expect(await loadQueue(USER)).toEqual([]);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('still reaches draft_ready then done when the analyze call resolves as a 409 ANALYSIS_IN_PROGRESS kick-off', async () => {
  // invokeSiteEventAnalysis never throws (tools/siteEvents.ts maps every
  // error, the edge function's 409 claim-already-taken included, into a
  // resolved AnalyzeResponse) - the worker treats any resolved, non-ok
  // outcome the same as a clean success: the call landed, so there is
  // nothing left for this entry but cleanup.
  invoke.mockImplementation(async () => ({
    ok: false,
    code: 'ANALYSIS_IN_PROGRESS',
    error: 'Sedang dianalisis oleh proses lain.',
  }));

  const seenStates: string[][] = [];
  const unsubscribe = subscribeToQueue(USER, (entries: CaptureQueueEntry[]) => {
    seenStates.push(entries.map((e) => e.state));
  });

  await enqueueNewCapture({ userId: USER, event, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
  startCaptureQueueWorker(USER);
  await flush();
  await flush();
  await flush();
  unsubscribe();

  expect(invoke).toHaveBeenCalledTimes(1);
  // Never lands in 'failed': a 409 is a successful kick-off, not an error.
  expect(seenStates.some((states) => states.includes('failed'))).toBe(false);
  expect(seenStates.some((states) => states.includes('draft_ready'))).toBe(true);
  expect(await loadQueue(USER)).toEqual([]);
});

it('queues a close on web in memory only, copying nothing, and drains it into the event\'s folder', async () => {
  const photoUri = 'blob:https://sano-app.vercel.app/cm1';
  const result = await enqueueCloseJob({
    userId: USER,
    jobId: 'job1',
    eventId: 'ev1',
    projectId: 'p1',
    roomId: 'r1',
    eventTitle: 'Retak acian',
    note: ' Sudah ditambal ',
    closurePhoto: {
      id: 'cm1', localUri: photoUri, kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg',
      durationS: null, sortOrder: 0, capturedAt: '2026-09-17T02:00:00.000Z',
    },
    nowIso: '2026-09-17T02:00:01.000Z',
  });

  // The blob: URL is either usable this session or gone; there is nothing to copy.
  expect(result.entry?.media[0].localUri).toBe(photoUri);
  expect(fsCalls).toEqual([]);
  expect(storageCalls).toEqual([]);
  expect((await loadQueue(USER)).map((e) => e.id)).toEqual(['job1']);

  startCaptureQueueWorker(USER);
  await flush();
  await flush();
  await flush();

  expect(upload).toHaveBeenCalledWith({ id: 'ev1', projectId: 'p1', media: [expect.objectContaining({ id: 'cm1', localUri: photoUri })] });
  expect(insertClosure).toHaveBeenCalledTimes(1);
  expect(closeRpc).toHaveBeenCalledWith('ev1', 'Sudah ditambal');
  expect(await loadQueue(USER)).toEqual([]);
  expect(fsCalls).toEqual([]);
  expect(storageCalls).toEqual([]);
});
