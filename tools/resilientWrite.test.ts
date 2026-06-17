import { resilientWrite } from './resilientWrite';

// The core resilience guarantee: a single bad row must only quarantine itself,
// never reject the whole batch and leave the baseline empty.
describe('resilientWrite', () => {
  it('inserts all rows when every chunk succeeds', async () => {
    const rows = [{ code: 'a' }, { code: 'b' }, { code: 'c' }];
    const { inserted, failed } = await resilientWrite(
      rows,
      async (batch) => ({ data: batch.map(r => ({ id: r.code })), error: null }),
      { chunkSize: 2 },
    );
    expect(inserted).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(failed).toHaveLength(0);
  });

  it('quarantines only the offending row and keeps the rest (one bad row in a chunk)', async () => {
    const rows = [{ code: 'ok1' }, { code: 'BAD' }, { code: 'ok2' }, { code: 'ok3' }];
    const { inserted, failed } = await resilientWrite(
      rows,
      // Chunk write fails if it contains BAD; single-row retry isolates it.
      async (batch) => {
        if (batch.some(r => r.code === 'BAD')) {
          if (batch.length === 1) return { data: null, error: { message: 'check constraint' } };
          return { data: null, error: { message: 'batch rejected' } };
        }
        return { data: batch.map(r => ({ id: r.code })), error: null };
      },
      { chunkSize: 4 },
    );
    expect(inserted).toEqual([{ id: 'ok1' }, { id: 'ok2' }, { id: 'ok3' }]);
    expect(failed).toHaveLength(1);
    expect(failed[0].row.code).toBe('BAD');
    expect(failed[0].error).toBe('check constraint');
  });

  it('handles writes that return null data (insert without select)', async () => {
    const rows = [{ x: 1 }, { x: 2 }];
    const { inserted, failed } = await resilientWrite(
      rows,
      async () => ({ data: null, error: null }),
    );
    expect(inserted).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });

  it('reports every failing row when all rows are bad', async () => {
    const rows = [{ code: 'x' }, { code: 'y' }];
    const { inserted, failed } = await resilientWrite(
      rows,
      async () => ({ data: null, error: { message: 'nope' } }),
      { chunkSize: 1 },
    );
    expect(inserted).toHaveLength(0);
    expect(failed.map(f => f.row.code)).toEqual(['x', 'y']);
  });
});
