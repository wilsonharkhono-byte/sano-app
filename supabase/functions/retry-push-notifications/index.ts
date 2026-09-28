// Deploy with --no-verify-jwt: the Dashboard cron calls this every 15 minutes
// with `Authorization: Bearer <WEBHOOK_AUTH_SECRET>`, a random hex secret, not
// a Supabase JWT - the gateway's own JWT check would refuse it before this
// file ever runs. checkAuth() (imported below) is the only gate (see
// datum-sync/index.ts:10 for the same pattern).

import { checkAuth, handleNotification, makeDeps, serviceClient } from '../send-push-notification/index.ts';

export interface RetryDeps {
  fetchPendingIds: () => Promise<string[]>;
  dispatch: (id: string) => Promise<string>;
}

export async function runRetry(deps: RetryDeps): Promise<{ processed: number; failed: number }> {
  const ids = await deps.fetchPendingIds();
  let failed = 0;
  for (const id of ids) {
    try {
      await deps.dispatch(id);
    } catch {
      failed++;
    }
  }
  return { processed: ids.length, failed };
}

// The webhook's own call for a brand-new row may still be in flight, and
// push_sent_at is a check-then-write (not atomic) - retrying anything
// younger than RETRY_MIN_AGE_MS risks a double send racing that delivery.
const RETRY_MIN_AGE_MS = 2 * 60_000;
const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Runs every 15 minutes (Dashboard cron). Re-sends anything from the last 24 h
// the webhook missed, and delivers to users who registered a phone after the
// notification was created ('no tokens' rows are never marked sent).
if (import.meta.main) {
  Deno.serve(async (req) => {
    const auth = await checkAuth(req.headers.get('authorization'), Deno.env.get('WEBHOOK_AUTH_SECRET'));
    if (auth === 'misconfigured') return new Response('WEBHOOK_AUTH_SECRET not set', { status: 500 });
    if (auth === 'unauthorized') return new Response('unauthorized', { status: 401 });

    const supa = serviceClient();
    const pushDeps = makeDeps(supa);

    const result = await runRetry({
      // Not extracted into its own testable function: doing so would only be
      // worth it if the result stayed simple, and mocking the raw chained
      // Supabase query builder for two dependent queries (device_tokens,
      // then notifications) is exactly the complexity the rest of this file
      // avoids by mocking plain Deps/RetryDeps functions instead. Left here,
      // untested directly - runRetry's own tests cover the dispatch loop.
      fetchPendingIds: async () => {
        const now = Date.now();

        // A row for a recipient with no device token yet can never send;
        // querying and dispatching it every 15 minutes is pure waste. Once
        // they register a phone their next retry pass will pick it up,
        // because this list is read fresh on every run.
        const { data: deviceRows } = await supa.from('device_tokens').select('user_id');
        const recipientIds = [...new Set(((deviceRows as { user_id: string }[] | null) ?? []).map(r => r.user_id))];
        if (!recipientIds.length) return [];

        const { data } = await supa
          .from('notifications')
          .select('id')
          .is('push_sent_at', null)
          .is('read_at', null) // already read in-app: don't push what they've seen
          .in('recipient_user_id', recipientIds)
          .gt('created_at', new Date(now - RETRY_MAX_AGE_MS).toISOString())
          .lt('created_at', new Date(now - RETRY_MIN_AGE_MS).toISOString())
          .order('created_at', { ascending: true })
          .limit(1000);
        const ids = ((data as { id: string }[] | null) ?? []).map(r => r.id);
        if (ids.length >= 1000) {
          console.warn('[retry-push-notifications] fetchPendingIds hit the 1000-row limit; some pending rows may be deferred to the next run');
        }
        return ids;
      },
      dispatch: (id) => handleNotification(id, pushDeps),
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
