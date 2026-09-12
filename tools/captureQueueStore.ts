// SANO - Offline capture queue persistence (spec §7).
//
// Native: every entry is its own AsyncStorage key, namespaced by user
// (`sano.captureQueue.v1.entry.{userId}.{entryId}`) so a shared phone never
// mixes supervisors. The entry KEY is the only source of truth for "does
// this entry exist" - loadQueue discovers ids by scanning
// AsyncStorage.getAllKeys() for that prefix (scanEntryIds), rather than
// maintaining a separate index array. A separate index needs a
// read-modify-write cycle (read all ids, add/remove one, write the array
// back) with no lock around it; two concurrent saveEntry/removeEntry calls
// for the same user race that cycle and one of them silently loses the
// other's id from the array forever - the entry record itself is written
// fine, it just becomes unreachable. Per-key storage has no shared mutable
// state for two calls to race over: entry A's key and entry B's key are two
// independent AsyncStorage slots, so this class of bug is structurally
// impossible here, not just less likely.
//
// A legacy index key (`sano.captureQueue.v1.index.{userId}`) is still READ
// (never written) for one release, unioned into scanEntryIds as a defensive
// net. It should be safe to delete entirely once no installed build predates
// this file - every entry this file itself ever wrote used the same entry-key
// naming scan already finds, so the union should normally be a no-op.
//
// Plus one expo-file-system copy of every media file under the app's
// document directory. Camera and recorder temp URIs can be purged by the OS
// at any time, so a capture is copied into a permanent, app-owned folder
// BEFORE it is queued; the write order is media copies first, then the
// entry record, so a crash between the two leaves an orphan directory
// (harmless, never referenced, and eventually reclaimed - see
// sweepOrphanedFiles) rather than a queue entry pointing at a file that was
// never actually saved.
//
// Web: memory-only (decision, spec §7 "Web gets save-and-retry only"). A
// closed tab loses everything, which SiteEventCaptureScreen states plainly
// (task 6). There is nothing to copy on web: the picker/recorder already
// hand back a blob: URL that is either usable this session or gone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import {
  enqueueCapture,
  markUnrecoverable,
  upgradeEntry,
  type CaptureQueueEntry,
} from './captureQueue';
import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';

const PREFIX = 'sano.captureQueue.v1';

/**
 * Legacy-only: nothing writes this key anymore (see the module comment).
 * Kept exported because tests pin the key shape and scanEntryIds still reads
 * it for one release as a defensive union with the scan.
 */
export function indexKey(userId: string): string {
  return `${PREFIX}.index.${userId}`;
}

export function entryKey(userId: string, entryId: string): string {
  return `${PREFIX}.entry.${userId}.${entryId}`;
}

function entryKeyPrefix(userId: string): string {
  return `${PREFIX}.entry.${userId}.`;
}

/**
 * `FileSystem.documentDirectory` is typed `string | null` - it can genuinely
 * be unavailable (native module not ready, unusual custom build). Throwing
 * here beats silently composing a scheme-less relative path, which would
 * only surface later as an opaque native error out of makeDirectoryAsync or
 * copyAsync.
 */
function documentDirectoryOrThrow(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('Penyimpanan HP tidak tersedia; coba lagi.');
  }
  return base;
}

/** Exported for tests; captureQueueWorker.ts never touches the filesystem directly. */
export function entryDirUri(userId: string, entryId: string): string {
  return `${documentDirectoryOrThrow()}capture-queue/${userId}/${entryId}/`;
}

function userQueueDirUri(userId: string): string | null {
  const base = FileSystem.documentDirectory;
  return base ? `${base}capture-queue/${userId}/` : null;
}

const REASON_MEDIA_MISSING =
  'Berkas foto atau suara untuk laporan ini hilang dari HP (mungkin dibersihkan sistem sebelum terkirim). ' +
  'Laporan tidak bisa dikirim; buang dan laporkan ulang.';

// ─── Native backend (AsyncStorage + expo-file-system) ─────────────────────────

/** One-release safety net only - see the module comment. Never written to. */
async function readLegacyIndexNative(userId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(indexKey(userId));
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The id list IS the set of `entry.` keys for this user - there is nothing
 * else that can drift out of sync with it. Unioned with the legacy index
 * only as a one-release defensive net (see the module comment); in the
 * ordinary case the union is a no-op because every id ever written there
 * also has a matching entry key today.
 */
async function scanEntryIds(userId: string): Promise<string[]> {
  const prefix = entryKeyPrefix(userId);
  const keys = await AsyncStorage.getAllKeys();
  const ids = new Set<string>();
  for (const k of keys) {
    if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
  }
  for (const id of await readLegacyIndexNative(userId)) ids.add(id);
  return [...ids];
}

/**
 * Returns null if the key held nothing (e.g. removed by a concurrent
 * removeEntry between the scan and this read - not corruption, nothing to
 * recover). Throws if the value exists but cannot be understood (bad JSON,
 * or a shape upgradeEntry refuses) - the caller decides how to report that
 * without ever deleting the underlying record.
 */
async function readEntryNative(userId: string, entryId: string): Promise<CaptureQueueEntry | null> {
  const raw = await AsyncStorage.getItem(entryKey(userId, entryId));
  if (!raw) return null;
  const parsed = JSON.parse(raw); // throws SyntaxError on corrupted JSON - caller catches it
  const upgraded = upgradeEntry(parsed);
  if (!upgraded) {
    throw new Error(`entry at ${entryKey(userId, entryId)} has an unrecognized shape`);
  }
  return upgraded;
}

async function copyMediaIntoQueueDir(
  userId: string,
  entryId: string,
  media: LocalSiteEventMedia[],
): Promise<LocalSiteEventMedia[]> {
  const dir = entryDirUri(userId, entryId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const cacheDir = FileSystem.cacheDirectory;
  const copied: LocalSiteEventMedia[] = [];
  for (const m of media) {
    const to = `${dir}${m.id}.${m.ext}`;
    await FileSystem.copyAsync({ from: m.localUri, to });
    // Only delete a source we know is our own app's cache copy (pickPhoto /
    // voiceRecorder write there). A content://, ph://, or document-picker
    // URI is owned by another app or the OS and must never be touched, even
    // after we have our own durable copy.
    if (cacheDir && m.localUri.startsWith(cacheDir)) {
      try {
        await FileSystem.deleteAsync(m.localUri, { idempotent: true });
      } catch (err) {
        console.warn(`captureQueueStore: failed to delete cache source ${m.localUri} after copy`, err);
      }
    }
    copied.push({ ...m, localUri: to });
  }
  return copied;
}

// ─── Orphan sweep ───────────────────────────────────────────────────────────

/**
 * A media directory younger than this is left alone even with no matching
 * entry key yet - it might be mid-enqueueNewCapture (media copies land
 * before the entry record does, by design; see the module comment), and
 * sweeping it out from under an in-flight capture would be strictly worse
 * than the wasted bytes a genuine orphan costs while it waits out the grace
 * period.
 */
const ORPHAN_SWEEP_GRACE_MS = 60_000;

/**
 * Deletes media directories under this user's queue folder that have no
 * matching entry key, once they are old enough to be a genuine orphan (a
 * crash between copying files and writing the entry, or between deleting an
 * entry and its files) rather than a capture still in progress. Never
 * throws - a failed sweep should not block loadQueue from returning real
 * entries. `nowMs` is a parameter only so tests can simulate the passage of
 * time without a real 60s sleep.
 */
export async function sweepOrphanedFiles(
  userId: string,
  nowMs: number = Date.now(),
  knownIds?: ReadonlyArray<string>,
): Promise<void> {
  const dir = userQueueDirUri(userId);
  if (!dir) return;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return; // nothing created for this user yet
  }
  // loadQueue has already scanned the keys it needs; re-scanning here would
  // mean a second getAllKeys over the whole of AsyncStorage per load. A list
  // handed in can only be staler than a fresh scan by the time it took to
  // walk the directory, and a directory younger than the grace period is
  // never touched anyway, so an entry created in that window is safe.
  const liveIds = new Set(knownIds ?? (await scanEntryIds(userId)));
  for (const name of names) {
    if (liveIds.has(name)) continue;
    const entryDir = `${dir}${name}/`;
    try {
      const info = await FileSystem.getInfoAsync(entryDir);
      const ageMs = info.exists ? nowMs - info.modificationTime * 1000 : Infinity;
      if (ageMs < ORPHAN_SWEEP_GRACE_MS) continue;
      await FileSystem.deleteAsync(entryDir, { idempotent: true });
    } catch (err) {
      console.warn(`captureQueueStore: failed to sweep orphaned dir ${entryDir}`, err);
    }
  }
}

// ─── Web backend (memory only) ─────────────────────────────────────────────────

const webStore = new Map<string, Map<string, CaptureQueueEntry>>();

/** Users whose media folder has already been swept in this app session (see loadQueue). */
const sweptUsers = new Set<string>();

function webUserMap(userId: string): Map<string, CaptureQueueEntry> {
  let map = webStore.get(userId);
  if (!map) {
    map = new Map();
    webStore.set(userId, map);
  }
  return map;
}

// ─── Change notifications (drives the Beranda badge without polling) ──────────

const listeners = new Map<string, Set<(entries: CaptureQueueEntry[]) => void>>();

/**
 * Awaited by saveEntry/removeEntry so that, once either resolves, every
 * current subscriber has already seen the update - callers never need to
 * guess how many microtask ticks a notification takes to land.
 */
async function notify(userId: string): Promise<void> {
  const subs = listeners.get(userId);
  if (!subs || subs.size === 0) return;
  const entries = await loadQueue(userId);
  for (const cb of subs) cb(entries);
}

/** Live updates for one user's queue. Used by useCaptureQueueEntries and by tests. */
export function subscribeToQueue(userId: string, callback: (entries: CaptureQueueEntry[]) => void): () => void {
  let subs = listeners.get(userId);
  if (!subs) {
    subs = new Set();
    listeners.set(userId, subs);
  }
  subs.add(callback);
  void loadQueue(userId).then(callback);
  return () => {
    subs?.delete(callback);
  };
}

/** Beranda's badge and "Perlu perhatian" list (task 5). Empty array while `userId` is null (signed out). */
export function useCaptureQueueEntries(userId: string | null): CaptureQueueEntry[] {
  const [entries, setEntries] = useState<CaptureQueueEntry[]>([]);
  useEffect(() => {
    if (!userId) {
      setEntries([]);
      return undefined;
    }
    return subscribeToQueue(userId, setEntries);
  }, [userId]);
  return entries;
}

// ─── Public API (both backends behind Platform.OS) ─────────────────────────────

export async function saveEntry(entry: CaptureQueueEntry): Promise<void> {
  if (Platform.OS === 'web') {
    webUserMap(entry.ownerId).set(entry.id, entry);
    await notify(entry.ownerId);
    return;
  }
  // No index to keep in sync: this entry's own key is the entire record of
  // its existence, so there is nothing else for a concurrent call to race.
  await AsyncStorage.setItem(entryKey(entry.ownerId, entry.id), JSON.stringify(entry));
  await notify(entry.ownerId);
}

/** Only for a 'done' entry: the server has it, and local copies are already gone. */
export async function removeEntry(userId: string, entryId: string): Promise<void> {
  if (Platform.OS === 'web') {
    webUserMap(userId).delete(entryId);
    await notify(userId);
    return;
  }
  await AsyncStorage.removeItem(entryKey(userId, entryId));
  await notify(userId);
}

async function recoverMissingMedia(entry: CaptureQueueEntry): Promise<CaptureQueueEntry> {
  // Upload always finishes before insert is attempted (captureQueue.ts's
  // nextStep ordering), so a still-needed local file can only go missing
  // before eventInserted flips true. After that, or once already flagged,
  // there is nothing new to check.
  if (entry.eventInserted || entry.unrecoverable) return entry;
  for (const m of entry.media) {
    if (m.uploaded) continue;
    let info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>;
    try {
      info = await FileSystem.getInfoAsync(m.localUri);
    } catch (err) {
      // An unexpected I/O error (SD card unmount, a transient permission
      // glitch) is not proof the file is gone - only a `{ exists: false }`
      // answer is. Leave the entry exactly as it is rather than flag it
      // unrecoverable on an inconclusive check; the next load tries again.
      console.warn(`captureQueueStore: getInfoAsync failed checking ${m.localUri} for entry ${entry.id}`, err);
      continue;
    }
    if (!info.exists) {
      const fixed = markUnrecoverable(entry, REASON_MEDIA_MISSING);
      await saveEntry(fixed);
      return fixed;
    }
  }
  return entry;
}

/** Reads the whole queue for one user, recovering (never dropping) entries whose local files are gone. */
export async function loadQueue(userId: string): Promise<CaptureQueueEntry[]> {
  if (Platform.OS === 'web') {
    return [...webUserMap(userId).values()];
  }
  const ids = await scanEntryIds(userId);
  // Once per user per app session. The sweep reclaims what a crash left
  // behind; one pass after launch finds all of it, and loadQueue runs on
  // every queue write, so repeating the directory walk on each of them would
  // cost a low-end phone a great deal to find nothing. Anything orphaned
  // while the app keeps running (a cleanup delete that threw) is reclaimed by
  // the next session's first load.
  if (!sweptUsers.has(userId)) {
    sweptUsers.add(userId); // claimed before the await, so two loads never sweep at once
    try {
      await sweepOrphanedFiles(userId, Date.now(), ids);
    } catch (err) {
      console.warn(`captureQueueStore: orphan sweep failed for user ${userId}`, err);
    }
  }
  const entries: CaptureQueueEntry[] = [];
  for (const id of ids) {
    let entry: CaptureQueueEntry | null;
    try {
      entry = await readEntryNative(userId, id);
    } catch (err) {
      // Corrupted JSON, or a shape upgradeEntry refuses to recognize. Never
      // delete the underlying record on a read failure - it is left in
      // storage exactly as found, reported here, and simply excluded from
      // this load. A future app version's upgradeEntry might still make
      // sense of it.
      console.warn(`captureQueueStore: could not load entry at ${entryKey(userId, id)}; leaving it in storage untouched`, err);
      continue;
    }
    if (!entry) continue; // key vanished after the scan (e.g. a concurrent removeEntry); nothing to recover
    entries.push(await recoverMissingMedia(entry));
  }
  return entries;
}

export interface NewCaptureRequest {
  userId: string;
  event: NewSiteEvent;
  workGroupNames: string[];
  nowIso: string;
}

/**
 * Copies every media file into the queue's own folder (native), builds the
 * entry, and persists it. This is the ONLY way an entry is created, so
 * "media copies first, then the entry record" always holds - and since the
 * entry's key IS how it is discovered, a crash before that write leaves
 * nothing to find (just an orphaned, harmless directory), never a
 * half-registered entry.
 */
export async function enqueueNewCapture(request: NewCaptureRequest): Promise<CaptureQueueEntry> {
  const media =
    Platform.OS === 'web' ? request.event.media : await copyMediaIntoQueueDir(request.userId, request.event.id, request.event.media);
  const entry = enqueueCapture({
    event: { ...request.event, media },
    ownerId: request.userId,
    workGroupNames: request.workGroupNames,
    nowIso: request.nowIso,
  });
  await saveEntry(entry);
  return entry;
}

/** The cleanup step (captureQueueWorker.ts task 3). No-op on web: nothing was ever copied. */
export async function deleteLocalMedia(userId: string, entryId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await FileSystem.deleteAsync(entryDirUri(userId, entryId), { idempotent: true });
}

/**
 * The only discard path for the LOCAL queue: an unrecoverable entry (media
 * gone before it could reach the server) never became a site_events row, so
 * there is nothing server-side to protect. Refuses once eventInserted is
 * true - at that point the row exists and "Draf menunggu" (plan 2) already
 * shows it; Buang there goes through discardSiteEvent, not this function.
 */
export async function discardEntryLocally(userId: string, entryId: string): Promise<{ error?: string }> {
  const entry = await readEntryForUser(userId, entryId);
  if (!entry) return {};
  if (entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
  await deleteLocalMedia(userId, entryId);
  await removeEntry(userId, entryId);
  return {};
}

async function readEntryForUser(userId: string, entryId: string): Promise<CaptureQueueEntry | null> {
  if (Platform.OS === 'web') return webUserMap(userId).get(entryId) ?? null;
  try {
    return await readEntryNative(userId, entryId);
  } catch {
    return null; // corrupted/unrecognized - nothing this caller can discard by shape alone
  }
}

/**
 * Test-only escape hatch: nothing else in the app needs to reach into these
 * directly. Also clears the once-per-session orphan-sweep record, so each
 * test starts from a fresh "app launch" rather than inheriting whether an
 * earlier test in the same file already swept that user.
 */
export function __clearWebStoreForTests(): void {
  webStore.clear();
  listeners.clear();
  sweptUsers.clear();
}
