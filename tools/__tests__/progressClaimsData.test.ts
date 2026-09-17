// tools/__tests__/progressClaimsData.test.ts
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
import { supabase } from '../supabase';
import {
  countLinkedLinesByRow, countSubmittedClaims, getOpenClaim, listClaimRows, listEntryTotals, listStageWeights, listVerifiedStagePct, removeClaimLine,
  resetStageWeights,
  returnClaim, saveClaimLine, seedReferenceWeights, setStageWeights, submitClaim, verifyClaim,
} from '../progressClaims/claims';

type Result = { data?: unknown; error?: unknown; count?: number | null };

function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const settled = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
  const q: Record<string, unknown> = { calls };
  for (const m of ['select', 'eq', 'in', 'gte', 'not', 'order', 'limit', 'range']) {
    q[m] = jest.fn((...args: unknown[]) => { calls.push([m, args]); return q; });
  }
  q.maybeSingle = jest.fn(async () => settled);
  q.then = (resolve: (v: typeof settled) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(settled).then(resolve, reject);
  return q as typeof q & { calls: typeof calls };
}

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe('reads', () => {
  it('asks for the project claim in progress', async () => {
    const q = chain({ data: { id: 'c1', status: 'DRAFT' } });
    from.mockReturnValueOnce(q);
    await expect(getOpenClaim('p1')).resolves.toMatchObject({ id: 'c1' });
    expect(from).toHaveBeenCalledWith('progress_claims');
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['in', ['status', ['DRAFT', 'SUBMITTED', 'RETURNED']]]]));
  });

  it('throws a query error instead of reading it as no claim', async () => {
    from.mockReturnValueOnce(chain({ error: { message: 'boom' } }));
    await expect(getOpenClaim('p1')).rejects.toMatchObject({ message: 'boom' });
  });

  it('counts submitted claims for the verify badge', async () => {
    const q = chain({ count: 1 });
    from.mockReturnValueOnce(q);
    await expect(countSubmittedClaims('p1')).resolves.toBe(1);
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['status', 'SUBMITTED']]]));
  });

  it('reads the latest verified figures from the one-row-per-item view', async () => {
    const q = chain({ data: [{ boq_item_id: 'k1', verified_pct: { SINGLE: 50 } }] });
    from.mockReturnValueOnce(q);
    await expect(listVerifiedStagePct('p1')).resolves.toEqual(new Map([['k1', { SINGLE: 50 }]]));
    expect(from).toHaveBeenCalledWith('progress_claim_latest_verified');
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']]]));
  });

  it('reads what each row entries sum to, as numbers', async () => {
    from.mockReturnValueOnce(chain({ data: [{ boq_item_id: 'k1', installed_total: '52.04' }, { boq_item_id: 'k2', installed_total: 5 }] }));
    await expect(listEntryTotals('p1')).resolves.toEqual(new Map([['k1', 52.04], ['k2', 5]]));
    expect(from).toHaveBeenCalledWith('progress_entry_totals');
  });

  it('pages past the 1,000-row cap in a stable order', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ boq_item_id: `r${i}`, installed_total: 1 }));
    const first = chain({ data: firstPage });
    const second = chain({ data: [{ boq_item_id: 'r1000', installed_total: '2.5' }] });
    from.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const totals = await listEntryTotals('p1');
    expect(totals.size).toBe(1001);
    expect(totals.get('r1000')).toBe(2.5);
    expect(first.calls).toEqual(expect.arrayContaining([['order', ['boq_item_id']], ['range', [0, 999]]]));
    expect(second.calls).toEqual(expect.arrayContaining([['range', [1000, 1999]]]));
  });

  it.each([
    ['stage weights', () => listStageWeights('p1'), 'boq_stage_weights'],
    ['latest verified figures', () => listVerifiedStagePct('p1'), 'progress_claim_latest_verified'],
  ])('pages the %s as well', async (_what, call, table) => {
    const q = chain({ data: [] });
    from.mockReturnValueOnce(q);
    await (call as () => Promise<unknown>)();
    expect(from).toHaveBeenCalledWith(table);
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['range', [0, 999]]]));
  });

  it('reads the claim rows as they are now, a hundred ids per request', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `r${i}`);
    const first = chain({ data: [{ id: 'r0', project_id: 'p1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: '200', installed: 0, progress: 0 }] });
    const second = chain({ data: [] });
    from.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const rows = await listClaimRows([...ids, 'r0']);
    expect(from).toHaveBeenCalledWith('boq_items');
    expect(rows.get('r0')).toMatchObject({ code: 'T1-001', planned: 200 });
    const idsIn = (q: ReturnType<typeof chain>) => q.calls.find(([m]) => m === 'in')?.[1][1] as string[];
    expect(idsIn(first)).toHaveLength(100);
    expect(idsIn(second)).toHaveLength(50);
  });

  it('reads no rows for a claim without lines', async () => {
    await expect(listClaimRows([])).resolves.toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
  });

  it('counts linked report lines from the latest revision since the week start', async () => {
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'r1v1', report_no: 1, revision: 1 }, { id: 'r1v2', report_no: 1, revision: 2 }] }))
      .mockReturnValueOnce(chain({ data: [{ boq_item_id: 'k1', report_id: 'r1v2' }] }));
    await expect(countLinkedLinesByRow('p1', '2026-09-14')).resolves.toEqual(new Map([['k1', 1]]));
    expect(from.mock.calls.map((c) => c[0])).toEqual(['client_progress_reports', 'client_report_lines']);
  });

  it('treats unreadable report lines as no evidence rather than an error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'r1', report_no: 1, revision: 1 }] }))
      .mockReturnValueOnce(chain({ error: { message: 'relation "client_report_lines" does not exist' } }));
    await expect(countLinkedLinesByRow('p1', '2026-09-14')).resolves.toEqual(new Map());
    warn.mockRestore();
  });
});

describe('writes', () => {
  it('saves a line with the argument names migration 104 declares', async () => {
    rpc.mockResolvedValueOnce({ data: { claim_id: 'c1', claim_status: 'DRAFT' }, error: null });
    await saveClaimLine({ projectId: 'p1', boqItemId: 'k1', claimedPct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, photoRefs: ['progress/p1/1.jpg'] });
    expect(rpc).toHaveBeenCalledWith('save_progress_claim_line', {
      p_project_id: 'p1', p_boq_item_id: 'k1', p_claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 },
      p_note: null, p_photo_refs: ['progress/p1/1.jpg'], p_regress_reason: null,
    });
  });

  it.each([
    ['submit_progress_claim', () => submitClaim('c1'), { p_claim_id: 'c1' }],
    ['return_progress_claim', () => returnClaim('c1', 'Foto kurang'), { p_claim_id: 'c1', p_note: 'Foto kurang' }],
    ['verify_progress_claim', () => verifyClaim('c1', [{ line_id: 'l1', verified_pct: { SINGLE: 40 } }]), { p_claim_id: 'c1', p_lines: [{ line_id: 'l1', verified_pct: { SINGLE: 40 } }], p_note: null }],
    ['remove_progress_claim_line', () => removeClaimLine('l1'), { p_line_id: 'l1' }],
    ['set_boq_stage_weights', () => setStageWeights('k1', { SINGLE: 1 }), { p_boq_item_id: 'k1', p_weights: { SINGLE: 1 } }],
    ['reset_boq_stage_weights', () => resetStageWeights('k1', 'KOLOM'), { p_boq_item_id: 'k1', p_reference_class: 'KOLOM' }],
    ['seed_reference_stage_weights', () => seedReferenceWeights('p1', [{ boq_item_id: 'k1', reference_class: 'KOLOM' }]), { p_project_id: 'p1', p_rows: [{ boq_item_id: 'k1', reference_class: 'KOLOM' }] }],
  ])('calls %s with its arguments', async (name, call, args) => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await (call as () => Promise<unknown>)();
    expect(rpc).toHaveBeenCalledWith(name, args);
  });

  it('turns a refusal into its Indonesian sentence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'CLAIM_LOCKED: klaim x sedang menunggu verifikasi' } });
    await expect(submitClaim('c1')).rejects.toThrow('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.');
  });

  it('keeps the refusal code and the server text for the screen', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'CLAIM_REGRESS_REASON: baris T1-001 turun dari progres terverifikasi' } });
    await expect(verifyClaim('c1', [])).rejects.toMatchObject({
      message: 'Penurunan progres wajib disertai alasan.',
      code: 'CLAIM_REGRESS_REASON',
      detail: 'CLAIM_REGRESS_REASON: baris T1-001 turun dari progres terverifikasi',
    });
  });

  it('skips the seed call when no row is missing weights', async () => {
    await expect(seedReferenceWeights('p1', [])).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
