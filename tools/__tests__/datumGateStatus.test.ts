/**
 * DATUM readiness on Papan Ruangan (spec 2026-09-27 §8.2): DATUM's own word,
 * marked old when old, and never "no news" where SANO simply does not know.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import {
  DATUM_READINESS_LABELS,
  datumAsOfLabel,
  datumChipsForRoom,
  listDatumGateStatus,
  type DatumGateRow,
  type DatumGateStatusResult,
} from '../datumGateStatus';

const mocked = supabase as unknown as { from: jest.Mock };
const calls: string[] = [];

/** Records every builder call and resolves to `result` whichever method is awaited last. */
function chain(table: string, result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${table}.${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

function tables(results: Record<string, { data: unknown; error: unknown }>) {
  mocked.from.mockImplementation((table: string) => chain(table, results[table] ?? { data: null, error: null }));
}

const NOW = '2026-09-27T03:00:00.000Z'; // 10.00 WIB
const row = (over: Partial<DatumGateRow> = {}): DatumGateRow => ({
  room_id: 'r1', gate_code: 'A', datum_area_id: 'a1', status: 'passed', datum_stale: false, synced_at: '2026-09-27T02:00:00.000Z', ...over,
});
const paired = (over: Partial<Extract<DatumGateStatusResult, { paired: true }>> = {}): DatumGateStatusResult => ({
  paired: true, lastGateReadAt: '2026-09-27T02:00:00.000Z', readAreaIds: ['a1'], roomLinks: { r1: 'a1' }, rows: [row()], ...over,
});

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
});

describe('listDatumGateStatus', () => {
  it('says unpaired, and reads nothing else, when the project has no DATUM code', async () => {
    tables({ projects: { data: { datum_project_code: null }, error: null } });
    expect(await listDatumGateStatus('p1')).toEqual({ paired: false });
    expect(mocked.from).toHaveBeenCalledTimes(1);
  });

  it('reads the last good gate read, the room links and the cache for a paired project', async () => {
    tables({
      projects: { data: { datum_project_code: 'K2-7' }, error: null },
      datum_sync_runs: { data: { finished_at: '2026-09-27T02:00:00.000Z', gate_area_ids: ['a1'] }, error: null },
      rooms: { data: [{ id: 'r1', datum_area_id: 'a1' }, { id: 'r2', datum_area_id: null }], error: null },
      room_datum_gate_status: { data: [row()], error: null },
    });
    expect(await listDatumGateStatus('p1')).toEqual({
      paired: true, lastGateReadAt: '2026-09-27T02:00:00.000Z', readAreaIds: ['a1'], roomLinks: { r1: 'a1', r2: null }, rows: [row()],
    });
    expect(calls).toContain('datum_sync_runs.select:"finished_at, gate_area_ids:counts->gate_area_ids"');
    expect(calls).toContain('datum_sync_runs.eq:"counts->steps->>gate_status":"ok"');
    expect(calls).toContain('datum_sync_runs.order:"finished_at":{"ascending":false}');
    expect(calls).toContain('room_datum_gate_status.eq:"project_id":"p1"');
  });

  it('returns the error, never an empty board, when any read fails or throws', async () => {
    tables({ projects: { data: null, error: { message: 'offline' } } });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'offline' });
    tables({
      projects: { data: { datum_project_code: 'K2-7' }, error: null },
      room_datum_gate_status: { data: null, error: { message: 'relation does not exist' } },
    });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'relation does not exist' });
    mocked.from.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'boom' });
  });
});

describe('datumChipsForRoom', () => {
  it('shows nothing while loading, for an unpaired project, and on a read error (the board says why once)', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, null, NOW)).toEqual({ kind: 'hidden' });
    expect(datumChipsForRoom({ room_id: 'r1' }, { paired: false }, NOW)).toEqual({ kind: 'hidden' });
    expect(datumChipsForRoom({ room_id: 'r1' }, { error: 'x' }, NOW)).toEqual({ kind: 'hidden' });
  });

  it('says never for an unlinked room, and for a project whose gate read never succeeded', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ roomLinks: { r1: null } }), NOW)).toEqual({ kind: 'never' });
    expect(datumChipsForRoom({ room_id: 'r9' }, paired(), NOW)).toEqual({ kind: 'never' });
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ lastGateReadAt: null }), NOW)).toEqual({ kind: 'never' });
  });

  it('says DATUM holds nothing only when the last good read covered the area, ignoring rows for another area', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [] }), NOW)).toEqual({ kind: 'none' });
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ datum_area_id: 'old-area' })] }), NOW)).toEqual({ kind: 'none' });
  });

  it('says never, not "nothing", for a room linked after the last good read', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [], readAreaIds: ['other-area'] }), NOW)).toEqual({ kind: 'never' });
  });

  it('shows one chip per gate in gate order with the fixed label, and the time SANO read it', () => {
    const state = datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ gate_code: 'B', status: 'blocked' }), row()] }), NOW);
    expect(state).toEqual({
      kind: 'chips',
      chips: [
        { gate_code: 'A', status: 'passed', label: 'lolos' },
        { gate_code: 'B', status: 'blocked', label: 'terhambat' },
      ],
      asOf: '09.00',
      old: false,
      datumStale: false,
    });
  });

  it('marks chips old only past 24 hours', () => {
    const at = (iso: string) => datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ synced_at: iso })] }), NOW);
    expect(at('2026-09-26T03:00:00.000Z')).toMatchObject({ old: false });
    expect(at('2026-09-26T02:59:59.000Z')).toMatchObject({ old: true, asOf: '26 Sep 09.59' });
  });

  it("flags DATUM's own stale rows", () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row(), row({ gate_code: 'B', datum_stale: true })] }), NOW)).toMatchObject({ datumStale: true });
  });
});

describe('labels and times', () => {
  it('names the six DATUM states exactly', () => {
    expect(DATUM_READINESS_LABELS).toEqual({
      not_started: 'belum mulai',
      in_progress: 'berjalan',
      ready_for_handoff: 'siap serah terima',
      blocked: 'terhambat',
      passed: 'lolos',
      not_applicable: 'tidak berlaku',
    });
  });

  it('reads HH.mm today and a date otherwise, across WIB midnight (17:00 UTC)', () => {
    expect(datumAsOfLabel('2026-09-27T16:59:00.000Z', '2026-09-27T16:59:30.000Z')).toBe('23.59');
    expect(datumAsOfLabel('2026-09-27T16:59:00.000Z', '2026-09-27T17:00:30.000Z')).toBe('27 Sep 23.59');
    expect(datumAsOfLabel('2026-09-27T17:00:00.000Z', '2026-09-27T17:00:30.000Z')).toBe('00.00');
  });
});
