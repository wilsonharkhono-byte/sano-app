/**
 * The pure halves (parseRoomPaste, roomsToDatumAreas) are fully covered here.
 * For the Supabase halves, only the branching logic is testable under jest -
 * mapping a 23505 conflict to DUPLICATE_ROOM_CODE, short-circuiting before any
 * request on an invalid code, and ensureAreaUmum's select-then-insert-then-
 * recover race, including its discarded-read warnings. Real RLS and
 * constraint failures are not reproducible here; those stay covered by the
 * migration self-checks in 096 and the manual pilot pass in spec §14.
 *
 * parseRoomPaste is the one place a human hands the system a list, so its
 * refusals matter: a room silently dropped from an import is a room with no
 * label, and a duplicate code is a second physical sticker pointing at the
 * first room's history.
 */
// tools/supabase.ts pulls in untransformed ESM (react-native-url-polyfill),
// which jest cannot load. The pure helpers never touch the client, but the
// module-level import still has to be stubbed.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import { parseRoomPaste, roomsToDatumAreas, createRoom, ensureAreaUmum } from '../rooms';
import type { Room } from '../types';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

const room = (over: Partial<Room>): Room => ({
  id: 'r1', project_id: 'p1', room_code: 'UMUM', room_name: 'Area Umum',
  floor: null, area_sqm: null, area_type: 'general', sort_order: 0,
  datum_area_id: null, qr_printed_at: null, active: true, created_by: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

describe('parseRoomPaste', () => {
  it('accepts pipe, tab and semicolon as the column separator', () => {
    const a = parseRoomPaste('Lt. 2 | Kamar Mandi Utama');
    const b = parseRoomPaste('Lt. 2\tKamar Mandi Utama');
    const c = parseRoomPaste('Lt. 2 ; Kamar Mandi Utama');
    for (const r of [a, b, c]) {
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        floor: 'Lt. 2', room_name: 'Kamar Mandi Utama',
        room_code: 'LT-2-KAMAR-MANDI-UTAMA', area_type: 'general',
      });
    }
  });

  it('derives the code from floor + name, in that order', () => {
    const { rows } = parseRoomPaste('Lt. 1 | Dapur');
    expect(rows[0].room_code).toBe('LT-1-DAPUR');
  });

  it('reads a third column as the area type, in Indonesian or English', () => {
    const { rows } = parseRoomPaste('Lt. 2 | Kamar Mandi Utama | Kamar mandi\nLt. 1 | Dapur | kitchen');
    expect(rows[0].area_type).toBe('bathroom');
    expect(rows[1].area_type).toBe('kitchen');
  });

  it('falls back to general and warns on an unknown area type', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 2 | Musholla | Surau');
    expect(rows[0].area_type).toBe('general');
    expect(warnings.join(' ')).toMatch(/Baris 1.*Surau.*Umum/);
  });

  it('skips blank lines without warning about them', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Dapur\n\n   \nLt. 2 | Kamar Tidur');
    expect(rows).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it('accepts a name-only line (no floor)', () => {
    const { rows } = parseRoomPaste('Dapur');
    expect(rows[0]).toMatchObject({ floor: '', room_name: 'Dapur', room_code: 'DAPUR' });
  });

  it('drops a duplicate code and names both line numbers', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Dapur\nLt. 1 | dapur');
    expect(rows).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/Baris 2.*LT-1-DAPUR.*baris 1/i);
  });

  it('drops a line whose code does not survive normalization', () => {
    const { rows, warnings } = parseRoomPaste('!!! | ???');
    expect(rows).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/Baris 1/);
  });

  it('drops a line whose 40-character slice left an invalid code', () => {
    const { rows, warnings } = parseRoomPaste('RUANG TAMU UTAMA | LANTAI DUA SAYAP BARAT DEPAN');
    expect(rows).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/40/);
  });

  it('numbers rows from 0 in sort_order, in paste order', () => {
    const { rows } = parseRoomPaste('Lt. 1 | Dapur\nLt. 1 | Ruang Makan');
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  it('returns nothing for empty input', () => {
    expect(parseRoomPaste('').rows).toHaveLength(0);
    expect(parseRoomPaste('   \n  ').rows).toHaveLength(0);
  });

  it('strips one pair of surrounding double quotes from each cell', () => {
    const { rows } = parseRoomPaste('"Lt. 2" | "Kamar Mandi Utama"');
    expect(rows[0]).toMatchObject({ floor: 'Lt. 2', room_name: 'Kamar Mandi Utama' });
  });

  it('keeps a row but warns when the 40-character slice truncates a still-valid code', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Kamar Tidur Utama Dengan Kamar Mandi Dalam');
    expect(rows).toHaveLength(1);
    expect(rows[0].room_code).toBe('LT-1-KAMAR-TIDUR-UTAMA-DENGAN-KAMAR-MAND');
    expect(rows[0].room_code.length).toBe(40);
    expect(warnings.join(' ')).toMatch(/Baris 1.*dipotong ke 40.*KAMAR-MAND/);
  });
});

describe('parseRoomPaste - header row detection', () => {
  it('skips a column-title first line and names it in the warning', () => {
    const { rows, warnings } = parseRoomPaste('Lantai | Nama | Tipe\nLt. 1 | Dapur | Dapur');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ floor: 'Lt. 1', room_name: 'Dapur' });
    expect(warnings.join(' ')).toMatch(/Baris 1.*judul kolom/i);
  });

  it('does not false-positive on an ordinary first data line', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Dapur');
    expect(rows).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('only checks the first non-blank line - a header-like line later is data', () => {
    const { rows, warnings } = parseRoomPaste(
      'Lt. 1 | Dapur\nLt. 2 | Kamar Tidur\nLantai | Nama | Tipe',
    );
    expect(rows).toHaveLength(3);
    expect(warnings.join(' ')).not.toMatch(/judul kolom/i);
  });
});

describe('roomsToDatumAreas', () => {
  it('emits DATUM area shape and nothing else', () => {
    const out = roomsToDatumAreas([
      room({ room_code: 'LT-2-KM', room_name: 'Kamar Mandi', floor: 'Lt. 2', area_type: 'bathroom', sort_order: 3 }),
    ]);
    expect(out).toEqual([
      { area_code: 'LT-2-KM', area_name: 'Kamar Mandi', floor: 'Lt. 2', area_type: 'bathroom', sort_order: 3 },
    ]);
  });

  it('sends an empty string rather than null for a missing floor', () => {
    expect(roomsToDatumAreas([room({ floor: null })])[0].floor).toBe('');
  });

  it('exports inactive rooms too - DATUM decides, not SANO', () => {
    expect(roomsToDatumAreas([room({ active: false })])).toHaveLength(1);
  });
});

describe('createRoom (Supabase mocked)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps a 23505 insert conflict to the duplicate message and code', async () => {
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(insertChain);

    const result = await createRoom({
      project_id: 'p1', room_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen',
    });

    expect(result.code).toBe('DUPLICATE_ROOM_CODE');
    expect(result.error).toMatch(/sudah dipakai/);
  });

  it('refuses an invalid room code before touching the database', async () => {
    const result = await createRoom({
      project_id: 'p1', room_name: '!!!', floor: '###', area_type: 'general',
    });

    expect(result.code).toBe('INVALID_ROOM_CODE');
    expect(result.error).toMatch(/tidak valid/);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

describe('ensureAreaUmum (Supabase mocked)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the existing Area Umum room when the first select finds it', async () => {
    const existing = room({ room_code: 'UMUM' });
    const selectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: existing, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(selectChain);

    const result = await ensureAreaUmum('p1');

    expect(result.room).toEqual(existing);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('recovers after a simulated race: select misses, insert 23505s, re-select finds it', async () => {
    const existing = room({ room_code: 'UMUM' });
    const firstSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    };
    const raceSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: existing, error: null }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(firstSelectChain) // ensureAreaUmum's own select
      .mockReturnValueOnce(insertChain)      // createRoom's insert
      .mockReturnValueOnce(raceSelectChain); // re-select after the 23505

    const result = await ensureAreaUmum('p1', 'user-1');

    expect(result.room).toEqual(existing);
    expect(mockSupabase.from).toHaveBeenCalledTimes(3);
  });

  it('warns but continues past an errored initial select, falling through to create', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const created = room({ room_code: 'UMUM' });
    const failingSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: 'network blip' } }),
    };
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: created, error: null }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(failingSelectChain)
      .mockReturnValueOnce(insertChain);

    const result = await ensureAreaUmum('p1');

    expect(warnSpy).toHaveBeenCalledWith('ensureAreaUmum select failed:', 'network blip');
    expect(result.room).toEqual(created);
    warnSpy.mockRestore();
  });

  it('warns but continues past an errored re-select after a race, surfacing the conflict error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const firstSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    };
    const raceSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: 'still down' } }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(firstSelectChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(raceSelectChain);

    const result = await ensureAreaUmum('p1');

    expect(warnSpy).toHaveBeenCalledWith('ensureAreaUmum select failed:', 'still down');
    expect(result.error).toMatch(/sudah dipakai/);
    warnSpy.mockRestore();
  });
});
