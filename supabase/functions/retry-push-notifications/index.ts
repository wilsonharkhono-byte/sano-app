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
    const auth = checkAuth(req.headers.get('authorization'), Deno.env.get('WEBHOOK_AUTH_SECRET'));
    if (auth === 'misconfigured') return new Response('WEBHOOK_AUTH_SECRET not set', { status: 500 });
    if (auth === 'unauthorized') return new Response('unauthorized', { status: 401 });

    const supa = serviceClient();
    const pushDeps = makeDeps(supa);

    const result = await runRetry({
      fetchPendingIds: async () => {
        const now = Date.now();
        const { data } = await supa
          .from('notifications')
          .select('id')
          .is('push_sent_at', null)
          .gt('created_at', new Date(now - RETRY_MAX_AGE_MS).toISOString())
          .lt('created_at', new Date(now - RETRY_MIN_AGE_MS).toISOString())
          .order('created_at', { ascending: true })
          .limit(1000);
        return ((data as { id: string }[] | null) ?? []).map(r => r.id);
      },
      dispatch: (id) => handleNotification(id, pushDeps),
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
