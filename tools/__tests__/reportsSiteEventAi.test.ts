/**
 * The second source of ai_usage_summary (plan 2 deviation D18).
 *
 * ai_chat_log stays the primary source and is untouched: it buckets per user,
 * per day and per model, and site_event_ai_runs has no user_id at all (its
 * rows are written by the edge function under the service role). Folding the
 * two together would mean inventing a user, so the runs land as their own
 * section with per-stage rows.
 *
 * The case that earns its place is the last one. site_event_ai_runs is
 * readable only by office roles and the event's reporter (migration 097), and
 * on a project where 097 has not been pasted the table does not exist at all.
 * Reporting "0 spend" in either case would be a confident lie; the section
 * carries the reason instead.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
// tools/reports.ts imports tools/storage.ts (for resolvePhotoUrl) at module
// scope, which imports expo-image-picker; jest-transforming that ESM package
// fails outside a real RN app. reports.test.ts sidesteps this the same way —
// mock the module boundary before ../reports pulls it in transitively.
jest.mock('../storage', () => ({
  resolvePhotoUrl: jest.fn(async (p: string) => `https://cdn/${p}`),
}));
import { supabase } from '../supabase';
import { readSiteEventAiUsage } from '../reports';
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

function chain(result: { data: unknown; error: { message: string } | null }) {
  const c: any = {};
  c.select = jest.fn().mockReturnValue(c);
  c.gte = jest.fn().mockReturnValue(c);
  c.lt = jest.fn().mockReturnValue(c);
  c.eq = jest.fn().mockReturnValue(Object.assign(Promise.resolve(result), c));
  return c;
}

const RUNS = [
  { stage: 'transcribe', model: 'gpt-4o-mini-transcribe', tokens_in: 0, tokens_out: 0, cost_usd: 0.003, status: 'ok' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: 4000, tokens_out: 500, cost_usd: 0.013, status: 'ok' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: 2000, tokens_out: 300, cost_usd: 0.007, status: 'rejected' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: null, tokens_out: null, cost_usd: null, status: 'error' },
];

describe('readSiteEventAiUsage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('totals tokens and spend and breaks them down per stage', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: RUNS, error: null }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out.total_runs).toBe(4);
    expect(out.total_input_tokens).toBe(6000);
    expect(out.total_output_tokens).toBe(800);
    expect(out.total_tokens).toBe(6800);
    expect(out.total_cost_usd).toBe(0.023);
    expect(out.by_stage.map((s) => s.stage)).toEqual(['analyze', 'transcribe']);
    const analyze = out.by_stage[0];
    expect(analyze).toMatchObject({
      run_count: 3, ok_count: 1, rejected_count: 1, error_count: 1,
      input_tokens: 6000, output_tokens: 800, total_tokens: 6800, cost_usd: 0.02,
      models: ['claude-sonnet-5'],
    });
  });

  it('applies the date window when one is given', async () => {
    const c = chain({ data: [], error: null });
    (mockSupabase.from as jest.Mock).mockReturnValue(c);
    await readSiteEventAiUsage('p1', '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z');
    expect(c.gte).toHaveBeenCalledWith('created_at', '2026-09-01T00:00:00Z');
    expect(c.lt).toHaveBeenCalledWith('created_at', '2026-09-12T00:00:00Z');
  });

  it('reads an empty table as zero spend, not as an error', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: [], error: null }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out).toEqual({
      total_runs: 0, total_input_tokens: 0, total_output_tokens: 0,
      total_tokens: 0, total_cost_usd: 0, by_stage: [],
    });
  });

  it('says WHY it is empty when the read fails, rather than reporting zero spend', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'permission denied for table site_event_ai_runs' } }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out.total_runs).toBe(0);
    expect(out.error).toBe('permission denied for table site_event_ai_runs');
  });
});
