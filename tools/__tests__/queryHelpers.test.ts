/**
 * Tests for queryHelpers module
 */

import { fetchAllByField, rpcNumeric, rpcWithError, fetchView } from '../queryHelpers';
import { supabase } from '../supabase';

// Mock supabase module
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

describe('queryHelpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── fetchAllByField ────────────────────────────────────────────────────

  describe('fetchAllByField', () => {
    it('should call correct table, select all, filter by field, and order', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await fetchAllByField('my_table', 'id', 'abc', 'created_at', false);

      expect(mockSupabase.from).toHaveBeenCalledWith('my_table');
      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('id', 'abc');
      expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual([{ id: '1', name: 'Test' }]);
    });

    it('should return empty array on null data', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await fetchAllByField('my_table', 'id', 'abc', 'created_at');

      expect(result).toEqual([]);
    });

    it('should respect ascending parameter', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockChain);

      await fetchAllByField('my_table', 'id', 'abc', 'created_at', true);

      expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('should default to ascending: false', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockChain);

      await fetchAllByField('my_table', 'id', 'abc', 'created_at');

      expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });

  // ─── rpcNumeric ─────────────────────────────────────────────────────────

  describe('rpcNumeric', () => {
    it('should return numeric data from RPC', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: 42, error: null });

      const result = await rpcNumeric('my_rpc', { param: 'value' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('my_rpc', { param: 'value' });
      expect(result).toBe(42);
    });

    it('should return 0 on error', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const result = await rpcNumeric('my_rpc', {});

      expect(result).toBe(0);
    });

    it('should return 0 on null data', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });

      const result = await rpcNumeric('my_rpc', {});

      expect(result).toBe(0);
    });

    it('should handle 0 as valid numeric result', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: 0, error: null });

      const result = await rpcNumeric('my_rpc', {});

      expect(result).toBe(0);
    });
  });

  // ─── rpcWithError ───────────────────────────────────────────────────────

  describe('rpcWithError', () => {
    it('should return data on success', async () => {
      const mockData = { id: '1', name: 'Test' };
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: mockData, error: null });

      const result = await rpcWithError('my_rpc', { param: 'value' });

      expect(mockSupabase.rpc).toHaveBeenCalledWith('my_rpc', { param: 'value' });
      expect(result).toEqual({ data: mockData });
      expect(result.error).toBeUndefined();
    });

    it('should return error string on failure', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'RPC failed with details' },
      });

      const result = await rpcWithError('my_rpc', {});

      expect(result).toEqual({ error: 'RPC failed with details' });
      expect(result.data).toBeUndefined();
    });

    it('should handle both data and error as undefined', async () => {
      (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });

      const result = await rpcWithError('my_rpc', {});

      expect(result).toEqual({ data: null });
      expect(result.error).toBeUndefined();
    });
  });

  // ─── fetchView (alias) ──────────────────────────────────────────────────

  describe('fetchView', () => {
    it('should be an alias for fetchAllByField', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (mockSupabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await fetchView('my_view', 'contract_id', 'c123', 'week_start', true);

      expect(mockSupabase.from).toHaveBeenCalledWith('my_view');
      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('contract_id', 'c123');
      expect(mockChain.order).toHaveBeenCalledWith('week_start', { ascending: true });
    });
  });
});
