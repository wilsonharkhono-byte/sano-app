// SANO - Offline capture queue persistence (spec §7).
//
// Native: an AsyncStorage index per signed-in user (so a shared phone never
// mixes supervisors), plus one expo-file-system copy of every media file
// under the app's document directory. Camera and recorder temp URIs can be
// purged by the OS at any time, so a capture is copied into a permanent,
// app-owned folder BEFORE it is queued; the write order is media copies
// first, then the index record, so a crash between the two leaves an orphan
// file (harmless, never referenced) rather than an index entry pointing at a
// file that was never actually saved.
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
  type CaptureQueueEntry,
} from './captureQueue';
import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';

const PREFIX = 'sano.captureQueue.v1';

export function indexKey(userId: string): string {
  return `${PREFIX}.index.${userId}`;
}

export function entryKey(userId: string, entryId: string): string {
  return `${PREFIX}.entry.${userId}.${entryId}`;
}

/** Exported for tests; captureQueueWorker.ts never touches the filesystem directly. */
export function entryDirUri(userId: string, entryId: string): string {
  const base = FileSystem.documentDirectory ?? '';
  return `${base}capture-queue/${userId}/${entryId}/`;
}

const REASON_MEDIA_MISSING =
  'Berkas foto atau suara untuk laporan ini hilang dari HP (mungkin dibersihkan sistem sebelum terkirim). ' +
  'Laporan tidak bisa dikirim; buang dan laporkan ulang.';

// ─── Native backend (AsyncStorage + expo-file-system) ─────────────────────────

async function readIndexNative(userId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(indexKey(userId));
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndexNative(userId: string, ids: string[]): Promise<void> {
  await AsyncStorage.setItem(indexKey(userId), JSON.stringify(ids));
}

async function readEntryNative(userId: string, entryId: string): Promise<CaptureQueueEntry | null> {
  const raw = await AsyncStorage.getItem(entryKey(userId, entryId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CaptureQueueEntry;
  } catch {
    return null;
  }
}

async function copyMediaIntoQueueDir(
  userId: string,
  entryId: string,
  media: LocalSiteEventMedia[],
): Promise<LocalSiteEventMedia[]> {
  const dir = entryDirUri(userId, entryId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const copied: LocalSiteEventMedia[] = [];
  for (const m of media) {
    const to = `${dir}${m.id}.${m.ext}`;
    await FileSystem.copyAsync({ from: m.localUri, to });
    copied.push({ ...m, localUri: to });
  }
  return copied;
}

// ─── Web backend (memory only) ─────────────────────────────────────────────────

const webStore = new Map<string, Map<string, CaptureQueueEntry>>();

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
  await AsyncStorage.setItem(entryKey(entry.ownerId, entry.id), JSON.stringify(entry));
  const ids = await readIndexNative(entry.ownerId);
  if (!ids.includes(entry.id)) {
    await writeIndexNative(entry.ownerId, [...ids, entry.id]);
  }
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
  const ids = await readIndexNative(userId);
  await writeIndexNative(userId, ids.filter((id) => id !== entryId));
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
    const info = await FileSystem.getInfoAsync(m.localUri);
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
  const ids = await readIndexNative(userId);
  const entries: CaptureQueueEntry[] = [];
  for (const id of ids) {
    const entry = await readEntryNative(userId, id);
    if (!entry) continue; // index drifted from an entry key that no longer exists; nothing to recover
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
 * "media copies first, then the index" always holds.
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
  return readEntryNative(userId, entryId);
}

/** Test-only escape hatch: nothing else in the app needs to reach into the map directly. */
export function __clearWebStoreForTests(): void {
  webStore.clear();
  listeners.clear();
}
