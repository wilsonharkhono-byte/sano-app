-- 072 — PO lifecycle: honor "Terima Final" (short-close), admin cancel, and the
--       per-line CLOSED_SHORT envelope fix (Task 2.7, HIGH)
--
-- Paste order: AFTER 071 (latest applied migration). Apply via the Dashboard SQL
--   Editor (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe throughout (find-by-shape CHECK swap, DROP exact signature +
--   CREATE OR REPLACE, CREATE OR REPLACE VIEW, CREATE OR REPLACE FUNCTION).
--
-- ── The three holes this closes ────────────────────────────────────────────
--   1. "Terima Final" is silently broken since 055/070. submit_receipt_lines
--      (070:248-251) computes PARTIAL_RECEIVED whenever total < PO qty and
--      IGNORES whether the supervisor declared the delivery final. A short
--      delivery therefore stays PARTIAL_RECEIVED forever: the receive form never
--      closes and every dashboard counts it as an open delivery
--      (BerandaScreen/LaporanScreen: open = OPEN || PARTIAL_RECEIVED).
--      FIX: add p_is_final. total ≥ qty → FULLY_RECEIVED; else if p_is_final →
--      CLOSED_SHORT (terminal); else PARTIAL_RECEIVED (unchanged).
--
--   2. No cancel path. CANCELLED has been in the purchase_orders CHECK since 001
--      but never had a writer, and the TS POStatus carried an un-storable 'CLOSED'.
--      FIX: cancel_purchase_order RPC (office-only), writes CANCELLED + an
--      activity_log row, ONLY for an OPEN, receipt-free PO.
--
--   3. v_material_envelope_status's CLOSED_SHORT arm (068:85-99) caps a line's
--      ordered contribution at LEAST(pol.quantity, PER-PO received). For a
--      multi-line short-closed PO that over-counts: every line is capped by the
--      WHOLE PO's received total instead of its own. The 2.3 reviewer flagged
--      this; it MUST be fixed to per-line attribution BEFORE CLOSED_SHORT gets a
--      writer here (this migration). FIX below.
--
-- ── CLOSED_SHORT is terminal (v1) ──────────────────────────────────────────
--   There is NO reopen path in v1. Once a PO is CLOSED_SHORT or CANCELLED it
--   leaves the receivable list and stays out of every open-PO count. A future
--   migration owns reopen semantics if the business needs them.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Widen purchase_orders.status CHECK to add 'CLOSED_SHORT'.
--    Find the constraint BY SHAPE (001 named it purchase_orders_status_check, but
--    resolve it by definition so a differently-named remote constraint is still
--    caught — 047/065 pattern). Superset preserves all existing values.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.purchase_orders'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    AND pg_get_constraintdef(con.oid) ILIKE '%OPEN%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.purchase_orders DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.purchase_orders
    ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('OPEN', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED', 'CLOSED_SHORT'));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. submit_receipt_lines gains p_is_final BOOLEAN DEFAULT FALSE (LAST).
--    Overload hygiene (071 pattern): adding a param changes the signature
--    (11 args → 12), so a bare CREATE OR REPLACE would leave BOTH overloads
--    installed and a positional call could route to the stale one. DROP the exact
--    070 11-arg signature FIRST, then CREATE OR REPLACE the 12-arg version, then
--    re-REVOKE/GRANT the exact 12-type list. Re-paste-safe: the DROP is a no-op on
--    the second paste (11-arg signature already gone) and CREATE OR REPLACE on the
--    12-arg is idempotent.
--
--    Everything OTHER than the status CASE is copied BYTE-FAITHFULLY from 070:
--    the FOR UPDATE lock, the 060 compensating guards, the PO-scoped idempotency
--    short-circuit, the cross-PO po_line_id validation, the receipt/lines/photos
--    inserts and the total-received SUM. ONLY the status recompute learns the
--    final flag.
--
--    The legacy 15-arg submit_receipt (062) is DELIBERATELY LEFT UNTOUCHED —
--    deployed builds still call it and it never learned a final flag.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
);

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
  p_client_receipt_id UUID DEFAULT NULL,   -- idempotency key (Task 1.2); NULL =
                                           -- legacy non-idempotent behavior.
  p_is_final          BOOLEAN DEFAULT FALSE -- Task 2.7: "Terima Final" — a short
                                            -- delivery is short-closed, not left
                                            -- PARTIAL. Ignored when total ≥ qty.
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
  --    exactly what the table policies would; identical to 060/062/070) ────────

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

  -- ── Idempotency short-circuit (Task 1.2) — PO-scoped, same as 062/070 ──────
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
  -- attribution must fail loud. Lines with no po_line_id are allowed (NULL).
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
  --    po_line_id + material_id (base units).
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

  -- 3. Receipt photos (one row per element) — identical to 062/070.
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

  -- 4. Server-authoritative PO status. Same total-received SUM as 070 (all of
  --    this PO's receipt_lines + legacy material_receipts). The ONLY change vs
  --    070: a short delivery declared final becomes CLOSED_SHORT (terminal)
  --    instead of PARTIAL_RECEIVED. A full/over delivery is always FULLY_RECEIVED
  --    regardless of the flag.
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
    WHEN p_is_final THEN 'CLOSED_SHORT'
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

-- Re-REVOKE/GRANT the EXACT 12-type signature (a SECURITY DEFINER function is
-- created with an implicit EXECUTE grant to PUBLIC).
REVOKE EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID, BOOLEAN
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID, BOOLEAN
) FROM anon;
GRANT EXECUTE ON FUNCTION submit_receipt_lines(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, JSONB, TEXT, UUID, BOOLEAN
) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. v_material_envelope_status — per-LINE CLOSED_SHORT attribution.
--    Body copied from 068 verbatim EXCEPT the CLOSED_SHORT received sub-select,
--    which is now correlated to THIS line rather than the whole PO.
--
--    Per-line received for pol =
--        SUM(rl.quantity_actual) over this PO's receipt_lines WHERE
--          rl.po_line_id = pol.id                              (exact line link, 070+)
--        OR (rl.po_line_id IS NULL AND rl.material_id = pol.material_id)  (fallback)
--
--    Fallback + its documented limits: a receipt line with NO po_line_id (a
--    legacy 062 single-line receive, or a header-only synthesis) is attributed
--    by material within the PO. That is exact when each material appears on ONE
--    PO line (the norm). Two PO lines sharing a material_id would each pick up the
--    same NULL-po_line_id legacy quantity (double count), and a legacy line whose
--    material_id matches no PO line is attributed to none. Both are bounded edge
--    cases: CLOSED_SHORT only exists post-072, and any short-close done through
--    submit_receipt_lines (070+) stamps po_line_id, so the fallback fires only for
--    receipts taken via the deprecated 062 path before the short-close.
--
--    ⚠ security_invoker (MANDATORY): 061 flipped this view to security_invoker;
--    CREATE OR REPLACE VIEW RESETS reloptions, so the flag MUST be restated here
--    or the cross-tenant leak 061 closed silently reopens. Restated below.
--    Column name/type/ORDER is byte-identical to 068 (CREATE OR REPLACE VIEW
--    forbids changing them; consumers may read positionally).
--
--    Ripple check (071's create_purchase_order reads total_ordered): the per-line
--    cap is ≤ the old per-PO cap, so remaining = planned − ordered only ever grows
--    (more accurate, never a spurious block). No signature or semantics change to
--    the gate — it keys off the same total_ordered column.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_material_envelope_status
WITH (security_invoker = on) AS
SELECT
  env.material_id,
  env.project_id,
  env.material_code,
  env.material_name,
  env.tier,
  env.unit,
  env.total_planned,
  env.boq_item_count,
  COALESCE(ordered.total_ordered, 0) AS total_ordered,
  COALESCE(received.total_received, 0) AS total_received,
  env.total_planned - COALESCE(ordered.total_ordered, 0) AS remaining_to_order,
  CASE
    WHEN env.total_planned > 0
    THEN ROUND((COALESCE(ordered.total_ordered, 0) / env.total_planned) * 100, 1)
    ELSE 0
  END AS burn_pct,
  COALESCE(requested.total_requested, 0) AS total_requested
FROM v_material_envelopes env
LEFT JOIN LATERAL (
  -- ORDERED = SANO purchase order lines. CANCELLED POs excluded. For a
  -- CLOSED_SHORT PO the line's ordered contribution is capped at what THAT LINE
  -- actually received (per-line, Task 2.7 — was per-PO in 068), so a short-closed
  -- order stops inflating the total the moment it is short-closed.
  SELECT SUM(
    CASE
      WHEN po.status = 'CLOSED_SHORT' THEN
        LEAST(
          pol.quantity,
          COALESCE((
            SELECT SUM(rl2.quantity_actual)
            FROM receipt_lines rl2
            JOIN receipts r2 ON r2.id = rl2.receipt_id
            WHERE r2.po_id = po.id
              AND (
                rl2.po_line_id = pol.id
                OR (rl2.po_line_id IS NULL AND rl2.material_id = pol.material_id)
              )
          ), 0)
        )
      ELSE pol.quantity
    END
  ) AS total_ordered
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.po_id
  WHERE po.project_id = env.project_id
    AND pol.material_id = env.material_id
    AND po.status <> 'CANCELLED'
) ordered ON true
LEFT JOIN LATERAL (
  -- REQUESTED = non-REJECTED material request lines (068 body, unchanged).
  SELECT SUM(mrl.quantity) AS total_requested
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = env.project_id
    AND mrl.material_id = env.material_id
    AND mrh.overall_status NOT IN ('REJECTED')
) requested ON true
LEFT JOIN LATERAL (
  -- RECEIVED — copied verbatim from 068/055 (id link preferred, name fallback).
  SELECT SUM(rl.quantity_actual) AS total_received
  FROM receipt_lines rl
  JOIN receipts r ON r.id = rl.receipt_id
  JOIN material_catalog mc2 ON mc2.id = env.material_id
  WHERE r.project_id = env.project_id
    AND (
      rl.material_id = env.material_id
      OR (rl.material_id IS NULL AND rl.material_name = mc2.name)
    )
) received ON true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. cancel_purchase_order — office-only admin cancel of an OPEN, receipt-free PO.
--
--    SECURITY INVOKER: office roles already hold FULL write on purchase_orders
--    (036 purchase_orders_office_all / 002 purchase_orders_office_update) and on
--    activity_log (036 office_all), so an invoker cancel composes cleanly under
--    the caller's RLS. An explicit is_office_role() guard is ALSO added so a
--    non-office caller (supervisor — read-only on POs post-060) FAILS LOUD rather
--    than silently updating zero rows under RLS. is_office_role() is SECURITY
--    DEFINER (036) so it reads profiles regardless of the caller's RLS.
--
--    Controller decision: cancel is allowed ONLY when status = 'OPEN' AND the PO
--    has NO receipts. A PO that already has deliveries must be short-closed via a
--    final receive (submit_receipt_lines p_is_final) instead — RAISE otherwise
--    with a clear message. status = 'OPEN' already implies no receipts on the
--    normal path (any receive flips status off OPEN), so the receipt checks are
--    belt-and-suspenders against legacy/partial writes.
--
--    activity_log.type must satisfy 001's CHECK (no 'cancel' value exists) — use
--    'permintaan' (the PO-domain activity type, same as create_purchase_order),
--    flag 'WARNING'. user_id = auth.uid() (the acting office user).
--
--    Idempotent / re-paste-safe: CREATE OR REPLACE FUNCTION (stable signature,
--    no overload) + GRANT re-issued.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cancel_purchase_order(
  p_po_id  UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status     TEXT;
  v_project_id UUID;
BEGIN
  IF NOT is_office_role() THEN
    RAISE EXCEPTION 'cancel_purchase_order: only an office role may cancel a purchase order';
  END IF;

  SELECT status, project_id
    INTO v_status, v_project_id
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'cancel_purchase_order: purchase order % not found', p_po_id;
  END IF;

  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION
      'cancel_purchase_order: only an OPEN purchase order can be cancelled (current status: %). A PO with deliveries can be short-closed via a final receive instead.',
      v_status;
  END IF;

  -- Belt-and-suspenders: an OPEN PO should have no receipts, but reject loudly if
  -- one somehow exists (new receipts table OR the legacy material_receipts).
  IF EXISTS (SELECT 1 FROM receipts WHERE po_id = p_po_id)
     OR EXISTS (SELECT 1 FROM material_receipts WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION
      'cancel_purchase_order: purchase order % already has receipts — short-close it via a final receive instead of cancelling',
      p_po_id;
  END IF;

  UPDATE purchase_orders
  SET status = 'CANCELLED'
  WHERE id = p_po_id;

  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES (
    v_project_id,
    auth.uid(),
    'permintaan',
    format('PO dibatalkan%s',
      CASE WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0
           THEN ': ' || p_reason ELSE '' END),
    'WARNING'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_purchase_order(UUID, TEXT) TO authenticated;
