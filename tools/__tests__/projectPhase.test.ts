/**
 * projects UPDATE passes for admin/principal on any project (036:73-76) and for
 * an admin, principal or estimator ASSIGNED to the project (023:58-60, widened
 * by 037). RLS does not raise on a filtered UPDATE; it returns zero rows with
 * error null. Without the read-back below, an unassigned estimator would see
 * "Fase diperbarui" and the phase would be unchanged.
 */
import { canSetProjectPhase, setProjectPhase } from '../projectPhase';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

function chain(result: { data: unknown; error: { message: string } | null }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

describe('canSetProjectPhase', () => {
  it('offers the control to office roles only', () => {
    expect(canSetProjectPhase('admin')).toBe(true);
    expect(canSetProjectPhase('principal')).toBe(true);
    expect(canSetProjectPhase('estimator')).toBe(true);
    expect(canSetProjectPhase('supervisor')).toBe(false);
    expect(canSetProjectPhase(undefined)).toBe(false);
  });
});

describe('setProjectPhase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports success when the row comes back', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      chain({ data: { id: 'p1', phase: 'FINISHING' }, error: null }),
    );
    await expect(setProjectPhase('p1', 'FINISHING')).resolves.toEqual({});
  });

  it('reports the RLS refusal instead of a silent success', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: null }));
    const res = await setProjectPhase('p1', 'FINISHING');
    expect(res.error).toMatch(/ditugaskan/i);
  });

  it('passes a real database error through', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      chain({ data: null, error: { message: 'boom' } }),
    );
    await expect(setProjectPhase('p1', 'FINISHING')).resolves.toEqual({ error: 'boom' });
  });
});
