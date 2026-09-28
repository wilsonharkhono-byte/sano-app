// Deploy with --no-verify-jwt: both callers (the Database Webhook on
// notifications INSERT, and retry-push-notifications' cron) present
// `Authorization: Bearer <WEBHOOK_AUTH_SECRET>`, a random hex secret, not a
// Supabase JWT - the gateway's own JWT check would refuse it before this
// file ever runs. checkAuth() below is the only gate (see datum-sync/index.ts:10
// for the same pattern).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  deeplink_screen: string;
  deeplink_params: unknown;
  push_sent_at: string | null;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: unknown;
  sound: 'default';
  // Omitted (not sent as null/undefined) when countUnread couldn't tell us
  // the recipient's unread count - an inaccurate badge is worse than none.
  badge?: number;
  channelId: 'default';
  priority: 'high';
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoResponse {
  data?: ExpoTicket[];
}

export interface Deps {
  fetchNotification: (id: string) => Promise<NotificationRow | null>;
  fetchTokens: (userId: string) => Promise<{ expo_push_token: string }[]>;
  countUnread: (userId: string) => Promise<number | null>;
  expoPush: (messages: ExpoMessage[]) => Promise<ExpoResponse>;
  markSent: (id: string) => Promise<void>;
  deleteToken: (token: string) => Promise<void>;
}

// Fail closed: without a configured secret nobody may trigger pushes.
// Constant time: both sides SHA-256 digested, then compared byte by byte,
// mirroring datum-sync/handler.ts's bearerMatches - a naive string ===
// would let a timing attack learn the secret one byte at a time.
export async function checkAuth(
  authorization: string | null,
  expected: string | undefined,
): Promise<'ok' | 'unauthorized' | 'misconfigured'> {
  if (!expected) return 'misconfigured';
  const enc = new TextEncoder();
  const [given, wanted] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(authorization ?? '')),
    crypto.subtle.digest('SHA-256', enc.encode(`Bearer ${expected}`)),
  ]);
  const a = new Uint8Array(given);
  const b = new Uint8Array(wanted);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? 'ok' : 'unauthorized';
}

// Only the id is trusted from the caller; title/body/recipient are re-read from
// the DB so a caller cannot push arbitrary text to a user.
export async function handleNotification(id: string, deps: Deps): Promise<string> {
  const row = await deps.fetchNotification(id);
  if (!row) return 'not found';
  if (row.push_sent_at) return 'already sent';

  const tokens = await deps.fetchTokens(row.recipient_user_id);
  if (!tokens.length) return 'no tokens';

  const badge = await deps.countUnread(row.recipient_user_id);
  const messages: ExpoMessage[] = tokens.map(t => ({
    to: t.expo_push_token,
    title: row.title,
    body: row.body,
    data: {
      notificationId: row.id,
      deeplinkScreen: row.deeplink_screen,
      deeplinkParams: row.deeplink_params,
    },
    sound: 'default',
    ...(badge !== null ? { badge } : {}),
    channelId: 'default',
    priority: 'high',
  }));

  const result = await deps.expoPush(messages);

  // A ticket per token: delete the ones Expo says are gone, log anything
  // else that failed (never the full token), and only mark the row sent
  // once at least one recipient actually got it.
  const tickets = result.data ?? [];
  let anyOk = false;
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket?.status === 'ok') {
      anyOk = true;
      continue;
    }
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await deps.deleteToken(tokens[i].expo_push_token);
      continue;
    }
    const suffix = tokens[i]?.expo_push_token.slice(-6) ?? `#${i}`;
    console.error(`[push] ticket error ${suffix}: ${ticket?.details?.error ?? ticket?.message ?? 'unknown'}`);
  }

  if (!anyOk) return 'failed';

  await deps.markSent(row.id);
  return 'ok';
}

// Shared by send-push-notification and retry-push-notifications.
export function makeDeps(supa: SupabaseClient): Deps {
  return {
    fetchNotification: async (id) => {
      const { data, error } = await supa
        .from('notifications')
        .select('id, recipient_user_id, title, body, deeplink_screen, deeplink_params, push_sent_at')
        .eq('id', id)
        .maybeSingle();
      if (error) console.error('[push] fetchNotification error', { error });
      return (data as NotificationRow | null) ?? null;
    },
    fetchTokens: async (userId) => {
      const { data, error } = await supa.from('device_tokens').select('expo_push_token').eq('user_id', userId);
      if (error) console.error('[push] fetchTokens error', { error });
      return (data as { expo_push_token: string }[] | null) ?? [];
    },
    countUnread: async (userId) => {
      const { count, error } = await supa
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', userId)
        .is('read_at', null);
      if (error) {
        console.error('[push] countUnread error', { error });
        return null;
      }
      return count ?? 0;
    },
    expoPush: async (messages) => {
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!resp.ok) throw new Error(`expo push ${resp.status}: ${await resp.text()}`);
      return resp.json();
    },
    markSent: async (id) => {
      const { error } = await supa.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', id);
      if (error) console.error('[push] markSent error', { error });
    },
    deleteToken: async (token) => {
      const { error } = await supa.from('device_tokens').delete().eq('expo_push_token', token);
      if (error) console.error('[push] deleteToken error', { error });
    },
  };
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// Guarded by import.meta.main so retry-push-notifications and the tests can
// import this module without binding the HTTP port.
if (import.meta.main) {
  Deno.serve(async (req) => {
    const auth = await checkAuth(req.headers.get('authorization'), Deno.env.get('WEBHOOK_AUTH_SECRET'));
    if (auth === 'misconfigured') return new Response('WEBHOOK_AUTH_SECRET not set', { status: 500 });
    if (auth === 'unauthorized') return new Response('unauthorized', { status: 401 });

    const payload = await req.json().catch(() => null) as { record?: { id?: unknown } } | null;
    const id = payload?.record?.id;
    if (typeof id !== 'string') return new Response('missing record.id', { status: 400 });

    const result = await handleNotification(id, makeDeps(serviceClient()));
    return new Response(result, { status: 200 });
  });
}
