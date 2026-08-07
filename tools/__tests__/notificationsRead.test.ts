const mockSelect = jest.fn();
const mockEq = jest.fn(() => ({ select: mockSelect }));
const mockUpdate = jest.fn(() => ({ eq: mockEq }));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ update: mockUpdate })),
  },
}));

import { markNotificationRead } from '../notificationsRead';
import { supabase } from '../supabase';

describe('markNotificationRead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ok:true when exactly 1 row is updated', async () => {
    mockSelect.mockResolvedValueOnce({ data: [{ id: 'n1' }], error: null });

    const result = await markNotificationRead('n1', '2026-08-07T00:00:00.000Z');

    expect(result).toEqual({ ok: true, error: null });
    expect(supabase.from).toHaveBeenCalledWith('notifications');
    expect(mockUpdate).toHaveBeenCalledWith({ read_at: '2026-08-07T00:00:00.000Z' });
    expect(mockEq).toHaveBeenCalledWith('id', 'n1');
    expect(mockSelect).toHaveBeenCalledWith('id');
  });

  it('surfaces ok:false with the Postgrest error message when the write errors', async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: 'network error' } });

    const result = await markNotificationRead('n2', '2026-08-07T00:00:00.000Z');

    expect(result).toEqual({ ok: false, error: 'network error' });
  });

  it('surfaces ok:false when 0 rows are updated (silent RLS no-op)', async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await markNotificationRead('n3', '2026-08-07T00:00:00.000Z');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('never throws — catches unexpected exceptions (e.g. dropped connection)', async () => {
    mockSelect.mockRejectedValueOnce(new Error('boom'));

    const result = await markNotificationRead('n4', '2026-08-07T00:00:00.000Z');

    expect(result).toEqual({ ok: false, error: 'boom' });
  });
});
