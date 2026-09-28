# Android push notifications — one-time setup

Everything here is done once. Order matters in Part C.

## Part A — Firebase (≈10 min, free)

1. Open https://console.firebase.google.com → **Create a project** → name `SANO` →
   turn **Google Analytics off** → Create.
2. On the project home, click the **Android** icon ("Add app").
   - Android package name: `com.sancontractor.supervisor` (exactly)
   - App nickname: `SANO`
   - Leave SHA-1 empty → **Register app**.
3. **Download google-services.json** → put it in the repo root (next to
   `app.json`). Skip the remaining "Add Firebase SDK" steps — Expo handles them.
4. Gear icon → **Project settings** → **Service accounts** →
   **Generate new private key** → Generate. A JSON file downloads.
   **Keep it private — never commit it or paste it in chat.**

## Part B — Give the key to EAS

In a terminal in the repo:

```bash
npx eas-cli credentials -p android
```

Choose build profile `preview` → **Google Service Account** →
**Manage your Google Service Account Key for Push Notifications (FCM V1)** →
**Set up a Google Service Account Key for Push Notifications (FCM V1)** →
**Upload a new service account key** → select the JSON from Part A step 4.
The key belongs to the app (package), so `production` builds use it too.

## Part C — Supabase Dashboard

1. Create a secret — run in a terminal and copy the output:

   ```bash
   openssl rand -hex 32
   ```

2. **Check what already exists.** SQL Editor → run:

   ```sql
   SELECT tgname, pg_get_triggerdef(t.oid)
   FROM pg_trigger t
   WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal;

   SELECT jobid, jobname, schedule FROM cron.job;
   ```

   If the second query errors with `schema "cron" does not exist`, enable
   **Integrations → Cron** first.

3. **Webhook.** Database → Webhooks → create (or edit the existing one that
   calls `send-push-notification`):
   - Name `push_on_notification_insert`, table `public.notifications`, event **Insert**
   - Type **Supabase Edge Functions**, function `send-push-notification`, method POST, timeout 5000 ms
   - HTTP headers: `Content-Type: application/json` and
     `Authorization: Bearer <secret from step 1>`

4. **Retry cron.** Integrations → Cron → Jobs → create job:
   - Name `retry-push-notifications`, schedule `*/15 * * * *`
   - Type **Supabase Edge Function**, POST, function `retry-push-notifications`
   - Header `Authorization: Bearer <secret>`, body `{}`
   - Delete any older daily retry job found in step 2.

5. **Secret.** Edge Functions → Secrets → add `WEBHOOK_AUTH_SECRET` = the secret.

Steps 3–4 come before step 5 so there is no window where the webhook sends no
header but the function demands one.

6. **Migration 108.** SQL Editor → paste all of
   `supabase/migrations/108_register_device_token.sql` → Run. The result grid
   must show one row with `prosecdef = true` and `anon_exec = false`. The app
   registers phones through this function, so paste it **before** anyone
   installs the new APK.

## Part D — Deploy the functions (Claude or developer)

Requires `supabase login` once (Personal Access Token). From a worktree on `main`:

```bash
supabase functions deploy send-push-notification --project-ref ufntlqvacjhmddwltcxf --use-api --no-verify-jwt
supabase functions deploy retry-push-notifications --project-ref ufntlqvacjhmddwltcxf --use-api --no-verify-jwt
```

`--no-verify-jwt` is required: the webhook and cron send the random
`WEBHOOK_AUTH_SECRET` bearer, not a JWT, so the gateway's JWT check would
reject every call before the function's own check runs.

Verify both refuse anonymous calls (expected `401`, from the function itself):

```bash
curl -s -w ' %{http_code}\n' -X POST https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/send-push-notification -d '{}'
curl -s -w ' %{http_code}\n' -X POST https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/retry-push-notifications -d '{}'
```

Expected body `unauthorized 401` for both (a gateway rejection would say
something about a JWT instead). Then prove the right bearer gets through — the
person holding the secret runs:

```bash
curl -s -w ' %{http_code}\n' -X POST https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/send-push-notification -H "Authorization: Bearer $WEBHOOK_AUTH_SECRET" -H 'Content-Type: application/json' -d '{"record":{"id":"00000000-0000-0000-0000-000000000000"}}'
```

Expected: `not found 200`.
