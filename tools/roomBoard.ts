// SANO - Papan Ruangan (spec §9).
//
// One read of v_room_board (migration 097) plus the pure summary, filter and
// age rules the three role layouts share. The board and the Finishing-phase
// client report order rooms with the SAME comparator
// (tools/clientReportRooms.ts), so they can never disagree about where a room
// sits.
//
// Nothing here derives a verdict. The view counts what is open, what is
// overdue and when the room was last touched; a room with no events reads
// "Belum ada kejadian", never "selesai".

import { supabase } from './supabase';
import { compareRoomsForDisplay } from './clientReportRooms';
import { SITE_EVENT_TYPE_LABELS } from './constants';
import type { RoomBoardRow, SiteEventType } from './types';

/** Every column of v_room_board, one literal (see the ROOM_COLUMNS note in tools/rooms.ts). */
export const ROOM_BOARD_COLUMNS =
  'room_id, project_id, room_code, room_name, floor, sort_order, area_type, active, ' +
  'open_progres, open_isu, open_hambatan, open_cacat, open_butuh_keputusan, open_info, ' +
  'overdue_count, last_event_at, last_gate_code, last_step_code, is_quiet, owner_initials';

export async function listRoomBoard(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<RoomBoardRow[]> {
  let q = supabase.from('v_room_board').select(ROOM_BOARD_COLUMNS).eq('project_id', projectId);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) {
    console.warn('listRoomBoard failed:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as RoomBoardRow[]).slice().sort(compareRoomsForDisplay);
}

// ─── Pure ────────────────────────────────────────────────────────────────────

export const OPEN_COUNT_COLUMNS: Record<SiteEventType, keyof RoomBoardRow> = {
  progres: 'open_progres',
  isu: 'open_isu',
  hambatan: 'open_hambatan',
  cacat: 'open_cacat',
  butuh_keputusan: 'open_butuh_keputusan',
  info: 'open_info',
};

export function openCount(row: RoomBoardRow, type: SiteEventType): number {
  return Number(row[OPEN_COUNT_COLUMNS[type]] ?? 0);
}

/** The four numbers in the strip above the cards (spec §9). */
export interface BoardSummary {
  hambatan: number;
  overdue: number;
  butuhKeputusan: number;
  quietRooms: number;
}

export function boardSummary(rows: RoomBoardRow[]): BoardSummary {
  return rows.reduce<BoardSummary>((acc, r) => ({
    hambatan: acc.hambatan + Number(r.open_hambatan ?? 0),
    overdue: acc.overdue + Number(r.overdue_count ?? 0),
    butuhKeputusan: acc.butuhKeputusan + Number(r.open_butuh_keputusan ?? 0),
    // A room with no event at all is not "quiet since an update stopped"; it
    // has simply never been used, and counting it would inflate the number the
    // PM acts on. The view's is_quiet covers both, so the strip narrows it.
    quietRooms: acc.quietRooms + (r.is_quiet && r.last_event_at !== null ? 1 : 0),
  }), { hambatan: 0, overdue: 0, butuhKeputusan: 0, quietRooms: 0 });
}

export interface BoardFilters {
  floor?: string | null;
  eventType?: SiteEventType | null;
  /** Owner initials as v_room_board reports them; the picker offers only what is on the board. */
  owner?: string | null;
  overdueOnly?: boolean;
}

export function filterBoard(rows: RoomBoardRow[], f: BoardFilters): RoomBoardRow[] {
  return rows.filter((r) => {
    if (f.floor != null && (r.floor ?? '') !== f.floor) return false;
    if (f.eventType && openCount(r, f.eventType) === 0) return false;
    if (f.owner && !(r.owner_initials ?? []).includes(f.owner)) return false;
    if (f.overdueOnly && Number(r.overdue_count ?? 0) === 0) return false;
    return true;
  });
}

/** Floor values present on the board, in board order, "" for the floorless ones. */
export function floorOptions(rows: RoomBoardRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const floor = r.floor ?? '';
    if (!seen.includes(floor)) seen.push(floor);
  }
  return seen;
}

/** Owner initials present on the board, sorted, deduplicated. */
export function ownerOptions(rows: RoomBoardRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const i of r.owner_initials ?? []) set.add(i);
  return [...set].sort();
}

/** "Hari ini" / "2 hari lalu" / "Belum ada kejadian". Never guesses a date. */
export function lastUpdateLabel(lastEventAt: string | null, now: Date = new Date()): string {
  if (!lastEventAt) return 'Belum ada kejadian';
  const then = new Date(lastEventAt);
  if (Number.isNaN(then.getTime())) return 'Belum ada kejadian';
  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  return `${days} hari lalu`;
}

/** The chips a card shows: only the types that actually have open events. */
export function openChips(row: RoomBoardRow): Array<{ type: SiteEventType; label: string; count: number }> {
  return (Object.keys(OPEN_COUNT_COLUMNS) as SiteEventType[])
    .map((type) => ({ type, label: SITE_EVENT_TYPE_LABELS[type], count: openCount(row, type) }))
    .filter((c) => c.count > 0);
}
