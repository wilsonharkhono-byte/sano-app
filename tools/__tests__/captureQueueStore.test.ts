/**
 * Persistence around the pure state machine. What matters here: media is
 * copied into the app's own folder and saved BEFORE the index record (so a
 * crash mid-enqueue never leaves an index pointing at a file that was never
 * actually captured); a missing local file is recovered into an explained,
 * never-silent unrecoverable flag rather than dropped; and the web backend
 * never touches AsyncStorage or the filesystem at all.
 */
let currentOS = 'android';
jest.mock('react-native', () => ({
  get Platform() {
    return { get OS() { return currentOS; } };
  },
}));

const calls: string[] = [];
const fsFiles = new Map<string, boolean>(); // uri -> exists

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async (uri: string) => {
    calls.push(`mkdir:${uri}`);
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    calls.push(`copy:${from}->${to}`);
    fsFiles.set(to, true);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    calls.push(`delete:${uri}`);
    fsFiles.delete(uri);
  }),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: fsFiles.get(uri) ?? false })),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  discardEntryLocally,
  enqueueNewCapture,
  entryDirUri,
  entryKey,
  indexKey,
  loadQueue,
  removeEntry,
  saveEntry,
  subscribeToQueue,
  __clearWebStoreForTests,
} from '../captureQueueStore';
import { markInserted, markUploaded } from '../captureQueue';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'u1';

const event = (over: Partial<NewSiteEvent> = {}): NewSiteEvent => ({
  id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: null, rawText: 'Catatan',
  capturedAt: '2026-09-11T02:00:00.000Z',
  media: [
    { id: 'm1', localUri: 'file:///tmp/cam/m1.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' },
  ],
  ...over,
});

beforeEach(async () => {
  currentOS = 'android';
  calls.length = 0;
  fsFiles.clear();
  fsFiles.set('file:///tmp/cam/m1.jpg', true); // the "camera temp file" exists until copied
  __clearWebStoreForTests();
  await AsyncStorage.clear();
});

describe('key shapes', () => {
  it('namespaces by user so a shared phone cannot mix supervisors', () => {
    expect(indexKey('u1')).toBe('sano.captureQueue.v1.index.u1');
    expect(indexKey('u2')).not.toBe(indexKey('u1'));
    expect(entryKey('u1', 'e1')).toBe('sano.captureQueue.v1.entry.u1.e1');
    expect(entryDirUri('u1', 'e1')).toBe('file:///doc/capture-queue/u1/e1/');
  });
});

describe('enqueueNewCapture (native)', () => {
  it('copies media into the queue folder, then writes the entry, then the index', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: ['Finishing'], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(entry.media[0].localUri).toBe('file:///doc/capture-queue/u1/e1/m1.jpg');
    expect(calls).toEqual([
      `mkdir:file:///doc/capture-queue/${USER}/e1/`,
      `copy:file:///tmp/cam/m1.jpg->file:///doc/capture-queue/${USER}/e1/m1.jpg`,
    ]);
    const storedIndex = JSON.parse((await AsyncStorage.getItem(indexKey(USER)))!);
    expect(storedIndex).toEqual(['e1']);
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored.id).toBe('e1');
    expect(stored.state).toBe('queued');
  });
});

describe('saveEntry / removeEntry', () => {
  it('round-trips through AsyncStorage and keeps the index in sync', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const uploaded = markUploaded(entry, 'm1', 999, '2026-09-11T02:00:05.000Z');
    await saveEntry(uploaded);
    const [reloaded] = await loadQueue(USER);
    expect(reloaded.state).toBe('uploading');
    expect(reloaded.media[0].bytes).toBe(999);

    await removeEntry(USER, 'e1');
    expect(await loadQueue(USER)).toEqual([]);
    expect(await AsyncStorage.getItem(entryKey(USER, 'e1'))).toBeNull();
  });
});

describe('loadQueue recovery', () => {
  it('flags an entry unrecoverable, with a clear reason, when a still-needed file is gone; never drops it', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    fsFiles.delete(entry.media[0].localUri); // simulate the OS purging the copy before it could upload

    const [reloaded] = await loadQueue(USER);
    expect(reloaded.unrecoverable).toBe(true);
    expect(reloaded.needsAttention).toBe(true);
    expect(reloaded.lastError).toMatch(/hilang dari HP/);
    // Persisted, so a second load does not need to re-check the filesystem.
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored.unrecoverable).toBe(true);
  });

  it('does not re-check files once the event is already inserted', async () => {
    let entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    entry = markUploaded(entry, 'm1', 10, '2026-09-11T02:00:05.000Z');
    entry = markInserted(entry, '2026-09-11T02:00:06.000Z');
    await saveEntry(entry);
    fsFiles.delete(entry.media[0].localUri); // the local copy is gone, which is fine post-insert

    const [reloaded] = await loadQueue(USER);
    expect(reloaded.unrecoverable).toBe(false);
    expect(reloaded.state).toBe('analyzing');
  });

  it('skips an index id whose entry record is missing, rather than crashing', async () => {
    await AsyncStorage.setItem(indexKey(USER), JSON.stringify(['ghost']));
    expect(await loadQueue(USER)).toEqual([]);
  });
});

describe('discardEntryLocally', () => {
  it('deletes the folder and drops the entry when nothing was ever inserted', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    fsFiles.delete(entry.media[0].localUri);
    await loadQueue(USER); // marks it unrecoverable

    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toBeUndefined();
    expect(calls).toContain(`delete:file:///doc/capture-queue/${USER}/e1/`);
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('refuses once the server has the event, and touches nothing', async () => {
    let entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    entry = markUploaded(entry, 'm1', 10, '2026-09-11T02:00:05.000Z');
    entry = markInserted(entry, '2026-09-11T02:00:06.000Z');
    await saveEntry(entry);
    calls.length = 0;

    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toMatch(/sudah tersimpan/);
    expect(calls).toEqual([]);
    expect((await loadQueue(USER))[0].id).toBe('e1');
  });
});

/** subscribeToQueue's initial callback fires from an un-awaited loadQueue; give it a real tick to land. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('subscribeToQueue', () => {
  it('calls back immediately, and again after every save, until unsubscribed', async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToQueue(USER, (entries) => seen.push(entries.length));
    await flush(); // the initial load
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    unsubscribe();
    await enqueueNewCapture({ userId: USER, event: event({ id: 'e2' }), workGroupNames: [], nowIso: '2026-09-11T02:00:02.000Z' });
    expect(seen).toEqual([0, 1]);
  });
});

describe('web backend', () => {
  beforeEach(() => {
    currentOS = 'web';
  });

  it('never touches AsyncStorage or the filesystem, and forgets nothing on its own', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(entry.media[0].localUri).toBe('file:///tmp/cam/m1.jpg'); // unchanged: nothing is copied on web
    expect(calls).toEqual([]);
    expect(await AsyncStorage.getItem(indexKey(USER))).toBeNull();
    expect((await loadQueue(USER)).map((e) => e.id)).toEqual(['e1']);

    __clearWebStoreForTests(); // stands in for "the tab was closed"
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('discardEntryLocally works the same way, minus any filesystem call', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toBeUndefined();
    expect(calls).toEqual([]);
    expect(await loadQueue(USER)).toEqual([]);
  });
});
