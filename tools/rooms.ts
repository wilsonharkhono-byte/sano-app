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
//
// Under RLS a filtered UPDATE is not an error: PostgREST matches zero rows and
// Supabase reports error null. updateRoom reports this via the shared
// tools/readBackUpdate.ts helper (CLAUDE.md §12); markRoomsPrinted has its
// own multi-row version of the same idiom, kept inline below.
// setRoomActive inherits this for free - it calls updateRoom.

import { supabase } from './supabase';
import { readBackUpdate } from './readBackUpdate';
import { normalizeRoomCode, normalizeRoomCodeUnsliced, isValidRoomCode, ROOM_CODE_MAX } from './roomCodes';
import { AREA_TYPES, AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import type { AreaType, Room } from './types';

// One string literal on purpose. supabase-js 2.100 parses a literal select list
// into row types, but a concatenated string types every row as
// GenericStringError, and each `as Room` cast below then fails tsc with TS2352
// (verified 2026-09-11 against the installed version). Do not split it.
const ROOM_COLUMNS =
  'id, project_id, room_code, room_name, floor, area_sqm, area_type, sort_order, datum_area_id, qr_printed_at, active, created_by, created_at';

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Either the project's rooms, or an explicit read failure. A fetch failure
 * must never collapse into "no rooms" (CLAUDE.md §12) - that is
 * indistinguishable from a genuinely empty project and would render the same
 * reassuring empty state over an RLS failure or a network blip. `listRooms`
 * below is the pre-existing thin wrapper kept for callers outside this
 * hardening pass; it still swallows the error into `[]`.
 */
export type RoomsResult =
  | { rooms: Room[]; error?: undefined }
  | { rooms: null; error: string };

export async function listRoomsResult(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<RoomsResult> {
  let q = supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .not('room_code', 'is', null) // app invariant: Room.room_code is a string (tools/types.ts)
    // Area Umum has a NULL floor and sort_order 9999, and must sort last,
    // consistent with the report grouping in spec §10.2; rooms without a
    // floor therefore also group at the end.
    .order('floor', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .order('room_name', { ascending: true });

  if (!opts.includeInactive) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) {
    console.warn('listRooms failed:', error.message);
    return { rooms: null, error: error.message };
  }
  return { rooms: (data ?? []) as Room[] };
}

export async function listRooms(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Room[]> {
  const result = await listRoomsResult(projectId, opts);
  return result.rooms ?? [];
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

/**
 * `INVALID_ROOM_CODE` covers both a missing name and a code that fails
 * normalizeRoomCode/isValidRoomCode - either way, no request was sent.
 * `DUPLICATE_ROOM_CODE` is the 23505 branch; `DB_ERROR` is everything else
 * the database returns. Additive to `error`, which keeps its Indonesian
 * message unchanged - this just lets a caller (e.g. ensureAreaUmum) branch
 * on structure instead of matching message substrings.
 */
export type RoomErrorCode = 'INVALID_ROOM_CODE' | 'DUPLICATE_ROOM_CODE' | 'DB_ERROR';

export async function createRoom(
  input: NewRoomInput,
): Promise<{ room?: Room; error?: string; code?: RoomErrorCode }> {
  const name = input.room_name.trim();
  if (!name) return { error: 'Nama ruangan wajib diisi.', code: 'INVALID_ROOM_CODE' };

  const code = normalizeRoomCode(input.room_code ?? `${input.floor} ${name}`);
  if (!isValidRoomCode(code)) {
    return {
      error: `Kode ruangan "${code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung). Persingkat nama atau lantainya.`,
      code: 'INVALID_ROOM_CODE',
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
    return {
      error: `Kode "${code}" sudah dipakai ruangan lain di proyek ini.`,
      code: 'DUPLICATE_ROOM_CODE',
    };
  }
  if (error) return { error: error.message, code: 'DB_ERROR' };
  return { room: data as Room };
}

/** Everything except the code. The code is never editable - see the header. */
export type RoomPatch = Partial<
  Pick<Room, 'room_name' | 'floor' | 'area_type' | 'sort_order' | 'area_sqm' | 'active'>
>;

const ROOM_UPDATE_REFUSED = 'Perubahan ruangan tidak tersimpan. Hanya peran kantor yang dapat mengubah ruangan.';

/**
 * Throws synchronously, before any request, if `patch` contains `room_code` -
 * that is an invariant violation in the caller's code (see the header), not a
 * runtime error to catch and display.
 */
export async function updateRoom(id: string, patch: RoomPatch): Promise<{ error?: string }> {
  if (Object.prototype.hasOwnProperty.call(patch, 'room_code')) {
    throw new Error('updateRoom tidak boleh mengubah room_code - kode ruangan bersifat tetap.');
  }
  const { error } = await readBackUpdate('rooms', patch, 'id', id, 'id', ROOM_UPDATE_REFUSED);
  if (error) return { error };
  return {};
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
  const { data: found, error: findError } = await supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .eq('room_code', AREA_UMUM_CODE)
    .maybeSingle();
  if (findError) console.warn('ensureAreaUmum select failed:', findError.message);

  if (found) return { room: found as Room };

  const created = await createRoom({
    project_id: projectId,
    room_name:  AREA_UMUM_NAME,
    floor:      '',
    area_type:  'general',
    // Sorts last on both keys: floor is NULL (nullsFirst: false in listRooms)
    // and sort_order is 9999, per spec §10.2.
    sort_order: 9999,
    room_code:  AREA_UMUM_CODE,
    created_by: createdBy ?? null,
  });

  if (created.code === 'DUPLICATE_ROOM_CODE') {
    const { data, error: raceError } = await supabase
      .from('rooms').select(ROOM_COLUMNS)
      .eq('project_id', projectId).eq('room_code', AREA_UMUM_CODE).maybeSingle();
    if (raceError) console.warn('ensureAreaUmum select failed:', raceError.message);
    return data ? { room: data as Room } : { error: created.error };
  }
  return created;
}

/** Stamped after a label sheet is printed. Reprints do not clear it (spec §8). */
// Any non-null value stamps the rooms. Migration 096's rooms_freeze_code trigger
// replaces it with the database clock (now()), so a phone with a wrong clock
// can never become the printed date shown on the label history.
export async function markRoomsPrinted(ids: string[]): Promise<{ error?: string }> {
  // Deduped before the query (a caller re-selecting the same room twice) and
  // before the count comparison below, so a duplicate id never reads as a
  // partial-success RLS refusal for a request that actually fully succeeded.
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase
    .from('rooms')
    .update({ qr_printed_at: new Date().toISOString() })
    .in('id', uniqueIds)
    .select('id');
  if (error) return { error: error.message };
  if ((data ?? []).length !== uniqueIds.length) {
    return { error: 'Sebagian ruangan tidak bisa ditandai tercetak (hak akses atau ruangan tidak ditemukan).' };
  }
  return {};
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

/** Column titles a pasted sheet might carry along - never room data. */
const FLOOR_HEADER_WORDS = new Set(['lantai', 'floor', 'lt']);
const NAME_HEADER_WORDS = new Set(['nama', 'nama ruangan', 'ruangan', 'name', 'room']);
/** A leading row-numbering column some sheets carry ("No", "No.", "Nomor", "#", "Urut"). */
const NUMBER_HEADER_WORDS = new Set(['no', 'no.', 'nomor', '#', 'urut']);

/** Lower-cases and drops one trailing dot, so a "Lt." header cell matches "lt". */
function headerWord(cell: string): string {
  return cell.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * True when the header row leads with a numbering column ("No | Lantai |
 * Nama | Tipe") ahead of the floor and name columns. When this is true every
 * data line in the same paste also carries that same leading number, and
 * parseRoomPaste shifts its column reads by one for the rest of the paste -
 * this fix does not change how an ordinary (unnumbered) data line is parsed.
 */
function hasNumberingColumn(cols: string[]): boolean {
  return (
    cols.length >= 3 &&
    NUMBER_HEADER_WORDS.has(headerWord(cols[0])) &&
    FLOOR_HEADER_WORDS.has(headerWord(cols[1])) &&
    NAME_HEADER_WORDS.has(headerWord(cols[2]))
  );
}

/**
 * True only when BOTH the floor and name columns read as titles, so a real
 * room that happens to be named "Ruangan" in a single-column line, or whose
 * floor is blank, is never mistaken for one. Also true for a numbered header
 * that leads with "No"/"Nomor"/"#"/"Urut" ahead of the floor and name columns
 * - see hasNumberingColumn, which the caller uses to decide whether to shift
 * the rest of the paste.
 */
function looksLikeHeaderRow(cols: string[]): boolean {
  if (cols.length < 2) return false;
  if (FLOOR_HEADER_WORDS.has(headerWord(cols[0])) && NAME_HEADER_WORDS.has(headerWord(cols[1]))) {
    return true;
  }
  return hasNumberingColumn(cols);
}

/**
 * Strips one surrounding pair of double quotes from a pasted cell - Excel's
 * own convention when a cell's text contains the separator, a newline, or a
 * literal quote - and then un-escapes a doubled quote ("") back to one,
 * exactly like the CSV escaping rule. Only fires when the cell is actually
 * wrapped in quotes; a bare cell is returned trimmed and otherwise untouched.
 *
 * This does NOT re-honour separators inside the quotes: a cell that still
 * contains "|" after unwrapping is split on it like any other, because the
 * line is already split on separators before any cell reaches this function.
 */
function unquoteCell(cell: string): string {
  const trimmed = cell.trim();
  const stripped = trimmed.replace(/^"(.*)"$/, '$1');
  return stripped === trimmed ? stripped : stripped.replace(/""/g, '"').trim();
}

/**
 * One room per line: `floor <sep> name <sep> area type?`, where <sep> is `|`,
 * a tab or `;`. A single-column line is treated as a bare name. A cell may be
 * quoted (Excel/Sheets paste convention); see unquoteCell for exactly what
 * that strips and un-escapes before anything else runs.
 *
 * Only the first non-blank line is ever checked for a column-title row (e.g.
 * "Lantai | Nama | Tipe" copied along with the sheet) - a later line that
 * happens to read the same way is real data and is kept. When that header
 * line leads with a numbering column ("No | Lantai | Nama | Tipe"), every
 * data line in the paste also carries that same leading number, so the rest
 * of the paste is read shifted one column to the right - see
 * hasNumberingColumn.
 *
 * Nothing is silently dropped: every skipped line produces a warning naming its
 * line number and the reason, because a room missing from the import is a room
 * with no QR label and no events.
 */
export function parseRoomPaste(text: string): RoomPasteResult {
  const rows: ParsedRoomRow[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>(); // code → line that claimed it
  let headerChecked = false;
  // Set only when the header row itself leads with a numbering column; every
  // subsequent line then also carries that leading number and is shifted.
  let numberedColumns = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i].trim();
    if (!raw) continue;

    let cols = raw
      .split(/\s*[|;\t]\s*/)
      .map(unquoteCell);

    if (!headerChecked) {
      headerChecked = true;
      if (looksLikeHeaderRow(cols)) {
        numberedColumns = hasNumberingColumn(cols);
        warnings.push(
          `Baris ${line} dilewati: baris ini terlihat seperti judul kolom ("${cols.join(' | ')}"), bukan data ruangan.`,
        );
        continue;
      }
    }

    if (numberedColumns) cols = cols.slice(1);

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

    const candidate = `${floor} ${name}`;
    const room_code = normalizeRoomCode(candidate);
    if (!isValidRoomCode(room_code)) {
      warnings.push(
        `Baris ${line} dilewati: kode "${room_code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung).`,
      );
      continue;
    }

    if (normalizeRoomCodeUnsliced(candidate).length > ROOM_CODE_MAX) {
      warnings.push(
        `Baris ${line}: kode dipotong ke ${ROOM_CODE_MAX} karakter menjadi "${room_code}". Pertimbangkan nama yang lebih pendek.`,
      );
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
