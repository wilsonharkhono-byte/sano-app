// SANO - Client report room grouping (spec 2026-09-10 §10.2).
//
// Pure. Turns a period's curated highlight lines into room groups the
// Finishing-phase renderer prints, and supplies the ONE room comparator both
// the client report and Papan Ruangan sort by, so the two surfaces can never
// disagree about where a room sits (spec §9).
//
// Spec §1.1 protects the renderer structurally: ClientReportRoomGroup carries
// a room label, a gate label and curated text, and has no field for an owner,
// a due date, an event type, a flag or a confidence. An internal value cannot
// leak into a client PDF because there is nowhere to put it.

import { AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import { gateChipLabel } from './gateRefs';
import type { GateRef } from './types';

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
  // "Lantai 2" are the same floor and sort_order takes over.
  if (fa.num === Number.MAX_SAFE_INTEGER && fa.text !== fb.text) return fa.text < fb.text ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.room_name.localeCompare(b.room_name, 'id-ID');
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
 * common gates. Lines with no gate, and codes no active gate matches, are
 * ignored rather than guessed at.
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
  return best ? gateChipLabel(best) : null;
}

/** Room name by id, for photo legends ("Figur 3 · Kamar Mandi Utama"). */
export function roomNameById(rooms: RoomLookupRow[]): Map<string, string> {
  return new Map(rooms.map((r) => [r.id, r.room_name]));
}

/**
 * Group a period's lines by room, ordered by floor then sort_order, Area Umum
 * last. A line whose room_id is null - or points at a room this project no
 * longer lists - falls into Area Umum, so nothing is ever dropped from a client
 * report for lack of a room (spec §10.2).
 */
export function groupHighlightsByRoom(
  lines: GroupableLine[],
  rooms: RoomLookupRow[],
  gates: GateRef[],
): ClientReportRoomGroup[] {
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

  return [...buckets.values()]
    .sort((a, b) => compareRoomsForDisplay(a.room, b.room))
    .map((bucket) => ({
      roomLabel: formatRoomLabel(bucket.room),
      gateLabel: pickGateLabel(bucket.lines, gates),
      updates: bucket.lines.map((l) => ({ date: l.date, area: l.area, note: l.note })),
    }));
}
