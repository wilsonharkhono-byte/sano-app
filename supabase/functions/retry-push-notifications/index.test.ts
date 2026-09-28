import { assertEquals } from 'std/assert';
import { runRetry, type RetryDeps } from './index.ts';

Deno.test('skips an empty pending list', async () => {
  let dispatched = 0;
  const deps: RetryDeps = {
    fetchPendingIds: async () => [],
    dispatch: async () => { dispatched++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 0, failed: 0 });
  assertEquals(dispatched, 0);
});

Deno.test('dispatches each pending id', async () => {
  const seen: string[] = [];
  const deps: RetryDeps = {
    fetchPendingIds: async () => ['1', '2', '3'],
    dispatch: async (id) => { seen.push(id); return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 3, failed: 0 });
  assertEquals(seen, ['1', '2', '3']);
});

Deno.test('continues past per-row failures', async () => {
  const seen: string[] = [];
  const deps: RetryDeps = {
    fetchPendingIds: async () => ['1', '2', '3'],
    dispatch: async (id) => {
      seen.push(id);
      if (id === '2') throw new Error('boom');
      return 'ok';
    },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 3, failed: 1 });
  assertEquals(seen, ['1', '2', '3']);
});
