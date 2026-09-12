// tools/clientReportRooms.ts imports tools/gateRefs.ts for gateChipLabel, and
// that module imports the Supabase client at load time. Nothing here touches
// the network, so the client is stubbed away entirely.
jest.mock('../supabase', () => ({ supabase: {} }));

import {
  compareRoomsForDisplay, formatRoomLabel, groupHighlightsByRoom, roomNameById,
  type GroupableLine, type RoomLookupRow,
} from '../clientReportRooms';
import type { GateRef } from '../types';

const gate = (code: string, short: string, sort_order: number): GateRef => ({
  code, name_id: short, short_label: short, description: null, sort_order, active: true,
  datum_gate_code: null, created_at: '2026-09-01T00:00:00Z',
});
const GATES: GateRef[] = [gate('B', 'Basah', 2), gate('D', 'Finishing', 4)];

const room = (id: string, name: string, floor: string | null, sort_order: number, code = id.toUpperCase()): RoomLookupRow =>
  ({ id, room_code: code, room_name: name, floor, sort_order });

const ROOMS: RoomLookupRow[] = [
  room('r2', 'Kamar Mandi Utama', '2', 0),
  room('r1', 'Ruang Keluarga', '1', 1),
  room('r10', 'Loteng', '10', 0),
  room('rx', 'Gudang', null, 0),
  room('ru', 'Area Umum', null, 9999, 'UMUM'),
];

// Deterministic PRNG (mulberry32) so the shuffle-then-sort test below is
// reproducible across runs and CI machines - no flakiness from Math.random.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Numbered floors, floor labels with no digits at all ("Basement", "Mezanin",
// "Dasar", "Atap" - the module's own example set), and a null floor together,
// so the comparator's full bucket/floorRank/text-fallback path gets exercised
// at once.
const MIXED_FLOOR_ROOMS: RoomLookupRow[] = [
  room('m1', 'Mezanin Room', 'Mezanin', 0),
  room('m2', 'Basement Storage', 'Basement', 0),
  room('m3', 'Dasar Room', 'Dasar', 0),
  room('m4', 'Atap Room', 'Atap', 0),
  room('m5', 'Kamar Mandi Utama', '2', 0),
  room('m6', 'Ruang Keluarga', '1', 0),
  room('m7', 'Gudang', null, 0),
];
// Numbered floors ascending (Ruang Keluarga, Kamar Mandi Utama), then the
// no-digit floors text-sorted ("atap" < "basement" < "dasar" < "mezanin"),
// then the floorless room last - exactly what floorRank's doc comment and
// compareRoomsForDisplay's line-80 comment both promise.
const MIXED_FLOOR_EXPECTED_IDS = ['m6', 'm5', 'm4', 'm2', 'm3', 'm1', 'm7'];

const line = (area: string, note: string, room_id: string | null, gate_code: string | null): GroupableLine =>
  ({ date: '14 Jun', area, note, room_id, gate_code });

describe('compareRoomsForDisplay', () => {
  it('orders by floor ascending, numerically, with 10 after 2', () => {
    const sorted = [...ROOMS].sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['Ruang Keluarga', 'Kamar Mandi Utama', 'Loteng', 'Gudang', 'Area Umum']);
  });

  it('puts floorless rooms after every floored room and Area Umum after those', () => {
    const sorted = [room('ru', 'Area Umum', null, 9999, 'UMUM'), room('rx', 'Gudang', null, 0), room('r1', 'A', '3', 0)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['A', 'Gudang', 'Area Umum']);
  });

  it('breaks a floor tie on sort_order, then on name', () => {
    const sorted = [room('c', 'C', '1', 5), room('a', 'A', '1', 5), room('b', 'B', '1', 1)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['B', 'A', 'C']);
  });

  it('ranks "Lt. 2", "2" and "Lantai 2" as the same floor', () => {
    const sorted = [room('a', 'A', 'Lantai 2', 2), room('b', 'B', '2', 1), room('c', 'C', 'Lt. 2', 0)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['C', 'B', 'A']);
  });

  it('ranks numbered floors first, then no-digit floor labels by text, then floorless', () => {
    const sorted = [...MIXED_FLOOR_ROOMS].sort(compareRoomsForDisplay).map((r) => r.id);
    expect(sorted).toEqual(MIXED_FLOOR_EXPECTED_IDS);
  });

  it('sorts the mixed-floor fixture the same way regardless of input order (shuffled, fixed seed)', () => {
    const rand = mulberry32(20260910);
    for (let i = 0; i < 25; i++) {
      const shuffled = shuffle(MIXED_FLOOR_ROOMS, rand);
      expect(shuffled.sort(compareRoomsForDisplay).map((r) => r.id)).toEqual(MIXED_FLOOR_EXPECTED_IDS);
    }
  });
});

describe('formatRoomLabel', () => {
  it('reads "Kamar Mandi Utama · Lt. 2"', () => {
    expect(formatRoomLabel(ROOMS[0])).toBe('Kamar Mandi Utama · Lt. 2');
  });
  it('does not spell the floor prefix twice', () => {
    expect(formatRoomLabel(room('a', 'Balkon', 'Lt. 3', 0))).toBe('Balkon · Lt. 3');
    expect(formatRoomLabel(room('a', 'Balkon', 'Lantai 3', 0))).toBe('Balkon · Lantai 3');
  });
  it('drops the separator when there is no floor', () => {
    expect(formatRoomLabel(room('a', 'Area Umum', null, 9999, 'UMUM'))).toBe('Area Umum');
  });
});

describe('groupHighlightsByRoom', () => {
  it('orders groups by floor then sort_order, Area Umum last', () => {
    const groups = groupHighlightsByRoom([
      line('Plafon', 'Rangka terpasang', 'r10', null),
      line('Dinding', 'Aci selesai', 'r1', 'B'),
      line('Halaman', 'Bongkaran diangkut', 'ru', null),
      line('Lantai', 'Keramik dipasang', 'r2', 'D'),
    ], ROOMS, GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual([
      'Ruang Keluarga · Lt. 1', 'Kamar Mandi Utama · Lt. 2', 'Loteng · Lt. 10', 'Area Umum',
    ]);
  });

  it('drops a line into Area Umum when it has no room, rather than dropping the line', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Pagar sementara dipasang', null, null)], ROOMS, GATES);
    expect(groups).toHaveLength(1);
    expect(groups[0].roomLabel).toBe('Area Umum');
    expect(groups[0].updates).toEqual([{ date: '14 Jun', area: 'Umum', note: 'Pagar sementara dipasang' }]);
  });

  it('still buckets a room-less line when the project never created Area Umum', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Catatan', null, null)], [ROOMS[0]], GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual(['Area Umum']);
  });

  it('buckets a line whose room is not in this project into Area Umum too', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Catatan', 'gone', null)], ROOMS, GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual(['Area Umum']);
  });

  it('chips the gate most of the group carries, ties going to the office ordering', () => {
    const groups = groupHighlightsByRoom([
      line('A', 'a', 'r2', 'B'), line('B', 'b', 'r2', 'D'), line('C', 'c', 'r2', 'B'),
    ], ROOMS, GATES);
    expect(groups[0].gateLabel).toBe('B · Basah');

    const tie = groupHighlightsByRoom([line('A', 'a', 'r2', 'D'), line('B', 'b', 'r2', 'B')], ROOMS, GATES);
    expect(tie[0].gateLabel).toBe('B · Basah');
  });

  it('leaves the chip off when no line carries a known gate', () => {
    expect(groupHighlightsByRoom([line('A', 'a', 'r2', null)], ROOMS, GATES)[0].gateLabel).toBeNull();
    expect(groupHighlightsByRoom([line('A', 'a', 'r2', 'Z')], ROOMS, GATES)[0].gateLabel).toBeNull();
  });

  it('keeps the curated line order inside a group and carries nothing but its text', () => {
    const groups = groupHighlightsByRoom([
      line('Satu', 'pertama', 'r2', null), line('Dua', 'kedua', 'r2', null),
    ], ROOMS, GATES);
    expect(groups[0].updates.map((u) => u.area)).toEqual(['Satu', 'Dua']);
    expect(Object.keys(groups[0].updates[0]).sort()).toEqual(['area', 'date', 'note']);
  });
});

describe('roomNameById', () => {
  it('maps a photo room to its bare name for the figure legend', () => {
    expect(roomNameById(ROOMS).get('r2')).toBe('Kamar Mandi Utama');
  });
});
