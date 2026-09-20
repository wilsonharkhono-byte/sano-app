// tools/__tests__/analyticsData.test.ts
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
import { supabase } from '../supabase';
import { loadApprovalData, loadChainSupport, loadDiaryData, loadMaterialData, loadProgressEntries, loadVerifiedClaimLines, saveProjectDates, validateProjectDates } from '../analytics/data';

type Result = { data?: unknown; error?: unknown };
function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const settled = { data: result.data ?? null, error: result.error ?? null };
  const q: Record<string, unknown> = { calls };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'update', 'is']) q[m] = jest.fn((...args: unknown[]) => { calls.push([m, args]); return q; });
  q.then = (resolve: (v: typeof settled) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(settled).then(resolve, reject);
  return q as typeof q & { calls: typeof calls };
}
const from = supabase.from as jest.Mock;
beforeEach(() => from.mockReset());

describe('validateProjectDates', () => {
  it('needs two real dates with the end after the start', () => {
    expect(validateProjectDates('2026-07-01', '2027-06-30')).toBeNull();
    expect(validateProjectDates('', '2027-06-30')).toBe('Isi tanggal mulai dengan format TTTT-BB-HH.');
    expect(validateProjectDates('2026-07-01', '2026-02-30')).toBe('Isi tanggal selesai rencana dengan format TTTT-BB-HH.');
    expect(validateProjectDates('2026-07-01', '2026-07-01')).toBe('Tanggal selesai rencana harus setelah tanggal mulai.');
  });
});

describe('saveProjectDates', () => {
  it('updates the project and fails loudly when the database changed nothing', async () => {
    const ok = chain({ data: [{ id: 'p1' }] });
    from.mockReturnValueOnce(ok);
    await expect(saveProjectDates('p1', '2026-07-01', '2027-06-30')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('projects');
    expect(ok.calls).toEqual(expect.arrayContaining([['update', [{ start_date: '2026-07-01', end_date: '2027-06-30' }]], ['eq', ['id', 'p1']]]));
    from.mockReturnValueOnce(chain({ data: [] }));
    await expect(saveProjectDates('p1', '2026-07-01', '2027-06-30')).rejects.toThrow('Tanggal tidak tersimpan. Hanya admin atau prinsipal yang bisa mengubah tanggal proyek.');
    await expect(saveProjectDates('p1', '2026-07-01', '2026-01-01')).rejects.toThrow('Tanggal selesai rencana harus setelah tanggal mulai.');
  });
});

describe('reads', () => {
  it('pages the verified progress entries of a project', async () => {
    const q = chain({ data: [{ boq_item_id: 'a', quantity: '12.5', created_at: '2026-09-16T03:00:00Z' }] });
    from.mockReturnValueOnce(q);
    await expect(loadProgressEntries('p1')).resolves.toEqual([{ boq_item_id: 'a', quantity: 12.5, created_at: '2026-09-16T03:00:00Z' }]);
    expect(from).toHaveBeenCalledWith('progress_entries');
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['range', [0, 999]]]));
  });

  it('reads the reports with their crew and lines, and the confirmed links by report and line', async () => {
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'r1', report_no: 1, revision: 1, period_start: '2026-09-07', crewTotal: 20, updates: [{ area: 'A', note: 'Galian' }] }, { id: 'r2', report_no: 2, revision: 1, period_start: '2026-09-08', crewTotal: 'x', updates: null }] }))
      .mockReturnValueOnce(chain({ data: [{ report_id: 'r1', line_index: 0, stage: 'GALIAN' }] }));
    const res = await loadDiaryData('p1');
    expect(res.reports).toEqual([
      { id: 'r1', report_no: 1, revision: 1, period_start: '2026-09-07', crewTotal: 20, updates: [{ area: 'A', note: 'Galian' }] },
      { id: 'r2', report_no: 2, revision: 1, period_start: '2026-09-08', crewTotal: null, updates: [] },
    ]);
    expect(res.links).toEqual(new Map([['r1:0', 'GALIAN']]));
  });

  it('reads the plan of the latest material master, the catalogue, and requests with their allocations', async () => {
    const headerChain = chain({ data: [{ id: 'h1', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', overall_status: 'APPROVED' }] });
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'mm2' }] }))
      .mockReturnValueOnce(chain({ data: [{ material_id: 'besi', boq_item_id: 'k1', planned_quantity: '1000' }] }))
      .mockReturnValueOnce(chain({ data: [{ id: 'besi', name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }] }))
      .mockReturnValueOnce(headerChain)
      .mockReturnValueOnce(chain({ data: [{ request_header_id: 'h1', material_id: 'besi', quantity: '500', material_request_line_allocations: [{ boq_item_id: 'k1', allocated_quantity: '500' }] }] }));
    const res = await loadMaterialData('p1');
    expect(res.planned).toEqual([{ material_id: 'besi', boq_item_id: 'k1', planned_quantity: 1000 }]);
    expect(res.catalog.get('besi')).toMatchObject({ category: 'Struktur', unit: 'kg' });
    expect(res.requests).toEqual([{ material_id: 'besi', quantity: 500, status: 'APPROVED', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', allocations: [{ boq_item_id: 'k1', allocated_quantity: 500 }] }]);
    expect(headerChain.calls).toEqual(expect.arrayContaining([['select', ['id, created_at, reviewed_at, overall_status']]]));
  });

  it('reads the request headers for the approval flow, and throws a read error', async () => {
    from.mockReturnValueOnce(chain({ data: [{ created_at: 'a', reviewed_at: null, overall_status: 'PENDING' }] }));
    await expect(loadApprovalData('p1')).resolves.toEqual([{ created_at: 'a', reviewed_at: null, overall_status: 'PENDING' }]);
    from.mockReturnValueOnce(chain({ error: { message: 'boom' } }));
    await expect(loadApprovalData('p1')).rejects.toThrow('boom');
  });
});

describe('loadVerifiedClaimLines and loadChainSupport', () => {
  it('reads the verified claims and their lines in chunks, stamping each line with its claim’s verification time', async () => {
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'c1', verified_at: '2026-08-26T03:00:00Z' }, { id: 'c2', verified_at: '2026-09-02T03:00:00Z' }] }))
      .mockReturnValueOnce(chain({ data: [
        { claim_id: 'c1', boq_item_id: 'k1', verified_pct: { PEMBESIAN: 50 }, weights_snapshot: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 } },
        { claim_id: 'c2', boq_item_id: 'k1', verified_pct: { PEMBESIAN: 100 }, weights_snapshot: null },
        { claim_id: 'c2', boq_item_id: 'k2', verified_pct: null, weights_snapshot: { SINGLE: 1 } },
      ] }));
    await expect(loadVerifiedClaimLines('p1')).resolves.toEqual([
      { boq_item_id: 'k1', verified_pct: { PEMBESIAN: 50 }, weights_snapshot: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 }, verified_at: '2026-08-26T03:00:00Z' },
      { boq_item_id: 'k1', verified_pct: { PEMBESIAN: 100 }, weights_snapshot: null, verified_at: '2026-09-02T03:00:00Z' },
    ]);
    expect(from).toHaveBeenNthCalledWith(1, 'progress_claims');
    expect(from).toHaveBeenNthCalledWith(2, 'progress_claim_lines');
    const claims = from.mock.results[0].value as { calls: Array<[string, unknown[]]> };
    expect(claims.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['eq', ['status', 'VERIFIED']], ['range', [0, 999]]]));
    const lines = from.mock.results[1].value as { calls: Array<[string, unknown[]]> };
    expect(lines.calls).toEqual(expect.arrayContaining([['select', ['claim_id, boq_item_id, verified_pct, weights_snapshot']], ['in', ['claim_id', ['c1', 'c2']]]]));
  });

  it('reads nothing more when there is no verified claim', async () => {
    from.mockReturnValueOnce(chain({ data: [] }));
    await expect(loadVerifiedClaimLines('p1')).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('bundles the diary lines, the stage weights and the verified lines, keeping a diary read failure soft', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'client_report_lines') return chain({ error: { message: 'no view' } });
      if (table === 'boq_stage_weights') return chain({ data: [{ boq_item_id: 'k1', weights: { SINGLE: 1 }, source: 'reference', reference_class: 'balok', updated_at: 'x' }] });
      if (table === 'progress_claims') return chain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });
    const res = await loadChainSupport('p1');
    expect(res.diary).toEqual({ lines: [], readable: false });
    expect(res.weights).toEqual([{ boq_item_id: 'k1', weights: { SINGLE: 1 }, source: 'reference', reference_class: 'balok', updated_at: 'x' }]);
    expect(res.verified).toEqual([]);
  });
});
