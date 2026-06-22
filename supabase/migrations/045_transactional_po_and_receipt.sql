-- 045 — Transactional PO creation + receipt submission (H1-atomicity)
--
-- Wraps two multi-write money paths into single plpgsql functions so every
-- write happens inside ONE implicit transaction (all-or-nothing). Previously
-- the screens issued sequential supabase inserts/updates with no transaction,
-- so a mid-flow failure left committed partial rows (orphan PO header without
-- lines, receipt header without lines/photos, etc).
--
-- Both functions are SECURITY INVOKER (the default) — they run under the
-- caller's RLS so all the existing per-table policies (project assignment +
-- office-role checks, received_by = auth.uid(), etc.) still apply. We do NOT
-- use SECURITY DEFINER because these write project-scoped operational data and
-- must respect RLS.
--
-- Re-runnable: both use CREATE OR REPLACE FUNCTION.
--
-- ⚠ This migration MUST be applied to Supabase BEFORE the matching app code is
--   deployed. The screens call these RPCs; without the functions, PO creation
--   and goods receipt will fail.

-- ═══════════════════════════════════════════════════════════════════════
-- create_purchase_order
--   Replaces handleCreatePO in Gate2Screen.tsx.
--   Writes (in order):
--     1. purchase_orders        (header)
--     2. purchase_order_lines   (one row per element of p_lines)
--     3. price_history          (one row per line)
--     4. activity_log           (single audit row)
--   Returns: the new PO id (uuid).
--
--   p_lines is a JSONB array; each element:
--     {
--       "material_id":   uuid | null,
--       "material_name": text,   (already sanitized by caller)
--       "quantity":      number,
--       "unit":          text,
--       "unit_price":    number,
--       "scope_tag":     text | null
--     }
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

  -- 2. Lines
  INSERT INTO purchase_order_lines (
    po_id, material_id, material_name, quantity, unit, unit_price, scope_tag
  )
  SELECT
    v_po_id,
    NULLIF(line->>'material_id', '')::UUID,
    line->>'material_name',
    (line->>'quantity')::NUMERIC,
    line->>'unit',
    (line->>'unit_price')::NUMERIC,
    NULLIF(line->>'scope_tag', '')
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
-- submit_receipt
--   Replaces handleSubmit in TerimaScreen.tsx.
--   Writes (in order):
--     1. receipts                (header)
--     2. receipt_lines           (single line)
--     3. receipt_photos          (one row per element of p_photos)
--     4. purchase_orders.status  (update)
--     5. activity_log            (single audit row)
--   Returns: the new receipt id (uuid).
--
--   p_photos is a JSONB array; each element:
--     {
--       "photo_type":   text,
--       "storage_path": text,
--       "gps_lat":      number | null,
--       "gps_lon":      number | null
--     }
-- ═══════════════════════════════════════════════════════════════════════

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
  p_new_po_status      TEXT,
  p_activity_label     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_receipt_id UUID;
BEGIN
  -- 1. Receipt header
  INSERT INTO receipts (
    po_id, project_id, received_by, vehicle_ref, gate3_flag, gate3_details, notes
  )
  VALUES (
    p_po_id, p_project_id, p_received_by, p_vehicle_ref,
    COALESCE(p_gate3_flag, 'OK'), p_gate3_details, p_notes
  )
  RETURNING id INTO v_receipt_id;

  -- 2. Receipt line (single)
  INSERT INTO receipt_lines (receipt_id, material_name, quantity_actual, unit)
  VALUES (v_receipt_id, p_line_material_name, p_line_quantity, p_line_unit);

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

  -- 4. Update PO status
  UPDATE purchase_orders
  SET status = p_new_po_status
  WHERE id = p_po_id;

  -- 5. Activity log
  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES (p_project_id, p_received_by, 'terima', p_activity_label, COALESCE(p_gate3_flag, 'OK'));

  RETURN v_receipt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_receipt(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT, TEXT
) TO authenticated;
