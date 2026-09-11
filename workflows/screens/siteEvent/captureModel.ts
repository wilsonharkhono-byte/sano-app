// SANO - Capture form model (pure).
//
// Turns what the supervisor collected on SiteEventCaptureScreen into the
// NewSiteEvent that tools/siteEvents.ts uploads. Type-only imports from tools/
// keep this file free of Supabase and native modules, so jest loads it as is.

import type { LocalSiteEventMedia, NewSiteEvent } from '../../../tools/siteEvents';
import type { PreparedPhoto } from '../../../tools/storage';
import { SITE_EVENT_MAX_CLOSEUPS } from '../../../tools/constants';

export interface CapturePhoto {
  /** Client-generated media id, fixed once taken so a resend reuses the same object path. */
  id: string;
  photo: PreparedPhoto;
}

export interface CaptureVoice {
  id: string;
  uri: string;
  durationMs: number;
  mimeType: string;
  ext: string;
  capturedAt: string;
}

export interface CaptureDraft {
  eventId: string;
  projectId: string;
  roomId: string;
  reporterId: string;
  gateCode: string | null;
  note: string;
  context: CapturePhoto | null;
  closeups: CapturePhoto[];
  voice: CaptureVoice | null;
}

export const CAPTURE_ERRORS = {
  context: 'Ambil foto konteks dulu. Close-up tanpa konteks sulit dipahami besok.',
  closeups: `Close-up maksimal ${SITE_EVENT_MAX_CLOSEUPS} foto.`,
} as const;

export function canSend(draft: CaptureDraft): { ok: true } | { ok: false; reason: string } {
  if (!draft.context) return { ok: false, reason: CAPTURE_ERRORS.context };
  if (draft.closeups.length > SITE_EVENT_MAX_CLOSEUPS) return { ok: false, reason: CAPTURE_ERRORS.closeups };
  return { ok: true };
}

function photoMedia(p: CapturePhoto, role: 'context' | 'closeup', sortOrder: number): LocalSiteEventMedia {
  return {
    id: p.id,
    localUri: p.photo.uri,
    kind: 'photo',
    role,
    mimeType: p.photo.contentType,
    ext: p.photo.ext,
    durationS: null,
    sortOrder,
    capturedAt: p.photo.capturedAt,
  };
}

export function buildNewSiteEvent(draft: CaptureDraft, nowIso: string): NewSiteEvent {
  const media: LocalSiteEventMedia[] = [];
  if (draft.context) media.push(photoMedia(draft.context, 'context', 0));
  draft.closeups.forEach((p, i) => media.push(photoMedia(p, 'closeup', i + 1)));
  if (draft.voice) {
    media.push({
      id: draft.voice.id,
      localUri: draft.voice.uri,
      kind: 'audio',
      role: 'audio',
      mimeType: draft.voice.mimeType,
      ext: draft.voice.ext,
      durationS: Math.round(draft.voice.durationMs / 100) / 10,
      sortOrder: 0,
      capturedAt: draft.voice.capturedAt,
    });
  }
  const note = draft.note.trim();
  return {
    id: draft.eventId,
    projectId: draft.projectId,
    roomId: draft.roomId,
    reporterId: draft.reporterId,
    gateCode: draft.gateCode,
    rawText: note ? note : null,
    capturedAt: draft.context?.photo.capturedAt ?? nowIso,
    media,
  };
}

export function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}
