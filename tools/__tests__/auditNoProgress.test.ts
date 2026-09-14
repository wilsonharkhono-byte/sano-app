// tools/__tests__/auditNoProgress.test.ts
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
import { supabase } from '../supabase';
import { detectAnomalies } from '../audit';

type Result = { data?: unknown; error?: unknown; count?: number | null };

function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const settled = { data: result.data ?? [], error: result.error ?? null, count: result.count ?? null };
  const q: Record<string, unknown> = { calls };
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
    q[m] = jest.fn((...args: unknown[]) => { calls.push([m, args]); return q; });
  }
  q.then = (resolve: (v: typeof settled) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(settled).then(resolve, reject);
  return q as typeof q & { calls: typeof calls };
}

const from = supabase.from as jest.Mock;

/** Claim activity counts in query order: lines created, lines edited on an open claim, claims submitted. */
function mockProject(counts: number[], error: unknown = null) {
  const claimQueries: Array<ReturnType<typeof chain>> = [];
  from.mockImplementation((table: string) => {
    if (table !== 'progress_claim_lines' && table !== 'progress_claims') return chain({ data: [] });
    const q = chain({ count: counts[claimQueries.length] ?? 0, error });
    claimQueries.push(q);
    return q;
  });
  return claimQueries;
}

const raisesNoProgress = async () => (await detectAnomalies('p1')).some((a) => a.type === 'no_progress');

beforeEach(() => {
  from.mockReset();
});

describe('detectAnomalies: no progress claimed in 7 days', () => {
  it('raises the anomaly when the site created, edited and submitted nothing', async () => {
    const queries = mockProject([0, 0, 0]);
    await expect(raisesNoProgress()).resolves.toBe(true);
    expect(queries).toHaveLength(3);
  });

  it.each([
    ['a claim line created', [1, 0, 0]],
    ['a line edited on an open claim', [0, 1, 0]],
    ['a claim submitted', [0, 0, 1]],
  ])('counts %s as site activity', async (_what, counts) => {
    mockProject(counts as number[]);
    await expect(raisesNoProgress()).resolves.toBe(false);
  });

  it('reads edits on open claims only and submissions by submitted_at, so a return or a verification is not site activity', async () => {
    const queries = mockProject([0, 0, 0]);
    await detectAnomalies('p1');
    const [created, edited, submitted] = queries;
    expect(created.calls).toEqual(expect.arrayContaining([['gte', ['created_at', expect.any(String)]]]));
    expect(edited.calls).toEqual(expect.arrayContaining([
      ['select', ['id, progress_claims!inner(status)', { count: 'exact', head: true }]],
      ['gte', ['updated_at', expect.any(String)]],
      ['in', ['progress_claims.status', ['DRAFT', 'SUBMITTED', 'RETURNED']]],
    ]));
    expect(submitted.calls).toEqual(expect.arrayContaining([['gte', ['submitted_at', expect.any(String)]]]));
    expect(submitted.calls.some(([, args]) => args[0] === 'updated_at')).toBe(false);
  });

  it('raises nothing when claim activity cannot be read', async () => {
    mockProject([0, 0, 0], { message: 'relation "progress_claims" does not exist' });
    await expect(raisesNoProgress()).resolves.toBe(false);
  });
});
