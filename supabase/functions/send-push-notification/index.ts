import { createClient } from '@supabase/supabase-js';

export interface NotificationRecord {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  deeplink_screen: string;
  deeplink_params: unknown;
}

export interface Deps {
  fetchNotificationSentAt: (id: string) => Promise<string | null>;
  fetchTokens: (userId: string) => Promise<{ expo_push_token: string }[]>;
  expoPush: (messages: ExpoMessage[]) => Promise<ExpoResponse>;
  markSent: (id: string) => Promise<void>;
  deleteToken: (token: string) => Promise<void>;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: unknown;
  sound: 'default';
}

interface ExpoResponse {
  data?: { status?: string; details?: { error?: string } }[];
}

export async function handleNotification(
  record: NotificationRecord,
  deps: Deps,
): Promise<string> {
  const sentAt = await deps.fetchNotificationSentAt(record.id);
  if (sentAt) return 'already sent';

  const tokens = await deps.fetchTokens(record.recipient_user_id);
  if (!tokens.length) return 'no tokens';

  const messages: ExpoMessage[] = tokens.map(t => ({
    to: t.expo_push_token,
    title: record.title,
    body: record.body,
    data: {
      notificationId: record.id,
      deeplinkScreen: record.deeplink_screen,
      deeplinkParams: record.deeplink_params,
    },
    sound: 'default',
  }));

  const result = await deps.expoPush(messages);
  await deps.markSent(record.id);

  for (let i = 0; i < (result.data ?? []).length; i++) {
    if (result.data![i]?.details?.error === 'DeviceNotRegistered') {
      await deps.deleteToken(tokens[i].expo_push_token);
    }
  }

  return 'ok';
}

// Real Deno.serve entry — wires Deps to the Supabase client + Expo fetch.
// Validates a shared-secret bearer if WEBHOOK_AUTH_SECRET env var is set
// (configured during Task 9 dashboard setup).
Deno.serve(async (req) => {
  const expected = Deno.env.get('WEBHOOK_AUTH_SECRET');
  if (expected) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${expected}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  const { record } = await req.json();
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const deps: Deps = {
    fetchNotificationSentAt: async (id) => {
      const { data } = await supa.from('notifications').select('push_sent_at').eq('id', id).single();
      return (data?.push_sent_at as string | null) ?? null;
    },
    fetchTokens: async (userId) => {
      const { data } = await supa.from('device_tokens').select('expo_push_token').eq('user_id', userId);
      return (data as { expo_push_token: string }[] | null) ?? [];
    },
    expoPush: async (messages) => {
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      return resp.json();
    },
    markSent: async (id) => {
      await supa.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', id);
    },
    deleteToken: async (token) => {
      await supa.from('device_tokens').delete().eq('expo_push_token', token);
    },
  };

  const result = await handleNotification(record, deps);
  return new Response(result, { status: 200 });
});
