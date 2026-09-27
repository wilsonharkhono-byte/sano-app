/**
 * The app's side of the DATUM sync (spec 2026-09-27 §7, §8.1): who may pair
 * and sync, every refusal as a sentence, and the card's read, which never
 * turns a failed read into "belum pernah".
 */
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));

import { supabase } from '../supabase';
import {
  DATUM_IMPORT_FORBIDDEN,
  DATUM_SYNC_FORBIDDEN,
  DATUM_SYNC_REFUSALS,
  canPairDatum,
  canSyncDatum,
  getDatumSyncState,
  importFromDatum,
  mapDatumPairingError,
  setDatumProjectCode,
  syncDatum,
} from '../datumSync';

const mocked = supabase as unknown as { from: jest.Mock; rpc: jest.Mock; functions: { invoke: jest.Mock } };
const calls: string[] = [];

function chain(table: string, result: { data: unknown; error: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'neq', 'not', 'is', 'lt', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${table}.${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const httpError = (payload: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { json: async () => payload } });
const report = { ok: true, runId: 'run-1', counts: { steps: { areas: 'ok' } }, differences: {}, error: null };

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
  mocked.rpc.mockReset();
  mocked.functions.invoke.mockReset();
});

describe('who may', () => {
  it('lets admin, principal and estimator pair and sync, never a supervisor', () => {
    for (const role of ['admin', 'principal', 'estimator'] as const) {
      expect(canPairDatum(role)).toBe(true);
      expect(canSyncDatum(role)).toBe(true);
    }
    expect(canPairDatum('supervisor')).toBe(false);
    expect(canSyncDatum('supervisor')).toBe(false);
    expect(canSyncDatum(null)).toBe(false);
  });
});

describe('setDatumProjectCode', () => {
  it('calls the 107 RPC and returns the stored code', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { code: 'K2-7' }, error: null });
    expect(await setDatumProjectCode('p1', ' k2-7 ')).toEqual({ code: 'K2-7' });
    expect(mocked.rpc).toHaveBeenCalledWith('set_datum_project_code', { p_project_id: 'p1', p_code: ' k2-7 ' });
  });

  it('maps each refusal to its sentence, and anything else with its message', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain' } });
    expect(await setDatumProjectCode('p1', 'K2-7')).toEqual({ error: 'Kode DATUM ini sudah dipakai proyek lain.' });
    expect(mapDatumPairingError('DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator')).toBe('Hanya admin, prinsipal atau estimator yang dapat menautkan proyek ke DATUM.');
    expect(mapDatumPairingError('DATUM_PAIRING_PROJECT: proyek tidak ditemukan')).toBe('Proyek tidak ditemukan.');
    expect(mapDatumPairingError('network down')).toBe('Kode DATUM gagal disimpan: network down');
  });
});

describe('syncDatum and importFromDatum', () => {
  it('send the spec bodies and return the run the server wrote', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: report, error: null });
    expect(await syncDatum('p1')).toEqual({ run: report });
    expect(await importFromDatum('p1', ['LT2-TERAS'])).toEqual({ run: report });
    expect(mocked.functions.invoke.mock.calls).toEqual([
      ['datum-sync', { body: { projectId: 'p1' } }],
      ['datum-sync', { body: { projectId: 'p1', importDatumOnly: true, areaCodes: ['LT2-TERAS'] } }],
    ]);
  });

  it.each(Object.entries(DATUM_SYNC_REFUSALS))('maps %s, whose meaning is fixed, to its sentence', async (code, sentence) => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code, error: 'x' }) });
    expect(await syncDatum('p1')).toEqual({ error: sentence, code });
  });

  it("shows the server's own reason where it varies, never a fixed sentence over it", async () => {
    const refuse = (code: string, error?: string) =>
      mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code, ...(error ? { error } : {}) }) });
    refuse('FORBIDDEN', 'Peran Anda tidak dapat diperiksa: permission denied for function is_office_role');
    expect(await syncDatum('p1')).toEqual({ error: 'Peran Anda tidak dapat diperiksa: permission denied for function is_office_role', code: 'FORBIDDEN' });
    refuse('FORBIDDEN', 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.');
    expect(await importFromDatum('p1', ['A-1'])).toEqual({ error: 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.', code: 'FORBIDDEN' });
    refuse('UNEXPECTED', 'Proyek gagal dibaca: canceling statement due to statement timeout');
    expect(await syncDatum('p1')).toEqual({ error: 'Sinkron DATUM gagal: Proyek gagal dibaca: canceling statement due to statement timeout', code: 'UNEXPECTED' });
    refuse('UNEXPECTED', 'Proyek gagal dibaca: offline');
    expect(await importFromDatum('p1', ['A-1'])).toEqual({ error: 'Ambil ruangan dari DATUM gagal: Proyek gagal dibaca: offline', code: 'UNEXPECTED' });
    refuse('BAD_REQUEST', 'areaCodes harus 1-500 kode DATUM, masing-masing 1-200 karakter.');
    expect(await importFromDatum('p1', ['A-1'])).toEqual({ error: 'Ambil ruangan dari DATUM gagal: areaCodes harus 1-500 kode DATUM, masing-masing 1-200 karakter.', code: 'BAD_REQUEST' });
  });

  it('falls back to its own sentence only when the server gave none', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code: 'FORBIDDEN' }) });
    expect(await syncDatum('p1')).toEqual({ error: DATUM_SYNC_FORBIDDEN, code: 'FORBIDDEN' });
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code: 'FORBIDDEN' }) });
    expect(await importFromDatum('p1', ['A-1'])).toEqual({ error: DATUM_IMPORT_FORBIDDEN, code: 'FORBIDDEN' });
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code: 'METHOD' }) });
    expect(await syncDatum('p1')).toEqual({ error: 'Sinkron DATUM gagal: METHOD', code: 'METHOD' });
  });

  it('never claims a run it did not get: an unknown answer or a dead network is an error', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: { hello: 1 }, error: null });
    expect(await syncDatum('p1')).toMatchObject({ code: 'UNEXPECTED' });
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    expect(await syncDatum('p1')).toEqual({ error: 'Sinkron DATUM gagal: Failed to send a request to the Edge Function', code: 'INVOKE_FAILED' });
  });
});

describe('getDatumSyncState', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', started_at: '2026-09-27T03:00:00.000Z',
    finished_at: '2026-09-27T03:00:05.000Z', ok: true, counts: { steps: { staff: 'ok' } }, differences: {}, error: null,
    requester: { full_name: 'Siti' }, ...over,
  });

  it('reads the newest two runs of the project, the newest staff run of any project, old waiting requests and the newest finished sync', async () => {
    const open = run({ id: 'run-2', finished_at: null, ok: null, requester: null });
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [open, run()], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: run({ id: 'run-0', project_id: 'p9' }), error: null }))
      .mockReturnValueOnce(chain('requests', { data: [{ requested_at: '2026-09-27T00:00:00.000Z' }], error: null, count: 3 }))
      .mockReturnValueOnce(chain('syncRun', { data: run({ id: 'run-1' }), error: null }));
    const state = await getDatumSyncState('p1', '2026-09-27T03:00:10.000Z');
    expect(state).toMatchObject({
      latest: { id: 'run-2', requester_name: null },
      latestFinished: { id: 'run-1', requester_name: 'Siti' },
      latestSync: { id: 'run-1' },
      staffRun: { id: 'run-0' },
      waiting: { count: 3, oldestAt: '2026-09-27T00:00:00.000Z' },
    });
    expect(calls).toContain('staffRun.eq:"counts->steps->>staff":"ok"');
    expect(calls).toContain('requests.lt:"requested_at":"2026-09-27T01:00:10.000Z"');
    expect(calls).toContain('requests.is:"handled_at":null');
  });

  it('takes the newest finished run that is not an import as the sync the create and escalate differences come from', async () => {
    const imported = run({ id: 'run-3', source: 'import' });
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [imported, run({ id: 'run-2', source: 'import' })], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }))
      .mockReturnValueOnce(chain('syncRun', { data: run({ id: 'run-1', source: 'cron' }), error: null }));
    expect(await getDatumSyncState('p1')).toMatchObject({ latestFinished: { id: 'run-3' }, latestSync: { id: 'run-1', source: 'cron' } });
    expect(calls).toContain('syncRun.eq:"project_id":"p1"');
    expect(calls).toContain('syncRun.neq:"source":"import"');
    expect(calls).toContain('syncRun.not:"finished_at":"is":null');
    expect(calls).toContain('syncRun.order:"finished_at":{"ascending":false}');
  });

  it('says never run, and no wait, with empty answers', async () => {
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }))
      .mockReturnValueOnce(chain('syncRun', { data: null, error: null }));
    expect(await getDatumSyncState('p1')).toEqual({ latest: null, latestFinished: null, latestSync: null, staffRun: null, waiting: null });
  });

  it('returns the error, never "belum pernah", when a read fails', async () => {
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: null, error: { message: 'offline' } }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }))
      .mockReturnValueOnce(chain('syncRun', { data: null, error: null }));
    expect(await getDatumSyncState('p1')).toEqual({ error: 'offline' });
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }))
      .mockReturnValueOnce(chain('syncRun', { data: null, error: { message: 'timeout' } }));
    expect(await getDatumSyncState('p1')).toEqual({ error: 'timeout' });
  });
});
