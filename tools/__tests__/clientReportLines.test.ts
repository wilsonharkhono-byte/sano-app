// tools/__tests__/clientReportLines.test.ts
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })) },
  },
}));
import { supabase } from '../supabase';
import {
  backlinkReports, confirmReportLine, confirmSuggestedLines, dismissReportLine, invokeReportLink, listUnlinkedReports,
  summarizeLines, suggestionLabel, type ClientReportLine,
} from '../clientReportLines';

const line = (over: Partial<ClientReportLine> = {}): ClientReportLine => ({
  id: 'l1', report_id: 'r1', line_index: 0, line_text: 'Bekisting Pile Cap :: Melanjutkan bekisting',
  boq_item_id: null, stage: null, activity_state: null, status: 'SUGGESTED', confirmed_by: null, confirmed_at: null,
  ai_boq_item_id: 'b1', ai_stage: 'BEKISTING', ai_activity_state: 'LANJUT', ai_confidence: 'high', ai_quote: 'Melanjutkan bekisting',
  ai_model: 'claude-opus-5', ai_run_id: 'run1', ...over,
});
const codeOf = (id: string | null) => (id === 'b1' ? 'T1-002' : null);

const updateChain = (rows: Array<{ id: string }>) => ({
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  select: jest.fn().mockResolvedValue({ data: rows, error: null }),
});

describe('summarizeLines', () => {
  it('counts statuses, ready suggestions, and lines the AI never reached', () => {
    const s = summarizeLines([
      line(),
      line({ id: 'l2', line_index: 1, ai_confidence: 'low' }),
      line({ id: 'l3', line_index: 2, status: 'CONFIRMED', boq_item_id: 'b1', stage: 'BEKISTING', activity_state: 'LANJUT' }),
      line({ id: 'l4', line_index: 3, status: 'DISMISSED' }),
      line({ id: 'l5', line_index: 4, ai_boq_item_id: null, ai_model: null, ai_confidence: null }),
    ]);
    expect(s).toEqual({ total: 5, confirmed: 1, suggested: 3, dismissed: 1, suggestedReady: 1, aiMissing: 1 });
  });
});

describe('suggestionLabel', () => {
  it('describes each state in Indonesian', () => {
    expect(suggestionLabel(line(), codeOf)).toBe('Saran: T1-002 · Bekisting · Lanjut (yakin)');
    expect(suggestionLabel(line({ ai_confidence: 'medium' }), codeOf)).toBe('Saran: T1-002 · Bekisting · Lanjut (cukup yakin)');
    expect(suggestionLabel(line({ status: 'CONFIRMED', boq_item_id: 'b1', stage: 'PENGECORAN', activity_state: 'SELESAI' }), codeOf))
      .toBe('T1-002 · Pengecoran · Selesai');
    expect(suggestionLabel(line({ status: 'DISMISSED' }), codeOf)).toBe('Tidak terkait');
    expect(suggestionLabel(line({ ai_boq_item_id: null, ai_confidence: 'low' }), codeOf)).toBe('AI tidak menemukan baris BoQ (ragu)');
    expect(suggestionLabel(line({ ai_boq_item_id: null, ai_model: null }), codeOf)).toBe('Belum ada saran AI');
  });
});

describe('invokeReportLink', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes the stage and report id and returns the payload', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { ok: true, code: 'LINKED', suggested: 3 }, error: null });
    const res = await invokeReportLink('r1', { force: true });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('report-progress-analyze', { body: { stage: 'link', report_id: 'r1', force: true } });
    expect(res).toEqual({ ok: true, code: 'LINKED', suggested: 3 });
  });

  it('surfaces the function JSON body on an HTTP error, and a generic message otherwise', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null, error: { context: { json: async () => ({ ok: false, code: 'DAILY_CAP', error: 'habis' }) } },
    });
    expect(await invokeReportLink('r1')).toEqual({ ok: false, code: 'DAILY_CAP', error: 'habis' });
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: new Error('net') });
    expect((await invokeReportLink('r1')).code).toBe('INVOKE_FAILED');
  });
});

describe('backlinkReports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('links sequentially, counts outcomes, and reports progress', async () => {
    const order: string[] = [];
    (supabase.functions.invoke as jest.Mock).mockImplementation(async (_fn: string, { body }: { body: { report_id: string } }) => {
      order.push(body.report_id);
      return body.report_id === 'r2' ? { data: { ok: false, code: 'LINK_ERROR', error: 'model' }, error: null } : { data: { ok: true, code: 'LINKED' }, error: null };
    });
    const progress: number[] = [];
    const res = await backlinkReports(['r1', 'r2', 'r3'], { onProgress: (done) => progress.push(done) });
    expect(order).toEqual(['r1', 'r2', 'r3']);
    expect(res).toEqual({ ok: 2, failed: 1, skipped: 0, stoppedBy: null, firstError: 'model' });
    expect(progress).toEqual([1, 2, 3]);
  });

  it('counts a report another caller is linking as skipped, not failed, and keeps going', async () => {
    (supabase.functions.invoke as jest.Mock).mockImplementation(async (_fn: string, { body }: { body: { report_id: string } }) =>
      body.report_id === 'r1'
        ? { data: null, error: { context: { json: async () => ({ ok: false, code: 'LINK_IN_PROGRESS', error: 'sedang berjalan' }) } } }
        : { data: { ok: true, code: 'LINKED' }, error: null });
    expect(await backlinkReports(['r1', 'r2'])).toEqual({ ok: 1, failed: 0, skipped: 1, stoppedBy: null, firstError: null });
  });

  it('stops on a run-level error such as DAILY_CAP or AUTH, and on cancel', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { ok: false, code: 'DAILY_CAP', error: 'habis' }, error: null });
    expect(await backlinkReports(['r1', 'r2'])).toEqual({ ok: 0, failed: 1, skipped: 0, stoppedBy: 'DAILY_CAP', firstError: 'habis' });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);

    (supabase.functions.invoke as jest.Mock).mockClear();
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null, error: { context: { json: async () => ({ ok: false, code: 'AUTH', error: 'Sesi tidak valid.' }) } },
    });
    expect(await backlinkReports(['r1', 'r2', 'r3'])).toEqual({ ok: 0, failed: 1, skipped: 0, stoppedBy: 'AUTH', firstError: 'Sesi tidak valid.' });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);

    (supabase.functions.invoke as jest.Mock).mockClear();
    let calls = 0;
    (supabase.functions.invoke as jest.Mock).mockImplementation(async () => { calls += 1; return { data: { ok: true, code: 'LINKED' }, error: null }; });
    const res = await backlinkReports(['r1', 'r2', 'r3'], { shouldStop: () => calls >= 1 });
    expect(res.stoppedBy).toBe('CANCELLED');
    expect(res.ok).toBe(1);
  });
});

describe('writes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('confirmSuggestedLines calls the invoker-rights RPC', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 4, error: null });
    expect(await confirmSuggestedLines('r1')).toBe(4);
    expect(supabase.rpc).toHaveBeenCalledWith('confirm_report_lines_bulk', { p_report_id: 'r1' });
  });

  it('confirmReportLine writes only the human fields', async () => {
    const chain = updateChain([{ id: 'l1' }]);
    (supabase.from as jest.Mock).mockReturnValue(chain);
    await confirmReportLine('l1', { boqItemId: 'b1', stage: 'BEKISTING', activityState: 'LANJUT' });
    const written = chain.update.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual(['activity_state', 'boq_item_id', 'confirmed_at', 'confirmed_by', 'stage', 'status']);
    expect(written.status).toBe('CONFIRMED');
    expect(written.confirmed_by).toBe('u1');
    expect(chain.eq).toHaveBeenCalledWith('id', 'l1');
  });

  it('fails loudly when RLS matched no row instead of pretending success', async () => {
    (supabase.from as jest.Mock).mockReturnValue(updateChain([]));
    await expect(dismissReportLine('l1')).rejects.toThrow('tidak ditugaskan');
  });

  it('dismissReportLine clears the row, stage and state', async () => {
    const chain = updateChain([{ id: 'l1' }]);
    (supabase.from as jest.Mock).mockReturnValue(chain);
    await dismissReportLine('l1');
    expect(chain.update.mock.calls[0][0]).toMatchObject({ boq_item_id: null, stage: null, activity_state: null, status: 'DISMISSED' });
  });

  it('listUnlinkedReports keeps only reports with at least one update and zero lines', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockResolvedValue({
        data: [
          { id: 'r1', report_no: 1, revision: 1, updates: [{ area: 'a', note: 'b' }], client_report_lines: [{ count: 0 }] },
          { id: 'r2', report_no: 2, revision: 1, updates: [{ area: 'a', note: 'b' }], client_report_lines: [{ count: 3 }] },
          { id: 'r3', report_no: 3, revision: 1, updates: [], client_report_lines: [{ count: 0 }] },
        ], error: null,
      }),
    };
    (supabase.from as jest.Mock).mockReturnValue(chain);
    expect(await listUnlinkedReports('p1')).toEqual([{ id: 'r1', report_no: 1, revision: 1 }]);
    expect(chain.select).toHaveBeenCalledWith('id, report_no, revision, updates:snapshot->updates, client_report_lines(count)');
  });
});
