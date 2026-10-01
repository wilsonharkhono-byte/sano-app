import { assertEquals, assertRejects } from 'std/assert';
import { checkAuth, handleNotification, type Deps, type ExpoMessage, type NotificationRow } from './index.ts';

const ROW: NotificationRow = {
  id: '00000000-0000-0000-0000-000000000001',
  recipient_user_id: '00000000-0000-0000-0000-000000000002',
  title: 'Permintaan disetujui',
  body: 'MR-12 disetujui estimator',
  deeplink_screen: 'ApprovalsScreen',
  deeplink_params: { headerId: 'h1' },
  push_sent_at: null,
};

function makeMockDeps(overrides: Partial<Deps> = {}) {
  const calls = {
    pushed: [] as ExpoMessage[][],
    markSent: 0,
    deleted: [] as string[],
  };
  const deps: Deps = {
    fetchNotification: async () => ({ ...ROW }),
    fetchTokens: async () => [{ expo_push_token: 'ExponentPushToken[abc]' }],
    countUnread: async () => 4,
    expoPush: async (messages) => { calls.pushed.push(messages); return { data: messages.map(() => ({ status: 'ok' })) }; },
    markSent: async () => { calls.markSent++; },
    deleteToken: async (t) => { calls.deleted.push(t); },
    ...overrides,
  };
  return { deps, calls };
}

Deno.test('checkAuth fails closed when the secret is not configured', async () => {
  assertEquals(await checkAuth('Bearer x', undefined), 'misconfigured');
  assertEquals(await checkAuth(null, ''), 'misconfigured');
});

Deno.test('checkAuth requires the exact bearer', async () => {
  assertEquals(await checkAuth('Bearer s3cret', 's3cret'), 'ok');
  assertEquals(await checkAuth('Bearer wrong', 's3cret'), 'unauthorized');
  assertEquals(await checkAuth(null, 's3cret'), 'unauthorized');
  // Same length as the real secret: exercises the byte-by-byte compare path,
  // not an early length mismatch.
  assertEquals(await checkAuth('Bearer s3cre7', 's3cret'), 'unauthorized');
});

Deno.test('unknown notification id is not pushed', async () => {
  const { deps, calls } = makeMockDeps({ fetchNotification: async () => null });
  assertEquals(await handleNotification(ROW.id, deps), 'not found');
  assertEquals(calls.pushed.length, 0);
});

Deno.test('skips when push_sent_at already set (idempotency)', async () => {
  const { deps, calls } = makeMockDeps({
    fetchNotification: async () => ({ ...ROW, push_sent_at: '2026-09-28T00:00:00Z' }),
  });
  assertEquals(await handleNotification(ROW.id, deps), 'already sent');
  assertEquals(calls.pushed.length, 0);
});

Deno.test('skips without marking sent when no tokens are registered', async () => {
  const { deps, calls } = makeMockDeps({ fetchTokens: async () => [] });
  assertEquals(await handleNotification(ROW.id, deps), 'no tokens');
  assertEquals(calls.pushed.length, 0);
  assertEquals(calls.markSent, 0);
});

Deno.test('message content comes from the DB row, with badge, channel and priority', async () => {
  const { deps, calls } = makeMockDeps();
  assertEquals(await handleNotification(ROW.id, deps), 'ok');
  const [msg] = calls.pushed[0];
  assertEquals(msg.to, 'ExponentPushToken[abc]');
  assertEquals(msg.title, 'Permintaan disetujui');
  assertEquals(msg.body, 'MR-12 disetujui estimator');
  assertEquals(msg.badge, 4);
  assertEquals(msg.channelId, 'default');
  assertEquals(msg.priority, 'high');
  assertEquals(msg.data, {
    notificationId: ROW.id,
    deeplinkScreen: ROW.deeplink_screen,
    deeplinkParams: { headerId: 'h1' },
  });
  assertEquals(calls.markSent, 1);
});

Deno.test('omits badge when countUnread cannot be determined', async () => {
  const { deps, calls } = makeMockDeps({ countUnread: async () => null });
  assertEquals(await handleNotification(ROW.id, deps), 'ok');
  const [msg] = calls.pushed[0];
  assertEquals('badge' in msg, false);
});

Deno.test('one message per token', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[a]' },
      { expo_push_token: 'ExponentPushToken[b]' },
    ],
  });
  await handleNotification(ROW.id, deps);
  assertEquals(calls.pushed[0].map(m => m.to), ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
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
  assertEquals(await handleNotification(ROW.id, deps), 'ok');
  assertEquals(calls.deleted, ['ExponentPushToken[stale]']);
  assertEquals(calls.markSent, 1);
});

Deno.test('does not mark sent when expoPush rejects', async () => {
  const { deps, calls } = makeMockDeps({
    expoPush: async () => { throw new Error('expo push 500: boom'); },
  });
  await assertRejects(() => handleNotification(ROW.id, deps));
  assertEquals(calls.markSent, 0);
});

Deno.test('marks nothing sent and returns failed when every ticket errors', async () => {
  const { deps, calls } = makeMockDeps({
    expoPush: async () => ({
      data: [{ status: 'error', details: { error: 'InvalidCredentials' } }],
    }),
  });
  assertEquals(await handleNotification(ROW.id, deps), 'failed');
  assertEquals(calls.markSent, 0);
});
