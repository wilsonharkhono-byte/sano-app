-- 062 — Idempotent submit_receipt: a timeout-then-retry can no longer
--        double-book a delivery (Task 1.2, Phase 1 correctness — HIGH)
--
-- REQUIRES migrations 002 (receipts table), 045/055 (submit_receipt lineage)
--   and 060 (current SECURITY DEFINER submit_receipt with in-function guards).
--   Apply after all of them.
--
-- ── The hole this closes ───────────────────────────────────────────────────
--   submit_receipt (060) has no dedup key. If the network times out AFTER the
--   server committed the receipt but BEFORE the client saw the response, the
--   client's retry runs the whole body a SECOND time: a second receipt row, the
--   quantity counted twice, and the PO possibly flipped to FULLY_RECEIVED on a
--   single physical delivery. The only guard today is the client `submitting`
--   flag, which does not survive a timeout+retry.
--
-- ── The fix, in two parts ──────────────────────────────────────────────────
--   1. receipts.client_receipt_id UUID (nullable) + a UNIQUE index. The client
--      mints ONE id per receive-form session and reuses it across retries, so a
--      retry carries the same id. Nullable + a partial UNIQUE index (WHERE NOT
--      NULL) means legacy rows and legacy callers — which send NULL — are never
--      constrained (many NULLs are allowed); only real idempotency keys are
--      deduped. The index is also the race backstop (see below).
--   2. submit_receipt gains p_client_receipt_id UUID as a trailing DEFAULT NULL
--      param. Adding a 15th parameter creates a NEW overload, so — exactly as
--      055 did when it added p_line_material_id — we DROP the 14-arg signature
--      first, CREATE OR REPLACE the 15-arg version, and re-issue the 060
--      REVOKE PUBLIC/anon + GRANT authenticated against the 15-arg type list.
--      The app calls with NAMED params via PostgREST, so pre-062 callers that
--      omit the new param still resolve through DEFAULT NULL.
--
--      Body is byte-for-byte 060 (SECURITY DEFINER, SET search_path = public,
--      the FOR UPDATE lock that also reads project_id, and all three
--      compensating guards — PO-exists, p_project_id-matches-PO, actor
--      assignment/office with auth.uid() IS NULL pass-through). The ONLY changes
--      vs 060 are:
--        • + trailing p_client_receipt_id UUID DEFAULT NULL parameter
--        • + the idempotency short-circuit after the guards (below)
--        • + client_receipt_id in the receipts INSERT
--
-- ── Why the check-then-insert is race-safe ─────────────────────────────────
--   The PO row is locked FOR UPDATE at the top, which SERIALIZES two concurrent
--   retries carrying the same id against the same PO. Call A takes the lock,
--   finds no existing receipt for the id, inserts (carrying client_receipt_id),
--   updates the PO, commits and releases the lock. Call B — which blocked on
--   that lock — then proceeds; because READ COMMITTED gives each statement a
--   fresh snapshot, B's lookup now SEES A's committed row and RETURNs A's
--   receipt id WITHOUT inserting or recomputing status (A already did both). If
--   two calls ever slipped past the lock (e.g. distinct PO but same id — not a
--   real case, but defensively), the partial UNIQUE index rejects the second
--   INSERT and the transaction rolls back rather than double-booking.
--   p_client_receipt_id IS NULL → the short-circuit is skipped entirely and the
--   original 060 non-idempotent path runs unchanged (legacy callers preserved).
--
-- Idempotent / re-paste-safe throughout: ADD COLUMN IF NOT EXISTS, CREATE
--   UNIQUE INDEX IF NOT EXISTS, DROP FUNCTION IF EXISTS + CREATE OR REPLACE.
--   Safe to paste into the Supabase Dashboard SQL editor more than once.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. receipts.client_receipt_id — the dedup key + its UNIQUE backstop
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS client_receipt_id UUID;

-- Partial UNIQUE index: enforces one receipt per client id, while leaving the
-- many legacy/NULL rows unconstrained (multiple NULLs allowed). This is both
-- the dedup guarantee and the concurrency backstop for the function below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_client_receipt_id
  ON receipts (client_receipt_id)
  WHERE client_receipt_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. submit_receipt — new trailing param + idempotency short-circuit
-- ═══════════════════════════════════════════════════════════════════════════
-- Drop the exact 14-arg 060 signature so the 15-arg version does not install as
-- an ambiguous overload (mirrors 055:165-167).

DROP FUNCTION IF EXISTS submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID
);

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
  p_line_material_id   UUID DEFAULT NULL,
  p_client_receipt_id  UUID DEFAULT NULL   -- idempotency key (Task 1.2); NULL =
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
BEGIN
  -- Lock the PO row up front to serialize concurrent receipts against the same
  -- PO (two supervisors receiving at once would otherwise each read a stale
  -- total and both write PARTIAL/FULLY based on client-computed math). We now
  -- also read project_id here — it is the authoritative scope for the guards.
  -- This same lock is what makes the idempotency check-then-insert below
  -- race-safe: a same-id retry blocks here until the first call commits.
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

  -- ── Idempotency short-circuit (Task 1.2) ───────────────────────────────────
  -- Runs AFTER the guards (so a retry is still authorized) but while the PO row
  -- lock above is held. If a receipt already exists for this client id, the
  -- first call already inserted the row AND recomputed the PO status — return
  -- that receipt id verbatim and do nothing else. See the header for the full
  -- race argument. NULL id → skip entirely (legacy path).
  IF p_client_receipt_id IS NOT NULL THEN
    SELECT id INTO v_receipt_id
    FROM receipts
    WHERE client_receipt_id = p_client_receipt_id;

    IF v_receipt_id IS NOT NULL THEN
      RETURN v_receipt_id;
    END IF;
  END IF;

  -- 1. Receipt header (now stamped with the idempotency key when supplied)
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
-- re-grant to authenticated only. Full 15-type arg list so the re-paste target
-- is unambiguous (mirrors 060's overload-safety care).
REVOKE EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID, UUID
) TO authenticated;
