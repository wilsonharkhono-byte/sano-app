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

**Already done on 2026-09-28 — do not redo:** `WEBHOOK_AUTH_SECRET` exists
(rotated that day) and the Database Webhook `notify-on-notification-insert`
(notifications INSERT → send-push-notification) sends
`Authorization: Bearer <that secret>`. The same secret is used by the DATUM
sync webhook, so **never generate a new one** here — it would break DATUM sync.
When you need the secret value below, copy it from the existing
`notify-on-notification-insert` webhook's Authorization header (the part after
`Bearer `). Watch for the Dashboard's auto-filled service-role header: the
value must be exactly `Bearer <64 hex characters>`, nothing else.

1. **Migration 108.** SQL Editor → paste all of
   `supabase/migrations/108_register_device_token.sql` → Run. The result grid
   must show one row with `prosecdef = true` and `anon_exec = false`. The app
   registers phones through this function, so paste it **before** anyone
   installs the new APK.

2. **Check the retry job.** SQL Editor → run:

   ```sql
   SELECT jobid, jobname, schedule, command FROM cron.job;
   ```

   Look for a job whose command mentions `retry-push-notifications`.

3. **Retry job — create or fix it.** Integrations → Cron → Jobs:
   - If one exists: edit it. If none: **Create job**.
   - Name `retry-push-notifications`, schedule `*/15 * * * *` (every 15 minutes)
   - Type **Supabase Edge Function**, method POST, function `retry-push-notifications`
   - Header `Authorization: Bearer <the existing secret>`, body `{}`
   - The old job (if any) was daily and may still carry the pre-rotation
     secret — replacing its schedule and header fixes both.

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
