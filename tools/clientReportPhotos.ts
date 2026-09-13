// tools/clientReportPhotos.ts
// SANO — Client report photos: storage paths and re-signing.
//
// Issued snapshots (client_progress_reports.snapshot) froze 7-day signed URLs,
// so a report older than a week re-rendered without photos (spec §5.2). New
// photos now carry `path`; old ones recover it from the URL. Renderers call
// withFreshPhotoUrls before showing a snapshot. Nothing here mutates its input.
//
// photoPathFromSignedUrl is twinned in
// supabase/functions/report-progress-analyze/util.ts (jest:
// reportProgressTwins.test.ts compares the function bodies) — keep it
// self-contained and edit both together.
import type { ClientReportDraft, ClientReportPhoto } from './clientReport';
import { resolvePhotoUrl } from './storage';

/**
 * The stored path a Supabase Storage object URL points at, in the form
 * resolvePhotoUrl accepts: bare for the photos bucket, `<bucket>:<path>` for
 * any other (the site-media convention). Null for anything else.
 */
export function photoPathFromSignedUrl(url: string | null | undefined): string | null {
  const PHOTOS_BUCKET = 'photos';
  /** `/storage/v1/object/{sign|public|authenticated}/<bucket>/<object path>` — query and fragment excluded. */
  const STORAGE_OBJECT_RE = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?#]+)\/([^?#]+)/;
  if (!url) return null;
  const match = STORAGE_OBJECT_RE.exec(url);
  if (!match) return null;
  let bucket: string;
  let objectPath: string;
  try {
    bucket = decodeURIComponent(match[1]);
    objectPath = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!objectPath) return null;
  return bucket === PHOTOS_BUCKET ? objectPath : `${bucket}:${objectPath}`;
}

export function photoStoragePath(photo: Pick<ClientReportPhoto, 'url' | 'path'>): string | null {
  return photo.path ?? photoPathFromSignedUrl(photo.url);
}

/** A copy of the draft whose photos carry a fresh signed URL and their storage path. */
export async function withFreshPhotoUrls(draft: ClientReportDraft): Promise<ClientReportDraft> {
  const refresh = async (photo: ClientReportPhoto): Promise<ClientReportPhoto> => {
    const path = photoStoragePath(photo);
    if (!path) return photo;
    const url = await resolvePhotoUrl(path);
    return { ...photo, path, url: url || photo.url };
  };
  const hero = draft.hero ? await refresh(draft.hero) : null;
  const thumbs = await Promise.all(draft.thumbs.map(refresh));
  return { ...draft, hero, thumbs };
}
