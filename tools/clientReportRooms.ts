// SANO - Client report room grouping (spec 2026-09-10 §10.2).
//
// Pure. Turns a period's curated highlight lines into room groups the
// Finishing-phase renderer prints, and supplies the ONE room comparator both
// the client report and Papan Ruangan sort by, so the two surfaces can never
// disagree about where a room sits (spec §9).
//
// Spec §1.1 protects the renderer structurally: a tagged line carries a room
// label, a gate label and curated text, and has no field for an owner, a due
// date, an event type, a flag or a confidence. An internal value cannot leak
// into a client PDF because there is nowhere to put it. `roomId` is the one
// non-label field and it exists only as a grouping key - no code path prints it.

import { AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import type { GateRef } from './types';

/**
 * "B · Basah" - the chip tools/gateRefs.ts `gateChipLabel` composes, and spec
 * §10.2's literal for the client report, so the bare gate letter on it is
 * sanctioned rather than a leaked internal code. Composed here instead of
 * imported because gateRefs.ts creates the Supabase client at module scope,
 * and tools/clientReportHtml.ts imports THIS module to group section 01 at
 * render time - a renderer must stay loadable with no database in scope.
 * clientReportRooms.test.ts pins this against `gateChipLabel` itself, so the
 * two strings cannot drift apart.
 */
function gateChip(gate: GateRef): string {
  return `${gate.code} · ${gate.short_label}`;
}

/** The minimum a row needs to be ordered and labelled: Room and RoomBoardRow both satisfy it. */
export interface DisplayRoom {
  room_code: string | null;
  room_name: string;
  floor: string | null;
  sort_order: number;
}

/** A room that lines can point at. */
export interface RoomLookupRow extends DisplayRoom {
  id: string;
}

/** A curated highlight line, plus the two links migration 098 added. */
export interface GroupableLine {
  date: string;
  area: string;
  note: string;
  room_id: string | null;
  gate_code: string | null;
}

/** What the renderer receives. Curated text, a room label, a gate label. Nothing else. */
export interface ClientReportRoomGroup {
  roomLabel: string;
  gateLabel: string | null;
  updates: Array<{ date: string; area: string; note: string }>;
}

/**
 * The room tags a stored update line carries. Both labels are client-safe
 * display strings frozen when the draft was assembled - the room NAME (never
 * its code) and the gate chip - so an issued report prints what it was sent
 * with even after a room is renamed. `roomId` is a grouping key and the
 * builder's picker value; it is never printed.
 */
export interface RoomTaggedLine {
  roomId?: string | null;
  roomLabel?: string | null;
  gateLabel?: string | null;
}

/** A curated update line plus its room tags: what `updates` holds in a room phase. */
export interface TaggedUpdateLine extends RoomTaggedLine {
  date: string;
  area: string;
  note: string;
}

/** One printed room block. Generic so the renderer keeps the whole update line. */
export interface RoomUpdateGroup<T> {
  roomLabel: string;
  gateLabel: string | null;
  updates: T[];
}

/** Area Umum absolutely last, then rooms with no floor, then floored rooms. */
function orderBucket(room: DisplayRoom): 0 | 1 | 2 {
  if ((room.room_code ?? '').toUpperCase() === AREA_UMUM_CODE) return 2;
  return (room.floor ?? '').trim() === '' ? 1 : 0;
}

/**
 * "Lt. 2" and "2" and "Lantai 2" all rank as floor 2, so a floor column typed
 * three ways still sorts ascending. A label with no digits at all ranks after
 * every numbered floor and then falls back to its own text.
 */
function floorRank(floor: string | null): { num: number; text: string } {
  const trimmed = (floor ?? '').trim();
  const digits = trimmed.match(/-?\d+/);
  return {
    num: digits ? parseInt(digits[0], 10) : Number.MAX_SAFE_INTEGER,
    text: trimmed.toLowerCase(),
  };
}

/**
 * Floor ascending, then rooms.sort_order, then name. Used by the report
 * grouping AND by Papan Ruangan: spec §9 requires both to agree.
 */
export function compareRoomsForDisplay(a: DisplayRoom, b: DisplayRoom): number {
  const ba = orderBucket(a);
  const bb = orderBucket(b);
  if (ba !== bb) return ba - bb;
  const fa = floorRank(a.floor);
  const fb = floorRank(b.floor);
  if (fa.num !== fb.num) return fa.num - fb.num;
  // Text only decides between two labels that carry NO number at all
  // ("Basement" vs "Mezanin"); once a floor number is read, "2", "Lt. 2" and
  // "Lantai 2" are the same floor and sort_order takes over. Deliberately a
  // bare `<` here, not localeCompare: floorRank.text is already lower-cased,
  // so this is a plain UTF-16 code-unit compare with no Intl dependency -
  // the safer choice for this one branch, unlike the name tiebreak below
  // which needs locale-aware ordering for real Indonesian room names.
  if (fa.num === Number.MAX_SAFE_INTEGER && fa.text !== fb.text) return fa.text < fb.text ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.room_name.localeCompare(b.room_name, 'id');
}

/** "Kamar Mandi Utama · Lt. 2". A floor already spelled "Lt. 2" is not prefixed twice. */
export function formatRoomLabel(room: DisplayRoom): string {
  const floor = (room.floor ?? '').trim();
  if (floor === '') return room.room_name;
  const spelled = /^(lt\.?|lantai)\b/i.test(floor) ? floor : `Lt. ${floor}`;
  return `${room.room_name} · ${spelled}`;
}

/**
 * The group's gate chip: the gate most of its lines carry. Ties go to the gate
 * the office ordered first, so the chip never flickers between two equally
 * common gates. Lines with no gate, and codes no gate in the given `gates`
 * list matches, are ignored rather than guessed at. Matching is on code
 * presence only, not `gate.active` - callers building a historical report
 * pass every gate, active or not, so a code a room used before its gate was
 * deactivated still resolves to a label instead of silently dropping out.
 */
function pickGateLabel(lines: GroupableLine[], gates: GateRef[]): string | null {
  const byCode = new Map(gates.map((g) => [g.code, g]));
  const counts = new Map<string, number>();
  for (const line of lines) {
    const code = line.gate_code;
    if (!code || !byCode.has(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: GateRef | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    const gate = byCode.get(code)!;
    if (count > bestCount || (count === bestCount && best !== null && gate.sort_order < best.sort_order)) {
      best = gate;
      bestCount = count;
    }
  }
  return best ? gateChip(best) : null;
}

/** Room name by id, for photo legends ("Figur 3 · Kamar Mandi Utama"). */
export function roomNameById(rooms: RoomLookupRow[]): Map<string, string> {
  return new Map(rooms.map((r) => [r.id, r.room_name]));
}

/**
 * Group a period's lines by room, ordered by floor then sort_order, Area Umum
 * last. A line whose room_id is null - or points at a room this project no
 * longer lists - falls into Area Umum, so nothing is ever dropped from a client
 * report for lack of a room (spec §10.2). Within a room, `updates` keeps the
 * exact order `lines` arrived in - this function never re-sorts by date, so
 * callers that need date order must sort `lines` before passing them in.
 */
export function groupHighlightsByRoom(
  lines: GroupableLine[],
  rooms: RoomLookupRow[],
  gates: GateRef[],
): ClientReportRoomGroup[] {
  return bucketLinesByRoom(lines, rooms).map((bucket) => ({
    roomLabel: formatRoomLabel(bucket.room),
    gateLabel: pickGateLabel(bucket.lines, gates),
    updates: bucket.lines.map((l) => ({ date: l.date, area: l.area, note: l.note })),
  }));
}

/** Shared by groupHighlightsByRoom and tagLinesByRoom: the ordered room buckets. */
function bucketLinesByRoom(
  lines: GroupableLine[],
  rooms: RoomLookupRow[],
): Array<{ room: RoomLookupRow; lines: GroupableLine[] }> {
  // A project whose Area Umum was never created still needs the bucket, or a
  // room-less line would have nowhere to go.
  const fallbackRoom: RoomLookupRow = rooms.find((r) => (r.room_code ?? '').toUpperCase() === AREA_UMUM_CODE)
    ?? { id: '', room_code: AREA_UMUM_CODE, room_name: AREA_UMUM_NAME, floor: null, sort_order: 9999 };

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const buckets = new Map<string, { room: RoomLookupRow; lines: GroupableLine[] }>();

  for (const line of lines) {
    const room = (line.room_id ? byId.get(line.room_id) : undefined) ?? fallbackRoom;
    const bucket = buckets.get(room.id) ?? { room, lines: [] };
    bucket.lines.push(line);
    buckets.set(room.id, bucket);
  }

  return [...buckets.values()].sort((a, b) => compareRoomsForDisplay(a.room, b.room));
}

/**
 * The assembly half of the room model: the same buckets `groupHighlightsByRoom`
 * builds, flattened back into ONE ordered list of lines, each carrying the room
 * and gate LABELS of the bucket it landed in. The draft stores only this list,
 * so the curator's edits, deletions and additions in the report builder are the
 * single source of truth for what prints (spec §1-§3), and `groupUpdatesByRoom`
 * rebuilds the printed blocks from it at render time. Every line of a room
 * carries that room's one chip, so re-grouping reproduces the same chip without
 * re-counting gates.
 */
export function tagLinesByRoom(
  lines: GroupableLine[],
  rooms: RoomLookupRow[],
  gates: GateRef[],
): TaggedUpdateLine[] {
  return bucketLinesByRoom(lines, rooms).flatMap((bucket) => {
    const roomLabel = formatRoomLabel(bucket.room);
    const gateLabel = pickGateLabel(bucket.lines, gates);
    // The synthesized Area Umum fallback has no real row, so no id to carry.
    const roomId = bucket.room.id === '' ? null : bucket.room.id;
    return bucket.lines.map((l) => ({
      date: l.date, area: l.area, note: l.note, roomId, roomLabel, gateLabel,
    }));
  });
}

/**
 * Re-group stored update lines into the blocks the renderer prints. Pure, and
 * deliberately reads ONLY the labels frozen on the lines - it never looks a
 * room up, so an issued snapshot renders identically forever (decision 4).
 *
 * Lines keep the order they are given, which for an assembled draft is already
 * floor then sort_order; Area Umum is forced last. A line the curator added
 * joins the room it was filed under rather than opening a second head, and a
 * line with no room label at all joins Area Umum. When NO line carries a label
 * the result is empty and the caller keeps its flat list - a snapshot frozen
 * before room tagging shipped must not grow a head it was never issued with.
 */
export function groupUpdatesByRoom<T extends RoomTaggedLine>(lines: readonly T[]): Array<RoomUpdateGroup<T>> {
  if (!lines.some((l) => (l.roomLabel ?? '').trim() !== '')) return [];

  const buckets = new Map<string, RoomUpdateGroup<T>>();
  for (const line of lines) {
    const roomLabel = (line.roomLabel ?? '').trim() || AREA_UMUM_NAME;
    // Two rooms can share a display label, so the id decides when there is one.
    // Area Umum is keyed by its label alone: the real UMUM room and an untagged
    // line both belong under the one head.
    const key = roomLabel === AREA_UMUM_NAME ? AREA_UMUM_NAME : ((line.roomId ?? '').trim() || `label:${roomLabel}`);
    const bucket = buckets.get(key) ?? { roomLabel, gateLabel: null, updates: [] };
    bucket.updates.push(line);
    if (bucket.gateLabel === null) bucket.gateLabel = (line.gateLabel ?? '').trim() || null;
    buckets.set(key, bucket);
  }

  const groups = [...buckets.values()].filter((g) => g.updates.length > 0);
  return [
    ...groups.filter((g) => g.roomLabel !== AREA_UMUM_NAME),
    ...groups.filter((g) => g.roomLabel === AREA_UMUM_NAME),
  ];
}
