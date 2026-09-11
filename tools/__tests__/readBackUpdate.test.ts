/**
 * The shared RLS read-back idiom (CLAUDE.md §12), extracted from updateRoom,
 * updateGateRef, updateGateStepRef and setProjectPhase, which all shared this
 * exact chain: `update(patch).eq(keyColumn, keyValue).select(columns).maybeSingle()`,
 * then a null row treated as the refusal it is rather than a success that
 * did not happen. Each caller keeps its own Indonesian refusal message and
 * return shape; this only covers the shared plumbing.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import { readBackUpdate } from '../readBackUpdate';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

/** update().eq().select().maybeSingle() - the single-row read-back chain. */
function updateChain(result: { data: unknown; error: { message: string } | null }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

describe('readBackUpdate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the row when the update matches one', async () => {
    const row = { id: 'r1', name: 'Dapur' };
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: row, error: null }));

    const result = await readBackUpdate('rooms', { name: 'Dapur' }, 'id', 'r1', 'id, name', 'refused');

    expect(result).toEqual({ data: row });
  });

  it('reports the refusal message, not a silent success, when RLS filters the row to null', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: null, error: null }));

    const result = await readBackUpdate('rooms', { name: 'Dapur' }, 'id', 'r1', 'id, name', 'Perubahan ditolak.');

    expect(result).toEqual({ error: 'Perubahan ditolak.' });
  });

  it('passes a real database error through instead of the refusal message', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: null, error: { message: 'boom' } }),
    );

    const result = await readBackUpdate('rooms', { name: 'Dapur' }, 'id', 'r1', 'id, name', 'Perubahan ditolak.');

    expect(result).toEqual({ error: 'boom' });
  });

  it('calls from(table), eq(keyColumn, keyValue) and select(columns) with the exact arguments', async () => {
    const chain = updateChain({ data: { code: 'B', short_label: 'Basah 2' }, error: null });
    (mockSupabase.from as jest.Mock).mockReturnValue(chain);

    await readBackUpdate('gate_refs', { short_label: 'Basah 2' }, 'code', 'B', 'code, short_label', 'refused');

    expect(mockSupabase.from).toHaveBeenCalledWith('gate_refs');
    expect(chain.update).toHaveBeenCalledWith({ short_label: 'Basah 2' });
    expect(chain.eq).toHaveBeenCalledWith('code', 'B');
    expect(chain.select).toHaveBeenCalledWith('code, short_label');
  });
});
