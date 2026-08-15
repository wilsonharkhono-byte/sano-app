-- 088 — Approval / PO separation of duties: the estimator approves, the admin
--        orders, and neither does the other's job.
-- (Design authority: docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md
--  §4 state machine, §5.1 RLS, §5.2 transition guard, §5.3 hard PO quantity gate, §7 rollout.)
--
-- Paste order: AFTER 087 (latest applied migration). Apply via the Supabase
--   Dashboard SQL Editor — the remote migration history is diverged, so
--   `supabase db push` is not the delivery path (project memory). Idempotent /
--   re-paste-safe throughout: DROP POLICY IF EXISTS before CREATE POLICY,
--   CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE TRIGGER,
--   ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT.
--
--   ⚠ THIS FILE RE-CREATES THREE FUNCTIONS THAT ARE ALREADY LIVE:
--       recompute_header_flag       (033) — §5.2 sticky set, section 6
--       notify_header_status_change (085) — §5.4 RETURNED branch, section 9
--       compute_tier2_flag          (069) — §5.5 open-demand whitelist, section 10
--     Each body below is its CURRENT live definition verbatim plus the one
--     documented change, so pasting this file loses nothing. The hazard runs the
--     other way: pasting 069 or 085 AFTER this file would silently revert §5.5
--     and §5.4 — 085's own header carries the identical caution about 067/079.
--     If a future migration edits any of the three, re-paste that migration
--     after this one, and port the change back into this file.
--
-- DEPLOY ORDER (spec §7): apply this migration BEFORE shipping the app build.
--   The narrowed policies are compatible with the CURRENT build — it simply
--   renders buttons that now fail server-side — so there is no window in which
--   the app breaks. Shipping the build first would instead give the estimator a
--   screen whose "Setujui" still works, which is the bug being closed.
--
-- REQUIRES (must already exist on the target):
--   002 — material_request_headers + its overall_status CHECK (:214), the
--         purchase_orders / purchase_order_lines office insert+update policies.
--   033 — recompute_header_flag() (the AUTO_HOLD promotion trigger).
--   036 — is_office_role(), and the blanket "<table>_office_all" FOR ALL
--         policies this migration must DROP for the two PO tables.
--   059 — the column-guard trigger pattern this migration's transition guard
--         follows (SECURITY DEFINER plpgsql, SET search_path = public).
--   060 — po_read_assigned, is_principal(), submit_receipt as SECURITY DEFINER.
--   066 — the 9-arg enqueue_notification with p_target_role (how §5.4 reaches
--         the estimators and nobody else).
--   067 — the notifications.type CHECK shape widened below, and 034's
--         AFTER UPDATE OF overall_status trigger binding that §5.4 rides on.
--   068 — v_material_envelope_status with total_ordered = non-CANCELLED PO
--         lines and the CLOSED_SHORT LEAST(qty, received) cap.
--   069 — the WARNING cap owned by the tier flag functions.
--   071 — approval_tasks.override_payload + create_purchase_order's client-side
--         of the same quantity gate.
--   073 — compute_tier2_flag's LIVE body (Task 2.9: CANCELLED POs excluded from
--         the fulfilled-line subquery). §5.5 re-creates this function FROM 073,
--         not from 069. Pasting 073 after this file would revert §5.5; pasting
--         069 after it would revert BOTH §5.5 and 073's CANCELLED fix.
--   085 — notify_header_status_change with the detail payload (re-created in
--         §5.4), plus mr_request_summary() which that body calls.
--
-- ── What this migration changes, and why ───────────────────────────────────
--
--   §4  material_request_headers gains the RETURNED status plus the columns
--       that carry the mandatory return reason and its author. An admin who
--       cannot fulfil an approved request must be able to hand it back with a
--       written reason instead of letting it stall silently (spec §2.5).
--
--   §5.1 PO writes narrow from "any office role" to admin + principal. 036's
--       purchase_orders_office_all / purchase_order_lines_office_all are
--       DROPPED, not merely supplemented: 060's header documents this exact
--       trap — a blanket is_office_role() FOR ALL left in place means the
--       excluded role "would keep FOR ALL and could still write the verdict,
--       defeating the principal-only intent". 002's office insert/update
--       policies on BOTH PO tables are narrowed to match. Office-wide READ is
--       restored for all three office roles by explicit SELECT policies, so the
--       estimator keeps the full Procurement screen (spec §2.6: full
--       visibility, restricted action) exactly as 060 did for approval_tasks.
--
--       PO CHILD TABLES — inspected, not assumed (spec §5.1 requires this):
--         purchase_order_lines  → narrowed here, same shape as the header.
--         receipts / receipt_lines / receipt_photos / material_receipts —
--           these reference purchase_orders but are the SUPERVISOR's Gate-3
--           receiving surface, not a procurement write. Narrowing them would
--           break receiving, which spec §5.1 and §10.8 explicitly protect.
--           DELIBERATELY UNTOUCHED. submit_receipt / submit_receipt_lines
--           (060/072, SECURITY DEFINER) are likewise not redefined here.
--         price_history — written per-line by create_purchase_order (071) and
--           read by the price book; it is a price record, not a PO write, and
--           keeps 036's office_all. An estimator writing price history has
--           never been the concern; ordering was.
--
--       KNOWN, ACCEPTED ROUGH EDGE: cancel_purchase_order (072) is SECURITY
--       INVOKER behind an is_office_role() pre-check. After this migration an
--       estimator still passes that pre-check but the UPDATE then finds no RLS
--       policy, so the cancel is REFUSED — correct outcome, unfriendly message.
--       Tightening 072's pre-check to is_po_writer() is a follow-up; it is not
--       done here because 072 is outside this migration's blast radius and the
--       security outcome is already right.
--
--   §5.2 A transition-guard trigger on material_request_headers. RLS cannot
--       restrict by column or by value, and the admin legitimately needs UPDATE
--       on this table in order to RETURN a request — so the legal-transition
--       matrix has to live in a trigger, following 059's guard shape.
--
--   §5.2 (last paragraph) 033's promotion trigger treats reviewer statuses as
--       sticky. RETURNED joins that set so a returned request is never silently
--       re-promoted to AUTO_HOLD out from under the estimator.
--
--   §5.3 The hard PO quantity gate migration 069 deferred ("Task 2.5, migration
--       TBD"), as a trigger on purchase_order_lines. 071 put the same gate
--       inside create_purchase_order, which 071's own header flags as leaving a
--       residual: "office can still insert PO lines directly via 002's
--       po_lines_office_insert, which this gate does not touch". This trigger
--       closes that path — it cannot be bypassed by ANY write route.
--
--   §5.4 The return has to REACH the estimator. Today it cannot: 085's
--       notify_header_status_change early-returns unless the new status is
--       AUTO_HOLD / APPROVED / REJECTED, and the notifications.type CHECK (067,
--       last widened by 079) has no RETURNED value — so adding the branch alone
--       would fail SILENTLY, because every enqueue sits inside the 034/067
--       never-block wrapper (EXCEPTION WHEN OTHERS THEN RAISE WARNING). Without
--       both halves an estimator only discovers a handed-back request by
--       happening to open Approvals: the silent stall §2.5 exists to abolish,
--       wearing a different hat. Sections 8 and 9 ship the CHECK and the branch
--       together, targeted at the estimator role (the actor who must act next)
--       and carrying the admin's reason so the notification is self-explanatory.
--
--   §5.5 Is a returned request still open demand? Yes — it is live work parked
--       with the estimator, exactly like PENDING. Two advisory surfaces disagree
--       today: 072's v_material_envelope_status.total_requested already counts it
--       (it excludes only REJECTED), while 069's compute_tier2_flag uses an
--       explicit whitelist that omits it. Section 10 adds RETURNED to 069's
--       whitelist. Both are heads-up signals capped at WARNING, so this changes
--       NO gate — but a request must not read as demand on one screen and not
--       another.
--
--   §7  Grandfathering. BOTH triggers judge NEW writes only. No backfill, no
--       UPDATE of existing rows, no historical PO or request invalidated. An
--       in-flight APPROVED request stays orderable exactly as before, and an
--       existing unlinked PO stays valid (the request→PO link remains OPTIONAL
--       — spec §2.2, unchanged).
--
-- ── DUAL-LAYER LOCKSTEP (read before editing either half) ──────────────────
--   The §5.3 trigger is the DB twin of tools/poQuantityGate.ts
--   (evaluatePoQuantityGate + checkOverrideCoverage) and of migration 071's
--   in-RPC gate. Per project memory (migrations 033/048/049), the TS and DB
--   halves must change IN LOCKSTEP; a divergence between them is a bug, not a
--   difference of opinion. How the halves are held together:
--     • "ordered" is read from v_material_envelope_status in BOTH halves
--       (Gate2Screen selects total_planned/total_ordered from that same view),
--       so the CANCELLED exclusion and the CLOSED_SHORT LEAST(qty, received)
--       cap are defined ONCE, in 068. Re-deriving that arithmetic here is what
--       would create drift, so this trigger does not.
--     • per-material aggregation before comparison — the TS helper GROUP BYs
--       material_id across the draft lines; 071 GROUP BYs the incoming JSONB;
--       this trigger SUMs the PO's own lines for NEW.material_id.
--     • unmeasured never blocks — NULL material_id, no envelope row, or
--       total_planned <= 0 (design §3: "no baseline → unknown, never blocks").
--     • the override contract is byte-identical to 071's: an approval_tasks row
--       with entity_type='po_qty_gate' and action IN ('APPROVE','OVERRIDE'),
--       whose override_payload lists the material with attempted_qty >= this
--       PO's attempt.
--     • the TS EPSILON (1e-9) has NO counterpart here ON PURPOSE: it guards
--       IEEE-754 subtraction dust in JavaScript floats. Postgres NUMERIC is
--       exact decimal, so a bare `>` is the same predicate — and it is exactly
--       what 071 already uses. Adding an epsilon in SQL would make the DB
--       LOOSER than the RPC, which is the divergence direction that lets a real
--       overage through.
--
-- ── Override lookup: why the trigger searches, where the RPC is handed an id ─
--   create_purchase_order takes p_override_task_id and validates THAT task. A
--   trigger has no such parameter, so it accepts any principal-decided
--   po_qty_gate task for the project whose payload covers this material. That
--   is deliberately never NARROWER than the RPC (the task the RPC accepted also
--   satisfies the trigger, so an RPC-approved PO can never be blocked at the
--   table), and it inherits 071's documented v1 limitation verbatim: an
--   approved override is not consumed/single-use, so it authorises up to
--   attempted_qty and could back a second identical over-order until a future
--   task adds single-use enforcement. The audit trail (approval_tasks +
--   activity_log) records each use.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. §4 — RETURNED status + the return-reason carrier columns
-- ═══════════════════════════════════════════════════════════════════════════
-- The CHECK was declared inline on the column in 002:214, so Postgres named it
-- material_request_headers_overall_status_check. DROP IF EXISTS + ADD under the
-- same name is re-paste-safe, and every existing row holds one of the original
-- five values, so the widened constraint validates without touching data.
--
-- No existing column fits the return reason (checked: 002's reviewed_by /
-- reviewed_at belong to the ESTIMATOR's verdict and must keep pointing at the
-- reviewer — overwriting them with the returning admin would erase who
-- approved the request; 005 added only request_basis; 076's overage_reason is
-- on material_request_lines and constrained to the five Signal-1 codes). So
-- three new columns, mirroring the reviewed_by/reviewed_at pairing already on
-- this table.
--
-- returned_reason is NOT declared NOT NULL: the column is meaningless for the
-- other five statuses, and a table-level NOT NULL would reject every ordinary
-- request. "Mandatory" is enforced where it is actually true — on the
-- transition INTO RETURNED, in the guard below.
--
-- The reason is deliberately NOT cleared when the estimator re-decides: it is
-- the audit record of why the request was once handed back. Readers must gate
-- the banner on overall_status = 'RETURNED', not on returned_reason IS NOT NULL.

ALTER TABLE material_request_headers
  DROP CONSTRAINT IF EXISTS material_request_headers_overall_status_check;

ALTER TABLE material_request_headers
  ADD CONSTRAINT material_request_headers_overall_status_check
  CHECK (overall_status IN (
    'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_HOLD', 'RETURNED'
  ));

ALTER TABLE material_request_headers
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;

ALTER TABLE material_request_headers
  ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES profiles(id);

ALTER TABLE material_request_headers
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. §5.1 — is_po_writer(): the two roles that may write purchase orders
-- ═══════════════════════════════════════════════════════════════════════════
-- Same shape as 036's is_office_role() and 060's is_principal(): SECURITY
-- DEFINER + fixed search_path so it reads profiles reliably regardless of the
-- caller's own RLS on that table, and STABLE so the planner may cache it within
-- a statement. The estimator is excluded — that is the entire point.

CREATE OR REPLACE FUNCTION is_po_writer()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal')
  );
$$;
GRANT EXECUTE ON FUNCTION is_po_writer() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. §5.1 — purchase_orders: office-wide READ for all, WRITE for admin+principal
-- ═══════════════════════════════════════════════════════════════════════════
-- End state on purchase_orders:
--   SELECT — assigned users of any role (060's po_read_assigned, untouched)
--            OR any office role on any project (purchase_orders_office_read
--            below, which preserves the cross-project read half of 036's
--            office_all that this migration drops).
--   INSERT/UPDATE/DELETE — admin + principal only, on any project
--            (purchase_orders_writer_all, the role-narrowed clone of 036's
--            office_all) and, redundantly but per spec, through 002's
--            assignment-scoped insert/update policies narrowed to the same two
--            roles. Supervisors keep NO write policy (060) and still receive
--            through the SECURITY DEFINER submit_receipt RPC.

DROP POLICY IF EXISTS "purchase_orders_office_all" ON purchase_orders;

DROP POLICY IF EXISTS "purchase_orders_office_read" ON purchase_orders;
CREATE POLICY "purchase_orders_office_read" ON purchase_orders
  FOR SELECT
  TO authenticated
  USING (is_office_role());

DROP POLICY IF EXISTS "purchase_orders_writer_all" ON purchase_orders;
CREATE POLICY "purchase_orders_writer_all" ON purchase_orders
  FOR ALL
  TO authenticated
  USING (is_po_writer())
  WITH CHECK (is_po_writer());

-- 002's assignment-scoped office policies, re-created with the estimator
-- removed. Bodies are 002:858-892 verbatim apart from the role list.
DROP POLICY IF EXISTS "purchase_orders_office_insert" ON purchase_orders;
CREATE POLICY "purchase_orders_office_insert" ON purchase_orders
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'principal')
    )
  );

DROP POLICY IF EXISTS "purchase_orders_office_update" ON purchase_orders;
CREATE POLICY "purchase_orders_office_update" ON purchase_orders
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'principal')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'principal')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. §5.1 — purchase_order_lines: the same narrowing, verified against its own
--    policy set rather than assumed to mirror the header's
-- ═══════════════════════════════════════════════════════════════════════════
-- Inspected policy set before this migration: po_lines_assigned_select (002,
-- SELECT via the parent PO's assignment), po_lines_office_insert /
-- po_lines_office_update (002, assignment + office role, both reaching the role
-- through a JOIN on profiles rather than a subquery), and
-- purchase_order_lines_office_all (036's loop, FOR ALL). The office_all is the
-- one that actually carries create_purchase_order's line inserts today, so
-- dropping it without the writer_all replacement below would break admin PO
-- creation on unassigned projects.

DROP POLICY IF EXISTS "purchase_order_lines_office_all" ON purchase_order_lines;

DROP POLICY IF EXISTS "po_lines_office_read" ON purchase_order_lines;
CREATE POLICY "po_lines_office_read" ON purchase_order_lines
  FOR SELECT
  TO authenticated
  USING (is_office_role());

DROP POLICY IF EXISTS "po_lines_writer_all" ON purchase_order_lines;
CREATE POLICY "po_lines_writer_all" ON purchase_order_lines
  FOR ALL
  TO authenticated
  USING (is_po_writer())
  WITH CHECK (is_po_writer());

-- 002:973-1010 verbatim apart from the role list.
DROP POLICY IF EXISTS "po_lines_office_insert" ON purchase_order_lines;
CREATE POLICY "po_lines_office_insert" ON purchase_order_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM purchase_orders po
      JOIN project_assignments pa ON pa.project_id = po.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE po.id = purchase_order_lines.po_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'principal')
    )
  );

DROP POLICY IF EXISTS "po_lines_office_update" ON purchase_order_lines;
CREATE POLICY "po_lines_office_update" ON purchase_order_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM purchase_orders po
      JOIN project_assignments pa ON pa.project_id = po.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE po.id = purchase_order_lines.po_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM purchase_orders po
      JOIN project_assignments pa ON pa.project_id = po.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE po.id = purchase_order_lines.po_id
        AND pa.user_id = auth.uid()
        AND pr.role IN ('admin', 'principal')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. §5.2 — the transition guard on material_request_headers
-- ═══════════════════════════════════════════════════════════════════════════
-- Shape follows 059's guard_boq_items_supervisor_cols: SECURITY DEFINER
-- plpgsql with SET search_path = public, reading profiles.role directly rather
-- than through a helper so the trigger cannot be defeated by the caller's RLS
-- on profiles.
--
-- Three carve-outs before the matrix is consulted, each for a reason:
--
--   1. auth.uid() IS NULL — the service-role key and the Dashboard SQL editor
--      run without a JWT, yet triggers (unlike RLS) still fire for them. This
--      is the trusted-context exception 057/059/060 all take; without it, a
--      data fix pasted into the Dashboard would be refused.
--
--   2. status unchanged — every UPDATE that merely touches reviewed_at,
--      overall_flag or a future column passes straight through. The guard
--      judges TRANSITIONS, not writes.
--
--   3. pg_trigger_depth() > 1 — the write came from inside another trigger,
--      which today means exactly one thing: 033's recompute_header_flag
--      promoting PENDING → AUTO_HOLD after a HIGH/CRITICAL line flag. That is
--      the SYSTEM acting on its own evidence, not an actor exercising a
--      capability, and the supervisor whose request line triggered it holds no
--      role in this matrix. Without this carve-out, submitting a request that
--      trips the Tier-1 DIRECT-allocation flag (069's documented carve-out, the
--      one path that can still AUTO_HOLD) would fail outright for the
--      supervisor. A nested write can still only produce the promotion 033
--      encodes; it cannot smuggle an APPROVED verdict, because nothing else
--      updates this table from inside a trigger.

CREATE OR REPLACE FUNCTION guard_material_request_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor   TEXT;
  v_from    TEXT := OLD.overall_status;
  v_to      TEXT := NEW.overall_status;
  v_allowed BOOLEAN;
BEGIN
  -- Carve-out 1: no JWT — service-role key / Dashboard SQL editor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Carve-out 2: not a status transition at all.
  IF NEW.overall_status IS NOT DISTINCT FROM OLD.overall_status THEN
    RETURN NEW;
  END IF;

  -- Carve-out 3: nested write — 033's AUTO_HOLD promotion (see header).
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_actor FROM profiles WHERE id = auth.uid();

  -- The §5.2 matrix, as a whitelist. A transition or role not named here is
  -- refused, so a future status added to the CHECK constraint is denied by
  -- default until someone deliberately grants it — the same whitelist-not-
  -- blacklist reasoning 059 used for its column guard.
  v_allowed := CASE
    -- The reviewer's verdict, from every open state. RETURNED is included so a
    -- returned request can be re-decided DIRECTLY once the estimator has
    -- amended or accepted it — the round trip never costs an extra click.
    WHEN v_to IN ('APPROVED', 'REJECTED')
      AND v_from IN ('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'RETURNED')
      THEN v_actor IN ('estimator', 'principal')
    -- Re-opening a returned request is available but never required.
    WHEN v_to = 'PENDING' AND v_from = 'RETURNED'
      THEN v_actor IN ('estimator', 'principal')
    -- Handing an approved request back to the estimator is the admin's move
    -- (spec §2.5); the principal keeps it as the escape hatch above them.
    WHEN v_to = 'RETURNED' AND v_from = 'APPROVED'
      THEN v_actor IN ('admin', 'principal')
    -- Manual "Tahan" stays principal-only — unchanged behaviour (spec §3).
    WHEN v_to = 'AUTO_HOLD'
      THEN v_actor = 'principal'
    ELSE FALSE
  END;

  -- IS NOT TRUE, not NOT v_allowed: an actor with no profiles row leaves
  -- v_actor NULL, every arm evaluates to NULL, and `NOT NULL` is NULL — which
  -- plpgsql would treat as false and let the write through. Failing loud on the
  -- unknown actor is the only honest reading.
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'MR_TRANSITION_DENIED: peran % tidak boleh mengubah status permintaan dari % ke %',
      COALESCE(v_actor, '(tanpa profil)'), v_from, v_to
      USING HINT = 'Persetujuan dilakukan estimator; pengembalian ke estimator dilakukan admin.';
  END IF;

  -- A return without a reason is the silent stall this design exists to kill
  -- (spec §2.5), so the reason is mandatory exactly here — at the transition —
  -- rather than as a table-level NOT NULL that would break the other statuses.
  IF v_to = 'RETURNED' THEN
    IF btrim(COALESCE(NEW.returned_reason, '')) = '' THEN
      RAISE EXCEPTION
        'MR_RETURN_REASON_REQUIRED: alasan wajib diisi saat mengembalikan permintaan ke estimator';
    END IF;

    -- Server-authoritative authorship, in the spirit of 033 overwriting
    -- line_flag and submit_receipt pinning p_received_by to auth.uid(): the
    -- recorded returner is the caller, never whatever the client sent.
    NEW.returned_by := auth.uid();
    NEW.returned_at := COALESCE(NEW.returned_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_request_headers_status_guard_trg ON material_request_headers;
CREATE TRIGGER material_request_headers_status_guard_trg
  BEFORE UPDATE OF overall_status
  ON material_request_headers
  FOR EACH ROW EXECUTE FUNCTION guard_material_request_status_transition();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. §5.2 (last paragraph) — RETURNED joins 033's sticky set
-- ═══════════════════════════════════════════════════════════════════════════
-- 033's recompute_header_flag re-created with the promotion condition made
-- explicit. Body is 033:263-310 verbatim except for v_should_promote.
--
-- Note the shape of the change: the existing whitelist IN ('PENDING',
-- 'AUTO_HOLD') ALREADY excludes RETURNED, so this is not a behaviour fix — it
-- is the invariant written down where it can be seen. The added NOT IN spells
-- out the full sticky set (every status a reviewer or an admin owns), so a
-- future migration that widens the whitelist cannot silently re-promote a
-- returned request out from under the estimator, which is the failure spec §5.2
-- names and §10.4 makes an acceptance criterion.
--
-- ⚠ RE-PASTE HAZARD: this function is also defined in 033. If a LATER migration
--   ever edits recompute_header_flag again, re-pasting 088 would revert it —
--   the same caution 060 carries about approval_tasks_office_insert. Re-paste
--   the later migration afterwards.

CREATE OR REPLACE FUNCTION recompute_header_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header_id UUID;
  v_worst_flag TEXT;
  v_current_status TEXT;
  v_should_promote BOOLEAN;
BEGIN
  v_header_id := COALESCE(NEW.request_header_id, OLD.request_header_id);

  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE line_flag = 'CRITICAL') > 0 THEN 'CRITICAL'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'HIGH')     > 0 THEN 'HIGH'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'WARNING')  > 0 THEN 'WARNING'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'INFO')     > 0 THEN 'INFO'
      ELSE 'OK'
    END INTO v_worst_flag
  FROM material_request_lines
  WHERE request_header_id = v_header_id;

  SELECT overall_status INTO v_current_status
  FROM material_request_headers
  WHERE id = v_header_id;

  -- Header may already be deleted (cascade from project) — nothing to update.
  IF v_current_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- Sticky set = every status a human decision owns: the reviewer's verdict
  -- (UNDER_REVIEW / APPROVED / REJECTED) and, as of 088, the admin's RETURNED.
  -- Only a request still sitting in the queue may be auto-promoted.
  v_should_promote :=
    v_worst_flag IN ('CRITICAL', 'HIGH')
    AND v_current_status IN ('PENDING', 'AUTO_HOLD')
    AND v_current_status NOT IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED');

  UPDATE material_request_headers
  SET
    overall_flag = v_worst_flag,
    overall_status = CASE
      WHEN v_should_promote THEN 'AUTO_HOLD'
      ELSE overall_status
    END
  WHERE id = v_header_id;

  RETURN NULL;
END;
$$;

-- 033's trigger binding for this function is unchanged and is deliberately NOT
-- re-created here, nor are 033's other two trigger functions (recompute_line_flag,
-- recompute_line_flag_from_allocation) — they are untouched by this design.

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. §5.3 — the hard PO quantity gate (Task 2.5), on purchase_order_lines
-- ═══════════════════════════════════════════════════════════════════════════
-- The rule (spec §5.3):
--   existing_non_cancelled_PO_qty + this_line_qty > current_planned
--     → reject, unless an APPROVED po_qty_gate override task exists for this
--       project + material.
--
-- WHY AFTER, NOT BEFORE: after the row lands, v_material_envelope_status.
-- total_ordered ALREADY equals existing + this line, so the rule collapses to
-- `total_ordered > total_planned` and this trigger never re-derives the
-- cancelled / closed-short arithmetic that 068 owns. A BEFORE trigger would
-- have to add NEW.quantity by hand and, on UPDATE, subtract the row's own prior
-- contribution — which for a CLOSED_SHORT PO is LEAST(qty, received), not qty.
-- That subtraction is precisely the kind of second implementation that drifts.
-- Raising from an AFTER trigger aborts the whole transaction, so nothing is
-- written either way. Postgres queues AFTER ROW triggers to the end of the
-- statement, so a multi-line INSERT (create_purchase_order's INSERT ... SELECT)
-- has all its lines in the table before the first invocation fires — every
-- invocation therefore sees the PO's full per-material total, matching 071's
-- pre-write GROUP BY exactly.
--
-- WHY THE UPDATE COLUMN LIST: `AFTER INSERT OR UPDATE OF quantity, material_id,
-- po_id`. A quantity gate has no business judging a price edit — and judging it
-- would break §7's grandfathering in practice, because Gate2Screen edits
-- unit_price on EXISTING lines and a legacy over-plan PO would suddenly refuse
-- a price correction. Column-scoped UPDATE triggers are 033's own house style
-- (`BEFORE INSERT OR UPDATE OF tier, quantity, material_id`). The body adds the
-- matching carve-out for a quantity that does not RISE — see the comment there;
-- together they are what makes §7's grandfathering true in practice and not
-- just on paper.
--
-- WHY SECURITY DEFINER: a gate that under-counts is worse than no gate. Under
-- SECURITY INVOKER, v_material_envelope_status (security_invoker = on since
-- 061) would resolve under the caller's RLS, so any future narrowing of a base
-- table's read policies would silently shrink total_ordered and quietly widen
-- the gate. Running as the definer makes the figures deterministic and
-- role-independent. This is the same choice 033/068/069's compute_tier2_flag
-- makes when reading this very view.

CREATE OR REPLACE FUNCTION guard_po_line_quantity_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project_id UUID;
  v_po_status  TEXT;
  v_planned    NUMERIC;
  v_ordered    NUMERIC;
  v_name       TEXT;
  v_attempted  NUMERIC;
BEGIN
  -- Free-text lines carry no catalog link, so there is no plan to compare them
  -- against. Design §3: no baseline → unknown, never blocks. Unmeasured
  -- over-orders are where the worst overages hide, but a quantity we cannot
  -- compare must not be fabricated into a block.
  IF NEW.material_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- An edit that cannot increase this material's cumulative is never an
  -- over-order, so it is never judged. Without this, a line that was ALREADY
  -- over plan when 088 landed could not even be CORRECTED DOWNWARD — the gate
  -- would read the pre-existing overage and refuse the very write that fixes
  -- it, locking the overage in place. That is the opposite of §7's promise that
  -- no existing PO is invalidated. Scoped tightly: same PO, same material, and
  -- the quantity not rising, so no new exposure can hide in it.
  IF TG_OP = 'UPDATE'
     AND NEW.po_id IS NOT DISTINCT FROM OLD.po_id
     AND NEW.material_id IS NOT DISTINCT FROM OLD.material_id
     AND NEW.quantity <= OLD.quantity THEN
    RETURN NULL;
  END IF;

  SELECT po.project_id, po.status
    INTO v_project_id, v_po_status
  FROM purchase_orders po
  WHERE po.id = NEW.po_id;

  -- A CANCELLED PO contributes nothing to total_ordered (068), so its lines
  -- cannot push anything past the plan — editing one is not an over-order.
  IF v_project_id IS NULL OR v_po_status = 'CANCELLED' THEN
    RETURN NULL;
  END IF;

  SELECT env.total_planned, env.total_ordered, env.material_name
    INTO v_planned, v_ordered, v_name
  FROM v_material_envelope_status env
  WHERE env.project_id = v_project_id
    AND env.material_id = NEW.material_id;

  -- No envelope row, or no published plan → UNMEASURED, never blocked.
  IF v_planned IS NULL OR v_planned <= 0 THEN
    RETURN NULL;
  END IF;

  -- total_ordered already includes this row (AFTER), so this IS
  -- existing_non_cancelled_PO_qty + this_line_qty <= current_planned.
  IF v_ordered <= v_planned THEN
    RETURN NULL;
  END IF;

  -- This PO's own attempt for this material — the figure the principal
  -- authorised at escalation (buildOverridePayload writes the same aggregate).
  SELECT COALESCE(SUM(pol.quantity), 0)
    INTO v_attempted
  FROM purchase_order_lines pol
  WHERE pol.po_id = NEW.po_id
    AND pol.material_id = NEW.material_id;

  -- The override contract, identical to 071's: a principal-decided po_qty_gate
  -- task for THIS project whose payload authorises at least this attempt. A
  -- missing, HOLD, REJECT or too-small task leaves the breach uncovered.
  IF EXISTS (
    SELECT 1
    FROM approval_tasks t
    WHERE t.project_id = v_project_id
      AND t.entity_type = 'po_qty_gate'
      AND t.action IN ('APPROVE', 'OVERRIDE')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(t.override_payload, '[]'::JSONB)) AS e
        WHERE (e->>'material_id')::UUID = NEW.material_id
          AND (e->>'attempted_qty')::NUMERIC >= v_attempted
      )
  ) THEN
    RETURN NULL;
  END IF;

  -- Same 'PO_QTY_BREACH:' prefix 071 raises, because Gate2Screen already
  -- branches on it — a direct-REST block must read as the same refusal, not as
  -- an unknown crash. Figures are reported, never derived: planned, the
  -- post-write cumulative, and this PO's attempt.
  RAISE EXCEPTION 'PO_QTY_BREACH: melebihi alokasi — % (rencana %, total di-PO %, PO ini %)',
    COALESCE(v_name, 'material'),
    round(v_planned, 3), round(v_ordered, 3), round(v_attempted, 3)
    USING HINT = 'Eskalasi ke prinsipal untuk override kuantitas, lalu buat ulang PO dengan task yang disetujui.';
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_lines_qty_gate_trg ON purchase_order_lines;
CREATE TRIGGER purchase_order_lines_qty_gate_trg
  AFTER INSERT OR UPDATE OF quantity, material_id, po_id
  ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION guard_po_line_quantity_gate();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. §5.4 — notifications.type admits RETURNED
-- ═══════════════════════════════════════════════════════════════════════════
-- Widened BY SHAPE, the 067/078/079 pattern: the type CHECK is the only CHECK
-- constraint on notifications, so matching '%type%' finds exactly it whatever
-- name it currently carries. Strict superset of 079's live list — nothing
-- dropped, and re-paste-safe (the re-added constraint still matches the shape
-- next run and is dropped + re-added identically).
--
-- This MUST land before section 9's branch. The enqueue there is wrapped in the
-- 034/067 never-block handler, so a type the CHECK rejects does not raise — it
-- logs a WARNING nobody reads and the estimator is never told. A notification
-- that silently does not exist is worse than none, because the screen and the
-- audit trail both imply it was sent.

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
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE',
      'RETURNED'
    ));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. §5.4 — notify_header_status_change emits on RETURNED, to the estimator
-- ═══════════════════════════════════════════════════════════════════════════
-- Body is 085:165-267 VERBATIM (the live definition) plus the RETURNED branch.
-- Everything 085 added is deliberately reproduced rather than re-derived: the
-- mr_request_summary subject line, the reviewer name, the flagged-lines subject
-- for AUTO_HOLD, and the admin-targeted REQUEST_APPROVED_FOR_PO handoff 067
-- added. Dropping any of them here would revert the bodies to 067's generic
-- "Request material ditolak." with no visible error anywhere.
--
-- Two mechanical changes make the single enqueue serve four types instead of
-- three, without touching the behaviour of the existing three:
--   • v_target (p_target_role, 066) — NULL for AUTO_HOLD / APPROVED / REJECTED,
--     which is exactly what 085's 8-arg call passed by default, so their
--     all-members fan-out is unchanged. 'estimator' for RETURNED.
--   • v_params (p_deeplink_params) — jsonb_build_object('headerId', NEW.id) for
--     the existing three, byte-identical to 085; the RETURNED case adds the
--     reason so a client can render it without a second round trip.
--
-- Why the estimator and not everyone: a return is a handoff, not an
-- announcement. It names the one role that must act next — the same reasoning
-- 067 used to target the admin on APPROVED and the estimator on INSERT.
--
-- Why the reason is carried, not just referenced: "your request was returned"
-- with no cause forces the estimator to open the screen to learn anything at
-- all, which is the polling behaviour §2.5 abolishes. The body is capped
-- because the in-app list clamps to 2 lines (085's header,
-- NotificationList.tsx) and push banners truncate anyway — an over-long reason
-- is cut with an explicit ellipsis, never quietly, and the full text stays on
-- the request and in the payload.
--
-- 034's AFTER UPDATE OF overall_status trigger already points at this function
-- name and fires for ANY status change, so no trigger re-create is needed. It
-- runs AFTER section 5's BEFORE guard, which is what stamps returned_by — so
-- the author read below is the server-authoritative one, never a client claim.

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. §5.5 — a RETURNED request is still open demand (compute_tier2_flag)
-- ═══════════════════════════════════════════════════════════════════════════
-- Body is 073:328-395 VERBATIM — 073, NOT 069, is the live definition: 073
-- (Task 2.9) superseded 069's body by excluding CANCELLED POs from the
-- fulfilled-line subquery. Rebuilding from 069 would silently revert that fix
-- on a live gate input. The ONE change here is 'RETURNED' joining the "other
-- open requests" whitelist. Signature unchanged, so 056's dispatch_line_flag
-- keeps resolving it and needs no re-create.
--
-- Why: 072's v_material_envelope_status.total_requested already counts a
-- returned request (it excludes only REJECTED). Leaving 069's whitelist as it
-- was would let the SAME request read as demand on the envelope screen and as
-- nothing here — one of the two numbers would be lying to the estimator, and
-- there is no way to tell which from the screen.
--
-- This changes NO gate. 069 capped every band at WARNING and that cap is
-- reproduced untouched below; the hard control is §5.3's PO-time trigger. The
-- only effect is that a heads-up appears slightly earlier for a material with a
-- returned request outstanding — which is the honest reading of the state.
--
-- TS TWIN (069's lockstep list, unchanged): gate1.ts
-- buildProjectEnvelopeOverageResult + PermintaanScreen buildTier2Result. Those
-- read the envelope view, which already counts RETURNED, so this migration
-- moves the SQL half INTO agreement with the TS half rather than away from it.

CREATE OR REPLACE FUNCTION compute_tier2_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_planned NUMERIC;
  v_po_ordered    NUMERIC;
  v_other_open    NUMERIC;
  v_burn_pct      NUMERIC;
BEGIN
  -- NULL material → OK (033 behavior preserved). CAVEAT: a direct REST insert
  -- with tier=2 and material_id NULL slips the gate; the app never does this
  -- (Tier-2 requires a catalog material), and free-text lines get INFO client-side.
  IF p_material_id IS NULL THEN
    RETURN 'OK';
  END IF;

  SELECT total_planned, total_ordered
    INTO v_total_planned, v_po_ordered
  FROM v_material_envelope_status
  WHERE project_id = p_project_id AND material_id = p_material_id;

  -- No envelope built yet (no boq link via ahs) → no baseline → INFO.
  IF v_total_planned IS NULL OR v_total_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  -- Other open requests (069's header definition, WIDENED by 088 §5.5 to
  -- include RETURNED — live work parked with the estimator, exactly like
  -- PENDING, and already counted as demand by v_material_envelope_status.
  -- total_requested since 072). Equivalently: everything NOT REJECTED.
  -- Other open requests (see header definition): non-rejected request lines for
  -- this material, excluding lines already fulfilled by a NON-CANCELLED PO. A
  -- line linked to a later-CANCELLED PO is NOT fulfilled — it returns to the burn
  -- (073's Task 2.9 lockstep fix, PRESERVED here verbatim). CLOSED_SHORT stays
  -- excluded (genuinely ordered). The current line self-excludes at BEFORE INSERT
  -- (not yet in the table).
  --
  -- 088's ONLY change to this body is 'RETURNED' in the status list below (§5.5):
  -- a returned request is still open work parked with the estimator. Dropping the
  -- CANCELLED join here would silently revert 073 on a live gate input and would
  -- also put this function out of lockstep with v_material_envelope_status (which
  -- excludes CANCELLED) and with 088's own PO gate.
  SELECT COALESCE(SUM(mrl.quantity), 0)
    INTO v_other_open
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = p_project_id
    AND mrl.material_id = p_material_id
    AND mrh.overall_status IN ('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'APPROVED', 'RETURNED')
    AND mrl.id NOT IN (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id IS NOT NULL
        AND po.status <> 'CANCELLED'
    );

  v_burn_pct := ((COALESCE(v_po_ordered, 0) + v_other_open + p_requested_qty) / v_total_planned) * 100;

  -- WARNING cap (Task 2.4, 069 — unchanged here). Pre-069: > 120 CRITICAL,
  -- > 100 HIGH, > 80 WARNING, > 50 INFO, else OK. Post-069: > 80 WARNING,
  -- > 50 INFO, else OK. 088 changes the INPUT, never the bands.
  IF v_burn_pct > 80 THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50 THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (run after pasting; spec §8 — under the AUTHENTICATED role for
-- each of the four roles, NEVER the service role, which bypasses RLS entirely
-- and would pass against a completely open policy set — the failure that hid
-- the material_aliases gap until migration 040)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- 1. No blanket office write remains on either PO table.
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE tablename IN ('purchase_orders', 'purchase_order_lines')
--   ORDER BY tablename, policyname;
--   -- expect: NO row named %_office_all; writes only via *_writer_all /
--   -- *_office_insert / *_office_update, all keyed to admin+principal.
--
--   -- 2. Both triggers are installed.
--   SELECT tgname, tgrelid::regclass
--   FROM pg_trigger
--   WHERE tgname IN ('material_request_headers_status_guard_trg',
--                    'purchase_order_lines_qty_gate_trg');
--
--   -- 3. RETURNED is legal on the header.
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'material_request_headers_overall_status_check';
--
--   -- 4. Nothing was invalidated (§7 grandfathering): every pre-existing PO
--   --    line still reads back, including any that already exceeds its plan.
--   SELECT COUNT(*) FROM purchase_order_lines;
--
--   -- 5. §5.4 — RETURNED is a legal notification type. If this returns a
--   --    definition WITHOUT 'RETURNED', section 9's enqueue is being dropped
--   --    silently by the never-block wrapper and no estimator is ever told.
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.notifications'::regclass AND contype = 'c';
--
--   -- 6. §5.4 end-to-end, on a REAL returned request (replace the id): exactly
--   --    one row, type RETURNED, and every recipient an estimator.
--   SELECT n.type, n.title, n.body, n.deeplink_params, p.role
--   FROM notifications n JOIN profiles p ON p.id = n.recipient_user_id
--   WHERE n.related_entity_id = '<header uuid>' AND n.type = 'RETURNED';
--   -- expect: role = 'estimator' on every row; body naming the admin + reason;
--   -- deeplink_params carrying headerId AND returnedReason.
--
--   -- 7. §5.5 — the two advisory surfaces now agree that a returned request is
--   --    open demand. Run with a project + material that has one outstanding.
--   SELECT compute_tier2_flag('<material uuid>', '<project uuid>', 0) AS tier2_flag,
--          total_planned, total_requested, total_ordered
--   FROM v_material_envelope_status
--   WHERE project_id = '<project uuid>' AND material_id = '<material uuid>';
--   -- expect: total_requested already includes the RETURNED lines (072) and the
--   -- flag is now computed from the same demand — never one counting it and the
--   -- other not. Still capped at WARNING: §5.5 changes no gate.
--
-- The behavioural matrix (all four roles × every §5.2 transition, the §5.3
-- arithmetic, and supervisor receiving) is enumerated as it.todo entries in
-- tools/__tests__/migration088.test.ts — un-skip that block once this migration
-- is live.
