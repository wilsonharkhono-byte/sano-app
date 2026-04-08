/**
 * Test suite for Kasbon (Cash Advance) query and mutation functions
 * Tests async Supabase-dependent functions with proper mocking
 */

// ─── Mock setup (BEFORE imports) ─────────────────────────────────────────────

const mockRpc = jest.fn();
let testChain: any;

function createChainMock(initialData?: any) {
  const chain: any = {
    select: jest.fn(function() { return this; }),
    eq: jest.fn(function() { return this; }),
    order: jest.fn(function() { return this; }),
    data: initialData ?? null,
    error: null,
  };
  // Make the chain thenable so await works
  chain.then = (resolve: any) => resolve({ data: chain.data, error: chain.error });
  testChain = chain;
  return chain;
}

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => {
      return createChainMock();
    }),
    rpc: jest.fn((...args: any[]) => mockRpc(...args)),
  },
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  getKasbonByContract,
  getKasbonByProject,
  getUnsettledKasbonTotal,
  getKasbonAging,
  requestKasbon,
  approveKasbon,
} from '../kasbon';
import { supabase } from '../supabase';

// ─── Mocks ──────────────────────────────────────────────────────────────────

type MockSupabase = {
  from: jest.Mock;
  rpc: jest.Mock;
};

const mockSupabase = supabase as unknown as MockSupabase;

// ─── Test Suites ────────────────────────────────────────────────────────────

describe('Kasbon Queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getKasbonByContract tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getKasbonByContract', () => {
    it('should call from("mandor_kasbon").select("*").eq("contract_id", id).order(...)', async () => {
      const contractId = 'contract-123';
      const mockData = [
        { id: 'k1', contract_id: contractId, amount: 100, kasbon_date: '2026-04-01' },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByContract(contractId);

      expect(mockSupabase.from).toHaveBeenCalledWith('mandor_kasbon');
      expect(chainWithData.select).toHaveBeenCalledWith('*');
      expect(chainWithData.eq).toHaveBeenCalledWith('contract_id', contractId);
      expect(chainWithData.order).toHaveBeenCalledWith('kasbon_date', { ascending: false });
    });

    it('should return data array when query succeeds', async () => {
      const contractId = 'contract-456';
      const mockData = [
        { id: 'k1', contract_id: contractId, amount: 500 },
        { id: 'k2', contract_id: contractId, amount: 300 },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByContract(contractId);

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
    });

    it('should return empty array when data is null', async () => {
      const contractId = 'contract-789';

      const chainWithData = createChainMock(null);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByContract(contractId);

      expect(result).toEqual([]);
    });

    it('should return empty array when data is undefined', async () => {
      const contractId = 'contract-999';

      const chainWithData = createChainMock(undefined);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByContract(contractId);

      expect(result).toEqual([]);
    });

    it('should order by kasbon_date descending', async () => {
      const contractId = 'contract-order';
      const mockData = [
        { id: 'k1', kasbon_date: '2026-04-03' },
        { id: 'k2', kasbon_date: '2026-04-02' },
        { id: 'k3', kasbon_date: '2026-04-01' },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      await getKasbonByContract(contractId);

      expect(chainWithData.order).toHaveBeenCalledWith('kasbon_date', { ascending: false });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getKasbonByProject tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getKasbonByProject', () => {
    it('should call from("mandor_kasbon").select("*").eq("project_id", id).order("created_at")', async () => {
      const projectId = 'project-123';
      const mockData = [
        { id: 'k1', project_id: projectId, amount: 100, created_at: '2026-04-01' },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByProject(projectId);

      expect(mockSupabase.from).toHaveBeenCalledWith('mandor_kasbon');
      expect(chainWithData.select).toHaveBeenCalledWith('*');
      expect(chainWithData.eq).toHaveBeenCalledWith('project_id', projectId);
      expect(chainWithData.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual(mockData);
    });

    it('should order by created_at descending', async () => {
      const projectId = 'project-order';
      const mockData = [
        { id: 'k1', created_at: '2026-04-03' },
        { id: 'k2', created_at: '2026-04-02' },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      await getKasbonByProject(projectId);

      expect(chainWithData.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should return empty array when data is null', async () => {
      const projectId = 'project-null';

      const chainWithData = createChainMock(null);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByProject(projectId);

      expect(result).toEqual([]);
    });

    it('should return data array when query succeeds', async () => {
      const projectId = 'project-success';
      const mockData = [
        { id: 'k1', project_id: projectId, amount: 250 },
        { id: 'k2', project_id: projectId, amount: 150 },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonByProject(projectId);

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getUnsettledKasbonTotal tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getUnsettledKasbonTotal', () => {
    it('should call RPC with correct params', async () => {
      const contractId = 'contract-rpc-1';

      mockRpc.mockResolvedValueOnce({ data: 5000, error: null });

      const result = await getUnsettledKasbonTotal(contractId);

      expect(mockRpc).toHaveBeenCalledWith('get_unsettled_kasbon_total', {
        p_contract_id: contractId,
      });
      expect(result).toBe(5000);
    });

    it('should return numeric data from RPC', async () => {
      const contractId = 'contract-rpc-2';

      mockRpc.mockResolvedValueOnce({ data: 12500, error: null });

      const result = await getUnsettledKasbonTotal(contractId);

      expect(result).toBe(12500);
      expect(typeof result).toBe('number');
    });

    it('should return 0 when RPC returns error', async () => {
      const contractId = 'contract-rpc-error';

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: new Error('RPC failed'),
      });

      const result = await getUnsettledKasbonTotal(contractId);

      expect(result).toBe(0);
    });

    it('should return 0 when data is null', async () => {
      const contractId = 'contract-rpc-null';

      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await getUnsettledKasbonTotal(contractId);

      expect(result).toBe(0);
    });

    it('should return 0 on any RPC error', async () => {
      const contractId = 'contract-rpc-error2';

      const error = { message: 'Database connection failed' };
      mockRpc.mockResolvedValueOnce({ data: undefined, error });

      const result = await getUnsettledKasbonTotal(contractId);

      expect(result).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getKasbonAging tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getKasbonAging', () => {
    it('should query v_kasbon_aging view with correct params', async () => {
      const projectId = 'project-aging-1';
      const mockData = [
        { id: 'k1', project_id: projectId, age_days: 10 },
      ];

      // Set data before calling - this will be picked up by the first chain created
      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonAging(projectId);

      expect(mockSupabase.from).toHaveBeenCalledWith('v_kasbon_aging');
      expect(chainWithData.select).toHaveBeenCalledWith('*');
      expect(chainWithData.eq).toHaveBeenCalledWith('project_id', projectId);
      expect(result).toEqual(mockData);
    });

    it('should order by age_days descending', async () => {
      const projectId = 'project-aging-2';
      const mockData = [
        { id: 'k1', age_days: 30 },
        { id: 'k2', age_days: 15 },
        { id: 'k3', age_days: 5 },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      await getKasbonAging(projectId);

      expect(chainWithData.order).toHaveBeenCalledWith('age_days', { ascending: false });
    });

    it('should return empty array when data is null', async () => {
      const projectId = 'project-aging-null';

      const chainWithData = createChainMock(null);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonAging(projectId);

      expect(result).toEqual([]);
    });

    it('should return data array when query succeeds', async () => {
      const projectId = 'project-aging-3';
      const mockData = [
        { id: 'k1', project_id: projectId, age_days: 20 },
        { id: 'k2', project_id: projectId, age_days: 5 },
      ];

      const chainWithData = createChainMock(mockData);
      mockSupabase.from.mockReturnValueOnce(chainWithData);

      const result = await getKasbonAging(projectId);

      expect(result).toEqual(mockData);
      expect(result.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // requestKasbon tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('requestKasbon', () => {
    it('should call RPC with contract_id, amount, and reason', async () => {
      const contractId = 'contract-req-1';
      const amount = 1000;
      const reason = 'Advance for materials';

      mockRpc.mockResolvedValueOnce({
        data: { id: 'k1', contract_id: contractId, amount, reason },
        error: null,
      });

      await requestKasbon(contractId, amount, reason);

      expect(mockRpc).toHaveBeenCalledWith('request_kasbon', {
        p_contract_id: contractId,
        p_amount: amount,
        p_reason: reason,
      });
    });

    it('should include optional kasbonDate when provided', async () => {
      const contractId = 'contract-req-2';
      const amount = 1500;
      const reason = 'Advance for tools';
      const kasbonDate = '2026-04-05';

      mockRpc.mockResolvedValueOnce({
        data: { id: 'k1', contract_id: contractId, amount, reason, kasbon_date: kasbonDate },
        error: null,
      });

      await requestKasbon(contractId, amount, reason, kasbonDate);

      expect(mockRpc).toHaveBeenCalledWith('request_kasbon', {
        p_contract_id: contractId,
        p_amount: amount,
        p_reason: reason,
        p_kasbon_date: kasbonDate,
      });
    });

    it('should not include kasbonDate when not provided', async () => {
      const contractId = 'contract-req-3';
      const amount = 2000;
      const reason = 'Advance for labor';

      mockRpc.mockResolvedValueOnce({
        data: { id: 'k1', contract_id: contractId, amount, reason },
        error: null,
      });

      await requestKasbon(contractId, amount, reason);

      expect(mockRpc).toHaveBeenCalledWith('request_kasbon', {
        p_contract_id: contractId,
        p_amount: amount,
        p_reason: reason,
      });

      const lastCall = mockRpc.mock.calls[mockRpc.mock.calls.length - 1];
      expect(lastCall[1]).not.toHaveProperty('p_kasbon_date');
    });

    it('should return data on success', async () => {
      const contractId = 'contract-req-success';
      const amount = 5000;
      const reason = 'Advance for project';
      const mockKasbon = {
        id: 'k-success-1',
        contract_id: contractId,
        amount,
        reason,
      };

      mockRpc.mockResolvedValueOnce({ data: mockKasbon, error: null });

      const result = await requestKasbon(contractId, amount, reason);

      expect(result).toEqual({ data: mockKasbon });
      expect(result.error).toBeUndefined();
    });

    it('should return error message on RPC failure', async () => {
      const contractId = 'contract-req-fail';
      const amount = 1000;
      const reason = 'Advance';
      const errorMsg = 'Insufficient contract balance';

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: errorMsg },
      });

      const result = await requestKasbon(contractId, amount, reason);

      expect(result).toEqual({ error: errorMsg });
      expect(result.data).toBeUndefined();
    });

    it('should return error when RPC error object is returned', async () => {
      const contractId = 'contract-req-error';
      const amount = 999;
      const reason = 'Test';

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Contract not found' },
      });

      const result = await requestKasbon(contractId, amount, reason);

      expect(result.error).toBe('Contract not found');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // approveKasbon tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('approveKasbon', () => {
    it('should call RPC approve_kasbon with kasbon_id', async () => {
      const kasbonId = 'kasbon-approve-1';

      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      await approveKasbon(kasbonId);

      expect(mockRpc).toHaveBeenCalledWith('approve_kasbon', {
        p_kasbon_id: kasbonId,
      });
    });

    it('should return undefined error on success', async () => {
      const kasbonId = 'kasbon-success-1';

      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await approveKasbon(kasbonId);

      expect(result).toEqual({ error: undefined });
    });

    it('should return error string on failure', async () => {
      const kasbonId = 'kasbon-fail-1';
      const errorMsg = 'Kasbon not found';

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: errorMsg },
      });

      const result = await approveKasbon(kasbonId);

      expect(result).toEqual({ error: errorMsg });
    });

    it('should extract error.message when error is object', async () => {
      const kasbonId = 'kasbon-error-obj';

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Already approved' },
      });

      const result = await approveKasbon(kasbonId);

      expect(result.error).toBe('Already approved');
    });

    it('should handle null error gracefully', async () => {
      const kasbonId = 'kasbon-null-error';

      mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

      const result = await approveKasbon(kasbonId);

      expect(result.error).toBeUndefined();
    });
  });
});
