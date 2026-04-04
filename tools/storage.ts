import { supabase } from './supabase';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Platform } from 'react-native';

const BUCKET = 'photos';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const TARGET_LONG_EDGE = 1280;
const TARGET_COMPRESS_QUALITY = 0.55;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
const photoUrlCache = new Map<string, { url: string; expiresAt: number }>();

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
  const cached = photoUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (!error && data?.signedUrl) {
    photoUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL - 60) * 1000,
    });
    return data.signedUrl;
  }

  const publicUrl = getPhotoUrl(path);
  photoUrlCache.set(path, {
    url: publicUrl,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return publicUrl;
}
