const mockSingle = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'defects') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: mockSingle,
            })),
          })),
          update: jest.fn((...args: any[]) => {
            mockUpdate(...args);
            return {
              eq: jest.fn(() => {
                // Return chainable object that supports another .eq() call
                return {
                  eq: jest.fn(() => ({
                    select: jest.fn(() =>
                      Promise.resolve({ data: [{ id: 'test-defect-1' }], error: null })
                    ),
                  })),
                };
              }),
            };
          }),
        };
      }
      return {};
    }),
  },
}));

import { transitionDefect } from '../defectLifecycle';
import { DefectStatus as DS, UserRole as UR } from '../constants';

describe('transitionDefect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: Valid transition OPEN→VALIDATED by estimator
  it('should successfully transition OPEN→VALIDATED by estimator', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-1', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-1', DS.VALIDATED, UR.ESTIMATOR, 'user-123', {
      responsible_party: 'contractor-A',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
  });

  // Test 2: Valid transition OPEN→IN_REPAIR by supervisor
  it('should successfully transition OPEN→IN_REPAIR by supervisor', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-2', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-2', DS.IN_REPAIR, UR.SUPERVISOR, 'user-456');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 3: Valid transition IN_REPAIR→RESOLVED by supervisor
  it('should successfully transition IN_REPAIR→RESOLVED by supervisor', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-3', status: DS.IN_REPAIR }, error: null });

    const result = await transitionDefect('def-3', DS.RESOLVED, UR.SUPERVISOR, 'user-789');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 4: Valid transition RESOLVED→VERIFIED by principal
  it('should successfully transition RESOLVED→VERIFIED by principal', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-4', status: DS.RESOLVED }, error: null });

    const result = await transitionDefect('def-4', DS.VERIFIED, UR.PRINCIPAL, 'principal-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 5: Valid transition VERIFIED→ACCEPTED_BY_PRINCIPAL by principal
  it('should successfully transition VERIFIED→ACCEPTED_BY_PRINCIPAL by principal', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-5', status: DS.VERIFIED }, error: null });

    const result = await transitionDefect('def-5', DS.ACCEPTED_BY_PRINCIPAL, UR.PRINCIPAL, 'principal-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 6: Invalid transition OPEN→RESOLVED by supervisor
  it('should reject invalid transition OPEN→RESOLVED by supervisor', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-6', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-6', DS.RESOLVED, UR.SUPERVISOR, 'user-456');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Transisi');
    expect(result.error).toContain('tidak diizinkan');
  });

  // Test 7: Invalid role - supervisor trying RESOLVED→VERIFIED
  it('should reject supervisor attempting RESOLVED→VERIFIED transition', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-7', status: DS.RESOLVED }, error: null });

    const result = await transitionDefect('def-7', DS.VERIFIED, UR.SUPERVISOR, 'supervisor-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak diizinkan');
  });

  // Test 8: Invalid role - principal trying OPEN→IN_REPAIR
  it('should reject principal attempting OPEN→IN_REPAIR transition', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-8', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-8', DS.IN_REPAIR, UR.PRINCIPAL, 'principal-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak diizinkan');
  });

  // Test 9: Transition RESOLVED→IN_REPAIR (reject) by estimator
  it('should allow estimator to reject RESOLVED→IN_REPAIR', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-9', status: DS.RESOLVED }, error: null });

    const result = await transitionDefect('def-9', DS.IN_REPAIR, UR.ESTIMATOR, 'estimator-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 10: Transition RESOLVED→IN_REPAIR (reject) by principal
  it('should allow principal to reject RESOLVED→IN_REPAIR', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-10', status: DS.RESOLVED }, error: null });

    const result = await transitionDefect('def-10', DS.IN_REPAIR, UR.PRINCIPAL, 'principal-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Test 11: OPEN→VALIDATED requires responsible_party field
  it('should include responsible_party when transitioning to VALIDATED', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-11', status: DS.OPEN }, error: null });

    await transitionDefect('def-11', DS.VALIDATED, UR.ESTIMATOR, 'user-123', {
      responsible_party: 'contractor-B',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: DS.VALIDATED,
        responsible_party: 'contractor-B',
      })
    );
  });

  // Test 12: Supabase returns error - propagates error message
  it('should propagate Supabase fetch error', async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed' },
    });

    const result = await transitionDefect('def-12', DS.VALIDATED, UR.ESTIMATOR, 'user-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak ditemukan');
  });

  // Test 13: Edge - same status transition
  it('should reject transition to the same status', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-13', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-13', DS.OPEN, UR.SUPERVISOR, 'user-456');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak diizinkan');
  });

  // Test 14: Edge - unknown status
  it('should reject transition to unknown status', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-14', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-14', 'UNKNOWN_STATUS' as any, UR.SUPERVISOR, 'user-456');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak diizinkan');
  });

  // Test 15: VERIFIED→IN_REPAIR reject by principal
  it('should allow principal to reject VERIFIED→IN_REPAIR', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-15', status: DS.VERIFIED }, error: null });

    const result = await transitionDefect('def-15', DS.IN_REPAIR, UR.PRINCIPAL, 'principal-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Additional test: Defect not found
  it('should handle defect not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await transitionDefect('nonexistent', DS.VALIDATED, UR.ESTIMATOR, 'user-123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('tidak ditemukan');
  });

  // Additional test: Admin can perform any transition
  it('should allow admin to perform OPEN→VALIDATED transition', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-admin', status: DS.OPEN }, error: null });

    const result = await transitionDefect('def-admin', DS.VALIDATED, UR.ADMIN, 'admin-user', {
      responsible_party: 'contractor-C',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // Additional test: Transition includes timestamps when appropriate
  it('should add resolved_at timestamp when transitioning to RESOLVED', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-ts', status: DS.IN_REPAIR }, error: null });

    await transitionDefect('def-ts', DS.RESOLVED, UR.SUPERVISOR, 'user-789');

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall).toHaveProperty('resolved_at');
    expect(typeof updateCall.resolved_at).toBe('string');
  });

  // Additional test: Transition includes verifier info when appropriate
  it('should add verifier_id and verified_at when transitioning to VERIFIED', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'def-verif', status: DS.RESOLVED }, error: null });

    await transitionDefect('def-verif', DS.VERIFIED, UR.PRINCIPAL, 'principal-verify-123');

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall).toHaveProperty('verifier_id', 'principal-verify-123');
    expect(updateCall).toHaveProperty('verified_at');
    expect(typeof updateCall.verified_at).toBe('string');
  });

});
