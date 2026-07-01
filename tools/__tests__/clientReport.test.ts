import { mapMilestoneStatusToLabel, deriveProjectStatusLabel, installedAsOf, computeWeeklyProgressDelta } from '../clientReport';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
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
  });
});
