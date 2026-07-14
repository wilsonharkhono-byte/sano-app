-- 060 — Role-gate purchase_orders headers + approval_tasks writes; convert
--        submit_receipt to SECURITY DEFINER with compensating internal guards
--        (Task 0.4, Phase 0 security hardening — HIGH/MED)
--
-- REQUIRES migrations 001 (base policies), 002 (office PO insert/update), 036
--   (is_office_role / is_office_manager + purchase_orders_office_all), 043
--   (approval_tasks RLS) and 055 (current submit_receipt). Apply after all of
--   them.
--
-- ── The two holes this closes ──────────────────────────────────────────────
--   H1  purchase_orders_assigned (001:445-448) is FOR ALL for ANY assigned
--       user, so a site supervisor can INSERT / UPDATE / DELETE PO headers
--       straight through PostgREST. submit_receipt (055, SECURITY INVOKER)
--       currently RELIES on this hole to flip purchase_orders.status as the
--       calling supervisor.
--   H2  approval_tasks_assigned (created by 043's loop, FOR ALL, assignment-
--       scoped) lets a supervisor write the principal's Gate-2 verdict
--       (action = APPROVE/REJECT/HOLD/OVERRIDE) via REST — audit gap G5.
--
-- ── The fix, in three parts ────────────────────────────────────────────────
--   1. submit_receipt → SECURITY DEFINER so the status flip no longer needs a
--      table-level PO write grant for the supervisor. Because a definer
--      function bypasses RLS on EVERY statement inside it, the function now
--      enforces, in code, exactly what RLS used to enforce at the table:
--        • caller must be assigned to the PO's project OR be an office role;
--        • p_received_by must equal auth.uid() (anti-spoofing);
--        • p_project_id must equal the PO's real project_id (data integrity —
--          also fixes the known audit finding where a mismatched p_project_id
--          wrote a receipt whose project scoping diverged from its PO).
--      auth.uid() IS NULL (service-role key / Dashboard SQL editor) is let
--      through the ACTOR checks, consistent with 057/059's house style; the
--      p_project_id data-integrity check still applies to everyone.
--   2. purchase_orders — drop the 001 FOR ALL hole, replace with a SELECT-only
--      policy. Office write coverage already exists (002's office insert/update
--      + 036's purchase_orders_office_all), so no new write policy is added.
--      End state: supervisors READ; office WRITES; supervisor receiving works
--      ONLY through the definer RPC above.
--   3. approval_tasks — drop BOTH of 043's FOR ALL policies for THIS table only
--      (approval_tasks_assigned AND approval_tasks_office_all) and replace with
--      three granular policies: SELECT = assigned; INSERT = office AND assigned
--      (estimator/admin escalate — a future task will also have estimators
--      insert PLAN_CEILING_RAISE tasks, which this covers); UPDATE = principal
--      AND assigned (the verdict). office_all MUST go too: if it stayed, an
--      estimator (an office role) would keep FOR ALL and could still write the
--      verdict, defeating the principal-only intent. The other six tables in
--      043's loop are left completely untouched.
--
-- Idempotent / re-paste-safe throughout: CREATE OR REPLACE FUNCTION, and every
--   policy is DROP POLICY IF EXISTS ... CREATE POLICY. Safe to paste into the
--   Supabase Dashboard SQL editor more than once (the project's migration path).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. submit_receipt → SECURITY DEFINER + compensating in-function guards
-- ═══════════════════════════════════════════════════════════════════════════
-- Body is byte-for-byte the 055 definition (same 14-arg signature, so no new
-- overload is introduced and no DROP is required — 055 already dropped the
-- stale 13-arg 045 overload). The ONLY changes vs 055 are:
--   • SECURITY INVOKER  → SECURITY DEFINER
--   • + SET search_path = public   (mandatory hardening for a definer function)
--   • the FOR UPDATE select now also reads project_id into v_po_project_id
--   • the guard block after that select
-- Everything from "-- 1. Receipt header" onward is identical to 055.

CREATE OR REPLACE FUNCTION submit_receipt(
  p_po_id              UUID,
  p_project_id         UUID,
  p_received_by        UUID,
  p_vehicle_ref        TEXT,
  p_gate3_flag         TEXT,
  p_gate3_details      JSONB,
  p_notes              TEXT,
  p_line_material_name TEXT,
  p_line_quantity      NUMERIC,
  p_line_unit          TEXT,
  p_photos             JSONB,
  p_new_po_status      TEXT,   -- DEPRECATED as of 055: ignored. Kept so pre-055
                               -- app builds keep calling successfully; the
                               -- server now computes status authoritatively.
  p_activity_label     TEXT,
  p_line_material_id   UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id     UUID;
  v_po_qty         NUMERIC;
  v_po_project_id  UUID;
  v_total_received NUMERIC;
  v_new_status     TEXT;
BEGIN
  -- Lock the PO row up front to serialize concurrent receipts against the same
  -- PO (two supervisors receiving at once would otherwise each read a stale
  -- total and both write PARTIAL/FULLY based on client-computed math). We now
  -- also read project_id here — it is the authoritative scope for the guards.
  SELECT quantity, project_id
    INTO v_po_qty, v_po_project_id
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  -- ── Compensating guards (this function is now SECURITY DEFINER and bypasses
  --    RLS, so it must enforce what the dropped PO FOR ALL policy used to) ────

  -- PO must exist. purchase_orders.project_id is NOT NULL (001:188), so a NULL
  -- here means the FOR UPDATE select matched no row.
  IF v_po_project_id IS NULL THEN
    RAISE EXCEPTION 'submit_receipt: purchase order % not found', p_po_id;
  END IF;

  -- Data integrity: the caller-supplied p_project_id must be the PO's real
  -- project. Applies to every caller (service-role included) — a receipt whose
  -- project scoping diverges from its PO is always wrong. Legitimate callers
  -- (TerimaScreen) always pass the PO's own project, so this never fires for
  -- them.
  IF p_project_id IS DISTINCT FROM v_po_project_id THEN
    RAISE EXCEPTION
      'submit_receipt: p_project_id % does not match purchase order project %',
      p_project_id, v_po_project_id;
  END IF;

  -- Actor checks — skipped only for the trusted no-JWT contexts (service-role
  -- key / Dashboard SQL editor), mirroring 057/059. When there IS a JWT:
  IF auth.uid() IS NOT NULL THEN
    -- Anti-spoofing: the recorded receiver must be the caller.
    IF p_received_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'submit_receipt: p_received_by must equal the calling user';
    END IF;

    -- Authorization: caller must be assigned to the PO's project OR be an
    -- office role (admin/principal/estimator). This is exactly what the old
    -- purchase_orders_assigned / office policies granted before this migration.
    IF NOT is_office_role()
       AND NOT EXISTS (
         SELECT 1 FROM project_assignments
         WHERE project_id = v_po_project_id
           AND user_id = auth.uid()
       ) THEN
      RAISE EXCEPTION
        'submit_receipt: caller is not assigned to project % and is not an office role',
        v_po_project_id;
    END IF;
  END IF;

  -- 1. Receipt header
  INSERT INTO receipts (
    po_id, project_id, received_by, vehicle_ref, gate3_flag, gate3_details, notes
  )
  VALUES (
    p_po_id, p_project_id, p_received_by, p_vehicle_ref,
    COALESCE(p_gate3_flag, 'OK'), p_gate3_details, p_notes
  )
  RETURNING id INTO v_receipt_id;

  -- 2. Receipt line (single) — now carries the catalog material_id link.
  INSERT INTO receipt_lines (receipt_id, material_id, material_name, quantity_actual, unit)
  VALUES (v_receipt_id, p_line_material_id, p_line_material_name, p_line_quantity, p_line_unit);

  -- 3. Receipt photos (one row per element)
  IF p_photos IS NOT NULL AND jsonb_array_length(p_photos) > 0 THEN
    INSERT INTO receipt_photos (receipt_id, photo_type, storage_path, gps_lat, gps_lon)
    SELECT
      v_receipt_id,
      ph->>'photo_type',
      ph->>'storage_path',
      (ph->>'gps_lat')::NUMERIC,
      (ph->>'gps_lon')::NUMERIC
    FROM jsonb_array_elements(p_photos) AS ph;
  END IF;

  -- 4. Server-authoritative PO status.
  --    Total received = SUM over ALL receipt_lines of this PO's receipts (the
  --    line just inserted is included) PLUS the legacy material_receipts rows.
  --    TerimaScreen's on-screen history counts BOTH tables, so the server math
  --    must too or the badge would disagree with the user's own view.
  SELECT
    COALESCE((
      SELECT SUM(rl.quantity_actual)
      FROM receipt_lines rl
      JOIN receipts r ON r.id = rl.receipt_id
      WHERE r.po_id = p_po_id
    ), 0)
    + COALESCE((
      SELECT SUM(mr.quantity_actual)
      FROM material_receipts mr
      WHERE mr.po_id = p_po_id
    ), 0)
  INTO v_total_received;

  v_new_status := CASE
    WHEN v_po_qty IS NOT NULL AND v_total_received >= v_po_qty THEN 'FULLY_RECEIVED'
    ELSE 'PARTIAL_RECEIVED'
  END;

  UPDATE purchase_orders
  SET status = v_new_status
  WHERE id = p_po_id;

  -- 5. Activity log
  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES (p_project_id, p_received_by, 'terima', p_activity_label, COALESCE(p_gate3_flag, 'OK'));

  RETURN v_receipt_id;
END;
$$;

-- A SECURITY DEFINER function is created with an implicit EXECUTE grant to
-- PUBLIC; revoke it so anon can never invoke it as the (superuser) owner, then
-- re-grant to authenticated only. Full 14-type arg list so the re-paste target
-- is unambiguous (mirrors 055's overload-safety care).
REVOKE EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID
) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. purchase_orders — supervisors read-only; office keeps full write
-- ═══════════════════════════════════════════════════════════════════════════
-- Drop the 001 FOR ALL hole and replace with SELECT only, using 001's exact
-- assignment subquery. Office writes are already covered elsewhere and are left
-- in place:
--   • 002 purchase_orders_office_insert  (FOR INSERT, assigned + office role)
--   • 002 purchase_orders_office_update  (FOR UPDATE, assigned + office role)
--   • 036 purchase_orders_office_all     (FOR ALL,   is_office_role())
-- so create_purchase_order (055, SECURITY INVOKER, called by admin/estimator)
-- still passes its INSERT here (office_all / office_insert), and its inserts
-- into purchase_order_lines / price_history / activity_log are all covered by
-- 036's office_all on those tables. After this migration a supervisor has NO
-- write policy on purchase_orders — only the SELECT below — and reaches status
-- updates solely through the definer submit_receipt.

DROP POLICY IF EXISTS "purchase_orders_assigned" ON purchase_orders;

DROP POLICY IF EXISTS "po_read_assigned" ON purchase_orders;
CREATE POLICY "po_read_assigned" ON purchase_orders
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. is_principal() — role helper (admin is NOT included: the verdict is the
--    principal's alone). Mirrors 036's is_office_role / is_office_manager
--    shape: SECURITY DEFINER + fixed search_path so it reads profiles reliably
--    regardless of the caller's RLS on that table.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_principal()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'principal'
  );
$$;
GRANT EXECUTE ON FUNCTION is_principal() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. approval_tasks — assigned+office read; office+assigned insert;
--    principal+assigned update. Replaces BOTH of 043's FOR ALL policies for
--    this table only.
-- ═══════════════════════════════════════════════════════════════════════════
-- 043's loop created two FOR ALL policies for approval_tasks:
--   approval_tasks_assigned    (assignment-scoped) — the supervisor hole (G5)
--   approval_tasks_office_all  (is_office_role())  — would still let an
--                                                    estimator write the verdict
-- Both are dropped; the six sibling tables in that loop are untouched. The
-- replacement matches the app's real writers (Gate2Screen.tsx):
--   • :195 SELECT — principal reads pending tasks           → approval_tasks_read
--                   (assigned only)
--   • :195 SELECT — office users read cross-project tasks  → approval_tasks_office_read
--                   (for reports/scoring on unassigned projects, matches 036
--                   office-global model)
--   • :529 INSERT — admin/estimator escalate to principal   → approval_tasks_office_insert
--   • :547 UPDATE — principal records APPROVE/REJECT/etc.    → approval_tasks_principal_update
-- The UI already renders the verdict buttons principal-only (Gate2Screen:193);
-- this makes the server agree, closing G5 (a supervisor PATCHing action=APPROVE
-- via REST is now denied — no UPDATE policy applies to them).

DROP POLICY IF EXISTS "approval_tasks_assigned" ON approval_tasks;
DROP POLICY IF EXISTS "approval_tasks_office_all" ON approval_tasks;

DROP POLICY IF EXISTS "approval_tasks_read" ON approval_tasks;
CREATE POLICY "approval_tasks_read" ON approval_tasks
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

-- Office-global read restored (matches 036's office model, used by reports/scoring
-- on unassigned projects); WRITE stays narrowed (INSERT office+assigned, UPDATE
-- principal-only).
DROP POLICY IF EXISTS "approval_tasks_office_read" ON approval_tasks;
CREATE POLICY "approval_tasks_office_read" ON approval_tasks
  FOR SELECT
  TO authenticated
  USING (is_office_role());

-- SUPERSEDED BY 071: 071 re-creates this policy with the verdict columns
-- pinned (AND action IS NULL AND acted_at IS NULL) so an APPROVE can only
-- arrive via the principal-only UPDATE path. If you re-paste 060, re-paste
-- 071 after it — this unpinned version alone reopens the override-forge path.
DROP POLICY IF EXISTS "approval_tasks_office_insert" ON approval_tasks;
CREATE POLICY "approval_tasks_office_insert" ON approval_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_office_role()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "approval_tasks_principal_update" ON approval_tasks;
CREATE POLICY "approval_tasks_principal_update" ON approval_tasks
  FOR UPDATE
  TO authenticated
  USING (
    is_principal()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_principal()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
