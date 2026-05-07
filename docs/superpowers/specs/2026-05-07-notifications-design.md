# Mobile Notifications — Design Spec

**Date:** 2026-05-07
**Status:** Design approved, pending implementation plan
**Touches:** New PostgreSQL tables (`device_tokens`, `notifications`), 5-7 PG triggers on existing source tables, one Supabase Edge Function, one Database Webhook, mobile and office screens.

## Problem

The SANO platform has no notification surface. When a request transitions to `AUTO_HOLD` (newly enforced server-side, see [Claim 1 spec](2026-05-04-server-gate-enforcement-design.md)), nobody is alerted — estimators discover it only by opening the Approvals screen. Same gap for APPROVED / REJECTED decisions (the requesting supervisor doesn't know unless they re-check), PO-ready events (field team doesn't know to expect a delivery), and Gate 2-4 outcomes (mismatches sit unattended).

For a construction control platform where Tier 1 holds can block field work, "log in and check" is too slow. Users need real-time alerts on the device they carry.

## Goals

- **Native push** delivered within ~2 seconds of the underlying DB event for users with the app closed/backgrounded.
- **In-app notification list** (with unread badge) for history and for users who have push permission denied.
- **Server-truth dispatch:** the trigger to enqueue is in the database, not the client. Same philosophy as Claim 1 — fires regardless of which client (REST, old app, etc.) caused the source row to change.
- **Project-scoped recipients:** every member of `project_assignments.project_id = source.project_id` gets the notification (with self-suppression so the user who took the action isn't notified about it).
- **Single ingest queue:** one `notifications` table acts as the outbox for push delivery AND the source for the in-app history.
- **Zero per-user preferences for v1.** OS-level disable is the only opt-out path. Add preferences only if the team complains in production.

## Non-goals

- **Email / SMS fallback.** Push + in-app is sufficient for the target users (always have the app installed).
- **Action buttons** (e.g., inline "Approve" on the push). Out of scope for v1; the tap-to-deeplink flow is enough.
- **Web push.** Office users on a browser see only the in-app list (via Realtime).
- **Notification preferences / mute toggles.** YAGNI — every project member gets every event from day one.
- **Per-event-type templates editable in the dashboard.** Templates are hard-coded PL/pgSQL strings; future i18n / template editor can layer on top.
- **Notification grouping on the OS side.** Each event is one push. If a project gets 5 AUTO_HOLDs in a minute, the user sees 5 pushes — acceptable.
- **Archival / retention.** Notifications grow unbounded for v1. Add a 90-day archive cron in a follow-up spec when the table size warrants it.

## Core principle

Database is the source of truth. PG triggers detect the event, write notifications rows for every project member, and the rest of the system (push delivery, in-app realtime) is just consumers of that table.

---

## Section 1 — Data model

Two new tables. Both project-scoped (cascade from projects).

### `device_tokens`

One row per (user, physical device).

```sql
CREATE TABLE device_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
```

The mobile app calls `upsert(..., { onConflict: 'expo_push_token' })` on launch so the same physical device upgrades cleanly when the app is reinstalled or the user re-authenticates.

### `notifications`

Outbox + in-app history.

```sql
CREATE TABLE notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient_user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN (
                       'AUTO_HOLD', 'APPROVED', 'REJECTED',
                       'PO_READY', 'RECEIPT_MISMATCH',
                       'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH'
                     )),
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  deeplink_screen    TEXT NOT NULL,
  deeplink_params    JSONB,
  related_entity_id  UUID,
  read_at            TIMESTAMPTZ,
  push_sent_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications(recipient_user_id, read_at NULLS FIRST, created_at DESC);
```

The composite index supports the in-app list query: "rows for me, unread first, newest first."

**RLS:** SELECT-restricted to `recipient_user_id = auth.uid()`. UPDATE-restricted to setting `read_at` on the user's own rows. INSERT denied to anon/authenticated (only `SECURITY DEFINER` triggers and the service-role can insert). DELETE not granted (cascade only).

---

## Section 2 — Triggers and recipient resolution

### Helper function

```sql
CREATE OR REPLACE FUNCTION enqueue_notification(
  p_project_id        UUID,
  p_type              TEXT,
  p_title             TEXT,
  p_body              TEXT,
  p_deeplink_screen   TEXT,
  p_deeplink_params   JSONB,
  p_related_entity_id UUID,
  p_exclude_user_id   UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications
    (project_id, recipient_user_id, type, title, body,
     deeplink_screen, deeplink_params, related_entity_id)
  SELECT p_project_id, pa.profile_id, p_type, p_title, p_body,
         p_deeplink_screen, p_deeplink_params, p_related_entity_id
  FROM project_assignments pa
  WHERE pa.project_id = p_project_id
    AND (p_exclude_user_id IS NULL OR pa.profile_id <> p_exclude_user_id);
END;
$$;
```

`p_exclude_user_id` is the actor (e.g., the reviewer who approved) so they don't notify themselves.

### Per-event triggers

All `AFTER INSERT` or `AFTER UPDATE` on the source table, all `SECURITY DEFINER`, all guarded by transition-checks so they don't double-fire.

| Event | Source table | Trigger condition | Title (id) | Body template (id) | Deeplink |
|---|---|---|---|---|---|
| `AUTO_HOLD` | `material_request_headers` | `AFTER UPDATE WHEN OLD.overall_status IS DISTINCT FROM NEW.overall_status AND NEW.overall_status = 'AUTO_HOLD'` | "Permintaan butuh review" | "Request <code> di-flag <flag>. Tap untuk review." | `ApprovalsScreen { headerId }` |
| `APPROVED` | `material_request_headers` | Same with `NEW.overall_status = 'APPROVED'` | "Permintaan disetujui" | "Request <code> disetujui." | `ApprovalsScreen { headerId }` |
| `REJECTED` | `material_request_headers` | Same with `NEW.overall_status = 'REJECTED'` | "Permintaan ditolak" | "Request <code> ditolak." | `ApprovalsScreen { headerId }` |
| `PO_READY` | `purchase_orders` | `AFTER INSERT OR UPDATE OF status` with guard `(TG_OP = 'INSERT' AND NEW.status = 'READY') OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'READY')` — single trigger function handles both creation-as-READY and later promotion-to-READY | "PO siap dikirim" | "PO <code> siap, supplier <name>." | `POScreen { poId }` |
| `RECEIPT_MISMATCH` | `receipts` | `AFTER INSERT WHEN gate3_flag IN ('WARNING', 'CRITICAL')` | "Penerimaan mismatch" | "Receipt dari <vehicle> ada selisih." | `ReceiptScreen { receiptId }` |
| `GATE2_OVER_BUDGET` | `purchase_orders` | `AFTER INSERT/UPDATE WHEN NEW.gate2_flag IN ('CRITICAL')` | "PO melebihi budget" | "PO <code> melebihi <pct>%." | `POScreen { poId }` |
| `GATE4_INVOICE_MISMATCH` | `gate4_outcomes` (verify table exists; if not, defer this event) | `AFTER INSERT WHEN flag != 'OK'` | "Tagihan mismatch" | "Invoice <code> ada selisih." | `InvoiceScreen { invoiceId }` |

If `gate4_outcomes` doesn't exist in the schema, drop `GATE4_INVOICE_MISMATCH` from the v1 trigger set (still in the type CHECK constraint for forward compatibility).

### Self-suppression

For events triggered by a user action (APPROVED, REJECTED, PO insert), the trigger reads the actor's id from the source row (`reviewed_by`, `created_by`, etc.) and passes it to `enqueue_notification(..., p_exclude_user_id => actor_id)`. For events triggered by the system (AUTO_HOLD set by Claim 1's trigger), there's no actor to exclude — pass NULL.

### Idempotence

Triggers use transition guards (`OLD.status IS DISTINCT FROM NEW.status`) so re-saving an unchanged header doesn't re-enqueue. The migration is `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS … CREATE TRIGGER`, same pattern as migration 033.

---

## Section 3 — Push delivery

### Edge Function

`supabase/functions/send-push-notification/index.ts` — invoked by a Supabase Database Webhook on `notifications` INSERT.

```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const { record } = await req.json();
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Idempotency check: Supabase webhooks are at-least-once. If push_sent_at
  // is already set, this row was already dispatched — skip.
  const { data: row } = await supa
    .from('notifications')
    .select('push_sent_at')
    .eq('id', record.id)
    .single();
  if (row?.push_sent_at) return new Response('already sent', { status: 200 });

  const { data: tokens } = await supa
    .from('device_tokens')
    .select('expo_push_token')
    .eq('user_id', record.recipient_user_id);

  if (!tokens?.length) return new Response('no tokens', { status: 200 });

  const messages = tokens.map(t => ({
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

  const resp = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  const result = await resp.json();

  // Best-effort: mark sent
  await supa.from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .eq('id', record.id);

  // Cleanup stale tokens
  for (let i = 0; i < (result.data ?? []).length; i++) {
    if (result.data[i]?.details?.error === 'DeviceNotRegistered') {
      await supa.from('device_tokens')
        .delete()
        .eq('expo_push_token', tokens[i].expo_push_token);
    }
  }

  return new Response('ok', { status: 200 });
});
```

### Database Webhook (one-time dashboard config)

- **Source:** `public.notifications`, on `INSERT`.
- **Target:** HTTP POST → Edge Function URL.
- **Auth:** Bearer with the project's anon key OR a custom header that the Edge Function validates against a shared secret. (Service-role JWT works but exposes more privilege than needed; prefer the shared secret pattern.)
- **Payload:** Supabase's default webhook envelope (`{ type, table, record, old_record }`).

The webhook is configured in the Supabase dashboard, NOT in a migration. The deployment notes in migration 034 reference this step explicitly.

### Failure handling

- **Edge Function fails or webhook delivery fails:** the row stays in `notifications` with `push_sent_at = NULL`. A nightly cron Edge Function `retry-push-notifications` picks up rows where `push_sent_at IS NULL AND created_at > now() - interval '24h'` and retries. After 24h, give up (the row remains in the in-app list, just no push retry).
- **`DeviceNotRegistered`:** delete the stale token. User's other devices still receive.
- **No `expo_push_token` registered for the user:** silent skip. The in-app list still works via Realtime — user sees it on next app open.
- **Token quota exceeded (Expo Push has soft limits):** Expo returns 429. Edge Function falls back to no-op (push_sent_at stays null). Rare in practice.

---

## Section 4 — Mobile / office app integration

### Token registration

New file `tools/notifications.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) return; // simulators don't get a real token

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: token,
      platform: Platform.OS,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' },
  );
}
```

### App entry wiring

In `App.tsx`, after the auth session is known, register the token and attach a tap listener.

```typescript
useEffect(() => {
  if (profile?.id) registerForPushNotifications(profile.id);
}, [profile?.id]);

useEffect(() => {
  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data;
    if (data.deeplinkScreen) {
      // Navigate based on deeplinkScreen + deeplinkParams.
      // Implementation depends on react-navigation setup.
      navigationRef.navigate(data.deeplinkScreen, data.deeplinkParams);
    }
  });
  return () => sub.remove();
}, []);
```

### In-app list screen

Two parallel screens (mobile + office) share a presentational list component.

**Files:**
- `workflows/screens/NotificationsScreen.tsx` — mobile (supervisors).
- `office/screens/NotificationsScreen.tsx` — office (estimators / admins / principals).
- `workflows/screens/components/NotificationList.tsx` — shared presentational component.

**UI:**
- Bell icon in the bottom-tab bar with an unread-count badge.
- Tapping the bell opens NotificationsScreen.
- List is grouped by day (Hari ini / Kemarin / 2 hari lalu / older), each row shows title + body + relative time + a dot if unread.
- Tap a row → mark `read_at = now()` and navigate to the notification's deeplink target.
- Pull-to-refresh re-fetches from the server.
- Realtime subscription appends new rows to the list and increments the badge without re-fetch.

### Realtime subscription

```typescript
useEffect(() => {
  if (!profile?.id) return;
  const channel = supabase.channel(`notifications:${profile.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_user_id=eq.${profile.id}`,
      },
      payload => {
        // Add to local state, increment unread badge
      },
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}, [profile?.id]);
```

The Realtime subscription is what drives in-app live updates. Push delivery is a separate path that lights up the OS notification when the app is closed.

### Files in scope

- Create: `tools/notifications.ts` (~80 LOC)
- Create: `workflows/screens/NotificationsScreen.tsx` (~120 LOC)
- Create: `office/screens/NotificationsScreen.tsx` (~120 LOC)
- Create: `workflows/screens/components/NotificationList.tsx` (~150 LOC)
- Modify: `App.tsx` (registration + tap listener)
- Modify: bottom-tab nav stacks for both surfaces (add Notifications tab, bell icon, unread badge wiring)

---

## Section 5 — Testing

### Integration tests against the linked Supabase project

Reuses the harness pattern from [Claim 1's spec](2026-05-04-server-gate-enforcement-design.md) (`tools/__tests__/_serverGateHarness.ts`).

Test file: `tools/__tests__/notificationDispatch.test.ts`. ~250 LOC. Cases:

```
✓ AUTO_HOLD enqueues for all 3 project members (no actor exclusion since
  AUTO_HOLD is set by trigger, not user action)
✓ APPROVED with reviewer = member: N-1 rows (actor self-suppressed)
✓ REJECTED with reviewer = member: N-1 rows (actor self-suppressed)
✓ Status update from PENDING → AUTO_HOLD → AUTO_HOLD again (idempotency
  on resave): only one notification row created (transition guard)
✓ PO_READY enqueues on insert
✓ RECEIPT_MISMATCH enqueues only when gate3_flag is WARNING/CRITICAL
✓ Project with 0 assigned members: 0 notification rows, no error
✓ Cascade: delete project → notifications gone
✓ enqueue_notification respects p_exclude_user_id
```

The harness gains two helpers: `assignToProject(projectId, userIds)` and `countNotifications({ projectId, recipientUserId, type })`.

### Edge Function tests (Deno)

Test file: `supabase/functions/send-push-notification/index.test.ts`. Mock `fetch` for Expo Push. Cases:

```
✓ No tokens → returns "no tokens", no Expo call
✓ One token → one Expo message dispatched, push_sent_at updated
✓ Multiple tokens for same user → batched into one Expo POST
✓ Expo returns DeviceNotRegistered → stale token deleted
✓ Expo returns generic error → push_sent_at NOT updated (so retry cron picks it up)
✓ Notification row referenced doesn't exist → 200 response, no crash
```

### Mobile unit tests

`tools/__tests__/notifications.test.ts`:
- `registerForPushNotifications` skips on simulator (`Device.isDevice = false`).
- Skips when permission denied.
- Calls upsert with the right payload when permission granted.

Mocks `expo-notifications`, `expo-device`, `Platform`, `supabase`.

### Manual smoke (required before merge)

On a physical iOS or Android device:
1. Install the app, log in as a project member.
2. Confirm push permission grant flow works.
3. Verify `device_tokens` row exists in DB.
4. From a different account (or REST API), submit a request that triggers AUTO_HOLD.
5. Push arrives within ~5s. Tap → opens Approvals filtered to that header.
6. Repeat for APPROVED + REJECTED scenarios.

The manual smoke is the only way to validate end-to-end push delivery; it cannot be fully automated without a real device + Expo's infrastructure in the loop.

---

## Section 6 — File layout, deployment, risks

### Create

- `supabase/migrations/034_notifications.sql` — tables + helper + 5-7 trigger functions + triggers + RLS. ~250 LOC.
- `supabase/functions/send-push-notification/index.ts` — Edge Function. ~70 LOC.
- `supabase/functions/retry-push-notifications/index.ts` — nightly retry cron. ~40 LOC.
- `tools/notifications.ts` — push registration + handlers. ~80 LOC.
- `workflows/screens/NotificationsScreen.tsx` (~120 LOC)
- `office/screens/NotificationsScreen.tsx` (~120 LOC)
- `workflows/screens/components/NotificationList.tsx` (~150 LOC)
- `tools/__tests__/notificationDispatch.test.ts` — integration. ~250 LOC.
- `supabase/functions/send-push-notification/index.test.ts` — Edge Function unit tests. ~150 LOC.
- `tools/__tests__/notifications.test.ts` — mobile unit tests. ~80 LOC.

### Modify

- `App.tsx` — call `registerForPushNotifications` after auth, attach tap listener.
- `workflows/_layout.tsx` (or equivalent) — add Notifications tab + bell icon + badge.
- `office/_layout.tsx` (or equivalent) — same.
- `package.json` — add `expo-notifications` if not already present in Expo SDK 54 baseline. Confirm `expo-device` is available.
- `tools/__tests__/_serverGateHarness.ts` — add `assignToProject` and `countNotifications` helpers.

### Deployment sequence

1. **Apply migration 034** to production via dashboard SQL editor (matches Claim 1's deployment pattern). Idempotent — safe to re-apply.
2. **Deploy Edge Functions:** `supabase functions deploy send-push-notification` and `supabase functions deploy retry-push-notifications`.
3. **Configure Database Webhook** in dashboard: source `public.notifications` INSERT, target the deployed Edge Function URL, with a shared-secret header.
4. **Schedule the retry cron** via Supabase dashboard cron config: `retry-push-notifications` daily at 2am.
5. **Build mobile app** with new dependencies. New native modules (`expo-notifications`) require a fresh build, not OTA. Roll out via TestFlight / Play Internal first.
6. **Smoke test** on physical device per Section 5.
7. **Office (web/admin) deploy** via Vercel — no native dependencies, just the new screen + Realtime subscription. Standard auto-deploy on merge.

### Effort estimate

| Task | Effort |
|---|---|
| Migration 034 (tables, helper, 5-7 triggers, RLS) + tests | 1.5 days |
| Edge Function `send-push-notification` + Deno tests | 0.5 day |
| Edge Function `retry-push-notifications` (cron) | 0.25 day |
| Mobile token registration + tap listener wiring | 0.5 day |
| In-app list screens (mobile + office) + shared component | 1 day |
| Bottom-tab integration + unread badge | 0.5 day |
| Database Webhook config + secret rotation runbook | 0.25 day |
| Manual smoke test + iteration | 0.5 day |
| **Total** | **~5 days** |

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Database Webhook delivery fails (Edge Function down, network) | Notification row remains with `push_sent_at IS NULL`. `retry-push-notifications` cron retries within 24h. In-app delivery via Realtime is independent. |
| Webhook called twice for same INSERT (Supabase guarantees at-least-once) | Edge Function checks `notification.push_sent_at IS NULL` before dispatching. If already sent, skip. |
| Expo `DeviceNotRegistered` (uninstalled, expired token) | Edge Function deletes the stale `device_tokens` row. User's other devices keep working. |
| Push permission denied | Token never registered. User sees in-app via Realtime, no push. Communicated as a known limitation in the user's Settings screen (if it exists) or in onboarding copy. |
| `project_assignments` empty for legacy projects | `enqueue_notification` inserts 0 rows. No error. Edge case is silent — acceptable. |
| Duplicate notifications from multiple status saves | Transition guard `OLD.overall_status IS DISTINCT FROM NEW.overall_status` blocks re-fires for unchanged values. |
| `notifications` table grows unbounded | Out of scope for v1. Add a 90-day archival cron in a follow-up spec when the table exceeds a few hundred thousand rows. |
| Mobile app must rebuild for native dependency | TestFlight / Play Internal first, then full rollout. Communicate timing to the team. |
| Realtime subscription latency over flaky cellular | Push delivery is the primary channel for AUTO_HOLD; Realtime is the in-app secondary. Acceptable degradation. |
| User has 5 devices → 5 simultaneous pushes for same notification | That's how Expo Push works for multi-device. Not deduplicated server-side. Acceptable — they'd want to know on every device they carry. |
| Database Webhook shared-secret leak | Rotate the secret + redeploy the Edge Function. Document the runbook in the deployment notes. |
| Edge Function cold-start adds 1-2s latency | Acceptable for the use case. If it ever matters, switch to Supabase's Realtime broadcast or pre-warm the function. |

### Out of scope (explicit)

- Notification preferences / muting (per Q3=A approved during brainstorming).
- Email or SMS fallback.
- Action buttons in push (inline Approve / Reject).
- Notification grouping / collapsing on the OS side.
- Web push notifications (browser surface).
- i18n / localization beyond Indonesian.
- Notification archival / retention.
- Per-event-type analytics or open-rate tracking.

---

## Open questions

None blocking. The `gate4_outcomes` table existence should be verified during planning; if it doesn't exist, drop `GATE4_INVOICE_MISMATCH` from the v1 trigger set and keep the type CHECK value for forward compatibility.
