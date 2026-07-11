-- 067 — Flow handoff notifications: APPROVED→admin, INSERT→estimator (Task 2.2, MED)
--
-- Paste order: AFTER 066 (both trigger functions below call the 9-arg
--   enqueue_notification with p_target_role, which 066 installs; on a
--   database without 066 the PERFORMs would fail to resolve — caught by the
--   EXCEPTION wrappers, i.e. silently no notifications. Paste 066 first.)
--   Apply via Dashboard SQL Editor (remote migration history diverged — see
--   project memory). Idempotent / re-paste-safe throughout.
--
-- Problem (flow audit, Task 2.2):
--   (a) When the estimator APPROVES a request, 034's notify_header_status_change
--       fans out a generic APPROVED to all project members — but nobody is
--       specifically handed the next action (create the PO in SANO). The
--       admin who makes the PO learns about it by polling.
--   (b) A newly INSERTED request notifies no one at all:
--       034's material_request_headers trigger is AFTER UPDATE OF
--       overall_status (034:206-212), so INSERT never fires it — and even on
--       UPDATE, the PENDING branch deliberately returns NULL (034:181-183).
--       The estimator polls the Approvals tab to discover new requests.
--
-- Fix:
--   1. Widen the notifications.type CHECK (034:58-62 is the only definer —
--      grepped every migration) by shape, adding REQUEST_APPROVED_FOR_PO and
--      REQUEST_PENDING. Strict superset — nothing dropped.
--   2. Replace notify_header_status_change (body faithful to 034:148-212):
--      on transition to APPROVED, ADDITIONALLY enqueue an admin-targeted
--      REQUEST_APPROVED_FOR_PO deeplinking to 'POScreen' — the office route
--      maps resolve POScreen → 'Procurement' (Gate2 / PO creation) in BOTH
--      tap paths: office/screens/NotificationsScreen.tsx:7-11 (in-app list)
--      and tools/notificationRouting.ts via workflows/App.tsx (push tap).
--      No office-side nav change needed. The existing all-members APPROVED
--      notification is unchanged.
--   3. New AFTER INSERT trigger on material_request_headers: a header born
--      PENDING or AUTO_HOLD enqueues an estimator-targeted notification
--      deeplinking to 'ApprovalsScreen', excluding the requester
--      (requested_by — they submitted it and see status in Permintaan).
--
-- Decision — actor exclusion on the admin-targeted APPROVED call: we do NOT
--   exclude NEW.reviewed_by. If the approver is also the project's only
--   admin (small-team reality), excluding the actor would notify zero rows
--   and the PO handoff ping would vanish exactly where it matters most
--   (066's implementer flagged this). Cost: an admin-approver gets a
--   self-notification — acceptable; it doubles as their PO to-do item.
--   The all-members APPROVED call keeps its 034 exclusion (v_actor).
--
-- Decision — AUTO_HOLD at INSERT reuses type 'AUTO_HOLD', not REQUEST_PENDING:
--   the request genuinely IS auto-held; labeling it REQUEST_PENDING would
--   misstate the record and any client filtering/styling on AUTO_HOLD would
--   miss real holds. Title/body mirror 034's AUTO_HOLD branch. Unlike 034's
--   UPDATE-path AUTO_HOLD (all-members, system-driven mid-flow), the INSERT
--   path targets estimators only: at creation time the ping is a review
--   handoff, and 034's transition trigger still covers any later flip to
--   AUTO_HOLD with the full fan-out. No new type needed beyond the two.
--
-- Never-block guarantee: every PERFORM enqueue_notification below is wrapped
--   in 034's BEGIN ... EXCEPTION WHEN OTHERS RAISE WARNING pattern — a
--   notification failure logs and continues; the business INSERT/UPDATE
--   always commits.

-- =========================================================================
-- 1. Widen notifications.type CHECK by shape (pattern: 047:20-33, 065:55-69).
--    The type CHECK is the only CHECK constraint on notifications (034:54-71),
--    so matching '%type%' finds exactly it. Re-paste-safe: after the first
--    run the re-added constraint (notifications_type_check) still matches
--    the shape and is dropped + re-added identically.
-- =========================================================================

DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.notifications'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING'
    ));
END $$;

-- =========================================================================
-- 2. notify_header_status_change — 034:148-212 body, plus the admin-targeted
--    REQUEST_APPROVED_FOR_PO enqueue on transition to APPROVED.
--    CREATE OR REPLACE: same signature, trigger keeps pointing at it.
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

  -- Existing all-members notification — unchanged from 034.
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- Notifications must not block business writes. Log and continue.
    RAISE WARNING 'enqueue_notification (header status) failed: %', SQLERRM;
  END;

  -- NEW (067): approval handoff — ping the admin(s) who create the SANO PO.
  -- Deliberately no actor exclusion (see header: sole-admin-approver case).
  IF NEW.overall_status = 'APPROVED' THEN
    BEGIN
      PERFORM enqueue_notification(
        NEW.project_id,
        'REQUEST_APPROVED_FOR_PO',
        'Request siap dibuatkan PO',
        'Request material disetujui. Buat PO di SANO.',
        'POScreen',
        jsonb_build_object('headerId', NEW.id),
        NEW.id,
        NULL,      -- p_exclude_user_id: none — keep the sole-admin-approver
        'admin'    -- p_target_role (066)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_notification (REQUEST_APPROVED_FOR_PO) failed: %', SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- 034's AFTER UPDATE OF overall_status trigger already points at this
-- function name; no trigger re-create needed for section 2.

-- =========================================================================
-- 3. AFTER INSERT trigger — new request lands in front of the estimator.
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_header_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type  TEXT;
  v_title TEXT;
  v_body  TEXT;
BEGIN
  IF NEW.overall_status = 'PENDING' THEN
    v_type  := 'REQUEST_PENDING';
    v_title := 'Permintaan baru menunggu review';
    v_body  := 'Request material baru menunggu persetujuan.';
  ELSIF NEW.overall_status = 'AUTO_HOLD' THEN
    -- Born held (gate flagged it before/at insert): reuse 034's AUTO_HOLD
    -- type + wording so clients treat it as a real hold (see header note).
    v_type  := 'AUTO_HOLD';
    v_title := 'Permintaan butuh review';
    v_body  := 'Request di-flag ' || COALESCE(NEW.overall_flag, 'CRITICAL') ||
               '. Tap untuk review.';
  ELSE
    -- Any other status at insert (pre-approved imports, etc.): not a
    -- review handoff — the UPDATE trigger owns transition notifications.
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      v_type,
      v_title,
      v_body,
      'ApprovalsScreen',
      jsonb_build_object('headerId', NEW.id),
      NEW.id,
      NEW.requested_by,  -- exclude the requester — they submitted it
      'estimator'        -- p_target_role (066): reviewers only
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notifications must not block business writes. Log and continue.
    RAISE WARNING 'enqueue_notification (header insert) failed: %', SQLERRM;
  END;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS material_request_headers_notify_insert_trg
  ON material_request_headers;
CREATE TRIGGER material_request_headers_notify_insert_trg
  AFTER INSERT
  ON material_request_headers
  FOR EACH ROW
  EXECUTE FUNCTION notify_header_created();
