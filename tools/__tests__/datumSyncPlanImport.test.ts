/**
 * The DATUM sync planner, the import (spec 2026-09-27 §6.3): only codes the
 * user confirmed AND still DATUM-only become rooms.
 */
import {
  IMPORT_GONE,
  importBadCode,
  importRaced,
  planImport,
  planRoomSync,
  type PlanArea,
  type PlanRoom,
} from '../datumSyncPlan';

const room = (over: Partial<PlanRoom> & { id: string }): PlanRoom => ({
  room_code: over.id.toUpperCase(), room_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0,
  active: true, datum_area_id: null, ...over,
});
const area = (over: Partial<PlanArea> & { id: string; area_code: string }): PlanArea => ({
  area_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0, ...over,
});

describe('planImport', () => {
  const plan = planRoomSync(
    [room({ id: 'r1', room_code: 'LT1-KM-1' })],
    [
      area({ id: 'a1', area_code: 'LT1-KM-1' }),
      area({ id: 'a2', area_code: 'LT2-TERAS', area_name: 'Teras Atas', floor: 'Lt. 2', area_type: 'terrace', sort_order: 7 }),
      area({ id: 'a3', area_code: `${'A'.repeat(39)} B`, area_name: 'Kode panjang' }),
    ],
  );

  it('imports only confirmed codes that are still DATUM-only, with code, name, floor, type, order and link', () => {
    const result = planImport(plan, ['LT2-TERAS', 'LT2-TERAS']);
    expect(result).toEqual({
      insert: [{
        area_id: 'a2', area_code: 'LT2-TERAS', room_code: 'LT2-TERAS', room_name: 'Teras Atas', floor: 'Lt. 2',
        area_type: 'terrace', sort_order: 7,
      }],
      skipped: [],
    });
  });

  it('skips a code that is no longer DATUM-only, and a code that cannot become a SANO room code, with reasons', () => {
    const result = planImport(plan, ['LT1-KM-1', 'GONE-1', `${'A'.repeat(39)} B`]);
    expect(result.insert).toEqual([]);
    expect(result.skipped).toEqual([
      { area_code: 'LT1-KM-1', reason: IMPORT_GONE },
      { area_code: 'GONE-1', reason: IMPORT_GONE },
      { area_code: `${'A'.repeat(39)} B`, reason: importBadCode(`${'A'.repeat(39)} B`) },
    ]);
    expect(IMPORT_GONE).toBe('Sudah ada di SANO atau tidak lagi ada di DATUM.');
  });

  it('names the room made in SANO meanwhile', () => {
    expect(importRaced('LT3-RACE')).toBe('Ruangan LT3-RACE sudah dibuat di SANO sebelum impor selesai.');
  });
});
