import { createClient } from '@supabase/supabase-js';
import { handleNotification, type NotificationRecord, type Deps } from '../send-push-notification/index.ts';

export interface RetryDeps {
  fetchPending: () => Promise<NotificationRecord[]>;
  dispatch: (record: NotificationRecord) => Promise<string>;
}

export async function runRetry(deps: RetryDeps): Promise<{ processed: number; failed: number }> {
  const pending = await deps.fetchPending();
  let failed = 0;
  for (const rec of pending) {
    try {
      await deps.dispatch(rec);
    } catch {
      failed++;
    }
  }
  return { processed: pending.length, failed };
}

// Guarded by import.meta.main so this module can be imported by tests
// without binding the HTTP port.
if (import.meta.main) {
  Deno.serve(async (req) => {
  const expected = Deno.env.get('WEBHOOK_AUTH_SECRET');
  if (expected) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${expected}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const deps: RetryDeps = {
    fetchPending: async () => {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supa
        .from('notifications')
        .select('id, recipient_user_id, title, body, deeplink_screen, deeplink_params')
        .is('push_sent_at', null)
        .gt('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(1000);
      return (data as NotificationRecord[] | null) ?? [];
    },
    dispatch: async (record) => {
      const innerDeps: Deps = {
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
      return handleNotification(record, innerDeps);
    },
  };

  const result = await runRetry(deps);
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
