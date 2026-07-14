-- 070 — Line-grain receiving: receipt lines link to their PO line, and a new
--        submit_receipt_lines RPC receives an N-line PO per line with real
--        per-line material identity + client-side unit conversion (Task 2.5,
--        Phase 2 — HIGH)
--
-- REQUIRES migrations 002 (receipts / receipt_lines / purchase_order_lines),
--   055 (receipt_lines.material_id + server-authoritative status), 060 (the
--   SECURITY DEFINER guard stack) and 062 (idempotency: receipts.client_receipt_id
--   + the PO-scoped short-circuit). Apply after all of them.
--
-- ── The hole this closes ───────────────────────────────────────────────────
--   Gate2Screen writes N-line POs (one purchase_order_lines row per material),
--   but the header collapses them to material_name = 'N item material' and
--   unit = 'mixed' (Gate2Screen.tsx:478-479). TerimaScreen then received ONE
--   line per receipt using that HEADER name/unit (TerimaScreen.tsx:245-247), so
--   for a multi-line PO the received line was "N item material"/'mixed': the
--   catalog lookup failed → material_id NULL → the quantity vanished from
--   v_material_envelope_status.total_received (055's id/name join) and the
--   Material Balance; status math compared mixed units; and a rebar line never
--   got its batang→kg conversion.
--
-- ── The fix, in two parts ──────────────────────────────────────────────────
--   1. receipt_lines.po_line_id — provenance link from a received line back to
--      the exact purchase_order_lines row it settles. Nullable: legacy receipts
--      (and header-only POs with no lines) keep it NULL, which is fine — the
--      envelope/balance joins resolve those via material_id / material_name as
--      before (055). Only NEW line-grain receipts populate it.
--   2. submit_receipt_lines — a COMPANION RPC (NOT a replacement). It takes the
--      header-level params from 062 but swaps the three single-line params
--      (p_line_material_name / p_line_quantity / p_line_unit) and p_line_material_id
--      for one `p_lines JSONB` array of {po_line_id, material_id, material_name,
--      quantity, unit} — all base-unit, converted client-side per line. Body is
--      the 062 guard stack + idempotency + FOR UPDATE, PLUS a cross-PO check
--      (every line's po_line_id must belong to p_po_id — fail loud), then it
--      inserts one receipt_lines row per element and recomputes status exactly
--      as 062 (the SUM naturally includes the new lines). Single-line POs flow
--      through this same path as an array of one.
--
--   The 15-arg submit_receipt from 062 is DELIBERATELY LEFT INTACT — deployed
--   app builds still call it, and a legacy single-line receive is unchanged.
--   ⚠ DEPRECATION: submit_receipt is superseded by submit_receipt_lines. Keep it
--   only until every client build sends line arrays; then drop it in a later
--   migration. Do NOT add features to submit_receipt.
--
-- ── Why the cross-PO line check must fail loud ─────────────────────────────
--   A line whose po_line_id points at ANOTHER PO's line would silently mis-
--   attribute a delivery — the wrong PO line looks fulfilled, the right one
--   still open. Same fail-closed spirit as 062's PO-scoped idempotency lookup:
--   never swallow a mis-scoped write, RAISE so the caller sees it.
--
-- Idempotent / re-paste-safe: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
--   EXISTS, CREATE OR REPLACE FUNCTION (submit_receipt_lines is a brand-new
--   name, so no overload to drop). Safe to paste into the Supabase Dashboard SQL
--   editor more than once.
--
-- ⚠ Paste this migration BEFORE deploying the app build that calls
--   submit_receipt_lines — PostgREST rejects unknown function signatures.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. receipt_lines.po_line_id — provenance link to the settled PO line
-- ═══════════════════════════════════════════════════════════════════════════
-- Column-level REFERENCES only fires when the column is first created, so
-- ADD COLUMN IF NOT EXISTS stays re-runnable.

ALTER TABLE receipt_lines
  ADD COLUMN IF NOT EXISTS po_line_id UUID REFERENCES purchase_order_lines(id);

CREATE INDEX IF NOT EXISTS idx_receipt_lines_po_line
  ON receipt_lines(po_line_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. submit_receipt_lines — line-grain companion to submit_receipt
-- ═══════════════════════════════════════════════════════════════════════════
-- Same guard stack, idempotency short-circuit and FOR UPDATE lock as 062; the
-- ONLY structural differences are: (a) p_lines JSONB replaces the single-line
-- params, (b) the cross-PO po_line_id validation, and (c) the receipt_lines
-- INSERT fans out over the array. p_new_po_status is intentionally NOT carried
-- over — this RPC only ships to clients that already know status is server-
-- authoritative (055), so there is no legacy flag to preserve.

CREATE OR REPLACE FUNCTION submit_receipt_lines(
  p_po_id             UUID,
  p_project_id        UUID,
  p_received_by       UUID,
  p_vehicle_ref       TEXT,
  p_gate3_flag        TEXT,
  p_gate3_details     JSONB,
  p_notes             TEXT,
  p_lines             JSONB,   -- [{po_line_id, material_id, material_name,
                               --   quantity, unit}], base-unit, client-converted
  p_photos            JSONB,
  p_activity_label    TEXT,
  p_client_receipt_id UUID DEFAULT NULL   -- idempotency key (Task 1.2); NULL =
                                          -- legacy non-idempotent behavior.
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
  v_orphan_line    UUID;
BEGIN
  -- Lock the PO row up front to serialize concurrent receipts against the same
  -- PO and to make the idempotency check-then-insert race-safe (a same-id retry
  -- blocks here until the first call commits). Read project_id for the guards.
  SELECT quantity, project_id
    INTO v_po_qty, v_po_project_id
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  -- ── Compensating guards (SECURITY DEFINER bypasses RLS — enforce in code
  --    exactly what the table policies would; identical to 060/062) ──────────

  IF v_po_project_id IS NULL THEN
    RAISE EXCEPTION 'submit_receipt_lines: purchase order % not found', p_po_id;
  END IF;

  IF p_project_id IS DISTINCT FROM v_po_project_id THEN
    RAISE EXCEPTION
      'submit_receipt_lines: p_project_id % does not match purchase order project %',
      p_project_id, v_po_project_id;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF p_received_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'submit_receipt_lines: p_received_by must equal the calling user';
    END IF;

    IF NOT is_office_role()
       AND NOT EXISTS (
         SELECT 1 FROM project_assignments
         WHERE project_id = v_po_project_id
           AND user_id = auth.uid()
       ) THEN
      RAISE EXCEPTION
        'submit_receipt_lines: caller is not assigned to project % and is not an office role',
        v_po_project_id;
    END IF;
  END IF;

  -- ── Idempotency short-circuit (Task 1.2) — PO-scoped, same as 062 ─────────
  -- A same-id retry against THIS PO returns the already-created receipt without
  -- re-inserting or re-recomputing status. A key replayed against a DIFFERENT
  -- PO falls through and fails loud on the partial UNIQUE index (062) rather
  -- than silently returning a foreign receipt id. NULL id → skip (legacy path).
  IF p_client_receipt_id IS NOT NULL THEN
    SELECT id INTO v_receipt_id
    FROM receipts
    WHERE client_receipt_id = p_client_receipt_id
      AND po_id = p_po_id;

    IF v_receipt_id IS NOT NULL THEN
      RETURN v_receipt_id;
    END IF;
  END IF;

  -- ── Line-array validation ─────────────────────────────────────────────────
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'submit_receipt_lines: p_lines must contain at least one line';
  END IF;

  -- Every supplied po_line_id must belong to THIS PO — cross-PO line
  -- attribution must fail loud (see header). Lines with no po_line_id
  -- (header-only/legacy synthesis) are allowed and stored NULL.
  SELECT NULLIF(elem->>'po_line_id', '')::UUID
    INTO v_orphan_line
  FROM jsonb_array_elements(p_lines) AS elem
  WHERE NULLIF(elem->>'po_line_id', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_lines pol
      WHERE pol.id = NULLIF(elem->>'po_line_id', '')::UUID
        AND pol.po_id = p_po_id
    )
  LIMIT 1;

  IF v_orphan_line IS NOT NULL THEN
    RAISE EXCEPTION
      'submit_receipt_lines: po_line_id % does not belong to purchase order %',
      v_orphan_line, p_po_id;
  END IF;

  -- 1. Receipt header (stamped with the idempotency key when supplied)
  INSERT INTO receipts (
    po_id, project_id, received_by, vehicle_ref, gate3_flag, gate3_details, notes,
    client_receipt_id
  )
  VALUES (
    p_po_id, p_project_id, p_received_by, p_vehicle_ref,
    COALESCE(p_gate3_flag, 'OK'), p_gate3_details, p_notes,
    p_client_receipt_id
  )
  RETURNING id INTO v_receipt_id;

  -- 2. Receipt lines — one row per array element, each carrying its OWN
  --    po_line_id + material_id (base units; the client converted supplier→base
  --    per line). A non-positive quantity would be rejected by
  --    CHECK (quantity_actual > 0) — the client skips zero-qty lines, so only
  --    positive lines arrive here.
  INSERT INTO receipt_lines (
    receipt_id, po_line_id, material_id, material_name, quantity_actual, unit
  )
  SELECT
    v_receipt_id,
    NULLIF(elem->>'po_line_id', '')::UUID,
    NULLIF(elem->>'material_id', '')::UUID,
    elem->>'material_name',
    (elem->>'quantity')::NUMERIC,
    elem->>'unit'
  FROM jsonb_array_elements(p_lines) AS elem;

  -- 3. Receipt photos (one row per element) — identical to 062.
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

  -- 4. Server-authoritative PO status — identical math to 062. The SUM over all
  --    receipt_lines of this PO's receipts naturally includes the lines just
  --    inserted; legacy material_receipts rows are added as before.
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
-- re-grant to authenticated only. Full 11-type arg list so the re-paste target
-- is unambiguous (mirrors 060/062's overload-safety care).
REVOKE EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
) TO authenticated;
