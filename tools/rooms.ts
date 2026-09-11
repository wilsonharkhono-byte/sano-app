// SANO - Rooms.
//
// Rooms are the spatial spine: from release 2 every site event is anchored to
// one. They are authored HERE but shaped like DATUM areas (room_code from
// normalizeRoomCode, area_type over DATUM's nine values) so that the release-2
// link is an upsert on (project_code, room_code) rather than a migration
// (spec §2 decision 2).
//
// There is deliberately no renameRoomCode. Before printing, a wrong code is
// fixed by deactivating the room and creating it again; after printing, the
// database refuses outright (096 rooms_freeze_code) because the code is behind
// a physical sticker.
//
// listRooms excludes rows with a NULL room_code; such rows can only come from
// pre-096 data and cannot be labelled or linked.

import { supabase } from './supabase';
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_MAX } from './roomCodes';
import { AREA_TYPES, AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import type { AreaType, Room } from './types';

// One string literal on purpose. supabase-js 2.100 parses a literal select list
// into row types, but a concatenated string types every row as
// GenericStringError, and each `as Room` cast below then fails tsc with TS2352
// (verified 2026-09-11 against the installed version). Do not split it.
const ROOM_COLUMNS =
  'id, project_id, room_code, room_name, floor, area_sqm, area_type, sort_order, datum_area_id, qr_printed_at, active, created_by, created_at';

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listRooms(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Room[]> {
  let q = supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .not('room_code', 'is', null) // app invariant: Room.room_code is a string (tools/types.ts)
    .order('floor', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('room_name', { ascending: true });

  if (!opts.includeInactive) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) {
    console.warn('listRooms failed:', error.message);
    return [];
  }
  return (data ?? []) as Room[];
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface NewRoomInput {
  project_id: string;
  room_name: string;
  floor: string;
  area_type: AreaType;
  sort_order?: number;
  area_sqm?: number | null;
  created_by?: string | null;
  /** Optional explicit code; otherwise derived from floor + name. */
  room_code?: string;
}

export async function createRoom(input: NewRoomInput): Promise<{ room?: Room; error?: string }> {
  const name = input.room_name.trim();
  if (!name) return { error: 'Nama ruangan wajib diisi.' };

  const code = normalizeRoomCode(input.room_code ?? `${input.floor} ${name}`);
  if (!isValidRoomCode(code)) {
    return {
      error: `Kode ruangan "${code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung). Persingkat nama atau lantainya.`,
    };
  }

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      project_id: input.project_id,
      room_code:  code,
      room_name:  name,
      floor:      input.floor.trim() || null,
      area_type:  input.area_type,
      sort_order: input.sort_order ?? 0,
      area_sqm:   input.area_sqm ?? null,
      created_by: input.created_by ?? null,
    })
    .select(ROOM_COLUMNS)
    .single();

  if (error?.code === '23505') {
    return { error: `Kode "${code}" sudah dipakai ruangan lain di proyek ini.` };
  }
  if (error) return { error: error.message };
  return { room: data as Room };
}

/** Everything except the code. The code is never editable - see the header. */
export type RoomPatch = Partial<
  Pick<Room, 'room_name' | 'floor' | 'area_type' | 'sort_order' | 'area_sqm' | 'active'>
>;

export async function updateRoom(id: string, patch: RoomPatch): Promise<{ error?: string }> {
  if (Object.prototype.hasOwnProperty.call(patch, 'room_code')) {
    throw new Error('updateRoom tidak boleh mengubah room_code - kode ruangan bersifat tetap.');
  }
  const { error } = await supabase.from('rooms').update(patch).eq('id', id);
  return { error: error?.message };
}

export async function setRoomActive(id: string, active: boolean): Promise<{ error?: string }> {
  return updateRoom(id, { active });
}

/**
 * The catch-all room. Select-then-insert rather than upsert: the unique index
 * is partial (035:52-53), so ON CONFLICT cannot name it, and a concurrent
 * second call is caught by the 23505 branch and treated as success.
 */
export async function ensureAreaUmum(
  projectId: string,
  createdBy?: string | null,
): Promise<{ room?: Room; error?: string }> {
  const { data: found } = await supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .eq('room_code', AREA_UMUM_CODE)
    .maybeSingle();

  if (found) return { room: found as Room };

  const created = await createRoom({
    project_id: projectId,
    room_name:  AREA_UMUM_NAME,
    floor:      '',
    area_type:  'general',
    sort_order: 9999, // sorts last, per spec §10.2
    room_code:  AREA_UMUM_CODE,
    created_by: createdBy ?? null,
  });

  if (created.error?.includes('sudah dipakai')) {
    const { data } = await supabase
      .from('rooms').select(ROOM_COLUMNS)
      .eq('project_id', projectId).eq('room_code', AREA_UMUM_CODE).maybeSingle();
    return data ? { room: data as Room } : { error: created.error };
  }
  return created;
}

/** Stamped after a label sheet is printed. Reprints do not clear it (spec §8). */
// Any non-null value stamps the rooms. Migration 096's rooms_freeze_code trigger
// replaces it with the database clock (now()), so a phone with a wrong clock
// can never become the printed date shown on the label history.
export async function markRoomsPrinted(ids: string[]): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const { error } = await supabase
    .from('rooms')
    .update({ qr_printed_at: new Date().toISOString() })
    .in('id', ids);
  return { error: error?.message };
}

// ─── Pure: paste import ──────────────────────────────────────────────────────

export interface ParsedRoomRow {
  /** 1-based, so warnings can name the line the user is looking at. */
  line: number;
  floor: string;
  room_name: string;
  area_type: AreaType;
  room_code: string;
  sort_order: number;
}

export interface RoomPasteResult {
  rows: ParsedRoomRow[];
  warnings: string[];
}

/** Indonesian labels, DATUM values, and the shorthands supervisors type. */
const AREA_TYPE_LOOKUP: Record<string, AreaType> = (() => {
  const m: Record<string, AreaType> = {};
  for (const t of AREA_TYPES) {
    m[t.value] = t.value;
    m[t.label.toLowerCase()] = t.value;
  }
  Object.assign(m, {
    'km': 'bathroom', 'toilet': 'bathroom', 'wc': 'bathroom',
    'kamar': 'bedroom',
    'ruang tamu': 'living', 'living room': 'living',
    'koridor': 'circulation', 'tangga': 'circulation', 'lorong': 'circulation',
    'gudang': 'utility', 'shaft': 'utility', 'panel': 'utility',
    'umum': 'general', 'lain-lain': 'general',
  } as Record<string, AreaType>);
  return m;
})();

/**
 * One room per line: `floor <sep> name <sep> area type?`, where <sep> is `|`,
 * a tab or `;`. A single-column line is treated as a bare name.
 *
 * Nothing is silently dropped: every skipped line produces a warning naming its
 * line number and the reason, because a room missing from the import is a room
 * with no QR label and no events.
 */
export function parseRoomPaste(text: string): RoomPasteResult {
  const rows: ParsedRoomRow[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>(); // code → line that claimed it

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i].trim();
    if (!raw) continue;

    const cols = raw.split(/\s*[|;\t]\s*/).map((c) => c.trim());
    const floor = cols.length >= 2 ? cols[0] : '';
    const name = cols.length >= 2 ? cols[1] : cols[0];
    const typeRaw = cols.length >= 3 ? cols[2] : '';

    if (!name) {
      warnings.push(`Baris ${line} dilewati: nama ruangan kosong.`);
      continue;
    }

    let area_type: AreaType = 'general';
    if (typeRaw) {
      const hit = AREA_TYPE_LOOKUP[typeRaw.toLowerCase()];
      if (hit) area_type = hit;
      else warnings.push(`Baris ${line}: tipe area "${typeRaw}" tidak dikenal, dipakai "Umum".`);
    }

    const room_code = normalizeRoomCode(`${floor} ${name}`);
    if (!isValidRoomCode(room_code)) {
      warnings.push(
        `Baris ${line} dilewati: kode "${room_code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung).`,
      );
      continue;
    }

    const claimed = seen.get(room_code);
    if (claimed !== undefined) {
      warnings.push(`Baris ${line} dilewati: kode ${room_code} sudah dipakai baris ${claimed}.`);
      continue;
    }
    seen.set(room_code, line);

    rows.push({ line, floor, room_name: name, area_type, room_code, sort_order: rows.length });
  }

  return { rows, warnings };
}

// ─── Pure: DATUM export ──────────────────────────────────────────────────────

export interface DatumAreaExport {
  area_code: string;
  area_name: string;
  floor: string;
  area_type: AreaType;
  sort_order: number;
}

/**
 * The escape hatch from spec §2 decision 2: rooms in DATUM's own area shape, so
 * a human can hand them to DATUM without SANO ever calling it. Inactive rooms
 * are included - whether an area is retired is DATUM's call, not ours.
 */
export function roomsToDatumAreas(rooms: Room[]): DatumAreaExport[] {
  return rooms.map((r) => ({
    area_code: r.room_code,
    area_name: r.room_name,
    floor: r.floor ?? '',
    area_type: r.area_type,
    sort_order: r.sort_order,
  }));
}
