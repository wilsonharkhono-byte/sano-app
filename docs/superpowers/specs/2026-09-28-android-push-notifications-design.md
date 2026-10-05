# Android Push Notifications + Unread Badge — Design

**Date:** 2026-09-28
**Scope:** Android APK only (iOS and web push are out of scope).
**Builds on:** `docs/superpowers/specs/2026-05-07-notifications-design.md` (the original notifications system).

## 1. Goal

When a SANO notification is created for a user, it appears on their Android
phone's lock screen / notification shade as a heads-up banner, and the app icon
shows a red badge equal to their **unread in-app notification count** (the same
number as the Notifikasi bell). Reading notifications in the app lowers the
badge; "tandai semua dibaca" clears it.

## 2. Current state (verified 2026-09-28 against live)

The pipeline from the May design is built but has never delivered a push:

- `notifications`: 210 rows, `push_sent_at` set on **0**.
- `device_tokens`: **0 rows** — no phone has ever registered.
- Root cause: Android push via Expo requires FCM. There is no Firebase project,
  no `google-services.json`, and no FCM V1 key on EAS, so
  `getExpoPushTokenAsync()` throws on the APK. `App.tsx` calls
  `void registerForPushNotifications(...)`, so the failure is invisible.
- `expo-notifications` is not listed in `app.json` plugins (no notification
  icon/colour; no explicit channel).
- Both edge functions are deployed but **unauthenticated**:
  `send-push-notification` returns 500 (not 401) on an unauthenticated empty
  POST, and `retry-push-notifications` returns 200 — so `WEBHOOK_AUTH_SECRET`
  is unset. `send-push-notification` also takes `title`/`body` from the request
  body, so anyone holding a real notification id could push arbitrary text.
- Whether the Database Webhook (notifications INSERT → send-push-notification)
  exists is unknown; the retry cron is daily.
- Pushes carry no `badge` field, and nothing sets the launcher badge from the app.

`expo-notifications` 0.32 on Android maps a remote `badge` value to
`NotificationCompat.Builder.setNumber()` and exposes `setBadgeCountAsync()`
(ShortcutBadger), so no new library is needed.

## 3. Design

### 3.1 Firebase / EAS (one-time, manual — user-owned)

1. Create a Firebase project; add an Android app with package
   `com.sancontractor.supervisor`.
2. Download `google-services.json` to the repo root and commit it (it holds
   public client identifiers, not secrets).
3. Create an FCM V1 service-account key and upload it with
   `eas credentials` → Android → preview/production → Push Notifications (FCM V1).
   The service-account JSON is **not** committed.

Exact click-by-click steps go in `docs/deploy/android-push-setup.md`.

### 3.2 App config (`app.json`)

- `android.googleServicesFile: "./google-services.json"`.
- Plugin `["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#B29F86" }]`.
- New asset `assets/notification-icon.png`: white-on-transparent silhouette of
  the SANO mark, 96×96 (Android requires a monochrome small icon).
- `version` 3.1.0 → **3.2.0**. The native config changes, and
  `runtimeVersion.policy = appVersion`, so the new binary gets its own OTA
  runtime; 3.1.0 phones cannot receive JS that assumes FCM.

### 3.3 Client — `tools/notifications.ts`

`registerForPushNotifications(userId)` becomes:

1. Skip on web and on non-devices.
2. On Android, `setNotificationChannelAsync('default', { importance: MAX,
   lockscreenVisibility: PUBLIC, sound: 'default', showBadge: true })` —
   before requesting the token (Android 13+ shows the permission prompt only
   once a channel exists).
3. Check-then-request permission (never request when already granted; see the
   AppState/permission trap in project memory).
4. `getExpoPushTokenAsync({ projectId })`, with `projectId` from
   `Constants.expoConfig.extra.eas.projectId`.
5. Upsert into `device_tokens` (existing `onConflict: 'expo_push_token'`),
   refreshing `last_seen_at`. Runs on every launch once the profile is known.
6. Return a status: `'active' | 'denied' | 'unsupported' | 'error'`. Errors
   are caught, `console.warn`-ed, and reported as `'error'` — never thrown.

The status is held in a tiny module-level store with a subscribe function
(`getPushStatus` / `usePushStatus`) so the UI can read it without prop drilling.

New `unregisterPushToken()`: deletes this device's token row (tracked from the
last successful registration). Called from `tools/auth.ts` `signOut()` **before**
`supabase.auth.signOut()`, while the session still satisfies the
`device_tokens_delete_own` RLS policy. Failures are swallowed so logout never
blocks.

### 3.4 Client — badge sync

New `useBadgeSync(unreadCount)` hook calls
`Notifications.setBadgeCountAsync(unreadCount)` whenever the count changes
(no-op on web). It is mounted in `Header.tsx`, next to the existing
`useUnreadCount`, which already refreshes on realtime changes and on
foreground — so the badge follows the bell with no extra subscriptions.

### 3.5 Client — status line

`LainnyaScreen` profile card gets one line: **Notifikasi HP: Aktif / Izin
ditolak / Gagal / Tidak didukung**. For "Izin ditolak", tapping opens the
system app settings (`Linking.openSettings()`). Lets the office tell which
supervisor's phone isn't registered during rollout.

### 3.6 Server — `send-push-notification`

- Accepts the webhook payload but uses **only `record.id`**; reads
  `recipient_user_id, title, body, deeplink_screen, deeplink_params, push_sent_at`
  from the DB. Unknown id → `'not found'`.
- Each Expo message gains:
  - `badge`: the recipient's unread count (`read_at IS NULL`), computed once per
    notification.
  - `channelId: 'default'`, `priority: 'high'`.
- `retry-push-notifications` reuses `handleNotification`, so it inherits both.
- Existing behaviour kept: idempotent via `push_sent_at`; `DeviceNotRegistered`
  tokens deleted; `'no tokens'` does not mark sent (so a user who registers
  later still gets the last 24 h on the next retry).

### 3.7 Server — ops (manual, documented in the setup doc)

1. Generate and set `WEBHOOK_AUTH_SECRET`; redeploy both functions
   (`--use-api`, from a main worktree, per the deployment reference).
2. Verify the Database Webhook on `notifications` INSERT → send-push-notification
   with header `Authorization: Bearer <secret>`; create it if missing.
3. Change the retry cron from daily to **every 15 minutes**, with the same
   bearer header.
4. Confirm unauthenticated POSTs to both functions now return 401.

### 3.8 Rollout

1. Merge to main; build the APK from main with the `preview` profile
   (channel `preview`, runtime 3.2.0).
2. Supervisors install over the existing app (same package and signing key —
   the login is kept). On first launch Android 13+ asks for notification permission.
3. Verify a `device_tokens` row appears for the user's phone, then send a test
   notification and confirm the banner, lock screen and badge.
4. From then on, OTAs must target runtime 3.2.0; the `ota-main` worktree's
   runtime note in project memory gets updated.

## 4. Testing

- **jest** `tools/__tests__/notifications.test.ts`: channel created before token;
  no request when already granted; `projectId` passed; status returned for
  denied / error / success; `unregisterPushToken` deletes the stored token and
  swallows errors.
- **jest** for `useBadgeSync`: calls `setBadgeCountAsync` with the count, and
  again when it changes.
- **Deno** `send-push-notification/index.test.ts`: title/body come from the DB,
  not the request; `badge` equals the unread count; `channelId` and `priority`
  set; unknown id → `'not found'`.
- **Manual E2E** on a real Samsung/Oppo-class phone: app killed → push arrives
  on the lock screen; badge number shows; reading in app lowers it; mark-all → 0;
  logout → no further pushes to that phone.

## 5. Known limits

- Pixel / stock-Android launchers show a dot, not a number.
- A user's *other* devices update their badge only on the next push or app open.
- Notifications older than 24 h at first registration are never pushed.
- iOS and browser push remain unsupported.
- A ticket `ok` from Expo counts as sent; delivery receipts (`/getReceipts`) are
  not polled, so FCM-side failures (e.g. a wrong FCM key) only show up as
  missing pushes. Follow-up: poll receipts from the retry cron.
- The refresh-token local sign-out (`App.tsx`, `scope: 'local'`) cannot remove
  the token (no session), so that phone keeps the previous user's pushes until
  someone signs in again (migration 108 then reassigns it).
- On first registration the next retry pass pushes each unread notification
  from the last 24 h separately.

## 6. Out of scope

iOS (APNs, Apple Developer account), web push, per-user notification
preferences / muting, notification grouping.
