/**
 * Persistence around the pure state machine. What matters here: media is
 * copied into the app's own folder and saved BEFORE the entry record (so a
 * crash mid-enqueue never leaves a discoverable entry pointing at a file
 * that was never actually captured - the entry's own AsyncStorage key IS how
 * it is discovered, so nothing can point at a file that isn't there); a
 * missing local file is recovered into an explained, never-silent
 * unrecoverable flag rather than dropped; one bad entry, or one unexpected
 * filesystem error, cannot take down the whole queue's load; and the web
 * backend never touches AsyncStorage or the filesystem at all.
 */
let currentOS = 'android';
jest.mock('react-native', () => ({
  get Platform() {
    return { get OS() { return currentOS; } };
  },
}));

const calls: string[] = [];
const fsFiles = new Map<string, boolean>(); // uri -> exists
const fsDirMtimes = new Map<string, number>(); // directory uri -> creation/modification time, ms

// `documentDirectory` is exposed through a getter backed by `fsState`, with a
// test-only setter, because TS/Babel's ESM interop wraps `import * as X`
// bindings in a getter-only namespace object - reassigning `FileSystem.foo =
// ...` from a test throws ("has only a getter"), and even a successful
// property swap on the TEST file's own wrapper object would not be visible
// to captureQueueStore.ts's *separately* wrapped `FileSystem` binding. A
// mutable closure variable underneath both wrappers' getters sidesteps that.
const fsState = { documentDirectory: 'file:///doc/' as string | null };

jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return fsState.documentDirectory;
  },
  __setDocumentDirectoryForTests: (value: string | null) => {
    fsState.documentDirectory = value;
  },
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async (uri: string) => {
    calls.push(`mkdir:${uri}`);
    fsDirMtimes.set(uri, Date.now());
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    calls.push(`copy:${from}->${to}`);
    fsFiles.set(to, true);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    calls.push(`delete:${uri}`);
    fsFiles.delete(uri);
    for (const key of [...fsFiles.keys()]) {
      if (key.startsWith(uri)) fsFiles.delete(key);
    }
    fsDirMtimes.delete(uri);
    for (const key of [...fsDirMtimes.keys()]) {
      if (key !== uri && key.startsWith(uri)) fsDirMtimes.delete(key);
    }
  }),
  getInfoAsync: jest.fn(async (uri: string) => {
    if (fsDirMtimes.has(uri)) {
      return { exists: true, isDirectory: true, modificationTime: fsDirMtimes.get(uri)! / 1000 };
    }
    return { exists: fsFiles.get(uri) ?? false };
  }),
  readDirectoryAsync: jest.fn(async (dirUri: string) => {
    const names = new Set<string>();
    for (const key of fsDirMtimes.keys()) {
      if (key === dirUri || !key.startsWith(dirUri)) continue;
      const name = key.slice(dirUri.length).split('/')[0];
      if (name) names.add(name);
    }
    return [...names];
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
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
  sweepOrphanedFiles,
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
  fsDirMtimes.clear();
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
  it('copies media into the queue folder, then writes the entry - with no separate index left to fall out of sync', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: ['Finishing'], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(entry.media[0].localUri).toBe('file:///doc/capture-queue/u1/e1/m1.jpg');
    expect(calls).toEqual([
      `mkdir:file:///doc/capture-queue/${USER}/e1/`,
      `copy:file:///tmp/cam/m1.jpg->file:///doc/capture-queue/${USER}/e1/m1.jpg`,
    ]);
    // Fix 1: no index is written anymore - the entry's own key is the only record of its existence.
    expect(await AsyncStorage.getItem(indexKey(USER))).toBeNull();
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored.id).toBe('e1');
    expect(stored.state).toBe('queued');
    // ...and it is discoverable purely by scanning for that key - nothing else to keep in sync.
    expect((await loadQueue(USER)).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('concurrent enqueue does not lose an entry (regression for review Critical #1)', () => {
  it('keeps both ids discoverable when two enqueueNewCapture calls race for the same user', async () => {
    const [a, b] = await Promise.all([
      enqueueNewCapture({ userId: USER, event: event({ id: 'e1' }), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
      enqueueNewCapture({ userId: USER, event: event({ id: 'e2' }), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
    ]);
    expect([a.id, b.id].sort()).toEqual(['e1', 'e2']);
    // With per-key storage there is no shared array for the two saves to race
    // over, so both survive regardless of how their internal awaits interleave.
    const loaded = await loadQueue(USER);
    expect(loaded.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });
});

const setDocumentDirectoryForTests = (FileSystem as unknown as {
  __setDocumentDirectoryForTests: (value: string | null) => void;
}).__setDocumentDirectoryForTests;

describe('enqueueNewCapture: no document directory (fix 2)', () => {
  it('fails clearly instead of building a malformed path when FileSystem.documentDirectory is null', async () => {
    setDocumentDirectoryForTests(null);
    try {
      await expect(
        enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
      ).rejects.toThrow('Penyimpanan HP tidak tersedia');
      expect(calls).toEqual([]); // never attempted mkdir/copy with a malformed relative path
    } finally {
      setDocumentDirectoryForTests('file:///doc/');
    }
  });
});

describe('saveEntry / removeEntry', () => {
  it('round-trips through AsyncStorage', async () => {
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

  it('skips a legacy index id whose entry record is missing, rather than crashing', async () => {
    await AsyncStorage.setItem(indexKey(USER), JSON.stringify(['ghost']));
    expect(await loadQueue(USER)).toEqual([]);
  });
});

describe('loadQueue resilience (fix 3): one bad entry cannot abort the whole load', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('skips an entry with unparseable JSON, without crashing and without deleting it', async () => {
    await enqueueNewCapture({ userId: USER, event: event({ id: 'e1' }), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    await AsyncStorage.setItem(entryKey(USER, 'bad'), '{not json');

    const loaded = await loadQueue(USER);
    expect(loaded.map((e) => e.id)).toEqual(['e1']);
    expect(await AsyncStorage.getItem(entryKey(USER, 'bad'))).toBe('{not json'); // never deleted
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(entryKey(USER, 'bad')), expect.any(Error));
  });

  it('skips an entry whose shape upgradeEntry refuses, without crashing and without deleting it', async () => {
    await enqueueNewCapture({ userId: USER, event: event({ id: 'e1' }), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    await AsyncStorage.setItem(entryKey(USER, 'weird'), JSON.stringify({ version: 1, id: 'weird' })); // missing required fields

    const loaded = await loadQueue(USER);
    expect(loaded.map((e) => e.id)).toEqual(['e1']);
    expect(await AsyncStorage.getItem(entryKey(USER, 'weird'))).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(entryKey(USER, 'weird')), expect.any(Error));
  });

  it('does not abort the load, and does not falsely flag unrecoverable, when getInfoAsync rejects unexpectedly', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    (FileSystem.getInfoAsync as jest.Mock).mockRejectedValueOnce(new Error('EIO: transient'));

    const [reloaded] = await loadQueue(USER);
    expect(reloaded.id).toBe('e1');
    expect(reloaded.unrecoverable).toBe(false); // inconclusive check, not proof the file is gone
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('getInfoAsync failed'), expect.any(Error));
  });
});

describe('legacy entries without a version field (fix 4: upgradeEntry)', () => {
  it('still loads an entry written before the version field existed', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const legacyShape: Record<string, unknown> = { ...entry };
    delete legacyShape.version;
    await AsyncStorage.setItem(entryKey(USER, 'e1'), JSON.stringify(legacyShape));

    const [loaded] = await loadQueue(USER);
    expect(loaded.id).toBe('e1');
    expect(loaded.version).toBe(1);
  });
});

describe('sweepOrphanedFiles (fix 5)', () => {
  it('leaves a freshly-orphaned directory alone (might be mid-enqueue), but reaps it once the grace period passes', async () => {
    // Simulate "died right after copying media, before the entry write" -
    // exactly what enqueueNewCapture does up to (not including) saveEntry.
    const dir = `file:///doc/capture-queue/${USER}/orphan1/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.copyAsync({ from: 'file:///tmp/cam/m1.jpg', to: `${dir}m1.jpg` });
    calls.length = 0;

    await sweepOrphanedFiles(USER); // "now": far too fresh to touch
    expect(calls.some((c) => c.startsWith('delete:'))).toBe(false);
    expect(fsFiles.get(`${dir}m1.jpg`)).toBe(true);

    await sweepOrphanedFiles(USER, Date.now() + 10 * 60_000); // well past the grace period
    expect(calls).toContain(`delete:${dir}`);
  });

  it('never sweeps a directory with a matching entry key, no matter how old', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    calls.length = 0;

    await sweepOrphanedFiles(USER, Date.now() + 60 * 60_000);
    expect(calls.some((c) => c.startsWith('delete:'))).toBe(false);
  });
});

describe('crash safety: the entry key is the only discovery point (fix 5)', () => {
  it('a crash between copying media and writing the entry leaves the file orphaned but undiscoverable', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('simulated crash'));

    await expect(
      enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' }),
    ).rejects.toThrow('simulated crash');

    // Not discoverable - no entry key was ever written.
    expect(await loadQueue(USER)).toEqual([]);
    // The copied file is still there: loadQueue's sweep just ran, but the
    // directory is brand new, so it was correctly left alone rather than reaped.
    expect(fsFiles.get(`file:///doc/capture-queue/${USER}/e1/m1.jpg`)).toBe(true);
  });
});

describe('copyMediaIntoQueueDir cache cleanup (fix 6)', () => {
  it('deletes the source file after copying, only when it lives under the cache directory', async () => {
    fsFiles.set('file:///cache/cam/m3.jpg', true);
    const ev = event({
      id: 'e3',
      media: [{ id: 'm3', localUri: 'file:///cache/cam/m3.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' }],
    });
    await enqueueNewCapture({ userId: USER, event: ev, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(calls).toContain('delete:file:///cache/cam/m3.jpg');
  });

  it('never deletes a content:// or document-picker source, even after a successful copy', async () => {
    fsFiles.set('content://media/external/images/42', true);
    const ev = event({
      id: 'e4',
      media: [{ id: 'm4', localUri: 'content://media/external/images/42', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' }],
    });
    await enqueueNewCapture({ userId: USER, event: ev, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(calls.some((c) => c.startsWith('delete:content://'))).toBe(false);
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

/**
 * loadQueue runs on every queue write (saveEntry and removeEntry notify
 * subscribers through it), and the worker writes twice per step. On a phone
 * with a day's reports queued, the difference between one scan per load and
 * several is thousands of AsyncStorage and filesystem round trips to deliver
 * one report.
 */
describe('scan cost', () => {
  it('reads the key list once per loadQueue', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    (AsyncStorage.getAllKeys as jest.Mock).mockClear();

    await loadQueue(USER);
    expect((AsyncStorage.getAllKeys as jest.Mock).mock.calls.length).toBe(1);
  });

  it('sweeps the media folder once per app session, not on every load', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    (FileSystem.readDirectoryAsync as jest.Mock).mockClear();

    await loadQueue(USER);
    await loadQueue(USER);
    await loadQueue(USER);
    expect((FileSystem.readDirectoryAsync as jest.Mock).mock.calls.length).toBe(1);

    // A fresh session sweeps again: a directory orphaned by a delete that
    // failed while the app was running is reclaimed at the next launch.
    __clearWebStoreForTests();
    await loadQueue(USER);
    expect((FileSystem.readDirectoryAsync as jest.Mock).mock.calls.length).toBe(2);
  });

  it('still reaps a genuine orphan on that one pass', async () => {
    const dir = `file:///doc/capture-queue/${USER}/orphan2/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    fsDirMtimes.set(dir, Date.now() - 10 * 60_000); // well past the grace period
    calls.length = 0;

    await loadQueue(USER);
    expect(calls).toContain(`delete:${dir}`);
  });
});
