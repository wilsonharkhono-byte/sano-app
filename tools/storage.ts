import { supabase } from './supabase';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Platform } from 'react-native';
import { SITE_MEDIA_BUCKET } from './constants';

const BUCKET = 'photos';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const TARGET_LONG_EDGE = 1280;
const TARGET_COMPRESS_QUALITY = 0.55;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
const photoUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Prefix marking a stored path that lives in the private site-media bucket
 * (migration 097). confirm_site_event writes VO photo paths into
 * site_changes.photo_urls this way, so every existing renderer that already
 * calls resolvePhotoUrl shows them without knowing about site events.
 */
export const SITE_MEDIA_PATH_PREFIX = `${SITE_MEDIA_BUCKET}:`;

export type StorageTarget =
  | { kind: 'local'; uri: string }
  | { kind: 'bucket'; bucket: string; path: string; allowPublicFallback: boolean };

const LOCAL_URI_RE = /^(file|content|blob|data|https?|ph|assets-library):/i;

/** Where a stored photo path points. Pure; exported for tests. */
export function storageTargetForPath(path: string): StorageTarget {
  if (LOCAL_URI_RE.test(path)) return { kind: 'local', uri: path };
  if (path.startsWith(SITE_MEDIA_PATH_PREFIX)) {
    return {
      kind: 'bucket',
      bucket: SITE_MEDIA_BUCKET,
      path: path.slice(SITE_MEDIA_PATH_PREFIX.length),
      allowPublicFallback: false,
    };
  }
  return { kind: 'bucket', bucket: BUCKET, path, allowPublicFallback: true };
}

async function preparePhotoForUpload(asset: ImagePicker.ImagePickerAsset) {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const resizeAction =
    Math.max(width, height) > TARGET_LONG_EDGE
      ? [
          width >= height
            ? { resize: { width: TARGET_LONG_EDGE } }
            : { resize: { height: TARGET_LONG_EDGE } },
        ]
      : [];

  // Keep one consistent, aggressively compressed "chat-style" photo preset
  // across the app so storage usage stays predictable.
  const processed = await manipulateAsync(asset.uri, resizeAction, {
    compress: TARGET_COMPRESS_QUALITY,
    format: SaveFormat.JPEG,
  });

  return {
    uri: processed.uri,
    contentType: 'image/jpeg',
    ext: 'jpg',
  };
}

export async function pickAndUploadPhoto(folder: string): Promise<string | null> {
  let result: ImagePicker.ImagePickerResult;

  if (Platform.OS === 'web') {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
  } else {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Camera permission required');
    }

    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
  }

  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const processed = await preparePhotoForUpload(asset);
  const ext = processed.ext;
  const fallbackContentType = processed.contentType;
  const fileName = `${folder}/${Date.now()}.${ext}`;

  let uploadBody: Blob | ArrayBuffer;

  if (Platform.OS === 'web') {
    const response = await fetch(processed.uri);
    const blob = await response.blob();
    if (blob.size > MAX_FILE_SIZE) {
      throw new Error('Photo exceeds 5MB limit');
    }
    uploadBody = blob;
  } else {
    const fileInfo = await FileSystem.getInfoAsync(processed.uri);
    if (fileInfo.exists && fileInfo.size > MAX_FILE_SIZE) {
      throw new Error('Photo exceeds 5MB limit');
    }

    const base64 = await FileSystem.readAsStringAsync(processed.uri, {
      encoding: 'base64',
    });

    uploadBody = decode(base64);
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, uploadBody, {
      contentType: fallbackContentType,
      upsert: false,
    });

  if (error) throw error;
  return fileName;
}

export function getPhotoUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function resolvePhotoUrl(path: string): Promise<string> {
  const target = storageTargetForPath(path);
  if (target.kind === 'local') return target.uri;

  const cacheKey = `${target.bucket}:${target.path}`;
  const cached = photoUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage.from(target.bucket).createSignedUrl(target.path, SIGNED_URL_TTL);
  if (!error && data?.signedUrl) {
    photoUrlCache.set(cacheKey, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL - 60) * 1000,
    });
    return data.signedUrl;
  }

  // Private media never falls back to a public URL. An empty string makes
  // PhotoGalleryField show its "Memuat foto" placeholder instead of a link that
  // would either leak or 404; callers keep their never-throws contract.
  if (!target.allowPublicFallback) return '';

  const publicUrl = getPhotoUrl(target.path);
  photoUrlCache.set(cacheKey, {
    url: publicUrl,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return publicUrl;
}

export interface PreparedPhoto {
  /** Local URI of the compressed JPEG, ready to preview or upload. */
  uri: string;
  contentType: string;
  ext: string;
  capturedAt: string;
}

/**
 * Shoot (native) or pick (web) one photo and compress it with the app-wide
 * 1280 px / JPEG 0.55 preset, without uploading. Site events upload later, to
 * their own private bucket and client-generated path.
 */
export async function pickPhoto(): Promise<PreparedPhoto | null> {
  let result: ImagePicker.ImagePickerResult;

  if (Platform.OS === 'web') {
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  } else {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Izin kamera diperlukan untuk mengambil foto.');
    }
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  }

  if (result.canceled || !result.assets[0]) return null;
  const processed = await preparePhotoForUpload(result.assets[0]);
  return { ...processed, capturedAt: new Date().toISOString() };
}

/** A local file (native) or blob: URL (web) as an upload body, with a size cap. */
export async function readUploadBody(
  uri: string,
  maxBytes: number,
): Promise<{ body: Blob | ArrayBuffer; bytes: number }> {
  const limitMb = Math.round(maxBytes / (1024 * 1024));

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    if (blob.size > maxBytes) throw new Error(`Berkas melebihi batas ${limitMb} MB.`);
    return { body: blob, bytes: blob.size };
  }

  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists ? info.size : 0;
  if (size > maxBytes) throw new Error(`Berkas melebihi batas ${limitMb} MB.`);
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const body = decode(base64);
  return { body, bytes: size || body.byteLength };
}
