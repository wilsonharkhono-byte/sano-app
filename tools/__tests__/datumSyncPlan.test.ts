/**
 * The DATUM sync planner, rooms against areas (spec 2026-09-27 §6.2, §6.4).
 * Pure: what a sync would link, create and only report, with nothing written.
 * The edge function runs a byte-identical copy (datumSyncPlanTwin.test.ts).
 */
import {
  NAME_TOO_LONG,
  codeHeldElsewhere,
  createGateOpen,
  createGateSentence,
  foldText,
  isPlanValidRoomCode,
  normalizeCode,
  planRoomSync,
  type PlanArea,
  type PlanRoom,
} from '../datumSyncPlan';
import { isValidRoomCode, normalizeRoomCode } from '../roomCodes';

const room = (over: Partial<PlanRoom> & { id: string }): PlanRoom => ({
  room_code: over.id.toUpperCase(), room_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0,
  active: true, datum_area_id: null, ...over,
});
const area = (over: Partial<PlanArea> & { id: string; area_code: string }): PlanArea => ({
  area_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0, ...over,
});

describe('normalizeCode', () => {
  // DATUM's own fixtures for normalizeAreaCode (apps/web/tests/unit/area-extract.test.ts:21-34).
  const fixtures: Array<[string, string]> = [
    ['l1 kitchen', 'L1-KITCHEN'],
    ['  km/anak  ', 'KMANAK'],
    ['Living—Lt1!', 'LIVINGLT1'],
    ['a--b-', 'A-B'],
    ['-x-', 'X'],
    ['A'.repeat(60), 'A'.repeat(40)],
  ];

  it.each(fixtures)('normalizes %j to %j, exactly as normalizeRoomCode does', (raw, expected) => {
    expect(normalizeCode(raw)).toBe(expected);
    expect(normalizeCode(raw)).toBe(normalizeRoomCode(raw));
  });

  it('judges codes exactly as isValidRoomCode does, including the 40th-character dash', () => {
    for (const code of ['LT1-KM-1', 'UMUM', '', 'LT1--KM', `${'A'.repeat(39)}-`, 'A'.repeat(41), 'lt1']) {
      expect(isPlanValidRoomCode(code)).toBe(isValidRoomCode(code));
    }
  });
});

describe('planRoomSync', () => {
  it('links an active and a retired room to the area with their code, and leaves already-linked rooms alone', () => {
    const plan = planRoomSync(
      [
        room({ id: 'r1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1' }),
        room({ id: 'r2', room_code: 'LT1-GUDANG', room_name: 'Gudang', active: false }),
        room({ id: 'r3', room_code: 'LT1-DAPUR', room_name: 'Dapur', datum_area_id: 'a3' }),
      ],
      [
        area({ id: 'a1', area_code: 'lt1 km 1', area_name: 'Kamar Mandi 1' }),
        area({ id: 'a2', area_code: 'LT1-GUDANG', area_name: 'Gudang' }),
        area({ id: 'a3', area_code: 'LT1-DAPUR', area_name: 'Dapur' }),
      ],
    );
    expect(plan.link).toEqual([
      { room_id: 'r1', room_code: 'LT1-KM-1', area_id: 'a1' },
      { room_id: 'r2', room_code: 'LT1-GUDANG', area_id: 'a2' },
    ]);
    expect(plan.matchedCount).toBe(3);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly).toEqual([]);
  });

  it('creates only active rooms with no area, in board order, UMUM untracked, and never a retired one', () => {
    const plan = planRoomSync(
      [
        room({ id: 'u', room_code: 'UMUM', room_name: 'Area Umum', floor: null, sort_order: 9999 }),
        room({ id: 'b', room_code: 'LT2-KAMAR', room_name: 'Kamar', floor: 'Lt. 2', sort_order: 0 }),
        room({ id: 'a2', room_code: 'LT1-DAPUR', room_name: 'Dapur', floor: 'Lt. 1', sort_order: 1, area_type: 'kitchen' }),
        room({ id: 'a1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', sort_order: 0, area_type: 'bathroom' }),
        room({ id: 'old', room_code: 'LT1-LAMA', room_name: 'Lama', active: false }),
      ],
      [],
    );
    expect(plan.create.map((c) => [c.area_code, c.tracked])).toEqual([
      ['LT1-KM-1', true], ['LT1-DAPUR', true], ['LT2-KAMAR', true], ['UMUM', false],
    ]);
    expect(plan.create[0]).toEqual({
      room_id: 'a1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', tracked: true,
    });
    expect(plan.retiredMissing).toEqual(['LT1-LAMA']);
    expect(plan.matchedCount).toBe(0);
  });

  it('refuses a name over 120 characters with the sentence, instead of sending it', () => {
    const plan = planRoomSync([room({ id: 'r1', room_code: 'LT1-PANJANG', room_name: 'x'.repeat(121) })], []);
    expect(plan.create).toEqual([]);
    expect(plan.createFailed).toEqual([{ room_code: 'LT1-PANJANG', reason: NAME_TOO_LONG }]);
    expect(NAME_TOO_LONG).toBe('Nama ruangan lebih dari 120 karakter; DATUM menolaknya.');
  });

  it('lists DATUM-only areas by sort order', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1' })],
      [
        area({ id: 'a9', area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 5 }),
        area({ id: 'a1', area_code: 'LT1-KM-1' }),
        area({ id: 'a8', area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade', sort_order: 2 }),
      ],
    );
    expect(plan.datumOnly).toEqual([
      { area_id: 'a8', area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade', sort_order: 2 },
      { area_id: 'a9', area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 5 },
    ]);
  });

  it('treats case and whitespace as no conflict, and a real name, floor or type difference as one row each, still linking', () => {
    const plan = planRoomSync(
      [
        room({ id: 'r1', room_code: 'LT1-KM-1', room_name: ' Kamar  mandi 1 ', floor: 'lt. 1', area_type: 'bathroom' }),
        room({ id: 'r2', room_code: 'LT1-KM-2', room_name: 'Kamar Mandi 2', floor: null, area_type: 'bathroom' }),
      ],
      [
        area({ id: 'a1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom' }),
        area({ id: 'a2', area_code: 'LT1-KM-2', area_name: 'KM Anak', floor: 'Lt. 2', area_type: 'general' }),
      ],
    );
    expect(plan.fieldConflicts).toEqual([
      { room_code: 'LT1-KM-2', field: 'name', sano: 'Kamar Mandi 2', datum: 'KM Anak' },
      { room_code: 'LT1-KM-2', field: 'floor', sano: '', datum: 'Lt. 2' },
      { room_code: 'LT1-KM-2', field: 'area_type', sano: 'bathroom', datum: 'general' },
    ]);
    expect(plan.link.map((l) => l.room_id)).toEqual(['r1', 'r2']);
  });

  it('lists two DATUM areas with one key as a duplicate, and neither links, creates nor imports it', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1' })],
      [area({ id: 'a1', area_code: 'LT1-KM-1' }), area({ id: 'a2', area_code: 'lt1 km 1' }), area({ id: 'a3', area_code: 'X-1' }), area({ id: 'a4', area_code: 'x 1' })],
    );
    expect(plan.datumDuplicates).toEqual([
      { key: 'LT1-KM-1', area_codes: ['LT1-KM-1', 'lt1 km 1'] },
      { key: 'X-1', area_codes: ['X-1', 'x 1'] },
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly).toEqual([]);
    expect(plan.matchedCount).toBe(0);
  });

  it('ignores rooms with no code', () => {
    const plan = planRoomSync([room({ id: 'r1', room_code: null })], [area({ id: 'a1', area_code: 'LT1-KM-1' })]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly.map((a) => a.area_code)).toEqual(['LT1-KM-1']);
  });

  it('keeps the link of a room whose area DATUM re-coded: no create, a code conflict, not DATUM-only', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', datum_area_id: 'a1' })],
      [area({ id: 'a1', area_code: 'LT1-KM-UTAMA', area_name: 'KM Utama' })],
    );
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.createFailed).toEqual([]);
    expect(plan.datumOnly).toEqual([]);
    expect(plan.fieldConflicts).toEqual([
      { room_code: 'LT1-KM-1', field: 'code', sano: 'LT1-KM-1', datum: 'LT1-KM-UTAMA' },
      { room_code: 'LT1-KM-1', field: 'name', sano: 'Kamar Mandi 1', datum: 'KM Utama' },
    ]);
    expect(plan.matchedCount).toBe(1);
    expect(createGateOpen(plan, 1)).toBe(true);
  });

  it('reads a linked area whose code differs only in form as no code conflict', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1', datum_area_id: 'a1' })],
      [area({ id: 'a1', area_code: 'lt1 km 1' })],
    );
    expect(plan.fieldConflicts).toEqual([]);
    expect(plan.link).toEqual([]);
    expect(plan.matchedCount).toBe(1);
  });

  it('falls back to the code when the linked area is gone from DATUM: relinks to the area with that code, or creates it', () => {
    const plan = planRoomSync(
      [
        room({ id: 'r1', room_code: 'LT1-KM-1', datum_area_id: 'gone-1' }),
        room({ id: 'r2', room_code: 'LT1-DAPUR', room_name: 'Dapur', datum_area_id: 'gone-2' }),
        room({ id: 'r3', room_code: 'LT1-GUDANG', datum_area_id: 'gone-3', active: false }),
      ],
      [area({ id: 'a1', area_code: 'LT1-KM-1' })],
    );
    expect(plan.link).toEqual([{ room_id: 'r1', room_code: 'LT1-KM-1', area_id: 'a1' }]);
    expect(plan.create).toEqual([
      { room_id: 'r2', area_code: 'LT1-DAPUR', area_name: 'Dapur', floor: 'Lt. 1', area_type: 'general', tracked: true },
    ]);
    expect(plan.retiredMissing).toEqual(['LT1-GUDANG']);
    expect(plan.datumOnly).toEqual([]);
    expect(plan.matchedCount).toBe(1);
  });

  it('neither links nor creates a room whose code names an area another room holds by link, and says why', () => {
    const plan = planRoomSync(
      [
        room({ id: 'rA', room_code: 'LT1-KM-1', datum_area_id: 'a1' }),
        room({ id: 'rB', room_code: 'LT1-KM-2' }),
        room({ id: 'rC', room_code: 'LT1-KM-3', datum_area_id: 'gone', active: false }),
      ],
      [area({ id: 'a1', area_code: 'LT1-KM-2' }), area({ id: 'a3', area_code: 'LT1-KM-3-OLD' })],
    );
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.createFailed).toEqual([{ room_code: 'LT1-KM-2', reason: codeHeldElsewhere('LT1-KM-2', 'LT1-KM-1') }]);
    expect(plan.fieldConflicts).toEqual([{ room_code: 'LT1-KM-1', field: 'code', sano: 'LT1-KM-1', datum: 'LT1-KM-2' }]);
    expect(plan.datumOnly.map((a) => a.area_id)).toEqual(['a3']);
    expect(plan.retiredMissing).toEqual(['LT1-KM-3']);
    expect(codeHeldElsewhere('LT1-KM-2', 'LT1-KM-1')).toBe(
      'Area DATUM dengan kode LT1-KM-2 sudah tertaut ke ruangan LT1-KM-1. Samakan kodenya di SANO atau DATUM.',
    );
  });

  it('keeps a link into a duplicated DATUM key and still lists the duplicate', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1', datum_area_id: 'a2' })],
      [area({ id: 'a1', area_code: 'LT1-KM-1' }), area({ id: 'a2', area_code: 'lt1 km 1' })],
    );
    expect(plan.datumDuplicates).toEqual([{ key: 'LT1-KM-1', area_codes: ['LT1-KM-1', 'lt1 km 1'] }]);
    expect(plan.link).toEqual([]);
    expect(plan.matchedCount).toBe(1);
    expect(plan.datumOnly).toEqual([]);
  });
});

describe('createGateOpen', () => {
  it('opens when a room matches by code, or DATUM has no areas; stays shut for a project DATUM mapped first', () => {
    const matched = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], [area({ id: 'a1', area_code: 'A-1' })]);
    const strangers = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], [area({ id: 'a1', area_code: 'B-1' })]);
    const empty = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], []);
    expect(createGateOpen(matched, 1)).toBe(true);
    expect(createGateOpen(empty, 0)).toBe(true);
    expect(createGateOpen(strangers, 1)).toBe(false);
    expect(createGateSentence('Citraland K2-7')).toBe(
      'Tidak ada ruangan yang cocok dengan area DATUM proyek Citraland K2-7. Periksa kode proyek DATUM, atau ambil ruangannya dari DATUM.',
    );
  });
});

describe('foldText', () => {
  it('treats null as empty', () => {
    expect(foldText(null)).toBe('');
    expect(foldText('  Lt.   2 ')).toBe('lt. 2');
  });
});
