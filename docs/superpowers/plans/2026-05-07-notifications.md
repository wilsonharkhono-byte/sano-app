# Mobile Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real-time native push + in-app notifications to project members when key workflow events occur (AUTO_HOLD, APPROVED, REJECTED, PO_READY, RECEIPT_MISMATCH).

**Architecture:** Single migration adds `device_tokens` + `notifications` tables and 5 PG triggers on existing source tables. Each trigger calls a shared `enqueue_notification` helper that fans out one row per project member. A Supabase Database Webhook fires a Supabase Edge Function on `notifications` INSERT, which dispatches via the Expo Push API. Mobile app subscribes via Supabase Realtime to keep the in-app list and unread badge live.

**Tech Stack:** PostgreSQL (PL/pgSQL triggers, RLS), Supabase (Database Webhook, Realtime, Edge Functions on Deno), Expo Push API, Expo SDK 54 (`expo-notifications`, `expo-device`), React Native, `@react-navigation/bottom-tabs`, Jest with ts-jest, `@supabase/supabase-js` service-role client.

**Spec:** [docs/superpowers/specs/2026-05-07-notifications-design.md](../specs/2026-05-07-notifications-design.md)

**Branch:** `feat/notifications` (already created from `origin/main`)

---

## Scope adjustments from spec self-review

Two events from the spec require persistent flag storage that doesn't exist in the schema. Both are deferred to follow-up specs; the type CHECK constraint includes them for forward compatibility but no v1 trigger is built.

| Event | Reason for deferral |
|---|---|
| `GATE2_OVER_BUDGET` | No `gate2_flag` column on `purchase_orders` and no `gate2_outcomes` table. Adding one is its own scope. |
| `GATE4_INVOICE_MISMATCH` | No `gate4_outcomes` or `invoices` table. Same reason. |

**v1 trigger set:** AUTO_HOLD, APPROVED, REJECTED, PO_READY, RECEIPT_MISMATCH (5 events).

Other corrections from the spec:
- **`project_assignments.user_id`** (NOT `profile_id`) — helper function uses `pa.user_id`.
- **`purchase_orders.status`** values are `OPEN | PARTIAL_RECEIVED | FULLY_RECEIVED | CANCELLED`. There is no `READY` value. **PO_READY trigger fires on `AFTER INSERT` (a freshly created PO is "ready to be sent to supplier" — there's no separate ready-state in the workflow).** No status-transition handling needed.

---

## File Structure

**Create:**
- `supabase/migrations/034_notifications.sql` — tables, helper, 5 trigger functions, 5 triggers, RLS (~280 LOC, idempotent like 033)
- `supabase/functions/send-push-notification/index.ts` — webhook-triggered Edge Function (~80 LOC)
- `supabase/functions/send-push-notification/index.test.ts` — Deno tests with `fetch` mocked (~150 LOC)
- `supabase/functions/retry-push-notifications/index.ts` — cron-triggered retry (~50 LOC)
- `supabase/functions/retry-push-notifications/index.test.ts` — Deno tests (~100 LOC)
- `tools/notifications.ts` — push token registration + tap listener wiring (~100 LOC)
- `tools/__tests__/notifications.test.ts` — unit tests for the registration logic (~80 LOC)
- `tools/__tests__/notificationDispatch.test.ts` — integration tests against linked Supabase project (~350 LOC)
- `workflows/screens/components/NotificationList.tsx` — shared presentational list (~180 LOC)
- `workflows/screens/components/__tests__/NotificationList.test.tsx` — RN component tests (~80 LOC)
- `workflows/screens/NotificationsScreen.tsx` — mobile-side container with Realtime subscription (~120 LOC)
- `office/screens/NotificationsScreen.tsx` — office-side container (~120 LOC)

**Modify:**
- `workflows/App.tsx` — call `registerForPushNotifications` after auth, attach tap listener
- `workflows/AppNavigation.tsx` — add Notifications tab + unread badge (supervisor)
- `office/navigation.tsx` — add Notifications tab + unread badge (admin/estimator)
- `office/PrincipalNavigation.tsx` — add Notifications tab + unread badge (principal)
- `tools/__tests__/_serverGateHarness.ts` — add `assignToProject` and `countNotifications` helpers

**No changes to:**
- `package.json` — `expo-notifications` and `expo-device` are part of Expo SDK 54 baseline (verify with `npx expo install --check` in Task 7)
- Existing migrations 001-033

---

## Migration application pattern (re-used from Claim 1)

The migration uses `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS … CREATE TRIGGER` patterns so it's fully idempotent. Apply via the Supabase dashboard SQL editor (matches the user's preference from Claim 1 — CLI requires `SUPABASE_DB_PASSWORD` which isn't in `.env`).

After each task that edits the migration, request the user re-paste the full file or just the edited functions. Both work.

---

## Prerequisites (one-time setup)

- [ ] **P1: Verify Supabase project + service key still in `.env`**

Run: `grep -c '^SUPABASE_SERVICE_KEY=' .env`
Expected: `1`. Confirms the harness from Claim 1 is reusable.

- [ ] **P2: Confirm test target project**

Read `EXPO_PUBLIC_SUPABASE_URL` from `.env`. Confirm with user this is `ufntlqvacjhmddwltcxf` (san-contractor) — same target as Claim 1. STOP if it changed.

- [ ] **P3: Verify Supabase CLI installed for Edge Function deploys (Task 5+)**

Run: `supabase --version`
Expected: any version. If missing, `brew install supabase/tap/supabase` or follow [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli).

- [ ] **P4: Confirm Expo SDK packages**

Run: `npx expo install --check 2>&1 | head -20`
Expected: shows `expo-notifications` and `expo-device` already at compatible versions OR prompts to install. If prompted, run `npx expo install expo-notifications expo-device` and commit `package.json` + `package-lock.json` separately before starting Task 1.

---

## Task 1: Migration scaffold — tables, helper, RLS

**Files:**
- Create: `supabase/migrations/034_notifications.sql`
- Modify: `tools/__tests__/_serverGateHarness.ts` (add `assignToProject`, `countNotifications`)
- Modify: `tools/__tests__/notificationDispatch.test.ts` — actually CREATE this in this task with one smoke test

This task creates the two new tables, the helper function, the row-level security policies, and the harness extensions. No triggers yet — those come in Tasks 2-3.

- [ ] **Step 1: Extend the harness with two helpers**

Edit `tools/__tests__/_serverGateHarness.ts`. Append before the final `cleanupTestData` function:

```typescript
/** Assigns the given user to the project. Used by notification tests. */
export async function assignToProject(projectId: string, userId: string): Promise<void> {
  const { error } = await adminClient.from('project_assignments').insert({
    project_id: projectId,
    user_id: userId,
  });
  if (error) throw error;
}

/** Counts notification rows matching the filter. */
export async function countNotifications(filter: {
  projectId?: string;
  recipientUserId?: string;
  type?: string;
}): Promise<number> {
  let query = adminClient.from('notifications').select('id', { count: 'exact', head: true });
  if (filter.projectId) query = query.eq('project_id', filter.projectId);
  if (filter.recipientUserId) query = query.eq('recipient_user_id', filter.recipientUserId);
  if (filter.type) query = query.eq('type', filter.type);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
```

Also extend `cleanupTestData` to delete leftover `notifications` and `device_tokens` rows. Find the existing `cleanupTestData` body and add these deletes BEFORE the existing `projects` delete (so dependents are cleaned first):

```typescript
  // Delete notifications + device_tokens for users we created (matched by
  // the auth-user prefix). Cascade from auth.users handles profiles, but
  // notifications and device_tokens reference profiles directly.
  const emailPrefix = TEST_PREFIX.toLowerCase();
  const { data: testUsers, error: listUsersErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listUsersErr) errors.push(new Error(`listUsers (cleanup deps) failed: ${listUsersErr.message}`));
  const testUserIds = (testUsers?.users ?? [])
    .filter(u => u.email?.startsWith(emailPrefix))
    .map(u => u.id);
  if (testUserIds.length > 0) {
    const { error: notifErr } = await adminClient
      .from('notifications')
      .delete()
      .in('recipient_user_id', testUserIds);
    if (notifErr) errors.push(new Error(`notifications delete failed: ${notifErr.message}`));

    const { error: tokErr } = await adminClient
      .from('device_tokens')
      .delete()
      .in('user_id', testUserIds);
    if (tokErr) errors.push(new Error(`device_tokens delete failed: ${tokErr.message}`));
  }
```

- [ ] **Step 2: Write a smoke test that uses the new helpers**

Create `tools/__tests__/notificationDispatch.test.ts`:

```typescript
import {
  adminClient,
  cleanupTestData,
  createTestProject,
  assignToProject,
  countNotifications,
} from './_serverGateHarness';

jest.setTimeout(30_000);

afterAll(async () => {
  await cleanupTestData();
});

describe('notification dispatch — harness smoke', () => {
  it('countNotifications returns 0 for a fresh project', async () => {
    const project = await createTestProject();
    const count = await countNotifications({ projectId: project.id });
    expect(count).toBe(0);
  });

  it('assignToProject inserts a project_assignments row', async () => {
    const project = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);

    const { data, error } = await adminClient
      .from('project_assignments')
      .select('user_id')
      .eq('project_id', project.id);
    expect(error).toBeNull();
    expect(data?.map(r => r.user_id)).toContain(project.ownerProfileId);
  });
});
```

- [ ] **Step 3: Run smoke test to verify harness extensions work**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts --runInBand --verbose`
Expected: `Tests: 2 passed, 2 total`. If `notifications` table doesn't exist yet, the `countNotifications` query fails with "relation not found" — that's expected at this point. The test for `assignToProject` should still pass.

If `countNotifications` fails with the table-not-found error: that's the expected failing state for TDD. Continue to Step 4 (creating the migration).

- [ ] **Step 4: Create the migration**

Create `supabase/migrations/034_notifications.sql`:

```sql
-- 034_notifications.sql
--
-- Notifications system: device_tokens + notifications tables plus the
-- enqueue_notification helper. Triggers per event type (AUTO_HOLD,
-- APPROVED, REJECTED, PO_READY, RECEIPT_MISMATCH) are added in tasks
-- 2-3 of this plan, layered into the same migration.
--
-- See: docs/superpowers/specs/2026-05-07-notifications-design.md
--
-- Server-truth philosophy mirrors migration 033 (Claim 1): triggers fire
-- regardless of which client caused the source row to change.

-- =========================================================================
-- Tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

CREATE TABLE IF NOT EXISTS notifications (
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

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_user_id, read_at NULLS FIRST, created_at DESC);

-- =========================================================================
-- Helper: enqueue_notification — fans out one row per project member
-- =========================================================================

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications
    (project_id, recipient_user_id, type, title, body,
     deeplink_screen, deeplink_params, related_entity_id)
  SELECT p_project_id, pa.user_id, p_type, p_title, p_body,
         p_deeplink_screen, p_deeplink_params, p_related_entity_id
  FROM project_assignments pa
  WHERE pa.project_id = p_project_id
    AND (p_exclude_user_id IS NULL OR pa.user_id <> p_exclude_user_id);
END;
$$;

-- =========================================================================
-- Row-level security
-- =========================================================================

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- device_tokens: user reads/writes their own tokens; service-role bypasses RLS.
DROP POLICY IF EXISTS device_tokens_select_own ON device_tokens;
CREATE POLICY device_tokens_select_own ON device_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS device_tokens_insert_own ON device_tokens;
CREATE POLICY device_tokens_insert_own ON device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS device_tokens_update_own ON device_tokens;
CREATE POLICY device_tokens_update_own ON device_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS device_tokens_delete_own ON device_tokens;
CREATE POLICY device_tokens_delete_own ON device_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- notifications: user reads + marks-read on rows where they're the recipient.
-- INSERT denied for authenticated; only SECURITY DEFINER triggers (and
-- service-role) can insert. DELETE not granted (cascade only).
DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (auth.uid() = recipient_user_id);

DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE USING (auth.uid() = recipient_user_id)
  WITH CHECK (auth.uid() = recipient_user_id);

-- (No INSERT or DELETE policy → blocked for non-service-role.)
```

- [ ] **Step 5: Apply migration to test DB**

Show the user the full migration content and ask them to apply it via the Supabase dashboard SQL editor (matches Claim 1 deployment pattern). After applying, the user confirms.

- [ ] **Step 6: Re-run the smoke test**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts --runInBand --verbose`
Expected: `Tests: 2 passed, 2 total`. Both tests pass: `countNotifications` returns 0 against the now-existing `notifications` table; `assignToProject` inserts cleanly.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/034_notifications.sql tools/__tests__/_serverGateHarness.ts tools/__tests__/notificationDispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): scaffold — tables, helper, RLS, harness extensions

Adds device_tokens and notifications tables with RLS. enqueue_notification
helper fans out one row per project_assignments member, with optional
exclude-user-id for actor self-suppression. No triggers yet — those land
in tasks 2-3.

Harness gains assignToProject, countNotifications, and cleanup of the
new tables.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Header status triggers (AUTO_HOLD / APPROVED / REJECTED)

**Files:**
- Modify: `supabase/migrations/034_notifications.sql` (append trigger fn + trigger)
- Modify: `tools/__tests__/notificationDispatch.test.ts` (append 4 tests)

This task adds the trigger that watches `material_request_headers.overall_status` for transitions to AUTO_HOLD, APPROVED, or REJECTED. One trigger function handles all three by branching on the new status.

- [ ] **Step 1: Write failing tests for header status events**

Append to `tools/__tests__/notificationDispatch.test.ts`:

```typescript
import {
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  submitRequest,
} from './_serverGateHarness';

describe('notification dispatch — header status', () => {
  it('AUTO_HOLD triggered by Claim 1 enqueues for all project members', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    // Assign 3 users (the owner from createTestProject + 2 fresh ones).
    const second = await createTestProject();
    const third = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, second.ownerProfileId);
    await assignToProject(project.id, third.ownerProfileId);

    // Submit an over-envelope Tier 2 request → server promotes to AUTO_HOLD.
    await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 200, // >120% burn → CRITICAL → AUTO_HOLD
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const count = await countNotifications({
      projectId: project.id,
      type: 'AUTO_HOLD',
    });
    expect(count).toBe(3); // 3 members, no actor exclusion (system-driven event)
  });

  it('APPROVED enqueues for all members except the reviewer who approved', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject(); // borrows the helper to spawn an extra user
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    // Reviewer approves (sets reviewed_by + status).
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);

    const allMembersCount = await countNotifications({
      projectId: project.id,
      type: 'APPROVED',
    });
    expect(allMembersCount).toBe(1); // 2 members, minus the reviewer = 1

    const reviewerCount = await countNotifications({
      projectId: project.id,
      recipientUserId: reviewer.ownerProfileId,
      type: 'APPROVED',
    });
    expect(reviewerCount).toBe(0); // self-suppressed
  });

  it('REJECTED enqueues for all members except the reviewer', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'REJECTED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);

    const count = await countNotifications({
      projectId: project.id,
      type: 'REJECTED',
    });
    expect(count).toBe(1);
  });

  it('Idempotent: resaving header with same status does NOT re-enqueue', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({
      projectId: project.id,
      materialId: material.id,
      boqItemId: boqItem.id,
      totalPlanned: 100,
    });
    const reviewer = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    await assignToProject(project.id, reviewer.ownerProfileId);

    const { headerId } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    // First approval → 1 notification (reviewer self-suppressed).
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED', reviewed_by: reviewer.ownerProfileId })
      .eq('id', headerId);
    expect(await countNotifications({ projectId: project.id, type: 'APPROVED' })).toBe(1);

    // Resave WITHOUT changing status (e.g., touching reviewed_at) → no new notification.
    await adminClient
      .from('material_request_headers')
      .update({ reviewed_at: new Date().toISOString() })
      .eq('id', headerId);
    expect(await countNotifications({ projectId: project.id, type: 'APPROVED' })).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts -t "header status" --runInBand --verbose`
Expected: all 4 tests FAIL — `countNotifications` returns 0 because no trigger exists yet.

- [ ] **Step 3: Append trigger to migration**

Edit `supabase/migrations/034_notifications.sql`. Append at the end:

```sql
-- =========================================================================
-- Trigger: material_request_headers status transitions
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_header_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    TEXT;
  v_title   TEXT;
  v_body    TEXT;
  v_actor   UUID;
BEGIN
  -- Transition guard: only fire when status changed to one of the three.
  IF OLD.overall_status IS NOT DISTINCT FROM NEW.overall_status THEN
    RETURN NULL;
  END IF;

  IF NEW.overall_status = 'AUTO_HOLD' THEN
    v_type  := 'AUTO_HOLD';
    v_title := 'Permintaan butuh review';
    v_body  := 'Request di-flag ' || COALESCE(NEW.overall_flag, 'CRITICAL') ||
               '. Tap untuk review.';
    v_actor := NULL; -- system-driven (Claim 1 trigger), no actor to exclude
  ELSIF NEW.overall_status = 'APPROVED' THEN
    v_type  := 'APPROVED';
    v_title := 'Permintaan disetujui';
    v_body  := 'Request material disetujui.';
    v_actor := NEW.reviewed_by;
  ELSIF NEW.overall_status = 'REJECTED' THEN
    v_type  := 'REJECTED';
    v_title := 'Permintaan ditolak';
    v_body  := 'Request material ditolak.';
    v_actor := NEW.reviewed_by;
  ELSE
    -- PENDING / UNDER_REVIEW transitions don't notify.
    RETURN NULL;
  END IF;

  PERFORM enqueue_notification(
    NEW.project_id,
    v_type,
    v_title,
    v_body,
    'ApprovalsScreen',
    jsonb_build_object('headerId', NEW.id),
    NEW.id,
    v_actor
  );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS material_request_headers_notify_status_trg
  ON material_request_headers;
CREATE TRIGGER material_request_headers_notify_status_trg
  AFTER UPDATE OF overall_status
  ON material_request_headers
  FOR EACH ROW
  EXECUTE FUNCTION notify_header_status_change();
```

- [ ] **Step 4: Apply updated migration to test DB**

Show the user the new function + trigger and ask them to paste into dashboard SQL editor. (Idempotent — safe to re-run the whole file.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts -t "header status" --runInBand --verbose`
Expected: all 4 tests PASS.

If the AUTO_HOLD test fails because the test envelope state has leftovers from previous test runs: run `npx jest tools/__tests__/notificationDispatch.test.ts -t "harness smoke" --runInBand` first to drain leftover state via cleanup, then re-run.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/034_notifications.sql tools/__tests__/notificationDispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): header status triggers (AUTO_HOLD / APPROVED / REJECTED)

Single trigger function notify_header_status_change branches on the new
overall_status and calls enqueue_notification with the right title/body
and actor exclusion. Transition guard (OLD IS DISTINCT FROM NEW) prevents
re-fires on unchanged saves.

AUTO_HOLD has no actor (system-driven by migration 033). APPROVED/REJECTED
exclude reviewed_by so the reviewer doesn't self-notify.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PO_READY + RECEIPT_MISMATCH triggers

**Files:**
- Modify: `supabase/migrations/034_notifications.sql` (append 2 trigger fns + 2 triggers)
- Modify: `tools/__tests__/notificationDispatch.test.ts` (append 2 tests)

PO_READY fires on `purchase_orders` INSERT (a freshly created PO is "ready to be sent"). RECEIPT_MISMATCH fires on `receipts` INSERT only when `gate3_flag` is WARNING or CRITICAL.

- [ ] **Step 1: Write failing tests**

Append to `tools/__tests__/notificationDispatch.test.ts`:

```typescript
describe('notification dispatch — PO and receipt events', () => {
  it('PO_READY enqueues for all project members on purchase_orders insert', async () => {
    const project = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);
    const second = await createTestProject();
    await assignToProject(project.id, second.ownerProfileId);

    const { error } = await adminClient.from('purchase_orders').insert({
      project_id: project.id,
      po_number: 'PO-TEST-001',
      boq_ref: 'BOQ-1',
      supplier: 'Test Supplier',
      material_name: 'Test Material',
      quantity: 100,
      unit: 'kg',
      ordered_date: new Date().toISOString().slice(0, 10),
    });
    expect(error).toBeNull();

    const count = await countNotifications({
      projectId: project.id,
      type: 'PO_READY',
    });
    expect(count).toBe(2);
  });

  it('RECEIPT_MISMATCH enqueues only when gate3_flag is WARNING or CRITICAL', async () => {
    const project = await createTestProject();
    await assignToProject(project.id, project.ownerProfileId);

    // First insert a PO so receipts can reference it.
    const { data: po, error: poErr } = await adminClient
      .from('purchase_orders')
      .insert({
        project_id: project.id,
        po_number: 'PO-RM-001',
        boq_ref: 'BOQ-1',
        supplier: 'Sup',
        material_name: 'Mat',
        quantity: 100,
        unit: 'kg',
      })
      .select('id')
      .single();
    expect(poErr).toBeNull();

    // Insert receipt with gate3_flag='OK' → no notification.
    await adminClient.from('receipts').insert({
      po_id: po!.id,
      project_id: project.id,
      received_by: project.ownerProfileId,
      gate3_flag: 'OK',
    });
    expect(await countNotifications({ projectId: project.id, type: 'RECEIPT_MISMATCH' })).toBe(0);

    // Insert receipt with gate3_flag='WARNING' → 1 notification.
    await adminClient.from('receipts').insert({
      po_id: po!.id,
      project_id: project.id,
      received_by: project.ownerProfileId,
      gate3_flag: 'WARNING',
    });
    expect(await countNotifications({ projectId: project.id, type: 'RECEIPT_MISMATCH' })).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts -t "PO and receipt" --runInBand --verbose`
Expected: both tests FAIL — counts return 0 because no trigger exists yet.

- [ ] **Step 3: Append triggers to migration**

Edit `supabase/migrations/034_notifications.sql`. Append at the end:

```sql
-- =========================================================================
-- Trigger: purchase_orders → PO_READY on insert
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_po_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM enqueue_notification(
    NEW.project_id,
    'PO_READY',
    'PO siap dikirim',
    'PO ' || COALESCE(NEW.po_number, 'baru') ||
      ' siap, supplier ' || NEW.supplier || '.',
    'POScreen',
    jsonb_build_object('poId', NEW.id),
    NEW.id,
    NULL  -- no actor recorded on purchase_orders; notify everyone
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS purchase_orders_notify_ready_trg ON purchase_orders;
CREATE TRIGGER purchase_orders_notify_ready_trg
  AFTER INSERT
  ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_po_ready();

-- =========================================================================
-- Trigger: receipts → RECEIPT_MISMATCH when gate3_flag is WARNING/CRITICAL
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_receipt_mismatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.gate3_flag NOT IN ('WARNING', 'CRITICAL') THEN
    RETURN NULL;
  END IF;

  PERFORM enqueue_notification(
    NEW.project_id,
    'RECEIPT_MISMATCH',
    'Penerimaan mismatch',
    'Receipt ' || COALESCE(NEW.vehicle_ref, 'tanpa nopol') ||
      ' di-flag ' || NEW.gate3_flag || '.',
    'ReceiptScreen',
    jsonb_build_object('receiptId', NEW.id),
    NEW.id,
    NEW.received_by
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS receipts_notify_mismatch_trg ON receipts;
CREATE TRIGGER receipts_notify_mismatch_trg
  AFTER INSERT
  ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION notify_receipt_mismatch();
```

- [ ] **Step 4: Apply migration to test DB (idempotent re-paste of full file)**

Same dashboard SQL editor pattern.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts -t "PO and receipt" --runInBand --verbose`
Expected: both tests PASS.

- [ ] **Step 6: Run the full test file to confirm no regressions**

Run: `npx jest tools/__tests__/notificationDispatch.test.ts --runInBand --verbose`
Expected: all 8 tests pass (2 smoke + 4 header status + 2 PO/receipt).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/034_notifications.sql tools/__tests__/notificationDispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): PO_READY and RECEIPT_MISMATCH triggers

PO_READY fires on purchase_orders INSERT (no separate ready-state in the
schema — INSERT means ready to send to supplier). RECEIPT_MISMATCH fires
on receipts INSERT only when gate3_flag is WARNING or CRITICAL, with the
receiver's user_id excluded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Edge Function `send-push-notification`

**Files:**
- Create: `supabase/functions/send-push-notification/index.ts`
- Create: `supabase/functions/send-push-notification/index.test.ts`
- Create: `supabase/functions/send-push-notification/deno.json` (Deno config)

The Edge Function is invoked by the Supabase Database Webhook (configured in Task 9). It looks up the recipient's device tokens, dispatches via Expo Push, marks `push_sent_at`, and cleans stale tokens.

- [ ] **Step 1: Create Deno config**

Create `supabase/functions/send-push-notification/deno.json`:

```json
{
  "tasks": {
    "test": "deno test --allow-env --allow-net --allow-read"
  },
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2",
    "std/assert": "jsr:@std/assert@1"
  }
}
```

- [ ] **Step 2: Write failing Deno tests**

Create `supabase/functions/send-push-notification/index.test.ts`:

```typescript
import { assertEquals } from 'std/assert';
import { handleNotification, type Deps } from './index.ts';

function makeMockDeps(overrides: Partial<Deps> = {}): {
  deps: Deps;
  calls: {
    selectNotification: number;
    selectTokens: number;
    expoFetch: Array<unknown>;
    updateSent: number;
    deleteToken: string[];
  };
} {
  const calls = {
    selectNotification: 0,
    selectTokens: 0,
    expoFetch: [] as unknown[],
    updateSent: 0,
    deleteToken: [] as string[],
  };
  const deps: Deps = {
    fetchNotificationSentAt: async () => { calls.selectNotification++; return null; },
    fetchTokens: async () => { calls.selectTokens++; return [{ expo_push_token: 'ExponentPushToken[abc]' }]; },
    expoPush: async (messages) => { calls.expoFetch.push(messages); return { data: messages.map(() => ({})) }; },
    markSent: async () => { calls.updateSent++; },
    deleteToken: async (t) => { calls.deleteToken.push(t); },
    ...overrides,
  };
  return { deps, calls };
}

const baseRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  recipient_user_id: '00000000-0000-0000-0000-000000000002',
  title: 'Test',
  body: 'Body',
  deeplink_screen: 'ApprovalsScreen',
  deeplink_params: { headerId: 'h1' },
};

Deno.test('skips when no tokens registered', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [],
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'no tokens');
  assertEquals(calls.expoFetch.length, 0);
  assertEquals(calls.updateSent, 0);
});

Deno.test('skips when push_sent_at already set (idempotency)', async () => {
  const { deps, calls } = makeMockDeps({
    fetchNotificationSentAt: async () => '2026-05-07T00:00:00Z',
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'already sent');
  assertEquals(calls.expoFetch.length, 0);
});

Deno.test('dispatches one Expo message per token, marks sent', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[a]' },
      { expo_push_token: 'ExponentPushToken[b]' },
    ],
  });
  const resp = await handleNotification(baseRecord, deps);
  assertEquals(resp, 'ok');
  assertEquals(calls.expoFetch.length, 1);
  assertEquals((calls.expoFetch[0] as Array<{ to: string }>).length, 2);
  assertEquals(calls.updateSent, 1);
  assertEquals(calls.deleteToken.length, 0);
});

Deno.test('deletes stale tokens on DeviceNotRegistered', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[good]' },
      { expo_push_token: 'ExponentPushToken[stale]' },
    ],
    expoPush: async () => ({
      data: [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }),
  });
  await handleNotification(baseRecord, deps);
  assertEquals(calls.deleteToken, ['ExponentPushToken[stale]']);
});
```

- [ ] **Step 3: Run tests to verify they fail (no implementation yet)**

Run: `cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read`
Expected: FAIL with "Cannot find module './index.ts'" or "handleNotification is not exported".

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/send-push-notification/index.ts`:

```typescript
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
Deno.serve(async (req) => {
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read`
Expected: all 4 tests pass.

- [ ] **Step 6: Deploy the Edge Function**

Run: `supabase functions deploy send-push-notification --project-ref ufntlqvacjhmddwltcxf`
Expected: "Function deployed successfully" plus the function URL.

If deploy fails on auth, check `supabase login` status. If the project ref is wrong, the linked project file at `supabase/.temp/linked-project.json` has the canonical ref.

Capture the function URL — it's needed for the Database Webhook config in Task 9.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-push-notification/
git commit -m "$(cat <<'EOF'
feat(notifications): send-push-notification Edge Function + Deno tests

Webhook-triggered function (configured in Task 9) dispatches via Expo
Push API. Idempotent: skips when push_sent_at is already set, so
Supabase's at-least-once webhook delivery doesn't duplicate pushes.
Cleans stale device_tokens on DeviceNotRegistered. Pure handleNotification
function tested with mocked Deps; real Deno.serve wires to Supabase + fetch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Edge Function `retry-push-notifications` (cron)

**Files:**
- Create: `supabase/functions/retry-push-notifications/index.ts`
- Create: `supabase/functions/retry-push-notifications/index.test.ts`
- Create: `supabase/functions/retry-push-notifications/deno.json`

A nightly cron that finds notifications with `push_sent_at IS NULL AND created_at > now() - interval '24h'` and re-invokes the dispatch path. Same handleNotification call, just iterating over multiple rows.

- [ ] **Step 1: Create Deno config**

Create `supabase/functions/retry-push-notifications/deno.json`:

```json
{
  "tasks": {
    "test": "deno test --allow-env --allow-net --allow-read"
  },
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2",
    "std/assert": "jsr:@std/assert@1"
  }
}
```

- [ ] **Step 2: Write failing tests**

Create `supabase/functions/retry-push-notifications/index.test.ts`:

```typescript
import { assertEquals } from 'std/assert';
import { runRetry, type RetryDeps } from './index.ts';

Deno.test('skips empty pending list', async () => {
  let dispatchCount = 0;
  const deps: RetryDeps = {
    fetchPending: async () => [],
    dispatch: async () => { dispatchCount++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 0);
  assertEquals(dispatchCount, 0);
});

Deno.test('dispatches each pending row', async () => {
  let dispatchCount = 0;
  const deps: RetryDeps = {
    fetchPending: async () => [
      { id: '1' } as never,
      { id: '2' } as never,
      { id: '3' } as never,
    ],
    dispatch: async () => { dispatchCount++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 3);
  assertEquals(dispatchCount, 3);
});

Deno.test('continues past per-row failures', async () => {
  let dispatchCount = 0;
  const errors: string[] = [];
  const deps: RetryDeps = {
    fetchPending: async () => [
      { id: '1' } as never,
      { id: '2' } as never,
      { id: '3' } as never,
    ],
    dispatch: async (rec) => {
      dispatchCount++;
      if ((rec as { id: string }).id === '2') {
        errors.push('boom');
        throw new Error('boom');
      }
      return 'ok';
    },
  };
  const result = await runRetry(deps);
  assertEquals(result.processed, 3);
  assertEquals(result.failed, 1);
  assertEquals(dispatchCount, 3);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/retry-push-notifications/index.ts`:

```typescript
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

Deno.serve(async () => {
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
        .gt('created_at', sinceIso);
      return (data as NotificationRecord[] | null) ?? [];
    },
    dispatch: async (record) => {
      // Build the same Deps used by send-push-notification.
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
```

- [ ] **Step 5: Run tests**

Run: `cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read`
Expected: all 3 tests pass.

- [ ] **Step 6: Deploy**

Run: `supabase functions deploy retry-push-notifications --project-ref ufntlqvacjhmddwltcxf`
Expected: deploy succeeds.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/retry-push-notifications/
git commit -m "$(cat <<'EOF'
feat(notifications): retry-push-notifications cron Edge Function

Nightly drain of unsent notifications (push_sent_at IS NULL AND created_at
> now() - 24h). Reuses handleNotification from send-push-notification so
the dispatch + token-cleanup logic isn't duplicated. Per-row failures are
isolated; the cron continues to the next row.

Cron schedule is configured separately via Supabase dashboard cron config
in Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Mobile token registration

**Files:**
- Create: `tools/notifications.ts`
- Create: `tools/__tests__/notifications.test.ts`

The mobile app calls `registerForPushNotifications` after login to request permission, fetch the Expo push token, and upsert it to `device_tokens`. A second helper `attachNotificationTapListener` lets the app navigate when the user taps a push.

- [ ] **Step 1: Write failing unit tests**

Create `tools/__tests__/notifications.test.ts`:

```typescript
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const mockUpsert = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerForPushNotifications, attachNotificationTapListener } from '../notifications';
import { supabase } from '../supabase';

describe('registerForPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('returns early on simulator', async () => {
    (Device as { isDevice: boolean }).isDevice = false;
    await registerForPushNotifications('user-1');
    expect(supabase.from).not.toHaveBeenCalled();
    (Device as { isDevice: boolean }).isDevice = true;
  });

  it('returns early when permission denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    await registerForPushNotifications('user-1');
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('registers existing-permission token without prompting', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[xxx]' });

    await registerForPushNotifications('user-1');

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('device_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        expo_push_token: 'ExponentPushToken[xxx]',
        platform: 'ios',
      }),
      { onConflict: 'expo_push_token' },
    );
  });

  it('prompts when permission undetermined and registers if granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[yyy]' });

    await registerForPushNotifications('user-1');

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });
});

describe('attachNotificationTapListener', () => {
  it('subscribes via expo-notifications and forwards deeplink data to handler', () => {
    const handler = jest.fn();
    const unsubscribe = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({
      remove: unsubscribe,
    });

    const cleanup = attachNotificationTapListener(handler);
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled();

    // Simulate the listener firing.
    const callback = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];
    callback({
      notification: {
        request: {
          content: {
            data: {
              deeplinkScreen: 'ApprovalsScreen',
              deeplinkParams: { headerId: 'h1' },
            },
          },
        },
      },
    });
    expect(handler).toHaveBeenCalledWith('ApprovalsScreen', { headerId: 'h1' });

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/notifications.test.ts --verbose`
Expected: FAIL — `Cannot find module '../notifications'`.

- [ ] **Step 3: Write the implementation**

Create `tools/notifications.ts`:

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

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  const tokenResp = await Notifications.getExpoPushTokenAsync();
  await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: tokenResp.data,
      platform: Platform.OS as 'ios' | 'android' | 'web',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' },
  );
}

export type NotificationTapHandler = (
  deeplinkScreen: string,
  deeplinkParams: Record<string, unknown> | null,
) => void;

export function attachNotificationTapListener(handler: NotificationTapHandler): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as {
      deeplinkScreen?: string;
      deeplinkParams?: Record<string, unknown>;
    };
    if (data?.deeplinkScreen) {
      handler(data.deeplinkScreen, data.deeplinkParams ?? null);
    }
  });
  return () => subscription.remove();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tools/__tests__/notifications.test.ts --verbose`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/notifications.ts tools/__tests__/notifications.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): mobile token registration + tap listener

registerForPushNotifications skips on simulators and when permission is
denied; prompts only if status is undetermined. Upsert via expo_push_token
unique key handles same-device-reinstall cleanly.

attachNotificationTapListener returns a cleanup fn so callers can manage
subscription lifecycle in useEffect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: NotificationList component + Notifications screens

**Files:**
- Create: `workflows/screens/components/NotificationList.tsx`
- Create: `workflows/screens/components/__tests__/NotificationList.test.tsx`
- Create: `workflows/screens/NotificationsScreen.tsx`
- Create: `office/screens/NotificationsScreen.tsx`

The shared `NotificationList` is a presentational component. The two screens (mobile + office) wire it up to a Realtime subscription and a "mark as read + deeplink" handler.

- [ ] **Step 1: Write failing component tests**

Create `workflows/screens/components/__tests__/NotificationList.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NotificationList, type NotificationItem } from '../NotificationList';

const items: NotificationItem[] = [
  {
    id: 'n1',
    type: 'AUTO_HOLD',
    title: 'Permintaan butuh review',
    body: 'Request di-flag CRITICAL',
    createdAt: new Date('2026-05-07T10:00:00Z').toISOString(),
    readAt: null,
    deeplinkScreen: 'ApprovalsScreen',
    deeplinkParams: { headerId: 'h1' },
  },
  {
    id: 'n2',
    type: 'APPROVED',
    title: 'Permintaan disetujui',
    body: 'Request disetujui',
    createdAt: new Date('2026-05-06T10:00:00Z').toISOString(),
    readAt: new Date('2026-05-06T11:00:00Z').toISOString(),
    deeplinkScreen: 'ApprovalsScreen',
    deeplinkParams: { headerId: 'h2' },
  },
];

describe('NotificationList', () => {
  it('renders titles and bodies', () => {
    const { getByText } = render(
      <NotificationList items={items} onPress={() => {}} />,
    );
    expect(getByText('Permintaan butuh review')).toBeTruthy();
    expect(getByText('Permintaan disetujui')).toBeTruthy();
  });

  it('shows empty state when items is empty', () => {
    const { getByText } = render(
      <NotificationList items={[]} onPress={() => {}} />,
    );
    expect(getByText(/belum ada notifikasi/i)).toBeTruthy();
  });

  it('calls onPress with the item when row tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <NotificationList items={items} onPress={onPress} />,
    );
    fireEvent.press(getByText('Permintaan butuh review'));
    expect(onPress).toHaveBeenCalledWith(items[0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest workflows/screens/components/__tests__/NotificationList.test.tsx --verbose`
Expected: FAIL — `Cannot find module '../NotificationList'`.

- [ ] **Step 3: Write the NotificationList component**

Create `workflows/screens/components/NotificationList.tsx`:

```typescript
import React from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  deeplinkScreen: string;
  deeplinkParams: Record<string, unknown> | null;
}

interface Props {
  items: NotificationItem[];
  onPress: (item: NotificationItem) => void;
}

const COLORS = {
  bg: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  unreadDot: '#EF4444',
  dayHeader: '#94A3B8',
};

function relativeDay(iso: string): string {
  const created = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfCreated.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  if (diffDays < 7) return `${diffDays} hari lalu`;
  return created.toLocaleDateString('id-ID');
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

interface ListEntry {
  type: 'header' | 'item';
  key: string;
  label?: string;
  item?: NotificationItem;
}

function buildEntries(items: NotificationItem[]): ListEntry[] {
  const out: ListEntry[] = [];
  let lastDay = '';
  for (const it of items) {
    const day = relativeDay(it.createdAt);
    if (day !== lastDay) {
      out.push({ type: 'header', key: `h-${day}`, label: day });
      lastDay = day;
    }
    out.push({ type: 'item', key: it.id, item: it });
  }
  return out;
}

export function NotificationList({ items, onPress }: Props): JSX.Element {
  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Belum ada notifikasi.</Text>
      </View>
    );
  }

  const entries = buildEntries(items);

  return (
    <FlatList
      data={entries}
      keyExtractor={e => e.key}
      renderItem={({ item: entry }) => {
        if (entry.type === 'header') {
          return <Text style={styles.dayHeader}>{entry.label}</Text>;
        }
        const n = entry.item!;
        const unread = !n.readAt;
        return (
          <TouchableOpacity style={styles.row} onPress={() => onPress(n)}>
            <View style={styles.rowContent}>
              <View style={styles.titleRow}>
                {unread && <View style={styles.unreadDot} />}
                <Text style={[styles.title, unread && styles.titleUnread]}>{n.title}</Text>
                <Text style={styles.time}>{formatTime(n.createdAt)}</Text>
              </View>
              <Text style={styles.body}>{n.body}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
  dayHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    color: COLORS.dayHeader,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  rowContent: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.unreadDot,
  },
  title: { fontSize: 14, color: COLORS.textPrimary, flex: 1 },
  titleUnread: { fontWeight: '600' },
  time: { fontSize: 12, color: COLORS.textSecondary },
  body: { fontSize: 13, color: COLORS.textSecondary },
});
```

- [ ] **Step 4: Run component tests to verify they pass**

Run: `npx jest workflows/screens/components/__tests__/NotificationList.test.tsx --verbose`
Expected: all 3 tests pass.

- [ ] **Step 5: Write the mobile NotificationsScreen**

Create `workflows/screens/NotificationsScreen.tsx`:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../tools/supabase';
import { NotificationList, type NotificationItem } from './components/NotificationList';

interface Props {
  profileId: string;
}

export default function NotificationsScreen({ profileId }: Props): JSX.Element {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, created_at, read_at, deeplink_screen, deeplink_params')
      .eq('recipient_user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(200);
    setItems((data ?? []).map(rowToItem));
  }, [profileId]);

  useEffect(() => {
    fetch().finally(() => setLoading(false));
  }, [fetch]);

  // Realtime subscription for live updates.
  useEffect(() => {
    const channel = supabase.channel(`notifications:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${profileId}`,
        },
        payload => {
          setItems(prev => [rowToItem(payload.new as NotificationRow), ...prev]);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profileId]);

  const handlePress = useCallback(async (item: NotificationItem) => {
    if (!item.readAt) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i));
    }
    navigation.navigate(item.deeplinkScreen, item.deeplinkParams ?? {});
  }, [navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetch();
    setRefreshing(false);
  }, [fetch]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NotificationList
        items={items}
        onPress={handlePress}
      />
    </View>
  );
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  deeplink_screen: string;
  deeplink_params: Record<string, unknown> | null;
}

function rowToItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    deeplinkScreen: row.deeplink_screen,
    deeplinkParams: row.deeplink_params,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
```

- [ ] **Step 6: Write the office NotificationsScreen**

Create `office/screens/NotificationsScreen.tsx` — same content as the mobile screen above, but with the import path adjusted to reach the shared component:

```typescript
// SAME as workflows/screens/NotificationsScreen.tsx EXCEPT the import:
// from '../../tools/supabase' stays the same
// from '../../workflows/screens/components/NotificationList' uses the shared component
import { NotificationList, type NotificationItem } from '../../workflows/screens/components/NotificationList';
```

Copy the full mobile screen content into `office/screens/NotificationsScreen.tsx` and adjust the relative import paths only.

- [ ] **Step 7: Smoke-test the screens by typechecking**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(NotificationsScreen|NotificationList)" | head -10`
Expected: zero errors related to the new files. (Pre-existing project-wide errors are fine; we're only checking our additions.)

- [ ] **Step 8: Commit**

```bash
git add workflows/screens/components/NotificationList.tsx \
        workflows/screens/components/__tests__/NotificationList.test.tsx \
        workflows/screens/NotificationsScreen.tsx \
        office/screens/NotificationsScreen.tsx
git commit -m "$(cat <<'EOF'
feat(notifications): NotificationList + Notifications screens

Shared presentational NotificationList groups items by relative day
(Hari ini / Kemarin / N hari lalu) with unread dot. Mobile and office
screens wire it to a Realtime subscription, an initial fetch, pull-to-
refresh, and a tap handler that marks read + deeplinks via the screen
+ params encoded in the notification row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: App.tsx + nav integration (3 navigations)

**Files:**
- Modify: `workflows/App.tsx` (call registration after profile load + attach tap listener)
- Modify: `workflows/AppNavigation.tsx` (add Notifications tab + unread badge for supervisors)
- Modify: `office/navigation.tsx` (add for admin/estimator)
- Modify: `office/PrincipalNavigation.tsx` (add for principal)

This task wires the notifications system into the running app: registration on auth, tap deeplinks, and a Notifications tab visible to all three role-based navigations.

- [ ] **Step 1: Wire registration + tap listener in workflows/App.tsx**

Find the `useEffect` that loads the profile (where `profile?.id` is set). Append after it:

```typescript
useEffect(() => {
  if (profile?.id) {
    void registerForPushNotifications(profile.id);
  }
}, [profile?.id]);

useEffect(() => {
  const cleanup = attachNotificationTapListener((screen, params) => {
    // The actual navigation depends on which navigator is mounted (role-based).
    // The simplest cross-navigator approach: use a top-level navigation ref.
    if (navigationRef.current?.isReady()) {
      navigationRef.current.navigate(screen as never, params as never);
    }
  });
  return cleanup;
}, []);
```

Add the necessary imports at the top:
```typescript
import { registerForPushNotifications, attachNotificationTapListener } from '../tools/notifications';
import { createNavigationContainerRef } from '@react-navigation/native';

const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();
```

And pass `navigationRef` to the `NavigationContainer` wherever it's instantiated:
```typescript
<NavigationContainer ref={navigationRef}>{/* existing children */}</NavigationContainer>
```

- [ ] **Step 2: Add Notifications tab + unread badge to AppNavigation**

Edit `workflows/AppNavigation.tsx`. Find the `Tab.Navigator` block (look for `<Tab.Screen` lines). Add a new screen entry next to the existing tabs. Use the unread-badge query already established by NotificationsScreen — wrap in a tabBarBadge function that reads from a hook.

First, add a tiny hook for the unread count. Create `workflows/screens/hooks/useUnreadCount.ts`:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../../../tools/supabase';

export function useUnreadCount(profileId: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profileId) { setCount(0); return; }

    let alive = true;
    const refresh = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', profileId)
        .is('read_at', null);
      if (alive) setCount(c ?? 0);
    };
    void refresh();

    const channel = supabase.channel(`unread:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${profileId}` },
        () => { void refresh(); },
      )
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  return count;
}
```

Then in `workflows/AppNavigation.tsx`, near the existing imports add:
```typescript
import NotificationsScreen from './screens/NotificationsScreen';
import { useUnreadCount } from './screens/hooks/useUnreadCount';
```

Inside the navigator function (where `profile` is in scope), compute the badge:
```typescript
const unread = useUnreadCount(profile?.id);
```

Add a Tab.Screen entry near existing ones:
```tsx
<Tab.Screen
  name="Notifications"
  options={{
    tabBarLabel: 'Notifikasi',
    tabBarBadge: unread > 0 ? unread : undefined,
  }}
>
  {() => <NotificationsScreen profileId={profile!.id} />}
</Tab.Screen>
```

- [ ] **Step 3: Add Notifications tab to office/navigation.tsx (admin/estimator)**

Same pattern. Imports:
```typescript
import NotificationsScreen from './screens/NotificationsScreen';
import { useUnreadCount } from '../workflows/screens/hooks/useUnreadCount';
```

Inside the navigator, compute `const unread = useUnreadCount(profile?.id);` and add the same Tab.Screen entry near the existing tabs (after `Approvals`).

- [ ] **Step 4: Add Notifications tab to office/PrincipalNavigation.tsx**

Same pattern. Imports + hook + Tab.Screen.

- [ ] **Step 5: Smoke-test the app starts**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20`
Expected: no new TypeScript errors related to navigation files. Pre-existing errors elsewhere are fine.

If you have a physical device or simulator handy, also run `npx expo start` and verify the app boots (the supervisor view should show 4 tabs instead of 3 — Notifikasi added).

- [ ] **Step 6: Commit**

```bash
git add workflows/App.tsx workflows/AppNavigation.tsx office/navigation.tsx office/PrincipalNavigation.tsx \
        workflows/screens/hooks/useUnreadCount.ts
git commit -m "$(cat <<'EOF'
feat(notifications): nav integration + token registration on auth

Three navigators (supervisor / admin-estimator / principal) gain a
Notifikasi tab with live unread badge via useUnreadCount hook (Realtime
subscription on notifications). App.tsx registers the Expo push token
after profile loads and attaches a tap listener that navigates via the
shared navigationRef, working across all three role-based stacks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Database Webhook + cron config + manual smoke

**Files:**
- Modify: `supabase/migrations/034_notifications.sql` (append a deployment-notes header comment)

This task is mostly dashboard configuration. The user does the clicks; the implementer documents the steps and verifies the wiring with a manual smoke test.

- [ ] **Step 1: Add deployment-notes header to the migration**

Edit `supabase/migrations/034_notifications.sql`. Replace the leading comment block with:

```sql
-- 034_notifications.sql
--
-- Notifications system: device_tokens + notifications tables, the
-- enqueue_notification helper, and 5 PG triggers per event type
-- (AUTO_HOLD, APPROVED, REJECTED, PO_READY, RECEIPT_MISMATCH).
--
-- Server-truth philosophy mirrors migration 033 (Claim 1): triggers fire
-- regardless of which client caused the source row to change. Hybrid
-- delivery: native push via Supabase Database Webhook → Edge Function →
-- Expo Push API; in-app via Realtime subscription on notifications.
--
-- Deployment:
--   1. Apply this migration via Supabase dashboard SQL editor. Idempotent.
--   2. Deploy Edge Functions:
--        supabase functions deploy send-push-notification
--        supabase functions deploy retry-push-notifications
--   3. Configure Database Webhook (dashboard → Database → Webhooks):
--        Source:  public.notifications, INSERT event
--        Target:  POST → <send-push-notification function URL>
--        Auth:    Authorization: Bearer <secret>; Edge Function validates.
--   4. Configure cron (dashboard → Database → Cron):
--        Job:     retry-push-notifications, daily at 02:00 UTC
--        Command: SELECT net.http_post('<retry-push-notifications URL>')
--   5. Build mobile app with Task 7's new dependencies (native modules
--      require fresh build, not OTA). Roll out via TestFlight / Play
--      Internal first.
--   6. Smoke test on physical device per the plan's Task 9 Step 4.
--
-- Spec: docs/superpowers/specs/2026-05-07-notifications-design.md
-- Plan: docs/superpowers/plans/2026-05-07-notifications.md
--
-- GATE2_OVER_BUDGET and GATE4_INVOICE_MISMATCH are in the type CHECK
-- constraint for forward compatibility but no triggers exist for them
-- in v1 — the underlying gate2_outcomes / gate4_outcomes tables are
-- not yet defined in the schema. Add triggers in follow-up specs once
-- those tables exist.
```

- [ ] **Step 2: Configure Database Webhook (manual)**

Show the user this checklist and ask them to perform the steps in the Supabase dashboard:

```
1. Open Supabase dashboard → san-contractor → Database → Webhooks → Create new
2. Name:           notify-on-notification-insert
3. Table:          public.notifications
4. Events:         INSERT only
5. Type:           HTTP Request
6. Method:         POST
7. URL:            <Task 4 deploy URL — paste the send-push-notification function URL>
8. HTTP Headers:   Authorization: Bearer <generate a random 32-char secret>
9. Save.

Then:
10. Add the same secret as a Supabase secret for the Edge Function:
      supabase secrets set WEBHOOK_AUTH_SECRET=<the secret> --project-ref ufntlqvacjhmddwltcxf
```

After webhook is saved, modify `supabase/functions/send-push-notification/index.ts` to validate the secret:

```typescript
Deno.serve(async (req) => {
  const expected = Deno.env.get('WEBHOOK_AUTH_SECRET');
  if (expected) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${expected}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }
  // ... existing body
});
```

Re-deploy: `supabase functions deploy send-push-notification --project-ref ufntlqvacjhmddwltcxf`.

- [ ] **Step 3: Configure cron schedule (manual)**

```
1. Supabase dashboard → Database → Cron → Create new
2. Name:     retry-push-notifications-nightly
3. Schedule: 0 2 * * *  (daily 02:00 UTC)
4. Type:     HTTP Request
5. Method:   POST
6. URL:      <retry-push-notifications function URL>
7. Headers:  Authorization: Bearer <same WEBHOOK_AUTH_SECRET>
8. Save.
```

(Some Supabase plans use `pg_cron` directly. If that's the case, ask the user to run a `cron.schedule(...)` statement in SQL editor instead. The migration intentionally doesn't define the schedule because Supabase's cron interface evolves.)

- [ ] **Step 4: Manual smoke test on a physical device**

Show the user this checklist:

```
1. Build the app for a physical device:
     eas build --platform ios --profile development     (or)
     eas build --platform android --profile development

2. Install on the device, log in as a project member.

3. Confirm Expo asks for push permission. Grant it.

4. In Supabase dashboard SQL editor, run:
     SELECT * FROM device_tokens WHERE user_id = '<your auth uid>';
   Expect 1 row with platform='ios' or 'android'.

5. From a different account (or curl), submit a Tier 2 over-envelope
   request that will trigger AUTO_HOLD:
     [follow PermintaanScreen flow OR direct REST insert as in Claim 1's
      manual smoke instructions]

6. Push should arrive within ~5s. Banner reads "Permintaan butuh review".

7. Tap the banner. App opens to ApprovalsScreen filtered to that header.

8. Open the Notifikasi tab. The notification appears in the list with
   the unread dot. Tap it → mark-as-read happens, dot disappears, deeplink
   navigates again.

9. Verify retry cron is wired: in SQL editor,
     UPDATE notifications SET push_sent_at = NULL WHERE id = '<some id>';
     SELECT net.http_post('<retry-push-notifications URL>');
   Expect another push delivery within seconds.
```

Document any failures in a TASK9_SMOKE_NOTES.md file (do not commit; for personal reference). The team's smoke test pass is the ship criterion.

- [ ] **Step 5: Run the full integration test suite to confirm nothing regressed**

Run: `npx jest --runInBand --verbose 2>&1 | tail -20`
Expected: no failures. New tests from Tasks 1-3 + 6 + 7 all pass alongside Claim 1's existing 16 tests.

- [ ] **Step 6: Commit deployment notes**

```bash
git add supabase/migrations/034_notifications.sql supabase/functions/send-push-notification/index.ts
git commit -m "$(cat <<'EOF'
docs(notifications): deployment notes header + webhook secret validation

Migration 034 gains a deployment header documenting the dashboard
configuration steps (webhook + cron). send-push-notification validates
the WEBHOOK_AUTH_SECRET header before processing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Hand off to finishing-a-development-branch**

After the manual smoke passes, invoke `superpowers:finishing-a-development-branch`. Branch is `feat/notifications`. Base is `main`.
