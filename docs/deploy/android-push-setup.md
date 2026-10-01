# Android push notifications — one-time setup

Everything here is done once. **The hard rule:** migration 108 (Part C),
the FCM key (Part B) and the function deploy (Part D) must all be done before
the new APK (Part E) reaches anyone.

## Part A — Firebase (≈10 min, free)

**Done 2026-10-02:** project `sano-318b9`; its `google-services.json` is
committed. Do NOT create a second Firebase project — its key would not match
the committed file and pushes would fail silently.

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
5. **Restrict the Android API key** (the repo is public, so the key in
   `google-services.json` is visible). https://console.cloud.google.com →
   select project `sano-318b9` → **APIs & Services → Credentials** →
   **Android key (auto created by Firebase)**:
   - Application restrictions → **Android apps** → add package
     `com.sancontractor.supervisor` with the SHA-1 fingerprint shown by
     `npx eas-cli credentials -p android` (Keystore section).
   - API restrictions → **Restrict key** → tick **Firebase Installations API**,
     **FCM Registration API** and **Firebase Cloud Messaging API** → Save.

## Part B — Give the key to EAS

**Done 2026-10-02.** If it ever has to be redone, the uploaded key must come
from project `sano-318b9`.

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

## Part E — Build and roll out the APK

1. Only after Parts B, C (108 pasted) and D (deployed + verified). Before the
   first install, check for stale tokens (the retry now targets every token
   holder at once):

   ```sql
   SELECT platform, count(*), max(last_seen_at) FROM device_tokens GROUP BY 1;
   ```

2. From a worktree on `origin/main` (with `npm ci` done):

   ```bash
   npx eas-cli build -p android --profile preview --non-interactive --no-wait
   ```

   When finished, `npx eas-cli build:view <id> --json` must show version and
   runtime `3.2.0`, channel `preview`, and a commit that is on `main`.
3. Install on ONE phone first; Lainnya → Notifikasi HP must say **Aktif**.
   Send a test push with the app closed and the phone locked; check the lock
   screen, the icon badge, and that tapping it opens the app on the right
   screen. A ticket `ok` from Expo does not prove FCM works — only this does.
4. Then share the APK. Tell supervisors to install over the old app (login is
   kept) and tap **Allow**. Right after their first registration they may get
   several notifications at once (unread ones from the last 24 h).
5. **OTA warning:** from this merge on, `eas update` from `main` reaches only
   3.2.0 phones. Supervisors still on 3.1.0 get nothing until they install
   this APK. An urgent fix for 3.1.0 phones must be published from commit
   `e431140` (runtime 3.1.0).
