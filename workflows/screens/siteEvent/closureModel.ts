// SANO - "Selesai" rules (pure). Closure spec 2026-09-26 §3.1 and §3.3.
//
// Migration 105's close_site_event is the rule; this file restates it so the
// form can say what is missing before the round trip, and says it in the same
// words. The database still refuses whatever this file lets through.

import type { SiteEventType } from '../../../tools/types';

export type Requirement = 'wajib' | 'opsional';

export interface ClosureRequirement {
  photo: Requirement;
  note: Requirement;
}

/** 105: a butuh_keputusan note must be at least this long after trimming. */
export const CLOSURE_NOTE_MIN = 10;
/** 097/105: SITE_EVENT_CLOSURE_NOTE above this. */
export const CLOSURE_NOTE_MAX = 500;

/** 105's photo branch names exactly these three types. */
const PHOTO_REQUIRED_TYPES: ReadonlyArray<SiteEventType> = ['cacat', 'isu', 'hambatan'];

export function closureRequirement(type: SiteEventType | null): ClosureRequirement {
  return {
    photo: type !== null && PHOTO_REQUIRED_TYPES.includes(type) ? 'wajib' : 'opsional',
    note: type === 'butuh_keputusan' ? 'wajib' : 'opsional',
  };
}

/**
 * Code points, like Postgres char_length - not UTF-16 units, which count an
 * emoji twice. Callers pass the SENT note (`note.trim()`): JavaScript's trim
 * strips a superset of 105's E' \t\r\n', so the server's trim is a no-op on
 * it and both sides count the same string.
 */
export function noteLength(sent: string): number {
  return Array.from(sent).length;
}

/** The sentence under a disabled "Tandai selesai", or null when the button may be pressed. */
export function closureBlocker(input: { type: SiteEventType | null; hasPhoto: boolean; sentNote: string }): string | null {
  const req = closureRequirement(input.type);
  if (req.photo === 'wajib' && !input.hasPhoto) return 'Ambil foto penutupan dulu.';
  if (req.note === 'wajib' && noteLength(input.sentNote) < CLOSURE_NOTE_MIN) {
    return 'Tulis catatan keputusan, minimal 10 karakter.';
  }
  return null;
}

export interface ClosureCopy {
  photoBadge: string;
  photoHelper: string;
  noteLabel: string;
  noteBadge: string;
  notePlaceholder: string;
  /** Shown under the note field only when the note is required. */
  noteHint: string | null;
  counter: (sentLength: number) => string;
}

/** Every label spec §3.3's table names, per type. */
export function closureCopy(type: SiteEventType | null): ClosureCopy {
  const req = closureRequirement(type);
  const decision = req.note === 'wajib';
  return {
    photoBadge: req.photo === 'wajib' ? 'Wajib' : 'Opsional',
    photoHelper: req.photo === 'wajib'
      ? 'Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.'
      : 'Opsional. Bukti bahwa masalahnya sudah beres.',
    noteLabel: decision ? 'Catatan keputusan' : 'Catatan penutupan',
    noteBadge: decision ? 'Wajib' : 'Opsional',
    notePlaceholder: decision ? 'Apa keputusannya dan siapa yang memutuskan?' : 'Opsional. Apa yang dikerjakan?',
    noteHint: decision ? 'Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?' : null,
    counter: (n) => (decision ? `${n}/${CLOSURE_NOTE_MAX} · minimal ${CLOSURE_NOTE_MIN}` : `${n}/${CLOSURE_NOTE_MAX}`),
  };
}

/** Native: the close is on the phone and in the queue; the status changes only when the server says so. */
export const CLOSE_QUEUED_TOAST = 'Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.';

/** Web: the queue is memory only (captureQueueStore.ts), so nothing survives a closed tab. */
export const WEB_CLOSE_QUEUED_TOAST = 'Dikirim dari tab ini. Jangan tutup halaman sampai status berubah menjadi Selesai.';
