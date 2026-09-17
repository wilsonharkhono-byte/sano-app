// tools/__tests__/clientReportPhotos.test.ts
jest.mock('../storage', () => ({ resolvePhotoUrl: jest.fn(async (p: string) => `https://fresh/${p}`) }));
import { resolvePhotoUrl } from '../storage';
import { photoPathFromSignedUrl, photoStoragePath, withFreshPhotoUrls } from '../clientReportPhotos';
import type { ClientReportDraft } from '../clientReport';

const SIGNED = 'https://ufntlqvacjhmddwltcxf.supabase.co/storage/v1/object/sign/photos/client-report/11e59d22/1789260214209.jpg?token=eyJhbGciOi';

describe('photoPathFromSignedUrl', () => {
  it('recovers the object path from a photos-bucket signed URL', () => {
    expect(photoPathFromSignedUrl(SIGNED)).toBe('client-report/11e59d22/1789260214209.jpg');
  });
  it('prefixes any other bucket the way resolvePhotoUrl routes it', () => {
    expect(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/sign/site-media/site-events/p/e/m.jpg?token=t'))
      .toBe('site-media:site-events/p/e/m.jpg');
  });
  it('accepts public and authenticated object URLs and decodes escapes', () => {
    expect(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/public/photos/a%20b/c.jpg')).toBe('a b/c.jpg');
    expect(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/authenticated/photos/d/e.jpg#frag')).toBe('d/e.jpg');
  });
  it('returns null for anything that is not a Storage object URL', () => {
    expect(photoPathFromSignedUrl('https://example.com/photo.jpg')).toBeNull();
    expect(photoPathFromSignedUrl('')).toBeNull();
    expect(photoPathFromSignedUrl(null)).toBeNull();
    expect(photoPathFromSignedUrl('https://x.supabase.co/storage/v1/object/sign/photos/?token=t')).toBeNull();
  });
});

describe('photoStoragePath', () => {
  it('prefers a stored path over the URL', () => {
    expect(photoStoragePath({ url: SIGNED, path: 'stored/p.jpg' })).toBe('stored/p.jpg');
    expect(photoStoragePath({ url: SIGNED, path: null })).toBe('client-report/11e59d22/1789260214209.jpg');
  });
});

describe('withFreshPhotoUrls', () => {
  const base: ClientReportDraft = {
    kind: 'harian', reportNo: 1, periodStart: '2026-09-13', periodEnd: '2026-09-13',
    projectName: 'P', clientName: null, subtitle: '', statusLabel: 'Sesuai Jadwal', weather: null,
    crewTotal: null, crewBreakdown: null, safetyIncidents: 0, nextPlan: '',
    updates: [], hero: { url: SIGNED, caption: 'a', date: '13 Sep' },
    thumbs: [
      { url: 'https://example.com/keep.jpg', caption: 'b', date: '13 Sep' },
      { url: 'x', path: 'site-media:k/l.jpg', caption: 'c', date: '13 Sep' },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  it('re-signs every photo with a recoverable path, stores the path, and leaves the rest untouched', async () => {
    const out = await withFreshPhotoUrls(base);
    expect(out.hero).toEqual({ url: 'https://fresh/client-report/11e59d22/1789260214209.jpg', path: 'client-report/11e59d22/1789260214209.jpg', caption: 'a', date: '13 Sep' });
    expect(out.thumbs[0]).toEqual(base.thumbs[0]);
    expect(out.thumbs[1]).toEqual({ url: 'https://fresh/site-media:k/l.jpg', path: 'site-media:k/l.jpg', caption: 'c', date: '13 Sep' });
    expect(resolvePhotoUrl).toHaveBeenCalledTimes(2);
    expect(base.hero?.url).toBe(SIGNED); // input not mutated
  });

  it('keeps the old URL when signing yields an empty string', async () => {
    (resolvePhotoUrl as jest.Mock).mockResolvedValueOnce('');
    const out = await withFreshPhotoUrls({ ...base, thumbs: [] });
    expect(out.hero?.url).toBe(SIGNED);
    expect(out.hero?.path).toBe('client-report/11e59d22/1789260214209.jpg');
  });
});
