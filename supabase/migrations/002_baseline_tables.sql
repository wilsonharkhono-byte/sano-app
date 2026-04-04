-- SAN Contractor — Phase 2: Baseline Import & Project Truth
-- This migration extends the core schema with baseline import, AHS/material
-- publishing, and downstream operational/reporting support.
--
-- IMPORTANT:
-- - Run 001_core_tables.sql first on a clean database.
-- - Run 004_boq_parser_extensions.sql, 007_import_pipeline_rls.sql, and
--   010_baseline_publish_rls.sql after this file to complete the full
--   baseline import/publish pipeline used by the app.
-- - Older one-shot reset scripts and stale copies of this file should not be
--   used as source of truth.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. MATERIAL CATALOG (global material master, shared across projects)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL,
  category TEXT,
  tier SMALLINT NOT NULL CHECK (tier IN (1, 2, 3)),
  unit TEXT NOT NULL,
  supplier_unit TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES material_catalog(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES material_catalog(id) ON DELETE CASCADE,
  spec_key TEXT NOT NULL,
  spec_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill/repair legacy material catalog schemas
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS supplier_unit TEXT NOT NULL DEFAULT '';
UPDATE material_catalog
SET supplier_unit = unit
WHERE COALESCE(supplier_unit, '') = '';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BOQ ITEM VERSIONING
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS boq_item_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  snapshot JSONB NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. AHS (Analisa Harga Satuan) — PROJECT-SPECIFIC
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ahs_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ahs_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ahs_version_id UUID NOT NULL REFERENCES ahs_versions(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id),
  material_spec TEXT,
  tier SMALLINT NOT NULL CHECK (tier IN (1, 2, 3)),
  usage_rate NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  waste_factor NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PROJECT MATERIAL MASTER (derived from AHS)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_material_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ahs_version_id UUID NOT NULL REFERENCES ahs_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_material_master_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id UUID NOT NULL REFERENCES project_material_master(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id),
  boq_item_id UUID NOT NULL REFERENCES boq_items(id),
  planned_quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. IMPORT PIPELINE — STAGING & REVIEW
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  original_file_path TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED'
    CHECK (status IN ('UPLOADED', 'PARSING', 'STAGING', 'REVIEW', 'PUBLISHED', 'FAILED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_staging_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  row_type TEXT NOT NULL CHECK (row_type IN ('boq', 'ahs', 'material', 'spec', 'price')),
  raw_data JSONB NOT NULL DEFAULT '{}',
  parsed_data JSONB,
  confidence NUMERIC NOT NULL DEFAULT 0,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'MODIFIED')),
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. PRICE HISTORY
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id),
  vendor TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 6b. PURCHASE ORDER LINES (Gate 2 price validation)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id),
  material_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(po_id);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number TEXT;

WITH po_numbering AS (
  SELECT
    po.id,
    'PO-' ||
    COALESCE(NULLIF(regexp_replace(UPPER(p.code), '[^A-Z0-9]+', '', 'g'), ''), 'PRJ') ||
    '-' ||
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY po.project_id
        ORDER BY po.ordered_date, po.created_at, po.id
      )::TEXT,
      3,
      '0'
    ) AS generated_po_number
  FROM purchase_orders po
  JOIN projects p ON p.id = po.project_id
)
UPDATE purchase_orders po
SET po_number = po_numbering.generated_po_number
FROM po_numbering
WHERE po.id = po_numbering.id
  AND COALESCE(po.po_number, '') = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_number_unique
  ON purchase_orders(po_number)
  WHERE po_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. TRANSACTIONAL TABLES UPDATE — new header+lines model
-- ═══════════════════════════════════════════════════════════════════════

-- Gate 1: Material Request Header + Lines
CREATE TABLE IF NOT EXISTS material_request_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id),
  requested_by UUID NOT NULL REFERENCES profiles(id),
  target_date DATE NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('NORMAL', 'URGENT', 'CRITICAL')),
  common_note TEXT,
  overall_flag TEXT NOT NULL DEFAULT 'OK',
  overall_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (overall_status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_HOLD')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE material_request_headers ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id);
ALTER TABLE material_request_headers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS material_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_header_id UUID NOT NULL REFERENCES material_request_headers(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material_catalog(id),
  custom_material_name TEXT,
  tier SMALLINT NOT NULL CHECK (tier IN (1, 2, 3)),
  material_spec_reference TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  line_flag TEXT NOT NULL DEFAULT 'OK',
  line_check_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gate 3: Receipts (partial receipt support)
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  received_by UUID NOT NULL REFERENCES profiles(id),
  vehicle_ref TEXT,
  gate3_flag TEXT NOT NULL DEFAULT 'OK',
  gate3_details JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  quantity_actual NUMERIC NOT NULL CHECK (quantity_actual > 0),
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  photo_type   TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  gps_lat      NUMERIC,
  gps_lon      NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from mtn_requests.material_id → material_catalog (deferred from 001_core_tables.sql)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mtn_requests_material_id_fkey'
  ) THEN
    ALTER TABLE mtn_requests
      ADD CONSTRAINT mtn_requests_material_id_fkey
      FOREIGN KEY (material_id) REFERENCES material_catalog(id);
  END IF;
END $$;

-- Gate 4: Progress entries (append-only)
CREATE TABLE IF NOT EXISTS progress_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id),
  reported_by UUID NOT NULL REFERENCES profiles(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  work_status TEXT NOT NULL CHECK (work_status IN ('IN_PROGRESS', 'COMPLETE', 'COMPLETE_DEFECT')),
  location TEXT,
  note TEXT,
  payroll_support BOOLEAN NOT NULL DEFAULT false,
  client_charge_support BOOLEAN NOT NULL DEFAULT false,
  linked_vo_id UUID,
  linked_rework_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_entry_id UUID REFERENCES progress_entries(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VO entries (unified — replaces micro_vos)
CREATE TABLE IF NOT EXISTS vo_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID REFERENCES boq_items(id),
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  cause TEXT CHECK (cause IN (
    'client_request', 'design_revision', 'estimator_error',
    'site_execution', 'unforeseen_condition', 'owner_supplied', 'contractor_rework'
  )),
  grade TEXT CHECK (grade IN ('low', 'medium', 'high', 'critical_margin')),
  est_material TEXT,
  est_cost NUMERIC,
  photo_path TEXT,
  is_micro BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'AWAITING'
    CHECK (status IN ('AWAITING', 'REVIEWED', 'APPROVED', 'REJECTED')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vo_entries ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id);
ALTER TABLE vo_entries ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS formal_vos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vo_entry_ids UUID[] NOT NULL DEFAULT '{}',
  total_value NUMERIC NOT NULL DEFAULT 0,
  billable BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ
);

-- Rework entries
CREATE TABLE IF NOT EXISTS rework_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID REFERENCES boq_items(id),
  description TEXT NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN (
    'client_request', 'design_revision', 'estimator_error',
    'site_execution', 'unforeseen_condition', 'owner_supplied', 'contractor_rework'
  )),
  cost_impact NUMERIC,
  performance_impact BOOLEAN NOT NULL DEFAULT true,
  linked_defect_id UUID,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE')),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rework_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE rework_entries ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES profiles(id);
ALTER TABLE rework_entries ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE rework_entries DROP CONSTRAINT IF EXISTS rework_entries_status_check;
UPDATE rework_entries SET status = 'OPEN' WHERE status NOT IN ('OPEN', 'IN_PROGRESS', 'DONE');
ALTER TABLE rework_entries
  ADD CONSTRAINT rework_entries_status_check
  CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE'));

-- Multi-photo attachments for operational forms
CREATE TABLE IF NOT EXISTS defect_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id UUID NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  photo_kind TEXT NOT NULL CHECK (photo_kind IN ('report', 'repair')),
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vo_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vo_entry_id UUID NOT NULL REFERENCES vo_entries(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rework_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rework_entry_id UUID NOT NULL REFERENCES rework_entries(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mtn_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mtn_request_id UUID NOT NULL REFERENCES mtn_requests(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. APPROVAL, AUDIT, SCORING TABLES
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  assigned_to UUID NOT NULL REFERENCES profiles(id),
  action TEXT CHECK (action IN ('APPROVE', 'REJECT', 'HOLD', 'OVERRIDE')),
  reason TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  trigger_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CLOSED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomaly_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL,
  period TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  total_score NUMERIC NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id, period)
);

CREATE TABLE IF NOT EXISTS vendor_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id),
  score NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. REPORTING
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS weekly_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  report_type TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  file_path TEXT NOT NULL,
  generated_by UUID NOT NULL REFERENCES profiles(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 10. UPDATE DEFECTS TABLE for full lifecycle
-- ═══════════════════════════════════════════════════════════════════════

-- Add new columns if they don't exist (safe for re-runs)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'boq_item_id') THEN
    ALTER TABLE defects ADD COLUMN boq_item_id UUID REFERENCES boq_items(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'responsible_party') THEN
    ALTER TABLE defects ADD COLUMN responsible_party TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'target_resolution_date') THEN
    ALTER TABLE defects ADD COLUMN target_resolution_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'verifier_id') THEN
    ALTER TABLE defects ADD COLUMN verifier_id UUID REFERENCES profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'handover_impact') THEN
    ALTER TABLE defects ADD COLUMN handover_impact BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'repair_photo_path') THEN
    ALTER TABLE defects ADD COLUMN repair_photo_path TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'resolved_at') THEN
    ALTER TABLE defects ADD COLUMN resolved_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defects' AND column_name = 'verified_at') THEN
    ALTER TABLE defects ADD COLUMN verified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Update milestones for revised_date support
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'milestones' AND column_name = 'revised_date') THEN
    ALTER TABLE milestones ADD COLUMN revised_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'milestones' AND column_name = 'revision_reason') THEN
    ALTER TABLE milestones ADD COLUMN revision_reason TEXT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. INDEXES for performance
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_boq_items_project ON boq_items(project_id);
CREATE INDEX IF NOT EXISTS idx_ahs_lines_version ON ahs_lines(ahs_version_id);
CREATE INDEX IF NOT EXISTS idx_ahs_lines_boq ON ahs_lines(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_material_master_lines_master ON project_material_master_lines(master_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_catalog_code_unique ON material_catalog(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_catalog_category ON material_catalog(category);
CREATE INDEX IF NOT EXISTS idx_import_staging_session ON import_staging_rows(session_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_review ON import_staging_rows(session_id, needs_review);
CREATE INDEX IF NOT EXISTS idx_request_headers_project ON material_request_headers(project_id);
CREATE INDEX IF NOT EXISTS idx_request_lines_header ON material_request_lines(request_header_id);
CREATE INDEX IF NOT EXISTS idx_receipts_po ON receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_progress_entries_project ON progress_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_entries_boq ON progress_entries(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_defect_photos_defect ON defect_photos(defect_id);
CREATE INDEX IF NOT EXISTS idx_vo_photos_vo ON vo_photos(vo_entry_id);
CREATE INDEX IF NOT EXISTS idx_rework_photos_rework ON rework_photos(rework_entry_id);
CREATE INDEX IF NOT EXISTS idx_mtn_photos_request ON mtn_photos(mtn_request_id);
CREATE INDEX IF NOT EXISTS idx_vo_entries_project ON vo_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_defects_project ON defects(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_price_history_material ON price_history(project_id, material_id);
CREATE INDEX IF NOT EXISTS idx_vendor_scorecards_vendor ON vendor_scorecards(project_id, vendor);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_pending ON approval_tasks(project_id, entity_type) WHERE action IS NULL;
CREATE INDEX IF NOT EXISTS idx_anomaly_events_project ON anomaly_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_cases_open ON audit_cases(project_id, status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_performance_scores_project ON performance_scores(project_id, period);
CREATE INDEX IF NOT EXISTS idx_report_exports_project ON report_exports(project_id, generated_at DESC);
-- NOTE: idx_milestone_revisions is created below, after the milestone_revisions table.

-- ═══════════════════════════════════════════════════════════════════════
-- 12. SERVER-DERIVED TOTALS (Gate 4 backend derivation)
-- ═══════════════════════════════════════════════════════════════════════

-- View: derived installed totals per BoQ item from progress_entries
CREATE OR REPLACE VIEW v_boq_installed AS
SELECT
  pe.boq_item_id,
  pe.project_id,
  SUM(pe.quantity) AS total_installed,
  COUNT(*) AS entry_count,
  MAX(pe.created_at) AS last_entry_at
FROM progress_entries pe
GROUP BY pe.boq_item_id, pe.project_id;

-- View: derived received totals per PO from receipts + receipt_lines
CREATE OR REPLACE VIEW v_po_received AS
SELECT
  r.po_id,
  r.project_id,
  rl.material_name,
  SUM(rl.quantity_actual) AS total_received,
  COUNT(DISTINCT r.id) AS receipt_count,
  MAX(r.created_at) AS last_receipt_at
FROM receipts r
JOIN receipt_lines rl ON rl.receipt_id = r.id
GROUP BY r.po_id, r.project_id, rl.material_name;

-- RPC: derive_boq_installed — callable from client
CREATE OR REPLACE FUNCTION derive_boq_installed(p_project_id UUID)
RETURNS TABLE (
  boq_item_id UUID,
  total_installed NUMERIC,
  entry_count BIGINT,
  last_entry_at TIMESTAMPTZ
) LANGUAGE sql STABLE AS $$
  SELECT boq_item_id, total_installed, entry_count, last_entry_at
  FROM v_boq_installed
  WHERE project_id = p_project_id;
$$;

-- RPC: derive_po_received — callable from client
CREATE OR REPLACE FUNCTION derive_po_received(p_project_id UUID)
RETURNS TABLE (
  po_id UUID,
  material_name TEXT,
  total_received NUMERIC,
  receipt_count BIGINT,
  last_receipt_at TIMESTAMPTZ
) LANGUAGE sql STABLE AS $$
  SELECT po_id, material_name, total_received, receipt_count, last_receipt_at
  FROM v_po_received
  WHERE project_id = p_project_id;
$$;

-- RPC: sync_boq_progress — updates boq_items.installed and progress from derived totals
CREATE OR REPLACE FUNCTION sync_boq_progress(p_project_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  updated_count INT := 0;
BEGIN
  UPDATE boq_items bi
  SET
    installed = COALESCE(d.total_installed, 0),
    progress = CASE
      WHEN bi.planned > 0 THEN LEAST(100, ROUND((COALESCE(d.total_installed, 0) / bi.planned) * 100))
      ELSE 0
    END
  FROM v_boq_installed d
  WHERE bi.id = d.boq_item_id
    AND bi.project_id = p_project_id
    AND d.project_id = p_project_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. SCHEDULE LAYER (Phase 9)
-- ═══════════════════════════════════════════════════════════════════════

-- Milestone revision history table (separate from milestones for auditability)
CREATE TABLE IF NOT EXISTS milestone_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  previous_date DATE NOT NULL,
  new_date DATE NOT NULL,
  reason TEXT NOT NULL,
  revised_by UUID NOT NULL REFERENCES profiles(id),
  revised_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestone_revisions_milestone ON milestone_revisions(milestone_id);

-- RPC: sync_milestone_statuses — updates milestones.status from progress data
-- Called after progress_entries are written
CREATE OR REPLACE FUNCTION sync_milestone_statuses(p_project_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  linked_ids UUID[];
  avg_prog NUMERIC;
  days_out INT;
  new_status TEXT;
  updated_count INT := 0;
BEGIN
  FOR m IN SELECT * FROM milestones WHERE project_id = p_project_id LOOP
    linked_ids := m.boq_ids;

    -- Compute average progress of linked BoQ items
    SELECT AVG(progress) INTO avg_prog
    FROM boq_items
    WHERE id = ANY(linked_ids) AND project_id = p_project_id;

    avg_prog := COALESCE(avg_prog, 0);

    -- Days until planned (or revised) date
    days_out := EXTRACT(DAY FROM (COALESCE(m.revised_date, m.planned_date)::DATE - CURRENT_DATE));

    -- Derive status
    IF avg_prog >= 100 THEN
      new_status := CASE WHEN days_out > 0 THEN 'AHEAD' ELSE 'COMPLETE' END;
    ELSIF days_out < 0 THEN
      new_status := 'DELAYED';
    ELSIF days_out <= 7 AND avg_prog < 50 THEN
      new_status := 'DELAYED';
    ELSIF days_out <= 14 AND avg_prog < 70 THEN
      new_status := 'AT_RISK';
    ELSE
      new_status := 'ON_TRACK';
    END IF;

    UPDATE milestones SET status = new_status WHERE id = m.id;
    updated_count := updated_count + 1;
  END LOOP;

  RETURN updated_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 14. BASELINE RLS FOR OFFICE-CONTROLLED TABLES
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE material_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_catalog_read" ON material_catalog;
DROP POLICY IF EXISTS "material_catalog_office_insert" ON material_catalog;
DROP POLICY IF EXISTS "material_catalog_office_update" ON material_catalog;
DROP POLICY IF EXISTS "material_catalog_office_delete" ON material_catalog;

CREATE POLICY "material_catalog_read" ON material_catalog
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "material_catalog_office_insert" ON material_catalog
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

CREATE POLICY "material_catalog_office_update" ON material_catalog
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

CREATE POLICY "material_catalog_office_delete" ON material_catalog
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

DROP POLICY IF EXISTS "price_history_assigned_read" ON price_history;
DROP POLICY IF EXISTS "price_history_office_insert" ON price_history;
DROP POLICY IF EXISTS "price_history_office_update" ON price_history;
DROP POLICY IF EXISTS "price_history_office_delete" ON price_history;

CREATE POLICY "price_history_assigned_read" ON price_history
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "price_history_office_insert" ON price_history
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

CREATE POLICY "price_history_office_update" ON price_history
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

CREATE POLICY "price_history_office_delete" ON price_history
  FOR DELETE
  USING (
    project_id IN (
      SELECT project_id
      FROM project_assignments
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator')
    )
  );

-- Transactional live-entry tables
ALTER TABLE material_request_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE defect_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vo_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vo_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtn_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_orders_office_insert" ON purchase_orders;
DROP POLICY IF EXISTS "purchase_orders_office_update" ON purchase_orders;
CREATE POLICY "purchase_orders_office_insert" ON purchase_orders
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );
CREATE POLICY "purchase_orders_office_update" ON purchase_orders
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "request_headers_assigned_select" ON material_request_headers;
DROP POLICY IF EXISTS "request_headers_assigned_insert" ON material_request_headers;
DROP POLICY IF EXISTS "request_headers_office_update" ON material_request_headers;
CREATE POLICY "request_headers_assigned_select" ON material_request_headers
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "request_headers_assigned_insert" ON material_request_headers
  FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "request_headers_office_update" ON material_request_headers
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "request_lines_assigned_select" ON material_request_lines;
DROP POLICY IF EXISTS "request_lines_assigned_insert" ON material_request_lines;
CREATE POLICY "request_lines_assigned_select" ON material_request_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM material_request_headers h
      JOIN project_assignments pa ON pa.project_id = h.project_id
      WHERE h.id = material_request_lines.request_header_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "request_lines_assigned_insert" ON material_request_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM material_request_headers h
      JOIN project_assignments pa ON pa.project_id = h.project_id
      WHERE h.id = material_request_lines.request_header_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "po_lines_assigned_select" ON purchase_order_lines;
DROP POLICY IF EXISTS "po_lines_office_insert" ON purchase_order_lines;
DROP POLICY IF EXISTS "po_lines_office_update" ON purchase_order_lines;
CREATE POLICY "po_lines_assigned_select" ON purchase_order_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM purchase_orders po
      JOIN project_assignments pa ON pa.project_id = po.project_id
      WHERE po.id = purchase_order_lines.po_id
        AND pa.user_id = auth.uid()
    )
  );
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
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );
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
        AND pr.role IN ('admin', 'estimator', 'principal')
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
        AND pr.role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "receipts_assigned_select" ON receipts;
DROP POLICY IF EXISTS "receipts_assigned_insert" ON receipts;
CREATE POLICY "receipts_assigned_select" ON receipts
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "receipts_assigned_insert" ON receipts
  FOR INSERT
  WITH CHECK (
    received_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "receipt_lines_assigned_select" ON receipt_lines;
DROP POLICY IF EXISTS "receipt_lines_assigned_insert" ON receipt_lines;
CREATE POLICY "receipt_lines_assigned_select" ON receipt_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN project_assignments pa ON pa.project_id = r.project_id
      WHERE r.id = receipt_lines.receipt_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "receipt_lines_assigned_insert" ON receipt_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN project_assignments pa ON pa.project_id = r.project_id
      WHERE r.id = receipt_lines.receipt_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "receipt_photos_assigned_select" ON receipt_photos;
DROP POLICY IF EXISTS "receipt_photos_assigned_insert" ON receipt_photos;
CREATE POLICY "receipt_photos_assigned_select" ON receipt_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN project_assignments pa ON pa.project_id = r.project_id
      WHERE r.id = receipt_photos.receipt_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "receipt_photos_assigned_insert" ON receipt_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN project_assignments pa ON pa.project_id = r.project_id
      WHERE r.id = receipt_photos.receipt_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "progress_entries_assigned_select" ON progress_entries;
DROP POLICY IF EXISTS "progress_entries_assigned_insert" ON progress_entries;
CREATE POLICY "progress_entries_assigned_select" ON progress_entries
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "progress_entries_assigned_insert" ON progress_entries
  FOR INSERT
  WITH CHECK (
    reported_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "progress_photos_assigned_select" ON progress_photos;
DROP POLICY IF EXISTS "progress_photos_assigned_insert" ON progress_photos;
CREATE POLICY "progress_photos_assigned_select" ON progress_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM progress_entries pe
      JOIN project_assignments pa ON pa.project_id = pe.project_id
      WHERE pe.id = progress_photos.progress_entry_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "progress_photos_assigned_insert" ON progress_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM progress_entries pe
      JOIN project_assignments pa ON pa.project_id = pe.project_id
      WHERE pe.id = progress_photos.progress_entry_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "defect_photos_assigned_select" ON defect_photos;
DROP POLICY IF EXISTS "defect_photos_assigned_insert" ON defect_photos;
CREATE POLICY "defect_photos_assigned_select" ON defect_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM defects d
      JOIN project_assignments pa ON pa.project_id = d.project_id
      WHERE d.id = defect_photos.defect_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "defect_photos_assigned_insert" ON defect_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM defects d
      JOIN project_assignments pa ON pa.project_id = d.project_id
      WHERE d.id = defect_photos.defect_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "vo_entries_assigned_select" ON vo_entries;
DROP POLICY IF EXISTS "vo_entries_assigned_insert" ON vo_entries;
DROP POLICY IF EXISTS "vo_entries_office_update" ON vo_entries;
CREATE POLICY "vo_entries_assigned_select" ON vo_entries
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "vo_entries_assigned_insert" ON vo_entries
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "vo_entries_office_update" ON vo_entries
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "vo_photos_assigned_select" ON vo_photos;
DROP POLICY IF EXISTS "vo_photos_assigned_insert" ON vo_photos;
CREATE POLICY "vo_photos_assigned_select" ON vo_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM vo_entries ve
      JOIN project_assignments pa ON pa.project_id = ve.project_id
      WHERE ve.id = vo_photos.vo_entry_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "vo_photos_assigned_insert" ON vo_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM vo_entries ve
      JOIN project_assignments pa ON pa.project_id = ve.project_id
      WHERE ve.id = vo_photos.vo_entry_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rework_entries_assigned_select" ON rework_entries;
DROP POLICY IF EXISTS "rework_entries_assigned_insert" ON rework_entries;
DROP POLICY IF EXISTS "rework_entries_office_update" ON rework_entries;
CREATE POLICY "rework_entries_assigned_select" ON rework_entries
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "rework_entries_assigned_insert" ON rework_entries
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "rework_entries_office_update" ON rework_entries
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'estimator', 'principal')
      )
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'estimator', 'principal')
      )
    )
  );

DROP POLICY IF EXISTS "rework_photos_assigned_select" ON rework_photos;
DROP POLICY IF EXISTS "rework_photos_assigned_insert" ON rework_photos;
CREATE POLICY "rework_photos_assigned_select" ON rework_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM rework_entries re
      JOIN project_assignments pa ON pa.project_id = re.project_id
      WHERE re.id = rework_photos.rework_entry_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "rework_photos_assigned_insert" ON rework_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM rework_entries re
      JOIN project_assignments pa ON pa.project_id = re.project_id
      WHERE re.id = rework_photos.rework_entry_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "mtn_photos_assigned_select" ON mtn_photos;
DROP POLICY IF EXISTS "mtn_photos_assigned_insert" ON mtn_photos;
CREATE POLICY "mtn_photos_assigned_select" ON mtn_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM mtn_requests mr
      JOIN project_assignments pa ON pa.project_id = mr.project_id
      WHERE mr.id = mtn_photos.mtn_request_id
        AND pa.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM mtn_requests mr
      JOIN project_assignments pa ON pa.project_id = mr.destination_project_id
      WHERE mr.id = mtn_photos.mtn_request_id
        AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "mtn_photos_assigned_insert" ON mtn_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM mtn_requests mr
      JOIN project_assignments pa ON pa.project_id = mr.project_id
      WHERE mr.id = mtn_photos.mtn_request_id
        AND pa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "weekly_digests_assigned_select" ON weekly_digests;
DROP POLICY IF EXISTS "weekly_digests_office_insert" ON weekly_digests;
CREATE POLICY "weekly_digests_assigned_select" ON weekly_digests
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "weekly_digests_office_insert" ON weekly_digests
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'estimator', 'principal')
    )
  );

DROP POLICY IF EXISTS "report_exports_assigned_select" ON report_exports;
DROP POLICY IF EXISTS "report_exports_assigned_insert" ON report_exports;
CREATE POLICY "report_exports_assigned_select" ON report_exports
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "report_exports_assigned_insert" ON report_exports
  FOR INSERT
  WITH CHECK (
    generated_by = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );
