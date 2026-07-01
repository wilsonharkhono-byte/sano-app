import { mapMilestoneStatusToLabel, deriveProjectStatusLabel, installedAsOf, computeWeeklyProgressDelta, assignNextReportNo, recordClientProgressReportExport, assembleClientReportDraft, issueClientReport } from '../clientReport';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../dailySiteLogs', () => ({ aggregatePeriod: jest.fn() }));
jest.mock('../storage', () => ({ resolvePhotoUrl: jest.fn(async (p: string) => `https://cdn/${p}`) }));
import { aggregatePeriod } from '../dailySiteLogs';
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

describe('clientReport status mapping', () => {
  it('maps each milestone status to an Indonesian label', () => {
    expect(mapMilestoneStatusToLabel('ON_TRACK')).toBe('Sesuai Jadwal');
    expect(mapMilestoneStatusToLabel('AHEAD')).toBe('Lebih Cepat');
    expect(mapMilestoneStatusToLabel('AT_RISK')).toBe('Perlu Perhatian');
    expect(mapMilestoneStatusToLabel('DELAYED')).toBe('Terlambat');
    expect(mapMilestoneStatusToLabel('COMPLETE')).toBe('Selesai');
  });

  it('deriveProjectStatusLabel returns the worst status across milestones', () => {
    expect(deriveProjectStatusLabel(['ON_TRACK', 'AHEAD'])).toBe('Sesuai Jadwal');
    expect(deriveProjectStatusLabel(['ON_TRACK', 'AT_RISK'])).toBe('Perlu Perhatian');
    expect(deriveProjectStatusLabel(['AT_RISK', 'DELAYED'])).toBe('Terlambat');
  });

  it('deriveProjectStatusLabel defaults to Sesuai Jadwal when empty', () => {
    expect(deriveProjectStatusLabel([])).toBe('Sesuai Jadwal');
  });
});

describe('clientReport weekly delta', () => {
  beforeEach(() => jest.clearAllMocks());

  it('installedAsOf sums quantities per boq item up to the cutoff date', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lte: jest.fn().mockResolvedValue({
        data: [
          { boq_item_id: 'a', quantity: 4, created_at: '2026-06-10' },
          { boq_item_id: 'a', quantity: 6, created_at: '2026-06-11' },
          { boq_item_id: 'b', quantity: 2, created_at: '2026-06-12' },
        ],
        error: null,
      }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const map = await installedAsOf('proj-1', '2026-06-14T23:59:59');

    expect(map.get('a')).toBe(10);
    expect(map.get('b')).toBe(2);
    expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-06-14T23:59:59');
  });

  it('computeWeeklyProgressDelta = overall% at end minus overall% at start', async () => {
    // start: a=0/10, b=0/10 -> 0% ; end: a=10/10, b=5/10 -> (100+50)/2 = 75%
    const startChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    const endChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockResolvedValue({
      data: [
        { boq_item_id: 'a', quantity: 10, created_at: '2026-06-13' },
        { boq_item_id: 'b', quantity: 5, created_at: '2026-06-13' },
      ], error: null }) };
    (mockSupabase.from as jest.Mock).mockReturnValueOnce(startChain).mockReturnValueOnce(endChain);

    const delta = await computeWeeklyProgressDelta(
      'proj-1',
      [{ id: 'a', planned: 10 }, { id: 'b', planned: 10 }],
      '2026-06-08', '2026-06-14',
    );

    expect(Math.round(delta)).toBe(75);
    expect(startChain.lte).toHaveBeenCalledWith('created_at', '2026-06-08T00:00:00');
    expect(endChain.lte).toHaveBeenCalledWith('created_at', '2026-06-14T23:59:59');
  });
});

describe('clientReport numbering + audit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('assignNextReportNo returns 1 when the project has no reports', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await assignNextReportNo('proj-1')).toBe(1);
  });

  it('assignNextReportNo returns max+1', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { report_no: 6 }, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    expect(await assignNextReportNo('proj-1')).toBe(7);
  });

  it('recordClientProgressReportExport inserts the plain-string report_type', async () => {
    const chain = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);
    await recordClientProgressReportExport('proj-1', 'u-1', { kind: 'mingguan' });
    expect(mockSupabase.from).toHaveBeenCalledWith('report_exports');
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'proj-1', generated_by: 'u-1', report_type: 'client_progress_report',
    }));
  });
});

describe('assembleClientReportDraft', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a draft: updates from highlights, hero = first featured photo, status from milestones', async () => {
    (aggregatePeriod as jest.Mock).mockResolvedValue({
      highlights: [
        { area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0, log_date: '2026-06-14' },
      ],
      featuredPhotos: [
        { storage_path: 'a.jpg', caption: 'Hero', is_featured: true, captured_at: null, log_date: '2026-06-14' },
        { storage_path: 'b.jpg', caption: 'Thumb', is_featured: true, captured_at: null, log_date: '2026-06-12' },
      ],
      weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
    });

    // Mock supabase chain for assignNextReportNo
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    const draft = await assembleClientReportDraft({
      projectId: 'proj-1', kind: 'mingguan',
      periodStart: '2026-06-08', periodEnd: '2026-06-14',
      projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy',
      milestoneStatuses: ['ON_TRACK'],
    });

    expect(draft.statusLabel).toBe('Sesuai Jadwal');
    expect(draft.updates).toEqual([{ date: '14 Jun', area: 'Tangga', note: 'Finishing' }]);
    expect(draft.hero?.url).toBe('https://cdn/a.jpg');
    expect(draft.thumbs).toHaveLength(1);
    expect(draft.thumbs[0].url).toBe('https://cdn/b.jpg');
    expect(draft.weather).toBe('Cerah');
    expect(draft.subtitle).toBe(''); // curator-typed, blank by default
  });
});
