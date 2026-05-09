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
