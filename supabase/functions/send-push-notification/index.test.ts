import { assertEquals } from 'std/assert';
import { handleNotification, type Deps } from './index.ts';

function makeMockDeps(overrides: Partial<Deps> = {}): {
  deps: Deps;
  calls: {
    selectNotification: number;
    selectTokens: number;
    expoFetch: Array<unknown>;
    updateSent: number;
    deleteToken: string[];
  };
} {
  const calls = {
    selectNotification: 0,
    selectTokens: 0,
    expoFetch: [] as unknown[],
    updateSent: 0,
    deleteToken: [] as string[],
  };
  const deps: Deps = {
    fetchNotificationSentAt: async () => { calls.selectNotification++; return null; },
    fetchTokens: async () => { calls.selectTokens++; return [{ expo_push_token: 'ExponentPushToken[abc]' }]; },
    expoPush: async (messages) => { calls.expoFetch.push(messages); return { data: messages.map(() => ({})) }; },
    markSent: async () => { calls.updateSent++; },
    deleteToken: async (t) => { calls.deleteToken.push(t); },
    ...overrides,
  };
  return { deps, calls };
}

const baseRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  recipient_user_id: '00000000-0000-0000-0000-000000000002',
  title: 'Test',
  body: 'Body',
  deeplink_screen: 'ApprovalsScreen',
  deeplink_params: { headerId: 'h1' },
};

Deno.test('skips when no tokens registered', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [],
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'no tokens');
  assertEquals(calls.expoFetch.length, 0);
  assertEquals(calls.updateSent, 0);
});

Deno.test('skips when push_sent_at already set (idempotency)', async () => {
  const { deps, calls } = makeMockDeps({
    fetchNotificationSentAt: async () => '2026-05-09T00:00:00Z',
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'already sent');
  assertEquals(calls.expoFetch.length, 0);
});

Deno.test('dispatches one Expo message per token, marks sent', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[a]' },
      { expo_push_token: 'ExponentPushToken[b]' },
    ],
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'ok');
  assertEquals(calls.expoFetch.length, 1);
  assertEquals((calls.expoFetch[0] as Array<{ to: string }>).length, 2);
  assertEquals(calls.updateSent, 1);
  assertEquals(calls.deleteToken.length, 0);
});

Deno.test('deletes stale tokens on DeviceNotRegistered', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[good]' },
      { expo_push_token: 'ExponentPushToken[stale]' },
    ],
    expoPush: async () => ({
      data: [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }),
  });
  await handleNotification(baseRecord, deps);
  assertEquals(calls.deleteToken, ['ExponentPushToken[stale]']);
});
