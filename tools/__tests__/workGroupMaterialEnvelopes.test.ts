const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import { getWorkGroupMaterialEnvelopes } from '../envelopes';

describe('getWorkGroupMaterialEnvelopes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the RPC with the project and BoQ ids', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1', 'boq-2']);

    expect(mockRpc).toHaveBeenCalledWith('get_workgroup_material_envelopes', {
      p_project_id: 'proj-1',
      p_boq_item_ids: ['boq-1', 'boq-2'],
    });
  });

  it('coerces PostgREST NUMERIC strings to numbers', async () => {
    // Postgres NUMERIC arrives over PostgREST as a string — untouched, every
    // downstream sum would silently concatenate instead of add.
    mockRpc.mockResolvedValue({
      data: [{ material_id: 'mat-1', planned: '1250.5', ordered: '200', requested: '50.25' }],
      error: null,
    });

    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(error).toBeNull();
    expect(rows).toEqual([
      { material_id: 'mat-1', planned: 1250.5, ordered: 200, requested: 50.25 },
    ]);
  });

  it('defaults missing legs to 0', async () => {
    mockRpc.mockResolvedValue({
      data: [{ material_id: 'mat-1', planned: '10', ordered: null, requested: null }],
      error: null,
    });

    const { rows } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(rows[0]).toEqual({ material_id: 'mat-1', planned: 10, ordered: 0, requested: 0 });
  });

  it('short-circuits on an empty BoQ id list without calling the RPC', async () => {
    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', []);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(error).toBeNull();
  });

  it('surfaces an RPC failure as a message instead of throwing', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(rows).toEqual([]);
    expect(error).toBe('network down');
  });
});
