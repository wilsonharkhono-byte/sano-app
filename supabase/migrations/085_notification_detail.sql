-- 085 — Notification detail: bodies name the materials, people and flags
--
-- Paste order: AFTER 084 (and after 066/067/078/079 — this file replaces
--   functions those migrations installed; pasting 067 or 079 AFTER this file
--   would silently revert the bodies to their generic wording). Apply via
--   Dashboard SQL Editor (remote migration history diverged — see project
--   memory). Idempotent / re-paste-safe throughout.
--
-- Problem (user report, 2026-07-23): a supervisor's rejected request surfaces
--   as title "Permintaan ditolak", body "Request material ditolak." — no
--   request identity, no materials, no quantities, no reviewer. Audit of every
--   enqueue_notification call site found the same gap across the flow:
--
--   type                     | body today                                | gap
--   -------------------------|-------------------------------------------|-----
--   REJECTED (034/067)       | "Request material ditolak."               | which request? what materials? who rejected?
--   APPROVED (034/067)       | "Request material disetujui."             | same
--   AUTO_HOLD (034/067)      | "Request di-flag CRITICAL. Tap…"          | which line tripped the gate?
--   REQUEST_PENDING (067)    | "Request material baru menunggu…"         | who asked for what, for when?
--   REQUEST_APPROVED_FOR_PO  | "Request material disetujui. Buat PO…"    | what should the PO contain?
--   PO_READY (034)           | "PO {n} siap, supplier {s}."              | which material / how much?
--   RECEIPT_MISMATCH (034)   | "Receipt {nopol} di-flag WARNING."        | which PO / material?
--   PLAN_CEILING_RAISE (079) | "Re-publish menaikkan plafon material…"   | which materials?
--   PLAN_REVISED (078)       | client-built summary                      | already specific — untouched
--
-- Fix: one line-summary helper + CREATE OR REPLACE of the five trigger
--   functions so every body carries the concrete subject. Wording style
--   follows the existing Indonesian strings; bodies are capped at 2 named
--   materials (+ "N lainnya") because the in-app list clamps to 2 lines
--   (workflows/screens/components/NotificationList.tsx:111) and push banners
--   truncate similarly.
--
-- Unit display: material_request_lines / purchase_orders store BASE-unit
--   quantities (kg for rebar — PermintaanScreen.tsx:679-682, Gate2Screen
--   submit path); supervisors think in supplier units (batang). The summary
--   converts through material_catalog.base_qty_per_supplier_unit — the same
--   fixed factor tools/rebarBatang.ts uses client-side — so a 250 kg D13 line
--   reads "20 batang", matching what the supervisor typed. Lines without a
--   factor (or without a catalog row) show their stored qty + unit verbatim.
--   No stored quantity is changed; this is display-only.
--
-- INSERT-path timing: notify_header_created (067) fires AT the header INSERT,
--   but submit_material_request (073) inserts the header FIRST and its lines
--   after — at trigger time the summary would see zero lines. The trigger is
--   therefore re-created as a CONSTRAINT TRIGGER DEFERRABLE INITIALLY
--   DEFERRED: it fires at COMMIT of the same transaction, when the lines
--   exist. Semantics are otherwise identical (AFTER INSERT, FOR EACH ROW,
--   never-block wrapper inside the function).
--
-- Truth contract: nothing here invents information. A rejection REASON is not
--   captured anywhere in the schema (ApprovalsScreen.handleRequest writes only
--   status/reviewed_by/reviewed_at), so the body names the reviewer and the
--   materials — it does NOT fabricate a reason. If reason capture is wanted,
--   that is a schema + UI feature, out of scope here.
--
-- Never-block guarantee (034/067 pattern): every PERFORM enqueue_notification
--   stays EXCEPTION-wrapped, and the summary/name lookups are additionally
--   wrapped so a helper failure degrades to the old generic wording instead
--   of dropping the notification.

-- =========================================================================
-- 0. Safety net: ensure the 9-arg enqueue_notification (066) exists.
--    Identical to 066 — re-pasting is a no-op on a database that has it.
-- =========================================================================

DROP FUNCTION IF EXISTS enqueue_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID
);

CREATE OR REPLACE FUNCTION enqueue_notification(
  p_project_id        UUID,
  p_type              TEXT,
  p_title             TEXT,
  p_body              TEXT,
  p_deeplink_screen   TEXT,
  p_deeplink_params   JSONB,
  p_related_entity_id UUID,
  p_exclude_user_id   UUID DEFAULT NULL,
  p_target_role       TEXT DEFAULT NULL
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
  JOIN profiles p ON p.id = pa.user_id
  WHERE pa.project_id = p_project_id
    AND (p_exclude_user_id IS NULL OR pa.user_id <> p_exclude_user_id)
    AND (p_target_role IS NULL OR p.role = p_target_role);
END;
$$;

-- =========================================================================
-- 1. Helper: mr_request_summary — "Semen Portland 50kg 100 sak, Besi Beton
--    D13 20 batang, 1 lainnya". p_only_flagged limits to lines whose
--    line_flag <> 'OK' (the AUTO_HOLD subject: exactly what tripped the
--    gate). Returns NULL when no matching lines — callers COALESCE to the
--    old generic wording, never to an invented value.
-- =========================================================================

CREATE OR REPLACE FUNCTION mr_request_summary(
  p_header_id    UUID,
  p_only_flagged BOOLEAN DEFAULT FALSE
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts TEXT[];
  v_total INT;
  v_text  TEXT;
BEGIN
  SELECT array_agg(part ORDER BY ord) FILTER (WHERE ord <= 2), COUNT(*)::INT
  INTO v_parts, v_total
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY l.created_at, l.id) AS ord,
      COALESCE(NULLIF(mc.name, ''), NULLIF(l.custom_material_name, ''), 'material')
      || ' '
      || CASE
           -- Rebar & friends: stored base-kg, supervisor thinks supplier units
           -- (batang). Same factor as tools/rebarBatang.ts (052).
           WHEN mc.base_qty_per_supplier_unit IS NOT NULL
                AND mc.base_qty_per_supplier_unit > 0
                AND NULLIF(mc.supplier_unit, '') IS NOT NULL
                AND mc.supplier_unit <> mc.unit
             THEN trim_scale(round(l.quantity / mc.base_qty_per_supplier_unit, 1))::TEXT
                  || ' ' || mc.supplier_unit
           ELSE trim_scale(round(l.quantity, 2))::TEXT || ' ' || l.unit
         END AS part
    FROM material_request_lines l
    LEFT JOIN material_catalog mc ON mc.id = l.material_id
    WHERE l.request_header_id = p_header_id
      AND (NOT p_only_flagged OR l.line_flag <> 'OK')
  ) s;

  IF v_total IS NULL OR v_total = 0 THEN
    RETURN NULL;
  END IF;

  v_text := array_to_string(v_parts, ', ');
  IF v_total > 2 THEN
    v_text := v_text || ', ' || (v_total - 2)::TEXT || ' lainnya';
  END IF;
  RETURN v_text;
END;
$$;

-- Trigger-internal helper (no direct PostgREST use intended, mirrors
-- enqueue_notification's GRANT posture — none needed).

-- =========================================================================
-- 2. notify_header_status_change — 067 body, enriched. Keeps 067's extra
--    admin-targeted REQUEST_APPROVED_FOR_PO enqueue and all role targeting.
-- =========================================================================

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
BEGIN
  -- Transition guard: only fire when status changed to one of the three.
  IF OLD.overall_status IS NOT DISTINCT FROM NEW.overall_status THEN
    RETURN NULL;
  END IF;

  IF NEW.overall_status NOT IN ('AUTO_HOLD', 'APPROVED', 'REJECTED') THEN
    -- PENDING / UNDER_REVIEW transitions don't notify.
    RETURN NULL;
  END IF;

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
  ELSE
    v_type  := 'REJECTED';
    v_title := 'Permintaan ditolak';
    v_body  := 'Request ' || COALESCE(v_summary, 'material') || ' ditolak'
               || COALESCE(' oleh ' || v_reviewer, '') || '.';
    v_actor := NEW.reviewed_by;
  END IF;

  -- Existing all-members notification — unchanged fan-out from 034/067.
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
-- function name; no trigger re-create needed for section 2.

-- =========================================================================
-- 3. notify_header_created — 067 body, enriched with requester + materials
--    + target date, and re-attached as a DEFERRED constraint trigger so the
--    line summary sees the lines 073 inserts after the header (see header).
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_header_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type      TEXT;
  v_title     TEXT;
  v_body      TEXT;
  v_summary   TEXT;
  v_requester TEXT;
  v_detail    TEXT;
BEGIN
  IF NEW.overall_status NOT IN ('PENDING', 'AUTO_HOLD') THEN
    -- Any other status at insert (pre-approved imports, etc.): not a
    -- review handoff — the UPDATE trigger owns transition notifications.
    RETURN NULL;
  END IF;

  BEGIN
    v_summary := mr_request_summary(NEW.id);
    SELECT NULLIF(full_name, '') INTO v_requester
    FROM profiles WHERE id = NEW.requested_by;
  EXCEPTION WHEN OTHERS THEN
    v_summary   := NULL;
    v_requester := NULL;
  END;

  -- "Krisanto meminta Semen 100 sak — target 25/07 (URGENT)."
  v_detail := COALESCE(v_requester, 'Supervisor')
              || ' meminta ' || COALESCE(v_summary, 'material')
              || COALESCE(' — target ' || to_char(NEW.target_date, 'DD/MM'), '')
              || CASE WHEN NEW.urgency IS DISTINCT FROM 'NORMAL'
                      THEN ' (' || NEW.urgency || ')' ELSE '' END;

  IF NEW.overall_status = 'PENDING' THEN
    v_type  := 'REQUEST_PENDING';
    v_title := 'Permintaan baru menunggu review';
    v_body  := v_detail || '. Menunggu persetujuan.';
  ELSE
    -- Born held (gate flagged it before/at insert): reuse 034's AUTO_HOLD
    -- type + flag wording so clients treat it as a real hold (067 note).
    v_type  := 'AUTO_HOLD';
    v_title := 'Permintaan butuh review';
    v_body  := v_detail || '. Di-flag '
               || COALESCE(NEW.overall_flag, 'CRITICAL')
               || ' — tap untuk review.';
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

-- Deferred so it fires at COMMIT, after 073's line inserts (see header).
DROP TRIGGER IF EXISTS material_request_headers_notify_insert_trg
  ON material_request_headers;
CREATE CONSTRAINT TRIGGER material_request_headers_notify_insert_trg
  AFTER INSERT
  ON material_request_headers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION notify_header_created();

-- =========================================================================
-- 4. notify_po_ready — 034 body + the PO's material and quantity.
--    purchase_orders stores one material per row (001:186-200), base units.
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_po_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty TEXT;
BEGIN
  BEGIN
    v_qty := trim_scale(round(NEW.quantity, 2))::TEXT || ' ' || NEW.unit;
  EXCEPTION WHEN OTHERS THEN
    v_qty := NULL;
  END;

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      'PO_READY',
      'PO siap dikirim',
      'PO ' || COALESCE(NEW.po_number, 'baru') || ': '
        || NEW.material_name
        || COALESCE(' ' || v_qty, '')
        || ' — supplier ' || NEW.supplier || '.',
      'POScreen',
      jsonb_build_object('poId', NEW.id),
      NEW.id,
      NULL  -- no actor recorded on purchase_orders; notify everyone
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification (PO_READY) failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 034's AFTER INSERT trigger already points at this function name.

-- =========================================================================
-- 5. notify_receipt_mismatch — 034 body + which PO / material the flagged
--    delivery belongs to (receipts.po_id → purchase_orders).
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

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      'RECEIPT_MISMATCH',
      'Penerimaan mismatch',
      'Penerimaan ' || COALESCE(v_material, 'material')
        || COALESCE(' (PO ' || v_po_number || ')', '')
        || COALESCE(', kendaraan ' || NULLIF(NEW.vehicle_ref, ''), '')
        || ' di-flag ' || NEW.gate3_flag || '.',
      'ReceiptScreen',
      jsonb_build_object('receiptId', NEW.id),
      NEW.id,
      NEW.received_by
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification (RECEIPT_MISMATCH) failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 034's AFTER INSERT trigger already points at this function name.

-- =========================================================================
-- 6. notify_plan_ceiling_raise — 079 body + which materials breached, from
--    the task's server-computed override_payload (071; entries carry
--    material_name — tools/ceilingRaiseGate.ts CeilingRaisePayloadEntry).
-- =========================================================================

CREATE OR REPLACE FUNCTION notify_plan_ceiling_raise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names TEXT;
  v_count INT;
BEGIN
  BEGIN
    SELECT string_agg(name, ', '), MAX(total)::INT
    INTO v_names, v_count
    FROM (
      SELECT e->>'material_name' AS name,
             COUNT(*) OVER () AS total,
             ROW_NUMBER() OVER () AS rn
      FROM jsonb_array_elements(NEW.override_payload) e
      WHERE NULLIF(e->>'material_name', '') IS NOT NULL
    ) s
    WHERE rn <= 2;
    IF v_count > 2 THEN
      v_names := v_names || ', ' || (v_count - 2)::TEXT || ' lainnya';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_names := NULL;
  END;

  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      'PLAN_CEILING_RAISE',
      'Persetujuan kenaikan plafon material',
      'Re-publish menaikkan plafon '
        || COALESCE(v_names, 'material yang sudah melebihi order')
        || ' — perlu keputusan prinsipal.',
      'ApprovalsScreen',
      jsonb_build_object('taskId', NEW.id),
      NEW.id,
      NULL,          -- p_exclude_user_id: none
      'principal'    -- p_target_role (066)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_plan_ceiling_raise failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 079's AFTER INSERT trigger (WHEN entity_type = 'plan_ceiling_raise')
-- already points at this function name; nothing to re-create when 079 is
-- applied. On a database where 079 is not yet pasted this is a plain
-- function definition with no trigger — harmless, and 079 must NOT be
-- pasted after this file (it would revert this function; see paste order).
