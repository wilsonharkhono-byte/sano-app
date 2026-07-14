-- 055 — Receipt→catalog link, PO→request link, and server-authoritative PO status
--
-- REQUIRES migrations 045 (transactional PO/receipt functions) and 046
--   (receipt_photos FK fix) to have been applied first — this migration
--   CREATE OR REPLACEs the two functions defined in 045.
--
-- ⚠ Apply this migration to Supabase BEFORE deploying the matching app build
--   (same rule as 045). The new `submit_receipt` gains a trailing
--   `p_line_material_id` parameter with a DEFAULT so pre-055 app builds keep
--   calling successfully; the new app build passes it. Deploying the app first
--   against a pre-055 database would still work (server ignores the extra data),
--   but the reconciliation upgrades below only take effect once this is applied.
--
-- What it does:
--   1. receipt_lines.material_id      — link a received line to a catalog row.
--   2. purchase_order_lines.request_line_id — plumbing for a future
--      "convert approved request → PO" flow (nullable, unpopulated today).
--   3. Backfill receipt_lines.material_id by UNAMBIGUOUS case-insensitive name
--      match (catalog has known duplicate names — never guess on ambiguity).
--   4. create_purchase_order — same signature; also stores request_line_id.
--   5. submit_receipt — writes material_id + computes PO status SERVER-SIDE
--      (client-supplied p_new_po_status is now ignored; race-safe via FOR UPDATE).
--   6. v_material_envelope_status — received join prefers the id link, falls
--      back to the legacy name match only when the line has no material_id.
--
-- Re-runnable: all DDL uses IF NOT EXISTS / OR REPLACE; the backfill is guarded
-- by `WHERE material_id IS NULL` so re-runs no-op.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. receipt_lines.material_id — the received-vs-planned join key
--    (Column-level REFERENCES only fires when the column is first created,
--     so ADD COLUMN IF NOT EXISTS stays re-runnable.)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE receipt_lines
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES material_catalog(id);

CREATE INDEX IF NOT EXISTS idx_receipt_lines_material
  ON receipt_lines(material_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. purchase_order_lines.request_line_id — link a PO line to the approved
--    material request line it fulfills. Nullable, unpopulated by current
--    screens; plumbing for a future request→PO conversion flow.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS request_line_id UUID REFERENCES material_request_lines(id);

CREATE INDEX IF NOT EXISTS idx_po_lines_request_line
  ON purchase_order_lines(request_line_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Backfill receipt_lines.material_id
--    Match receipt_lines.material_name (case-insensitive, trimmed) against
--    material_catalog.name, but ONLY where that normalized name resolves to
--    EXACTLY ONE catalog row. The catalog has known duplicate/overlapping
--    names during the transition — a name matching 2+ rows is ambiguous and
--    is deliberately left NULL rather than guessed. Guarded by
--    `material_id IS NULL` so already-linked rows and re-runs are untouched.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE receipt_lines rl
SET material_id = uniq.id
FROM (
  -- HAVING COUNT(*) = 1 guarantees a single row per group; (array_agg(id))[1]
  -- returns that one id. (Postgres has no min()/max() aggregate for uuid.)
  SELECT lower(trim(name)) AS norm_name, (array_agg(id))[1] AS id
  FROM material_catalog
  WHERE name IS NOT NULL AND trim(name) <> ''
  GROUP BY lower(trim(name))
  HAVING COUNT(*) = 1
) uniq
WHERE rl.material_id IS NULL
  AND lower(trim(rl.material_name)) = uniq.norm_name;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. create_purchase_order — SAME signature as 045.
--    Only change: the purchase_order_lines insert also extracts
--    request_line_id from each JSONB line element (NULL when absent).
--    Signature is unchanged, so CREATE OR REPLACE introduces no overload.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_purchase_order(
  p_project_id     UUID,
  p_po_number      TEXT,
  p_boq_ref        TEXT,
  p_supplier       TEXT,
  p_material_name  TEXT,
  p_quantity       NUMERIC,
  p_unit           TEXT,
  p_unit_price     NUMERIC,
  p_ordered_date   DATE,
  p_user_id        UUID,
  p_activity_label TEXT,
  p_lines          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_po_id UUID;
BEGIN
  -- 1. Header
  INSERT INTO purchase_orders (
    project_id, po_number, boq_ref, supplier, material_name,
    quantity, unit, unit_price, ordered_date, status
  )
  VALUES (
    p_project_id, p_po_number, p_boq_ref, p_supplier, p_material_name,
    p_quantity, p_unit, p_unit_price, p_ordered_date, 'OPEN'
  )
  RETURNING id INTO v_po_id;

  -- 2. Lines (now carrying request_line_id when the caller supplies one)
  INSERT INTO purchase_order_lines (
    po_id, material_id, material_name, quantity, unit, unit_price, scope_tag,
    request_line_id
  )
  SELECT
    v_po_id,
    NULLIF(line->>'material_id', '')::UUID,
    line->>'material_name',
    (line->>'quantity')::NUMERIC,
    line->>'unit',
    (line->>'unit_price')::NUMERIC,
    NULLIF(line->>'scope_tag', ''),
    NULLIF(line->>'request_line_id', '')::UUID
  FROM jsonb_array_elements(p_lines) AS line;

  -- 3. Price history (one row per line)
  INSERT INTO price_history (project_id, material_id, vendor, unit_price, recorded_at)
  SELECT
    p_project_id,
    NULLIF(line->>'material_id', '')::UUID,
    p_supplier,
    (line->>'unit_price')::NUMERIC,
    now()
  FROM jsonb_array_elements(p_lines) AS line;

  -- 4. Activity log
  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES (p_project_id, p_user_id, 'permintaan', p_activity_label, 'INFO');

  RETURN v_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase_order(
  UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, UUID, TEXT, JSONB
) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. submit_receipt — new trailing param + server-authoritative PO status.
--
--    The param list changes (adds p_line_material_id), so we DROP the exact
--    old 13-arg signature first — otherwise CREATE OR REPLACE with a different
--    arg list would leave BOTH functions installed as an ambiguous overload,
--    and Postgres would keep routing old-style positional calls to the stale
--    one. p_line_material_id is placed LAST with a DEFAULT so existing
--    named-arg callers (pre-055 app builds) keep resolving.
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT
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
  p_line_material_id   UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_receipt_id     UUID;
  v_po_qty         NUMERIC;
  v_total_received NUMERIC;
  v_new_status     TEXT;
BEGIN
  -- Lock the PO row up front to serialize concurrent receipts against the same
  -- PO (two supervisors receiving at once would otherwise each read a stale
  -- total and both write PARTIAL/FULLY based on client-computed math).
  SELECT quantity INTO v_po_qty
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

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

GRANT EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT, UUID
) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. v_material_envelope_status — identical to 004's definition EXCEPT the
--    `received` lateral join now prefers the id link and only falls back to
--    the legacy name match when the receipt line has no material_id. Column
--    list is unchanged. Sits on whatever v_material_envelopes resolves to
--    (Task 2's 054 may re-scope the base view — no interaction here).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_material_envelope_status AS
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
  END AS burn_pct
FROM v_material_envelopes env
LEFT JOIN LATERAL (
  SELECT SUM(mrl.quantity) AS total_ordered
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = env.project_id
    AND mrl.material_id = env.material_id
    AND mrh.overall_status NOT IN ('REJECTED')
) ordered ON true
LEFT JOIN LATERAL (
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
