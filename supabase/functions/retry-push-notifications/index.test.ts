import { assertEquals } from 'std/assert';
import { runRetry, type RetryDeps } from './index.ts';

Deno.test('skips empty pending list', async () => {
  let dispatchCount = 0;
  const deps: RetryDeps = {
    fetchPending: async () => [],
    dispatch: async () => { dispatchCount++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 0);
  assertEquals(dispatchCount, 0);
});

Deno.test('dispatches each pending row', async () => {
  let dispatchCount = 0;
  const deps: RetryDeps = {
    fetchPending: async () => [
      { id: '1' } as never,
      { id: '2' } as never,
      { id: '3' } as never,
    ],
    dispatch: async () => { dispatchCount++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 3);
  assertEquals(dispatchCount, 3);
});

Deno.test('continues past per-row failures', async () => {
  let dispatchCount = 0;
  const errors: string[] = [];
  const deps: RetryDeps = {
    fetchPending: async () => [
      { id: '1' } as never,
      { id: '2' } as never,
      { id: '3' } as never,
    ],
    dispatch: async (rec) => {
      dispatchCount++;
      if ((rec as { id: string }).id === '2') {
        errors.push('boom');
        throw new Error('boom');
      }
      return 'ok';
    },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 3);
  assertEquals(result.failed, 1);
  assertEquals(dispatchCount, 3);
});
