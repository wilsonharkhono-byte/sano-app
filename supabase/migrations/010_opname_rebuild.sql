-- supabase/migrations/010_opname_rebuild.sql
-- SANO — Opname Architecture Rebuild
-- Integrates mandor payment with Gate 4 progress and Gate 5 reconciliation.
-- Moves all payment computation into Postgres RPCs with role enforcement.
--
-- Run AFTER 008_labor_opname.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. AUDIT TABLE: opname_line_revisions
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_line_id UUID NOT NULL REFERENCES opname_lines(id) ON DELETE CASCADE,
  header_id UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  -- Cascades intentional: revisions are operational audit data, deleted with their parent header.
  changed_by UUID NOT NULL REFERENCES profiles(id),
  field_name TEXT NOT NULL,
  old_value NUMERIC,
  new_value NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_line
  ON opname_line_revisions(opname_line_id);
CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_header
  ON opname_line_revisions(header_id);

-- RLS: same access as opname_lines (project-assigned users)
ALTER TABLE opname_line_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opname_line_revisions_select" ON opname_line_revisions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM opname_headers oh
    JOIN project_assignments pa ON pa.project_id = oh.project_id
    WHERE oh.id = opname_line_revisions.header_id AND pa.user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MISSING INDEXES on ahs_lines
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ahs_lines_trade_category
  ON ahs_lines(trade_category)
  WHERE trade_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ahs_lines_line_type_trade
  ON ahs_lines(line_type, trade_category)
  WHERE line_type = 'labor';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. BATCH TRADE CATEGORY RPC (replaces serial JS loop)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_detected_trade_categories(
  p_updates JSONB  -- array of {"id": "uuid", "trade_category": "text"}
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item JSONB;
BEGIN
  -- Validate input is a JSON array
  IF p_updates IS NULL OR jsonb_typeof(p_updates) != 'array' THEN
    RAISE EXCEPTION 'apply_detected_trade_categories: p_updates must be a non-null JSON array';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    -- Skip items missing required fields rather than crashing
    CONTINUE WHEN item->>'id' IS NULL OR item->>'trade_category' IS NULL;

    UPDATE ahs_lines
    SET trade_category = item->>'trade_category'
    WHERE id = (item->>'id')::UUID
      AND (trade_confirmed = false OR trade_confirmed IS NULL);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION apply_detected_trade_categories(JSONB) IS
'Batch update ahs_lines trade_category from detected values.
Input: JSONB array of {id: uuid, trade_category: text}.
Only updates lines where trade_confirmed is false or null.
Runs SECURITY DEFINER to bypass per-row RLS on ahs_lines.
Items with missing id or trade_category are silently skipped.';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. VIEW: v_opname_progress_reconciliation
--    Cross-references opname claimed % against Gate 4 field progress.
--    Flags lines where mandor claim diverges significantly from
--    field-verified installed progress.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_opname_progress_reconciliation AS
SELECT
  ol.id AS line_id,
  ol.header_id,
  oh.project_id,
  oh.contract_id,
  oh.week_number,
  ol.boq_item_id,
  bi.code AS boq_code,
  bi.label AS boq_label,
  bi.unit,
  bi.planned AS budget_volume,
  -- Mandor's claimed progress
  COALESCE(ol.verified_pct, ol.cumulative_pct) AS claimed_progress_pct,
  -- Field-verified progress from Gate 4 progress_entries
  CASE
    WHEN bi.planned > 0
    THEN ROUND((bi.installed / bi.planned) * 100, 1)
    ELSE 0
  END AS field_progress_pct,
  -- Variance: positive = mandor claims MORE than field shows
  COALESCE(ol.verified_pct, ol.cumulative_pct)
    - CASE
        WHEN bi.planned > 0
        THEN ROUND((bi.installed / bi.planned) * 100, 1)
        ELSE 0
      END AS variance_pct,
  -- Flag
  CASE
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 20 THEN 'HIGH'
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 10 THEN 'WARNING'
    ELSE 'OK'
  END AS variance_flag
FROM opname_lines ol
JOIN opname_headers oh ON oh.id = ol.header_id
JOIN boq_items bi ON bi.id = ol.boq_item_id;