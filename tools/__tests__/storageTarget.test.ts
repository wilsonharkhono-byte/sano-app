/**
 * storage.ts serves two buckets now: the legacy photos bucket (behaviour
 * unchanged, including its public-URL fallback) and the private site-media
 * bucket from migration 097, addressed with a 'site-media:' prefix so that
 * site_changes.photo_urls can carry either kind. The one rule that must never
 * break: a private path is never turned into a public URL.
 */
jest.mock('../supabase', () => ({ supabase: { storage: { from: jest.fn() } } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { supabase } from '../supabase';
import { SITE_MEDIA_PATH_PREFIX, resolvePhotoUrl, storageTargetForPath } from '../storage';

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
