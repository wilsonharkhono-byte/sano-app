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
--        Auth:    Authorization: Bearer <secret>; set the same value as
--                 supabase secret WEBHOOK_AUTH_SECRET.
--   4. Configure cron (dashboard → Database → Cron):
--        Job:     retry-push-notifications, daily at 02:00 UTC
--        Command: net.http_post('<retry-push-notifications URL>')
--   5. Build mobile app with Task 6's new dependencies (expo-notifications,
--      expo-device — native modules require fresh build, not OTA). Roll
--      out via TestFlight / Play Internal first.
--   6. Smoke test on physical device per the plan's Task 9 checklist.
--
-- Spec: docs/superpowers/specs/2026-05-07-notifications-design.md
-- Plan: docs/superpowers/plans/2026-05-07-notifications.md
--
-- GATE2_OVER_BUDGET and GATE4_INVOICE_MISMATCH are in the type CHECK
-- constraint for forward compatibility but no triggers exist for them
-- in v1 — the underlying gate2_outcomes / gate4_outcomes tables are
-- not yet defined in the schema. Add triggers in follow-up specs once
-- those tables exist.

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
