/**
 * storage.ts serves two buckets now: the legacy photos bucket (behaviour
 * unchanged, including its public-URL fallback) and the private site-media
 * bucket from migration 097, addressed with a 'site-media:' prefix so that
 * site_changes.photo_urls can carry either kind. The one rule that must never
 * break: a private path is never turned into a public URL.
 */
jest.mock('../supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { supabase } from '../supabase';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { PhotoPermissionError, SITE_MEDIA_PATH_PREFIX, pickPhoto, resolvePhotoUrl, storageTargetForPath } from '../storage';

const storageFrom = supabase.storage.from as unknown as jest.Mock;

function bucketMock(signed: { signedUrl: string } | null) {
  return {
    createSignedUrl: jest.fn(async () => (signed ? { data: signed, error: null } : { data: null, error: { message: 'Object not found' } })),
    getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://public.example/photo.jpg' } })),
  };
}

beforeEach(() => storageFrom.mockReset());

describe('storageTargetForPath', () => {
  it('uses the site-media prefix the migration writes', () => {
    expect(SITE_MEDIA_PATH_PREFIX).toBe('site-media:');
  });

  it('passes local and already-resolved URIs through untouched', () => {
    for (const uri of ['file:///data/x.jpg', 'content://media/1', 'blob:https://sano-app.vercel.app/abc', 'data:image/jpeg;base64,AAAA', 'https://signed.example/x']) {
      expect(storageTargetForPath(uri)).toEqual({ kind: 'local', uri });
    }
  });

  it('routes a site-media path to the private bucket with no public fallback', () => {
    expect(storageTargetForPath('site-media:site-events/p/e/m.jpg')).toEqual({
      kind: 'bucket', bucket: 'site-media', path: 'site-events/p/e/m.jpg', allowPublicFallback: false,
    });
  });

  it('keeps every other path on the photos bucket exactly as before', () => {
    expect(storageTargetForPath('site-changes/p1/1700000000.jpg')).toEqual({
      kind: 'bucket', bucket: 'photos', path: 'site-changes/p1/1700000000.jpg', allowPublicFallback: true,
    });
  });
});

describe('resolvePhotoUrl', () => {
  it('returns a local preview URI without touching storage', async () => {
    await expect(resolvePhotoUrl('file:///preview.jpg')).resolves.toBe('file:///preview.jpg');
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('signs a site-media path against the site-media bucket', async () => {
    const bucket = bucketMock({ signedUrl: 'https://signed.example/site-media' });
    storageFrom.mockReturnValue(bucket);
    await expect(resolvePhotoUrl('site-media:site-events/p/e/a.jpg')).resolves.toBe('https://signed.example/site-media');
    expect(storageFrom).toHaveBeenCalledWith('site-media');
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('site-events/p/e/a.jpg', 60 * 60 * 24 * 7);
  });

  it('returns an empty string, never a public URL, when private media cannot be signed', async () => {
    const bucket = bucketMock(null);
    storageFrom.mockReturnValue(bucket);
    await expect(resolvePhotoUrl('site-media:site-events/p/e/b.jpg')).resolves.toBe('');
    expect(bucket.getPublicUrl).not.toHaveBeenCalled();
  });

  it('still falls back to a public URL for the legacy photos bucket', async () => {
    const bucket = bucketMock(null);
    storageFrom.mockReturnValue(bucket);
    await expect(resolvePhotoUrl('site-changes/p1/legacy.jpg')).resolves.toBe('https://public.example/photo.jpg');
    expect(storageFrom).toHaveBeenCalledWith('photos');
  });

  // Distinct paths per test below (not reused from other tests in this file):
  // the signed-URL cache is module-level state that otherwise leaks across
  // tests within this file.
  it('reuses the cache on a second call for the same site-media path', async () => {
    const bucket = bucketMock({ signedUrl: 'https://signed.example/cache-reuse' });
    storageFrom.mockReturnValue(bucket);
    const path = 'site-media:site-events/p/e/cache-reuse.jpg';

    await expect(resolvePhotoUrl(path)).resolves.toBe('https://signed.example/cache-reuse');
    await expect(resolvePhotoUrl(path)).resolves.toBe('https://signed.example/cache-reuse');

    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('caches a site-media path and its legacy-bucket counterpart separately', async () => {
    const bucket = bucketMock({ signedUrl: 'https://signed.example/dual-cache' });
    storageFrom.mockReturnValue(bucket);

    await expect(resolvePhotoUrl(`${SITE_MEDIA_PATH_PREFIX}x/y.jpg`)).resolves.toBe('https://signed.example/dual-cache');
    await expect(resolvePhotoUrl('x/y.jpg')).resolves.toBe('https://signed.example/dual-cache');

    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(2);
    expect(storageFrom).toHaveBeenNthCalledWith(1, 'site-media');
    expect(storageFrom).toHaveBeenNthCalledWith(2, 'photos');
  });
});

/**
 * pickPhoto used to throw a bare Error on a denied camera permission,
 * discarding `canAskAgain` from requestCameraPermissionsAsync — the capture
 * screen then had to re-query the permission itself in its catch block just
 * to recover that one bit. PhotoPermissionError carries it directly.
 */
describe('pickPhoto', () => {
  const requestCameraPermissionsAsync = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
  const requestMediaLibraryPermissionsAsync = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
  const launchCameraAsync = ImagePicker.launchCameraAsync as jest.Mock;
  const launchImageLibraryAsync = ImagePicker.launchImageLibraryAsync as jest.Mock;
  const manipulate = manipulateAsync as jest.Mock;

  afterEach(() => {
    Platform.OS = 'web';
    jest.clearAllMocks();
  });

  it('throws a PhotoPermissionError carrying canAskAgain: true when the permission is denied but askable again', async () => {
    Platform.OS = 'ios';
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });

    const err: unknown = await pickPhoto().catch((e) => e);
    expect(err).toBeInstanceOf(PhotoPermissionError);
    expect(err).toMatchObject({ canAskAgain: true, message: 'Izin kamera diperlukan untuk mengambil foto.' });
  });

  it('carries canAskAgain: false for a permanent denial', async () => {
    Platform.OS = 'android';
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    const err: unknown = await pickPhoto().catch((e) => e);
    expect(err).toBeInstanceOf(PhotoPermissionError);
    expect((err as PhotoPermissionError).canAskAgain).toBe(false);
  });

  it('proceeds to the camera and returns a prepared photo once permission is granted', async () => {
    Platform.OS = 'ios';
    requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///in.jpg', width: 100, height: 100 }] });
    manipulate.mockResolvedValue({ uri: 'file:///out.jpg' });

    await expect(pickPhoto()).resolves.toMatchObject({ uri: 'file:///out.jpg', contentType: 'image/jpeg', ext: 'jpg' });
  });

  it('returns null, not an error, when the picker is canceled', async () => {
    Platform.OS = 'ios';
    requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    launchCameraAsync.mockResolvedValue({ canceled: true, assets: [] });

    await expect(pickPhoto()).resolves.toBeNull();
  });

  // The web branch (library picker) never checked a permission at all before
  // this fix, so a denial fell straight through to {canceled: true} instead
  // of the typed, canAskAgain-carrying error the native branch already gives.
  describe('web (library) branch', () => {
    it('throws a PhotoPermissionError, not a silent cancel, when the media library permission is denied', async () => {
      Platform.OS = 'web';
      requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });

      const err: unknown = await pickPhoto().catch((e) => e);
      expect(err).toBeInstanceOf(PhotoPermissionError);
      expect(err).toMatchObject({ canAskAgain: true, message: 'Izin galeri diperlukan untuk memilih foto.' });
      expect(launchImageLibraryAsync).not.toHaveBeenCalled();
    });

    it('falls back to canAskAgain: true when the picker response omits it', async () => {
      Platform.OS = 'web';
      requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });

      const err: unknown = await pickPhoto().catch((e) => e);
      expect((err as PhotoPermissionError).canAskAgain).toBe(true);
    });

    it('proceeds to the library and returns a prepared photo once permission is granted', async () => {
      Platform.OS = 'web';
      requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///web-in.jpg', width: 100, height: 100 }] });
      manipulate.mockResolvedValue({ uri: 'file:///web-out.jpg' });

      await expect(pickPhoto()).resolves.toMatchObject({ uri: 'file:///web-out.jpg', contentType: 'image/jpeg', ext: 'jpg' });
    });

    it('returns null, not an error, when the picker is canceled', async () => {
      Platform.OS = 'web';
      requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });

      await expect(pickPhoto()).resolves.toBeNull();
    });
  });
});
