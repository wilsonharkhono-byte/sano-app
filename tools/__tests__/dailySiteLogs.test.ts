import { getDailyLog, upsertDailyLog } from '../dailySiteLogs';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

describe('dailySiteLogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getDailyLog returns null when no log exists for the date', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const result = await getDailyLog('proj-1', '2026-06-29');

    expect(result).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('daily_site_logs');
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(chain.eq).toHaveBeenCalledWith('log_date', '2026-06-29');
  });

  it('getDailyLog assembles the log with its highlights and photos', async () => {
    const logRow = {
      id: 'log-1', project_id: 'proj-1', log_date: '2026-06-29', weather: 'Cerah',
      crew_total: 8, crew_breakdown: '3 tukang', safety_incidents: 0, author_id: 'u-1',
    };
    const logChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: logRow, error: null }),
    };
    const hlChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [{ id: 'h1', log_id: 'log-1', area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0 }],
        error: null,
      }),
    };
    const phChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ id: 'p1', log_id: 'log-1', storage_path: 'daily-log/x.jpg', caption: 'Foto', is_featured: true, captured_at: null }],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(logChain)   // daily_site_logs
      .mockReturnValueOnce(hlChain)    // daily_log_highlights
      .mockReturnValueOnce(phChain);   // daily_log_photos

    const result = await getDailyLog('proj-1', '2026-06-29');

    expect(result?.id).toBe('log-1');
    expect(result?.highlights).toHaveLength(1);
    expect(result?.highlights[0].area).toBe('Tangga');
    expect(result?.photos[0].is_featured).toBe(true);
  });

  it('upsertDailyLog upserts the log then replaces highlights and photos', async () => {
    const upsertChain = {
      upsert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'log-9' }, error: null }),
    };
    const delChain = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
    const insChain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(upsertChain)  // upsert daily_site_logs
      .mockReturnValueOnce(delChain)     // delete highlights
      .mockReturnValueOnce(insChain)     // insert highlights
      .mockReturnValueOnce(delChain)     // delete photos
      .mockReturnValueOnce(insChain);    // insert photos

    const id = await upsertDailyLog({
      project_id: 'proj-1', log_date: '2026-06-29', weather: 'Cerah',
      crew_total: 8, crew_breakdown: '3 tukang', safety_incidents: 0, author_id: 'u-1',
      highlights: [{ area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0 }],
      photos: [{ storage_path: 'daily-log/x.jpg', caption: 'Foto', is_featured: true, captured_at: null }],
    });

    expect(id).toBe('log-9');
    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'proj-1', log_date: '2026-06-29' }),
      { onConflict: 'project_id,log_date' },
    );
    expect(insChain.insert).toHaveBeenCalledTimes(2);
  });
});
