import { getDailyLog, upsertDailyLog, aggregatePeriod } from '../dailySiteLogs';
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
    expect(delChain.eq).toHaveBeenCalledWith('log_id', 'log-9');
  });

  it('aggregatePeriod merges logs: highlights ordered, featured photos, latest weather, summed safety', async () => {
    const logsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          { id: 'l1', log_date: '2026-06-08', weather: 'Cerah', crew_total: 6, crew_breakdown: 'a', safety_incidents: 0 },
          { id: 'l2', log_date: '2026-06-14', weather: 'Hujan', crew_total: 8, crew_breakdown: 'b', safety_incidents: 1 },
        ],
        error: null,
      }),
    };
    const hlChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          { id: 'h2', log_id: 'l2', area: 'Tangga', note: 'n2', boq_item_id: null, sort_order: 0 },
          { id: 'h1', log_id: 'l1', area: 'Listrik', note: 'n1', boq_item_id: null, sort_order: 0 },
        ],
        error: null,
      }),
    };
    const phChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ id: 'p1', log_id: 'l2', storage_path: 'x.jpg', caption: 'c', is_featured: true, captured_at: null }],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(logsChain)
      .mockReturnValueOnce(hlChain)
      .mockReturnValueOnce(phChain);

    const agg = await aggregatePeriod('proj-1', '2026-06-08', '2026-06-14');

    expect(agg.weather).toBe('Hujan');           // most recent in range (l2)
    expect(agg.crewTotal).toBe(8);
    expect(agg.safetyIncidents).toBe(1);          // summed
    expect(agg.highlights.map(h => h.area)).toEqual(['Listrik', 'Tangga']); // by log_date asc
    expect(agg.highlights[0].log_date).toBe('2026-06-08');
    expect(agg.featuredPhotos).toHaveLength(1);
  });
});
