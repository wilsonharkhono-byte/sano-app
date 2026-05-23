import { probeBoq, normalizeBoq } from '../normalize';

describe('boq probe/normalize clients', () => {
  it('probeBoq posts to the probe Edge Function and returns counts', async () => {
    const fakeFetch: any = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows_total: 50, rows_needing_expansion: 47, blocks_referenced: 5 }),
    });
    const result = await probeBoq({ storagePath: 'p/a.xlsx', supabaseUrl: 'https://x', anonKey: 'k', fetch: fakeFetch });
    expect(result).toEqual({ rows_total: 50, rows_needing_expansion: 47, blocks_referenced: 5 });
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/boq-probe'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('normalizeBoq throws on non-200', async () => {
    const fakeFetch: any = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(normalizeBoq({ storagePath: 'p/a.xlsx', supabaseUrl: 'https://x', anonKey: 'k', fetch: fakeFetch })).rejects.toThrow(/500/);
  });
});
