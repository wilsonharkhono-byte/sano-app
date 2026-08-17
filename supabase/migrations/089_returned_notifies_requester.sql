-- 089_returned_notifies_requester.sql
--
-- Also notify the SUPERVISOR who raised a material request when an admin
-- returns it. Migration 088 §5.4 notified only the estimator (the role that
-- must act next); the requester learned nothing until they happened to open
-- Permintaan — a smaller version of the silent stall that the RETURNED state
-- exists to abolish.
--
-- REQUIRES 088 (this re-creates ITS notify_header_status_change) and 066
--   (enqueue_notification's p_target_role). Apply AFTER 088.
--
-- ⚠ RE-CREATES A LIVE FUNCTION: notify_header_status_change. The body below is
--   088's section 9 VERBATIM plus one added block. Pasting 088 (or 085, or 034)
--   after this file silently reverts it. See 088's header for the same warning
--   about 033 / 069 / 073 / 085.
--
-- Idempotent / re-paste-safe: CREATE OR REPLACE only. No schema change --
--   'RETURNED' is already in the notifications.type CHECK (088 section 8).

CREATE OR REPLACE FUNCTION notify_header_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type     TEXT;
  v_title    TEXT;
  v_body     TEXT;
  v_actor    UUID;
  v_summary  TEXT;
  v_reviewer TEXT;
  v_returner TEXT;
  v_reason   TEXT;
  v_target   TEXT  := NULL;  -- p_target_role (066): NULL = 085's all-members fan-out
  v_params   JSONB;
  v_body_req TEXT;   -- 089: requester-facing copy (differs from the estimator's)
BEGIN
  -- Transition guard: only fire when status changed to one of the four.
  IF OLD.overall_status IS NOT DISTINCT FROM NEW.overall_status THEN
    RETURN NULL;
  END IF;

  IF NEW.overall_status NOT IN ('AUTO_HOLD', 'APPROVED', 'REJECTED', 'RETURNED') THEN
    -- PENDING / UNDER_REVIEW transitions don't notify.
    RETURN NULL;
  END IF;

  v_params := jsonb_build_object('headerId', NEW.id);

  -- Detail lookups degrade to NULL (→ old generic wording), never block.
  BEGIN
    v_summary := mr_request_summary(NEW.id);
    SELECT NULLIF(full_name, '') INTO v_reviewer
    FROM profiles WHERE id = NEW.reviewed_by;
  EXCEPTION WHEN OTHERS THEN
    v_summary  := NULL;
    v_reviewer := NULL;
  END;

  IF NEW.overall_status = 'AUTO_HOLD' THEN
    v_type  := 'AUTO_HOLD';
    v_title := 'Permintaan butuh review';
    -- Subject preference: the flagged lines (exactly what tripped the gate),
    -- else the whole request, else the old generic wording.
    BEGIN
      v_summary := COALESCE(mr_request_summary(NEW.id, TRUE), v_summary);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    v_body  := 'Request ' || COALESCE(v_summary, 'material')
               || ' di-flag ' || COALESCE(NEW.overall_flag, 'CRITICAL')
               || '. Tap untuk review.';
    v_actor := NULL; -- system-driven (Claim 1 trigger), no actor to exclude
  ELSIF NEW.overall_status = 'APPROVED' THEN
    v_type  := 'APPROVED';
    v_title := 'Permintaan disetujui';
    v_body  := 'Request ' || COALESCE(v_summary, 'material') || ' disetujui'
               || COALESCE(' oleh ' || v_reviewer, '') || '.';
    v_actor := NEW.reviewed_by;
  ELSIF NEW.overall_status = 'REJECTED' THEN
    v_type  := 'REJECTED';
    v_title := 'Permintaan ditolak';
    v_body  := 'Request ' || COALESCE(v_summary, 'material') || ' ditolak'
               || COALESCE(' oleh ' || v_reviewer, '') || '.';
    v_actor := NEW.reviewed_by;
  ELSE
    -- NEW (088 §5.4): the admin handed an approved request back. Unlike the
    -- three above, the reviewer is NOT the actor — returned_by is, stamped by
    -- section 5's guard from auth.uid().
    v_type  := 'RETURNED';
    v_title := 'Permintaan dikembalikan';

    BEGIN
      SELECT NULLIF(full_name, '') INTO v_returner
      FROM profiles WHERE id = NEW.returned_by;
    EXCEPTION WHEN OTHERS THEN
      v_returner := NULL;
    END;

    -- Truth contract: no reason is invented. A blank one (only reachable from a
    -- service-role write, which bypasses the guard) simply yields a body with no
    -- ": ..." clause rather than a plausible-sounding filler.
    v_reason := NULLIF(btrim(COALESCE(NEW.returned_reason, '')), '');

    v_body := 'Request ' || COALESCE(v_summary, 'material')
              || ' dikembalikan ke estimator'
              || COALESCE(' oleh ' || v_returner, '')
              || COALESCE(
                   ': ' || CASE
                             WHEN length(v_reason) > 120
                               THEN left(v_reason, 119) || '…'  -- cut is VISIBLE
                             ELSE v_reason
                           END,
                   '')
              || '.';
    v_actor  := NEW.returned_by;   -- the admin who returned it, excluded
    v_target := 'estimator';       -- the role that must act next (066)
    -- Full, untruncated reason for any client that wants to render it inline.
    v_params := v_params || jsonb_build_object('returnedReason', v_reason);
  END IF;

  -- Existing all-members notification — unchanged fan-out from 034/067 for the
  -- three original types (v_target NULL); estimator-scoped for RETURNED.
  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      v_type,
      v_title,
      v_body,
      'ApprovalsScreen',
      v_params,
      NEW.id,
      v_actor,
      v_target
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notifications must not block business writes. Log and continue.
    RAISE WARNING 'enqueue_notification (header status) failed: %', SQLERRM;
  END;

  -- 089 — ALSO tell the supervisor who raised the request that it came back.
  --
  -- enqueue_notification targets by ROLE (066), so calling it with
  -- p_target_role = 'supervisor' would ping every supervisor on the project,
  -- including ones with no stake in this request. The requester is a single
  -- known user (NEW.requested_by), so this inserts that one row directly,
  -- mirroring the helper's own INSERT shape and its project-assignment join.
  --
  -- Guards: never notify the acting admin; and skip when the requester's role
  -- is 'estimator', because the role-targeted enqueue above already reached
  -- them (a duplicate notification for one event trains people to ignore
  -- notifications, which is how a "returned" request goes unnoticed again).
  --
  -- deeplink_screen stays 'ApprovalsScreen': tools/notificationRouting.ts
  -- resolves that to the Permintaan tab for supervisors, whose navigator has
  -- no Approvals route.
  IF NEW.overall_status = 'RETURNED' AND NEW.requested_by IS NOT NULL THEN
    BEGIN
      v_body_req := 'Permintaan Anda ' || COALESCE(v_summary, 'material')
                    || ' dikembalikan'
                    || COALESCE(' oleh ' || v_returner, '')
                    || COALESCE(
                         ': ' || CASE
                                   WHEN length(v_reason) > 120
                                     THEN left(v_reason, 119) || '…'
                                   ELSE v_reason
                                 END,
                         '')
                    || '.';

      INSERT INTO notifications
        (project_id, recipient_user_id, type, title, body,
         deeplink_screen, deeplink_params, related_entity_id)
      SELECT NEW.project_id, pa.user_id, 'RETURNED', 'Permintaan dikembalikan',
             v_body_req, 'ApprovalsScreen', v_params, NEW.id
      FROM project_assignments pa
      JOIN profiles p ON p.id = pa.user_id
      WHERE pa.project_id = NEW.project_id
        AND pa.user_id    = NEW.requested_by
        AND (NEW.returned_by IS NULL OR pa.user_id <> NEW.returned_by)
        AND p.role <> 'estimator';
    EXCEPTION WHEN OTHERS THEN
      -- Same contract as every other enqueue here: a notification failure must
      -- never block the business write.
      RAISE WARNING 'requester RETURNED notification failed: %', SQLERRM;
    END;
  END IF;

  -- 067: approval handoff — ping the admin(s) who create the SANO PO.
  -- Deliberately no actor exclusion (see 067 header: sole-admin-approver).
  IF NEW.overall_status = 'APPROVED' THEN
    BEGIN
      PERFORM enqueue_notification(
        NEW.project_id,
        'REQUEST_APPROVED_FOR_PO',
        'Request siap dibuatkan PO',
        'Request ' || COALESCE(v_summary, 'material')
          || ' disetujui. Buat PO di SANO.',
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
