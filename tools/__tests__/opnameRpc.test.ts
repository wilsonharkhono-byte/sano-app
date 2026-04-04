// tools/__tests__/opnameRpc.test.ts
import {
  updateOpnameLineProgress,
  submitOpname,
  verifyOpname,
  approveOpname,
  markOpnamePaid,
  getOpnameProgressFlags,
  getLaborPaymentSummary,
  refreshPriorPaid,
} from '../opnameRpc';

// Mock supabase module
const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}));

describe('opnameRpc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── updateOpnameLineProgress ───────────────────────────────────────

  describe('updateOpnameLineProgress', () => {
    it('calls update_opname_line_progress RPC with all params', async () => {
      mockRpc.mockResolvedValue({ error: null });

      const result = await updateOpnameLineProgress('line-uuid-1', {
        cumulative_pct: 50,
        verified_pct: 45,
        is_tdk_acc: false,
        tdk_acc_reason: null,
        notes: 'Checked on site',
      });

      expect(mockRpc).toHaveBeenCalledWith('update_opname_line_progress', {
        p_line_id: 'line-uuid-1',
        p_cumulative_pct: 50,
        p_verified_pct: 45,
        p_is_tdk_acc: false,
        p_tdk_acc_reason: null,
        p_notes: 'Checked on site',
      });
      expect(result.error).toBeUndefined();
    });

    it('passes null for omitted optional params', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await updateOpnameLineProgress('line-uuid-2', { cumulative_pct: 30 });

      expect(mockRpc).toHaveBeenCalledWith('update_opname_line_progress', {
        p_line_id: 'line-uuid-2',
        p_cumulative_pct: 30,
        p_verified_pct: null,
        p_is_tdk_acc: null,
        p_tdk_acc_reason: null,
        p_notes: null,
      });
    });

    it('returns error message on RPC failure', async () => {
      mockRpc.mockResolvedValue({ error: { message: 'Line not found: bad-id' } });

      const result = await updateOpnameLineProgress('bad-id', {});
      expect(result.error).toBe('Line not found: bad-id');
    });
  });

  // ─── submitOpname ───────────────────────────────────────────────────

  describe('submitOpname', () => {
    it('calls submit_opname RPC with header id', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await submitOpname('header-uuid-1');

      expect(mockRpc).toHaveBeenCalledWith('submit_opname', {
        p_header_id: 'header-uuid-1',
      });
    });

    it('returns error on failure', async () => {
      mockRpc.mockResolvedValue({ error: { message: 'Not in DRAFT status' } });

      const result = await submitOpname('header-uuid-1');
      expect(result.error).toBe('Not in DRAFT status');
    });
  });

  // ─── verifyOpname ───────────────────────────────────────────────────

  describe('verifyOpname', () => {
    it('passes notes to verify_opname RPC', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await verifyOpname('header-uuid-1', 'All lines checked');

      expect(mockRpc).toHaveBeenCalledWith('verify_opname', {
        p_header_id: 'header-uuid-1',
        p_notes: 'All lines checked',
      });
    });

    it('passes null when notes not provided', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await verifyOpname('header-uuid-1');

      expect(mockRpc).toHaveBeenCalledWith('verify_opname', {
        p_header_id: 'header-uuid-1',
        p_notes: null,
      });
    });
  });

  // ─── approveOpname ──────────────────────────────────────────────────

  describe('approveOpname', () => {
    it('passes kasbon to approve_opname RPC', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await approveOpname('header-uuid-1', 500000);

      expect(mockRpc).toHaveBeenCalledWith('approve_opname', {
        p_header_id: 'header-uuid-1',
        p_kasbon: 500000,
      });
    });
  });

  // ─── markOpnamePaid ─────────────────────────────────────────────────

  describe('markOpnamePaid', () => {
    it('calls mark_opname_paid RPC', async () => {
      mockRpc.mockResolvedValue({ error: null });

      await markOpnamePaid('header-uuid-1');

      expect(mockRpc).toHaveBeenCalledWith('mark_opname_paid', {
        p_header_id: 'header-uuid-1',
        p_payment_reference: null,
      });
    });
  });

  // ─── getOpnameProgressFlags ─────────────────────────────────────────

  describe('getOpnameProgressFlags', () => {
    it('queries v_opname_progress_reconciliation and filters non-OK flags', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            {
              line_id: 'line-1',
              boq_item_id: 'boq-1',
              boq_code: 'STR-01',
              boq_label: 'Kolom Beton',
              claimed_progress_pct: 80,
              field_progress_pct: 55,
              variance_pct: 25,
              variance_flag: 'HIGH',
            },
          ],
          error: null,
        }),
      };
      mockFrom.mockReturnValue(mockChain);

      const result = await getOpnameProgressFlags('header-uuid-1');

      expect(mockFrom).toHaveBeenCalledWith('v_opname_progress_reconciliation');
      expect(mockChain.eq).toHaveBeenCalledWith('header_id', 'header-uuid-1');
      expect(mockChain.neq).toHaveBeenCalledWith('variance_flag', 'OK');
      expect(result).toHaveLength(1);
      expect(result[0].variance_flag).toBe('HIGH');
    });

    it('returns empty array when no flags', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockFrom.mockReturnValue(mockChain);

      const result = await getOpnameProgressFlags('header-uuid-1');
      expect(result).toEqual([]);
    });
  });

  // ─── getLaborPaymentSummary ─────────────────────────────────────────

  describe('getLaborPaymentSummary', () => {
    it('queries contracts, opnames, kasbon, and rates for the project', async () => {
      // The new implementation makes multiple .from() calls in parallel,
      // each with different chain methods. Provide a fully chainable mock.
      const makeChain = (data: any[] = []) => {
        const chain: Record<string, jest.Mock> = {};
        const resolver = { data, error: null };
        chain.select = jest.fn().mockReturnValue(chain);
        chain.eq = jest.fn().mockReturnValue(chain);
        chain.in = jest.fn().mockReturnValue(chain);
        chain.order = jest.fn().mockResolvedValue(resolver);
        // For calls that end without .order (e.g. mandor_contract_rates)
        chain.then = jest.fn((resolve: any) => resolve(resolver));
        return chain;
      };

      mockFrom.mockImplementation(() => makeChain([]));

      const result = await getLaborPaymentSummary('project-uuid-1');

      expect(mockFrom).toHaveBeenCalledWith('mandor_contracts');
      expect(result).toEqual([]);
    });
  });

  // ─── refreshPriorPaid ───────────────────────────────────────────────

  describe('refreshPriorPaid', () => {
    it('returns prior_paid from RPC result', async () => {
      mockRpc.mockResolvedValue({ data: 12500000, error: null });

      const result = await refreshPriorPaid('header-uuid-1');

      expect(mockRpc).toHaveBeenCalledWith('refresh_prior_paid', {
        p_header_id: 'header-uuid-1',
      });
      expect(result.prior_paid).toBe(12500000);
      expect(result.error).toBeUndefined();
    });

    it('defaults prior_paid to 0 when RPC returns null', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await refreshPriorPaid('header-uuid-1');
      expect(result.prior_paid).toBe(0);
    });

    it('returns error message on failure', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'Header not found' } });

      const result = await refreshPriorPaid('header-uuid-1');
      expect(result.error).toBe('Header not found');
    });
  });
});
