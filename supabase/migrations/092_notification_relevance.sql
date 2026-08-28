-- 092 — Notification relevance: only the parties to THIS request are notified,
--       and nobody sees a notification for a project they are not on.
--
-- User (2026-08-26): "it should only show up to the corresponding people. if
--   they are tagged in, or are in the project… between corresponding site
--   supervisor and estimator and admin regarding material request, they should
--   know each other. but it should also be filtered based on the project."
--   Refined the same day: "make sure the one being notified are only the
--   relevant parties. the correct supervisor and estimator."
--
-- "The correct supervisor and estimator" — who the schema actually knows:
--
--   THE SUPERVISOR is always knowable. material_request_headers.requested_by is
--     NOT NULL (002:204-218) — the person who raised this request. Every outcome
--     of a request is addressed to them personally, never to the supervisor role.
--
--   THE ESTIMATOR is knowable ONCE SOMEONE HAS DECIDED. reviewed_by is stamped
--     with the actor on APPROVED / REJECTED / manual Tahan (ApprovalsScreen
--     handleRequest:467-469, handleRequestHold:492-496) and is deliberately LEFT
--     ALONE when an admin returns the request (handleRequestReturn:523-529, "so
--     reviewed_by is left alone, keeping the record of who approved"). So on
--     RETURNED, reviewed_by IS the estimator who approved it — the one person
--     who must now act. Before any decision, reviewed_by is NULL: the request is
--     UNCLAIMED and the estimator role genuinely IS the correct target, because
--     it is a shared inbox and whoever picks it up becomes the owner.
--
--   Truth contract (CLAUDE.md §12): where the schema records no owner, we target
--     the role inbox and say so — we do NOT invent an assignee. mr_owning_estimator
--     below returns NULL rather than guessing, and every caller falls back to the
--     inbox, so a notification is never silently dropped.
--
-- What was actually wrong (audit of every live enqueue path):
--
--   type                     | recipients before 092              | after 092
--   -------------------------|-----------------------------------|-----------
--   AUTO_HOLD (transition)   | ALL project members               | owning estimator (else estimator inbox) + requester
--   APPROVED                 | ALL members minus reviewer        | the requester only
--   REJECTED                 | ALL members minus reviewer        | the requester only
--   RETURNED (088/089)       | ALL estimators + requester        | the estimator who approved it + requester
--   PO_READY                 | ALL members                      | admins + supervisors (see limitation below)
--   RECEIPT_MISMATCH         | ALL members minus receiver       | admins; + principals on CRITICAL
--   REQUEST_PENDING (067/085)| estimators minus requester       | unchanged — a new request is unclaimed by definition
--   REQUEST_APPROVED_FOR_PO  | admins                           | unchanged
--   PLAN_REVISED (078)       | supervisors (+principal on raise)| unchanged
--   PLAN_CEILING_RAISE (079) | principals                       | unchanged
--
-- KNOWN LIMITATION — PO_READY cannot name the correct supervisor. Nothing in the
--   schema links a purchase order back to the request that motivated it:
--   purchase_orders has project_id + a free-text boq_ref and no requester
--   (001:186-200), material_request_line_allocations links request lines to
--   boq_items (005), and 070 links receipt lines to PO lines — none of it closes
--   PO → request header. Matching on boq_ref text would be a guess, so this stays
--   role-targeted (admins send the PO, supervisors receive the delivery) and is
--   flagged here rather than faked. Closing it properly means adding a
--   request_header_id to purchase_orders at PO-creation time — a schema + UI
--   change, deliberately out of scope for this migration.
--
-- DROPPED — the principal no longer receives routine AUTO_HOLD. Migration 093
--   makes the principal a member of EVERY project, so a role-wide AUTO_HOLD ping
--   would deliver every hold on every project to them: precisely the noise this
--   migration exists to remove, multiplied. The principal keeps the decisions
--   that are genuinely theirs — PLAN_CEILING_RAISE (079), CRITICAL receipt
--   mismatch (below), PLAN_REVISED on a ceiling raise (078) — and retains the
--   Approvals screen for oversight of everything else.
--
-- "If they are not in the project, they should not see the notification":
--   delivery was already membership-scoped (enqueue_notification joins
--   project_assignments), but READING was not — a user removed from a project
--   kept seeing its rows forever. The SELECT policy now also requires current
--   membership in the notification's project.
--
-- Paste order: AFTER 089 (this file re-creates ITS notify_header_status_change)
--   and AFTER 085 (re-creates its notify_po_ready / notify_receipt_mismatch).
--   Apply via Dashboard SQL Editor (remote migration history diverged — see
--   project memory). Idempotent / re-paste-safe throughout.
--
-- ⚠ RE-CREATES LIVE FUNCTIONS: notify_header_status_change (last: 089),
--   notify_po_ready (last: 085), notify_receipt_mismatch (last: 085).
--   Pasting 034, 067, 085, 088 or 089 after this file silently reverts the
--   targeting to the old all-members fan-out. Re-paste 092 last.
--
-- Never-block guarantee (034/067/085 pattern): every enqueue below stays
--   EXCEPTION-wrapped — a notification failure logs a WARNING and the
--   business write commits.

-- =========================================================================
-- 1. Helper: enqueue_notification_user — one KNOWN person, not a role.
--    enqueue_notification (066) can only target a role, which would ping
--    every supervisor/estimator on the project; this flow needs "the
--    requester" and "the estimator who approved it". Mirrors 089's inline
--    INSERT shape: the membership join means a person who has since left the
--    project gets nothing, and the exclusion inputs stop one event producing
--    two rows for the same human.
-- =========================================================================

DROP FUNCTION IF EXISTS enqueue_notification_user(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT[]
);

CREATE OR REPLACE FUNCTION enqueue_notification_user(
  p_project_id        UUID,
  p_user_id           UUID,
  p_type              TEXT,
  p_title             TEXT,
  p_body              TEXT,
  p_deeplink_screen   TEXT,
  p_deeplink_params   JSONB,
  p_related_entity_id UUID,
  p_exclude_user_ids  UUID[] DEFAULT NULL,  -- actor, and anyone already notified
  p_skip_roles        TEXT[] DEFAULT NULL   -- roles a role-targeted call already reached
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- array_remove keeps a NULL entry from poisoning the = ANY() comparison into
  -- NULL (which would filter out EVERY row and silently drop the notification).
  v_exclude UUID[] := array_remove(COALESCE(p_exclude_user_ids, ARRAY[]::UUID[]), NULL);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications
    (project_id, recipient_user_id, type, title, body,
     deeplink_screen, deeplink_params, related_entity_id)
  SELECT p_project_id, pa.user_id, p_type, p_title, p_body,
         p_deeplink_screen, p_deeplink_params, p_related_entity_id
  FROM project_assignments pa
  JOIN profiles p ON p.id = pa.user_id
  WHERE pa.project_id = p_project_id
    AND pa.user_id    = p_user_id
    AND NOT (pa.user_id = ANY (v_exclude))
    AND (p_skip_roles IS NULL OR p.role <> ALL (p_skip_roles));
END;
$$;

-- =========================================================================
-- 2. Helper: mr_owning_estimator — the estimator who last decided this
--    request and is STILL on the project, or NULL.
--
--    NULL means "no owner the schema can name" and the caller must fall back
--    to the estimator inbox. Two distinct cases both yield NULL, deliberately:
--      • reviewed_by IS NULL — nobody has decided yet (a fresh request).
--      • reviewed_by is a principal — a manual Tahan (088 §3) stamps the
--        principal into reviewed_by, and a principal is not the estimator who
--        owns the review queue.
--    The membership check matters as much as the role one: an estimator who
--    has left the project would swallow the notification, turning a returned
--    request back into the silent stall 088 §5.4 exists to abolish.
-- =========================================================================

CREATE OR REPLACE FUNCTION mr_owning_estimator(
  p_project_id  UUID,
  p_reviewed_by UUID
) RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pa.user_id
  FROM project_assignments pa
  JOIN profiles p ON p.id = pa.user_id
  WHERE pa.project_id = p_project_id
    AND pa.user_id    = p_reviewed_by
    AND p.role        = 'estimator';
$$;

-- Trigger-internal helpers — same GRANT posture as enqueue_notification: none.

-- =========================================================================
-- 3. notify_header_status_change — 089's machinery (summary, reviewer,
--    returner, reason, params) kept verbatim; only WHO receives changes.
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_header_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary  TEXT;
  v_reviewer TEXT;
  v_returner TEXT;
  v_reason   TEXT;
  v_params   JSONB;
  v_body     TEXT;
  v_body_req TEXT;    -- requester-facing copy ("Permintaan Anda …")
  v_owner    UUID;    -- the estimator who owns this request, NULL if unclaimed
  v_inbox    TEXT[];  -- ARRAY['estimator'] when the role inbox was used instead
  v_actor    UUID;    -- the human whose write caused this transition, if any
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

  -- Detail lookups degrade to NULL (→ generic wording), never block (085).
  BEGIN
    v_summary := mr_request_summary(NEW.id);
    SELECT NULLIF(full_name, '') INTO v_reviewer
    FROM profiles WHERE id = NEW.reviewed_by;
  EXCEPTION WHEN OTHERS THEN
    v_summary  := NULL;
    v_reviewer := NULL;
  END;

  IF NEW.overall_status = 'AUTO_HOLD' THEN
    -- Subject preference (085): the flagged lines, else the whole request.
    BEGIN
      v_summary := COALESCE(mr_request_summary(NEW.id, TRUE), v_summary);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    v_body := 'Request ' || COALESCE(v_summary, 'material')
              || ' di-flag ' || COALESCE(NEW.overall_flag, 'CRITICAL')
              || '. Tap untuk review.';

    -- A human stamped a verdict in THIS write (the principal's manual Tahan,
    -- 088 §3) — they are the actor and must not be notified of their own move.
    -- 033's system promotion leaves reviewed_by untouched, so v_actor is NULL
    -- there: nobody acted, and nobody is excluded.
    v_actor := CASE WHEN NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
                    THEN NEW.reviewed_by ELSE NULL END;

    -- 092: the ONE estimator who owns this request — or the inbox if unclaimed.
    v_owner := mr_owning_estimator(NEW.project_id, NEW.reviewed_by);
    IF v_owner IS NOT NULL THEN
      BEGIN
        PERFORM enqueue_notification_user(
          NEW.project_id, v_owner, 'AUTO_HOLD',
          'Permintaan butuh review', v_body,
          'ApprovalsScreen', v_params, NEW.id,
          ARRAY[v_actor], NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_notification_user (AUTO_HOLD owner) failed: %', SQLERRM;
      END;
    ELSE
      v_inbox := ARRAY['estimator'];
      BEGIN
        PERFORM enqueue_notification(
          NEW.project_id, 'AUTO_HOLD', 'Permintaan butuh review', v_body,
          'ApprovalsScreen', v_params, NEW.id,
          v_actor,
          'estimator'    -- p_target_role (066): the unclaimed-review inbox
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_notification (AUTO_HOLD inbox) failed: %', SQLERRM;
      END;
    END IF;

    -- 092: the requester learns their own request is stuck. Excluded if they
    -- are the actor or the owner already notified above; skipped if the inbox
    -- fan-out already reached them.
    BEGIN
      PERFORM enqueue_notification_user(
        NEW.project_id, NEW.requested_by, 'AUTO_HOLD',
        'Permintaan Anda ditahan',
        'Permintaan Anda ' || COALESCE(v_summary, 'material')
          || ' di-flag ' || COALESCE(NEW.overall_flag, 'CRITICAL')
          || ' — menunggu review.',
        'ApprovalsScreen', v_params, NEW.id,
        ARRAY[v_actor, v_owner], v_inbox
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'requester AUTO_HOLD notification failed: %', SQLERRM;
    END;

  ELSIF NEW.overall_status = 'APPROVED' THEN
    -- 092: the outcome goes to the requester ONLY. The reviewer acted (they
    -- know), admins get the dedicated REQUEST_APPROVED_FOR_PO handoff below,
    -- and no other supervisor has a stake in this request.
    v_body_req := 'Permintaan Anda ' || COALESCE(v_summary, 'material')
                  || ' disetujui' || COALESCE(' oleh ' || v_reviewer, '') || '.';
    BEGIN
      PERFORM enqueue_notification_user(
        NEW.project_id, NEW.requested_by, 'APPROVED',
        'Permintaan disetujui', v_body_req,
        'ApprovalsScreen', v_params, NEW.id,
        ARRAY[NEW.reviewed_by],   -- never self-notify a requester-reviewer
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'requester APPROVED notification failed: %', SQLERRM;
    END;

  ELSIF NEW.overall_status = 'REJECTED' THEN
    v_body_req := 'Permintaan Anda ' || COALESCE(v_summary, 'material')
                  || ' ditolak' || COALESCE(' oleh ' || v_reviewer, '') || '.';
    BEGIN
      PERFORM enqueue_notification_user(
        NEW.project_id, NEW.requested_by, 'REJECTED',
        'Permintaan ditolak', v_body_req,
        'ApprovalsScreen', v_params, NEW.id,
        ARRAY[NEW.reviewed_by],   -- never self-notify a requester-reviewer
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'requester REJECTED notification failed: %', SQLERRM;
    END;

  ELSE
    -- RETURNED (088 §5.4 + 089). reviewed_by still holds the estimator who
    -- APPROVED this request — the admin's handback is addressed to that one
    -- person, not to every estimator on the project.
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
    -- Full, untruncated reason for any client that wants to render it inline.
    v_params := v_params || jsonb_build_object('returnedReason', v_reason);

    v_owner := mr_owning_estimator(NEW.project_id, NEW.reviewed_by);
    IF v_owner IS NOT NULL THEN
      BEGIN
        PERFORM enqueue_notification_user(
          NEW.project_id, v_owner, 'RETURNED',
          'Permintaan dikembalikan', v_body,
          'ApprovalsScreen', v_params, NEW.id,
          ARRAY[NEW.returned_by],   -- the admin who returned it, excluded
          NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_notification_user (RETURNED owner) failed: %', SQLERRM;
      END;
    ELSE
      -- No nameable owner (approver has left the project, or a service-role
      -- write produced RETURNED without a reviewer). Fall back to the inbox —
      -- a returned request that reaches nobody is the exact silent stall
      -- 088 §5.4 exists to abolish.
      v_inbox := ARRAY['estimator'];
      BEGIN
        PERFORM enqueue_notification(
          NEW.project_id, 'RETURNED', 'Permintaan dikembalikan', v_body,
          'ApprovalsScreen', v_params, NEW.id,
          NEW.returned_by,   -- the admin who returned it, excluded
          'estimator'        -- p_target_role (066): the role that must act next
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_notification (RETURNED inbox) failed: %', SQLERRM;
      END;
    END IF;

    -- 089 — ALSO tell the supervisor who raised the request that it came back.
    -- deeplink_screen stays 'ApprovalsScreen': tools/notificationRouting.ts
    -- resolves that to the Permintaan tab for supervisors.
    IF NEW.requested_by IS NOT NULL THEN
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
        PERFORM enqueue_notification_user(
          NEW.project_id, NEW.requested_by, 'RETURNED',
          'Permintaan dikembalikan', v_body_req,
          'ApprovalsScreen', v_params, NEW.id,
          ARRAY[NEW.returned_by, v_owner],  -- acting admin, and the owner above
          v_inbox                           -- NULL unless the inbox was used
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'requester RETURNED notification failed: %', SQLERRM;
      END;
    END IF;
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

-- 034's AFTER UPDATE OF overall_status trigger already points at this
-- function name; no trigger re-create needed.

-- =========================================================================
-- 4. notify_po_ready — 085 body, retargeted: admins (they send the PO) and
--    supervisors (site receives the delivery). See the KNOWN LIMITATION in
--    this file's header: no PO → request link exists, so the ONE requesting
--    supervisor is not knowable here and is not guessed at.
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_po_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty  TEXT;
  v_body TEXT;
BEGIN
  BEGIN
    v_qty := trim_scale(round(NEW.quantity, 2))::TEXT || ' ' || NEW.unit;
  EXCEPTION WHEN OTHERS THEN
    v_qty := NULL;
  END;

  v_body := 'PO ' || COALESCE(NEW.po_number, 'baru') || ': '
            || NEW.material_name
            || COALESCE(' ' || v_qty, '')
            || ' — supplier ' || NEW.supplier || '.';

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id, 'PO_READY', 'PO siap dikirim', v_body,
      'POScreen', jsonb_build_object('poId', NEW.id), NEW.id,
      NULL,
      'admin'        -- p_target_role (066): the role that sends the PO
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification (PO_READY admin) failed: %', SQLERRM;
  END;
  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id, 'PO_READY', 'PO siap dikirim', v_body,
      'POScreen', jsonb_build_object('poId', NEW.id), NEW.id,
      NULL,
      'supervisor'   -- p_target_role (066): the site that will receive it
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification (PO_READY supervisor) failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 034's AFTER INSERT trigger already points at this function name.

-- =========================================================================
-- 5. notify_receipt_mismatch — 085 body, retargeted: admins own the
--    discrepancy; principals are additionally told on CRITICAL (they are the
--    escalation authority — 088). The receiving supervisor stays excluded;
--    other supervisors are no longer pinged.
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_receipt_mismatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_number TEXT;
  v_material  TEXT;
  v_body      TEXT;
BEGIN
  IF NEW.gate3_flag NOT IN ('WARNING', 'CRITICAL') THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT po.po_number, po.material_name INTO v_po_number, v_material
    FROM purchase_orders po WHERE po.id = NEW.po_id;
  EXCEPTION WHEN OTHERS THEN
    v_po_number := NULL;
    v_material  := NULL;
  END;

  v_body := 'Penerimaan ' || COALESCE(v_material, 'material')
            || COALESCE(' (PO ' || v_po_number || ')', '')
            || COALESCE(', kendaraan ' || NULLIF(NEW.vehicle_ref, ''), '')
            || ' di-flag ' || NEW.gate3_flag || '.';

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id, 'RECEIPT_MISMATCH', 'Penerimaan mismatch', v_body,
      'ReceiptScreen', jsonb_build_object('receiptId', NEW.id), NEW.id,
      NEW.received_by,
      'admin'        -- p_target_role (066): procurement owns the follow-up
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification (RECEIPT_MISMATCH admin) failed: %', SQLERRM;
  END;

  IF NEW.gate3_flag = 'CRITICAL' THEN
    BEGIN
      PERFORM enqueue_notification(
        NEW.project_id, 'RECEIPT_MISMATCH', 'Penerimaan mismatch', v_body,
        'ReceiptScreen', jsonb_build_object('receiptId', NEW.id), NEW.id,
        NEW.received_by,
        'principal'  -- p_target_role (066): escalation authority
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_notification (RECEIPT_MISMATCH principal) failed: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

-- 034's AFTER INSERT trigger already points at this function name.

-- =========================================================================
-- 6. RLS — reading a notification now also requires CURRENT membership in
--    its project. Delivery was always membership-scoped; this closes the
--    read side ("if they are not in the project, they should not see the
--    notification"): a user removed from a project stops seeing its rows,
--    past ones included. Mark-read (UPDATE) keeps its recipient-only shape —
--    a row the user can no longer SELECT is unreachable from the app anyway.
--
--    ⚠ Paste 093 immediately after this file: until the principal back-fill
--    runs, this policy hides the principal's existing notifications on
--    projects they were never added to.
-- =========================================================================

DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (
    auth.uid() = recipient_user_id
    AND EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = notifications.project_id
        AND pa.user_id    = auth.uid()
    )
  );
