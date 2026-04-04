-- SANO — Phase 2b: BoQ Parser Extensions
-- Extends baseline tables to support real Excel BoQ import with:
--   - Hierarchical BoQ structure (chapters, sub-items)
--   - AHS line types (material, labor, equipment, subcontractor)
--   - Project markup factors (client-facing price multipliers)
--   - Material envelope aggregation (Tier 2 cross-BoQ ordering)
--   - AI anomaly flags from parser
--
-- Run AFTER 002_baseline_tables.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. EXTEND boq_items FOR HIERARCHY & STRUCTURAL COMPOSITES
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS parent_code TEXT;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS chapter TEXT;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS element_code TEXT;
-- composite_factors stores structural ratio data for concrete items:
-- {"formwork_ratio": 6.5, "rebar_ratio": 120, "wiremesh_ratio": 0}
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS composite_factors JSONB;
-- cost_breakdown stores the 5-component unit price from RAB:
-- {"material": 850000, "labor": 250000, "equipment": 50000, "subkon": 0, "prelim": 0}
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS cost_breakdown JSONB;
-- client_unit_price = internal_unit_price * markup_factor
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS client_unit_price NUMERIC;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS internal_unit_price NUMERIC;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. EXTEND ahs_lines FOR LABOR, EQUIPMENT, SUBKON LINE TYPES
-- ═══════════════════════════════════════════════════════════════════════

-- line_type distinguishes material purchases from labor/equipment/subkon costs
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS line_type TEXT DEFAULT 'material'
  CHECK (line_type IN ('material', 'labor', 'equipment', 'subkon'));

-- coefficient is the raw multiplier from the AHS (e.g., 70 pcs per m2)
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS coefficient NUMERIC DEFAULT 0;

-- unit_price is the per-unit cost from Material! or Upah! sheet
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0;

-- description stores the original text from the AHS for non-material lines
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS description TEXT;

-- ahs_block_title stores the AHS block header (e.g., "1 m2 Bekisting Bata Merah...")
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS ahs_block_title TEXT;

-- source_row tracks the original Excel row for traceability
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS source_row INT;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PROJECT MARKUP FACTORS (client pricing multipliers per category)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_markup_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  factor NUMERIC NOT NULL DEFAULT 1.0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);

CREATE INDEX IF NOT EXISTS idx_markup_factors_project ON project_markup_factors(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. MATERIAL ENVELOPE VIEW (Tier 2 cross-BoQ aggregation)
-- ═══════════════════════════════════════════════════════════════════════

-- Aggregates planned material quantities across all BoQ items in a project.
-- Used for Tier 2 envelope checks: one material order may serve many BoQ items.
CREATE OR REPLACE VIEW v_material_envelopes AS
SELECT
  pmml.material_id,
  pmm.project_id,
  mc.code AS material_code,
  mc.name AS material_name,
  mc.tier,
  mc.unit,
  SUM(pmml.planned_quantity) AS total_planned,
  COUNT(DISTINCT pmml.boq_item_id) AS boq_item_count
FROM project_material_master_lines pmml
JOIN project_material_master pmm ON pmm.id = pmml.master_id
JOIN material_catalog mc ON mc.id = pmml.material_id
GROUP BY pmml.material_id, pmm.project_id, mc.code, mc.name, mc.tier, mc.unit;

-- Tracks cumulative material orders against envelope (for Tier 2 burn tracking)
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
    AND rl.material_name = mc2.name
) received ON true;

-- RPC: get_material_envelope — callable from client for Gate 1 Tier 2 checks
CREATE OR REPLACE FUNCTION get_material_envelope(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  tier SMALLINT,
  unit TEXT,
  total_planned NUMERIC,
  total_ordered NUMERIC,
  total_received NUMERIC,
  remaining_to_order NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT
    material_id, material_name, tier, unit,
    total_planned, total_ordered, total_received,
    remaining_to_order, burn_pct, boq_item_count
  FROM v_material_envelope_status
  WHERE project_id = p_project_id
    AND v_material_envelope_status.material_id = p_material_id;
$$;

-- RPC: get_envelope_boq_breakdown — shows per-BoQ allocation for a material
CREATE OR REPLACE FUNCTION get_envelope_boq_breakdown(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  boq_item_id UUID,
  boq_code TEXT,
  boq_label TEXT,
  planned_quantity NUMERIC,
  pct_of_total NUMERIC
) LANGUAGE sql STABLE AS $$
  SELECT
    pmml.boq_item_id,
    bi.code,
    bi.label,
    pmml.planned_quantity,
    CASE
      WHEN SUM(pmml.planned_quantity) OVER () > 0
      THEN ROUND((pmml.planned_quantity / SUM(pmml.planned_quantity) OVER ()) * 100, 1)
      ELSE 0
    END AS pct_of_total
  FROM project_material_master_lines pmml
  JOIN project_material_master pmm ON pmm.id = pmml.master_id
  JOIN boq_items bi ON bi.id = pmml.boq_item_id
  WHERE pmm.project_id = p_project_id
    AND pmml.material_id = p_material_id
  ORDER BY pmml.planned_quantity DESC;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. AI ANOMALY FLAGS (parser-detected deviations)
-- ═══════════════════════════════════════════════════════════════════════

-- Stores AI-detected anomalies found during BoQ parsing.
-- These are reviewed by estimators before baseline publish.
CREATE TABLE IF NOT EXISTS import_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN (
    'coefficient_deviation',   -- AHS coefficient outside standard range
    'price_deviation',         -- unit price significantly above/below market
    'missing_component',       -- AHS block missing expected component (e.g., no rebar in concrete)
    'unit_mismatch',           -- unit inconsistency between AHS and material catalog
    'duplicate_item',          -- potential duplicate BoQ items
    'waste_factor_unusual',    -- waste factor outside normal 5-20% range
    'zero_quantity',           -- BoQ item with zero volume
    'unresolved_material',     -- material name not matched to catalog
    'formula_error',           -- detected broken formula or circular reference
    'ratio_deviation'          -- structural ratio (formwork/rebar) outside expected range
  )),
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  source_sheet TEXT,
  source_row INT,
  description TEXT NOT NULL,
  expected_value TEXT,
  actual_value TEXT,
  context JSONB DEFAULT '{}',
  resolution TEXT CHECK (resolution IN ('PENDING', 'ACCEPTED', 'CORRECTED', 'DISMISSED')),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_anomalies_session ON import_anomalies(session_id);
CREATE INDEX IF NOT EXISTS idx_import_anomalies_unresolved
  ON import_anomalies(session_id, resolution)
  WHERE resolution = 'PENDING';
