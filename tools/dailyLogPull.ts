// SANO - "Tarik dari kejadian ruangan" (spec §10.1).
//
// Pure. Turns a day's CONFIRMED site events into PROPOSED daily-log lines and
// photo offers. It proposes; it never saves. The curated-draft model from the
// 2026-06-28 Blueprint spec is unchanged: every line the client eventually
// reads was read, edited and approved by a human first.
//
// The split that matters: `progres` and `info` were already written for a
// reader and arrive pre-selected. `isu`, `hambatan`, `cacat` and
// `butuh_keputusan` are internal language - a defect list is not a client
// update - so they are LISTED but unchecked, with a note saying they need
// client-safe rewording. Nothing is hidden from the curator and nothing
// internal walks into a report on its own.

import { AREA_UMUM_NAME } from './constants';
import { SITE_MEDIA_PATH_PREFIX } from './storage';
import { compareRoomsForDisplay, type RoomLookupRow } from './clientReportRooms';
import type { DailyLogHighlight, DailyLogPhoto } from './dailySiteLogs';
import type { SiteEventMedia, SiteEventType } from './types';

/** Types whose wording is already safe for a client to read. */
export const CLIENT_SAFE_EVENT_TYPES: ReadonlyArray<SiteEventType> = ['progres', 'info'];

export const REWORDING_NOTE =
  'Tulis ulang dengan bahasa yang aman untuk klien sebelum dimasukkan ke laporan.';

export const PULL_EMPTY_NOTE =
  'Belum ada kejadian terkonfirmasi di tanggal ini.';

/**
 * Conservative signals that a line still carries field/internal language,
 * independent of event_type: money, trade/role names, a request TO the
 * owner, variation-order shorthand, or an internal code. This cannot detect
 * a person's name — nothing can, cheaply — but it catches the categories
 * that actually showed up in the field text this feature is built to pull:
 * payment disputes, scope-change asks, and site jargon. False positives are
 * fine here; a false negative is the failure mode that matters.
 */
export const RISKY_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bowner\b/i,
  /\bminta\b/i,
  /\bVO\b/, // Variation Order; case-sensitive on purpose
  /\bbayar(an)?\b/i,
  /\btukang\b/i,
  /\bmandor\b/i,
  /\bRp\.?\s?\d/i,
  /\d+[.,]?\d*\s?(rb|ribu|jt|juta|m2|m3|m²|m³|kg|ton|sak|zak)\b/i,
  /\bAI\b/,
  /\b[A-Z]{1,3}\.\d+(?:\.\d+)*\b/, // gate/step/chapter codes: B.2, III.A.1
  /\bblocking\b/i,
];

export function hasRiskyLanguage(text: string): boolean {
  return RISKY_TEXT_PATTERNS.some((re) => re.test(text));
}

export const RISKY_TEXT_NOTE = 'Teks dari lapangan, periksa sebelum dipakai.';

export const DISMISSED_NOTE = 'Pernah dihapus dari log ini — periksa sebelum menandainya lagi.';

/** The shape tools/siteEvents.ts hands over; only what a proposal needs. */
export interface PullableEvent {
  id: string;
  event_type: SiteEventType | null;
  title: string | null;
  summary: string | null;
  room_id: string;
  gate_code: string | null;
  confirmed_at: string | null;
  media: Array<Pick<SiteEventMedia, 'id' | 'kind' | 'role' | 'storage_path' | 'sort_order'>>;
}

export interface ProposedHighlight {
  eventId: string;
  eventType: SiteEventType;
  roomLabel: string;
  /** Pre-ticked in the picker. False for the four internal types, risky text, or a dismissed event. */
  preselected: boolean;
  /** Shown as a warning line under the proposal. */
  needsRewording: boolean;
  /** True when the note text itself trips a risky-language signal, independent of event type. */
  flaggedText: boolean;
  /** True when this event's id was previously pulled onto this log and then removed by the curator. */
  wasDismissed: boolean;
  highlight: DailyLogHighlight;
}

export interface ProposedPhoto {
  mediaId: string;
  eventId: string;
  roomLabel: string;
  photo: DailyLogPhoto;
}

function roomOrderIndex(rooms: RoomLookupRow[]): Map<string, number> {
  const ordered = [...rooms].sort(compareRoomsForDisplay);
  return new Map(ordered.map((r, i) => [r.id, i]));
}

function eventOrder(a: PullableEvent, b: PullableEvent, order: Map<string, number>): number {
  const ra = order.get(a.room_id) ?? Number.MAX_SAFE_INTEGER;
  const rb = order.get(b.room_id) ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return String(a.confirmed_at ?? '').localeCompare(String(b.confirmed_at ?? ''));
}

/**
 * One proposal per confirmed event that carries text, ordered the way the board
 * and the report order rooms. An event already pulled into this log (its id is
 * in `alreadyPulled`) is left out, so tapping "Tarik" twice cannot duplicate a
 * line.
 *
 * `dismissed` names events the curator pulled onto this log earlier in this
 * session and then removed. They are still offered again (resurrection is
 * fine — the event still happened), but never pre-ticked and always flagged
 * with `DISMISSED_NOTE`, so a removal is never silently undone by a second
 * "Tarik". This is a session-scoped, in-memory list, not a persisted
 * tombstone: closing and reopening the Daily Log screen forgets it. That is
 * the deliberately simpler option — an honest "we remember within this visit"
 * rather than a DB-backed rejection table this task's scope doesn't call for.
 */
export function proposeHighlightsFromEvents(
  events: PullableEvent[],
  rooms: RoomLookupRow[],
  alreadyPulled: ReadonlyArray<string> = [],
  dismissed: ReadonlyArray<string> = [],
): ProposedHighlight[] {
  const order = roomOrderIndex(rooms);
  const nameById = new Map(rooms.map((r) => [r.id, r.room_name]));
  const pulled = new Set(alreadyPulled);
  const dismissedIds = new Set(dismissed);

  return events
    .filter((e) => e.event_type !== null && !pulled.has(e.id))
    .filter((e) => (e.summary ?? e.title ?? '').trim() !== '')
    .sort((a, b) => eventOrder(a, b, order))
    .map((e) => {
      const type = e.event_type as SiteEventType;
      const roomLabel = nameById.get(e.room_id) ?? AREA_UMUM_NAME;
      const note = (e.summary ?? e.title ?? '').trim();
      const typeSafe = CLIENT_SAFE_EVENT_TYPES.includes(type);
      const flaggedText = hasRiskyLanguage(note);
      const wasDismissed = dismissedIds.has(e.id);
      return {
        eventId: e.id,
        eventType: type,
        roomLabel,
        preselected: typeSafe && !flaggedText && !wasDismissed,
        needsRewording: !typeSafe,
        flaggedText,
        wasDismissed,
        highlight: {
          area: roomLabel,
          note,
          boq_item_id: null,
          sort_order: 0,
          room_id: e.room_id,
          gate_code: e.gate_code,
          source_event_id: e.id,
        },
      };
    });
}

/**
 * Context photos, offered with their room label. Never pre-featured: the
 * curator decides what a client sees, exactly as they do for photos they upload
 * themselves. Captions start empty for the same reason - an internal title is
 * not a caption.
 */
export function proposePhotosFromEvents(
  events: PullableEvent[],
  rooms: RoomLookupRow[],
  alreadyPulled: ReadonlyArray<string> = [],
): ProposedPhoto[] {
  const order = roomOrderIndex(rooms);
  const nameById = new Map(rooms.map((r) => [r.id, r.room_name]));
  const pulled = new Set(alreadyPulled);
  const out: ProposedPhoto[] = [];

  for (const e of [...events].sort((a, b) => eventOrder(a, b, order))) {
    const context = e.media
      .filter((m) => m.kind === 'photo' && m.role === 'context' && !pulled.has(m.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const m of context) {
      out.push({
        mediaId: m.id,
        eventId: e.id,
        roomLabel: nameById.get(e.room_id) ?? AREA_UMUM_NAME,
        photo: {
          // D17: the prefix routes the path to the private site-media bucket,
          // so every renderer that already calls resolvePhotoUrl signs it.
          storage_path: `${SITE_MEDIA_PATH_PREFIX}${m.storage_path}`,
          caption: null,
          is_featured: false,
          captured_at: e.confirmed_at,
          room_id: e.room_id,
          source_media_id: m.id,
        },
      });
    }
  }
  return out;
}

/** Append the picked proposals to the log's existing lines, renumbering as the form does. */
export function mergePulledHighlights(
  existing: DailyLogHighlight[],
  picked: ProposedHighlight[],
): DailyLogHighlight[] {
  const kept = existing.filter((h) => h.area.trim() !== '' || h.note.trim() !== '');
  return [...kept, ...picked.map((p) => p.highlight)].map((h, i) => ({ ...h, sort_order: i }));
}
