/**
 * Only the pure halves are covered here. The Supabase halves are thin
 * single-statement wrappers whose real failure modes are RLS and constraint
 * violations - neither reproducible under jest, both covered by the migration
 * self-checks in 096 and by the manual pilot pass in spec §14.
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

import { parseRoomPaste, roomsToDatumAreas } from '../rooms';
import type { Room } from '../types';

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
