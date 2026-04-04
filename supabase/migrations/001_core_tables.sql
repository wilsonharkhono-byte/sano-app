-- SANO — Core Foundation Tables
-- Run this FIRST (before 002_baseline_tables.sql).
-- Creates all base tables referenced by downstream migrations.
-- Includes compatibility repairs for legacy tables that may already exist.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. PROFILES (extends Supabase auth.users)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL DEFAULT '',
  phone        TEXT,
  role         TEXT NOT NULL DEFAULT 'supervisor'
               CHECK (role IN ('supervisor', 'estimator', 'admin', 'principal')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If profiles already existed from the older schema, widen the role check so
-- the current office role model is accepted by seeds and app logic.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE profiles SET role = 'supervisor' WHERE role NOT IN ('supervisor', 'estimator', 'admin', 'principal');
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('supervisor', 'estimator', 'admin', 'principal'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'supervisor')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. PROJECTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  location        TEXT,
  client_name     TEXT,
  contract_value  NUMERIC,
  start_date      DATE,
  end_date        DATE,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch projects if it already existed from an older schema
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location       TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name    TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_value NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date     DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date       DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
UPDATE projects SET status = 'ACTIVE' WHERE status NOT IN ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PROJECT ASSIGNMENTS (many-to-many: users ↔ projects)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_user    ON project_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON project_assignments(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. BOQ ITEMS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS boq_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  planned         NUMERIC NOT NULL DEFAULT 0,
  installed       NUMERIC NOT NULL DEFAULT 0,
  progress        NUMERIC NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  -- Tier strings (legacy, superseded by ahs_lines FK linkage)
  tier1_material  TEXT,
  tier2_material  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

-- Patch boq_items if it already existed
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS installed      NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS progress       NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS tier1_material TEXT;
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS tier2_material TEXT;

CREATE INDEX IF NOT EXISTS idx_boq_items_project ON boq_items(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. ENVELOPES (budget envelopes per BoQ item, for Gate 1 checks)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS envelopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id   UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  max_quantity  NUMERIC NOT NULL,
  warning_pct   NUMERIC NOT NULL DEFAULT 80,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, boq_item_id)
);

-- Patch envelopes if it already existed from the old material-based schema.
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS boq_item_id   UUID REFERENCES boq_items(id) ON DELETE CASCADE;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS max_quantity  NUMERIC;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS warning_pct   NUMERIC NOT NULL DEFAULT 80;
ALTER TABLE envelopes ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT now();

-- Drop NOT NULL on ALL legacy columns the new schema doesn't use.
-- We check each column individually so it's safe if the column doesn't exist.
DO $$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['material_name', 'planned', 'unit', 'quantity', 'material_id', 'supplier', 'boq_ref']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'envelopes' AND column_name = col
    ) THEN
      EXECUTE format('ALTER TABLE envelopes ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'envelopes'
      AND column_name = 'planned'
  ) THEN
    EXECUTE 'UPDATE envelopes SET max_quantity = COALESCE(max_quantity, planned) WHERE max_quantity IS NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'envelopes'
      AND constraint_name = 'envelopes_project_id_boq_item_id_key'
  ) THEN
    ALTER TABLE envelopes
      ADD CONSTRAINT envelopes_project_id_boq_item_id_key
      UNIQUE (project_id, boq_item_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. PURCHASE ORDERS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_number       TEXT,
  boq_ref         TEXT NOT NULL,
  supplier        TEXT NOT NULL,
  material_name   TEXT NOT NULL,
  quantity        NUMERIC NOT NULL CHECK (quantity > 0),
  unit            TEXT NOT NULL,
  unit_price      NUMERIC,
  ordered_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch purchase_orders if it already existed
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number     TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS unit_price    NUMERIC;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ordered_date  DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
-- Migrate old status values to new enum
UPDATE purchase_orders SET status = 'OPEN' WHERE status NOT IN ('OPEN', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED');
ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'OPEN';
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('OPEN', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'));

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

CREATE INDEX IF NOT EXISTS idx_purchase_orders_project ON purchase_orders(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_number_unique
  ON purchase_orders(po_number)
  WHERE po_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. MILESTONES
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS milestones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  planned_date     DATE NOT NULL,
  revised_date     DATE,
  revision_reason  TEXT,
  boq_ids          UUID[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'ON_TRACK'
                   CHECK (status IN ('ON_TRACK', 'AT_RISK', 'DELAYED', 'AHEAD', 'COMPLETE')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch milestones if it already existed
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS revised_date     DATE;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS revision_reason  TEXT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS boq_ids          UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_status_check;
UPDATE milestones SET status = 'ON_TRACK' WHERE status NOT IN ('ON_TRACK', 'AT_RISK', 'DELAYED', 'AHEAD', 'COMPLETE');
ALTER TABLE milestones
  ADD CONSTRAINT milestones_status_check
  CHECK (status IN ('ON_TRACK', 'AT_RISK', 'DELAYED', 'AHEAD', 'COMPLETE'));

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. DEFECTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS defects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_ref               TEXT NOT NULL,
  boq_item_id           UUID REFERENCES boq_items(id),
  location              TEXT NOT NULL,
  description           TEXT NOT NULL,
  severity              TEXT NOT NULL CHECK (severity IN ('Minor', 'Major', 'Critical')),
  photo_path            TEXT,
  status                TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'VALIDATED', 'IN_REPAIR', 'RESOLVED', 'VERIFIED', 'ACCEPTED_BY_PRINCIPAL')),
  responsible_party     TEXT,
  target_resolution_date DATE,
  verifier_id           UUID REFERENCES profiles(id),
  handover_impact       BOOLEAN NOT NULL DEFAULT false,
  reported_by           UUID REFERENCES profiles(id),
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch defects if it already existed
ALTER TABLE defects ADD COLUMN IF NOT EXISTS boq_item_id            UUID;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS photo_path             TEXT;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS responsible_party      TEXT;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS target_resolution_date DATE;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS verifier_id            UUID;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS handover_impact        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS reported_by            UUID;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS reported_at            TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE defects ALTER COLUMN reported_by DROP NOT NULL;
ALTER TABLE defects DROP CONSTRAINT IF EXISTS defects_severity_check;
UPDATE defects SET severity = 'Minor' WHERE severity NOT IN ('Minor', 'Major', 'Critical');
ALTER TABLE defects
  ADD CONSTRAINT defects_severity_check
  CHECK (severity IN ('Minor', 'Major', 'Critical'));
ALTER TABLE defects DROP CONSTRAINT IF EXISTS defects_status_check;
UPDATE defects SET status = 'OPEN' WHERE status NOT IN ('OPEN', 'VALIDATED', 'IN_REPAIR', 'RESOLVED', 'VERIFIED', 'ACCEPTED_BY_PRINCIPAL');
ALTER TABLE defects
  ADD CONSTRAINT defects_status_check
  CHECK (status IN ('OPEN', 'VALIDATED', 'IN_REPAIR', 'RESOLVED', 'VERIFIED', 'ACCEPTED_BY_PRINCIPAL'));

CREATE INDEX IF NOT EXISTS idx_defects_project ON defects(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. ACTIVITY LOG
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id),
  type        TEXT NOT NULL,
  label       TEXT NOT NULL,
  flag        TEXT NOT NULL DEFAULT 'OK'
              CHECK (flag IN ('OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch activity_log constraints if it already existed
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_type_check;
UPDATE activity_log SET type = 'vo' WHERE type = 'micro_vo';
UPDATE activity_log SET type = 'defect' WHERE type = 'cacat';
ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_type_check
  CHECK (type IN ('progres', 'terima', 'permintaan', 'cacat', 'defect', 'rework', 'mtn', 'vo', 'attendance'));
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_flag_check;
UPDATE activity_log SET flag = 'OK' WHERE flag NOT IN ('OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL');
ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_flag_check
  CHECK (flag IN ('OK', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'));

CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- 10. MTN REQUESTS (Material Transfer Nota)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mtn_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by            UUID NOT NULL REFERENCES profiles(id),
  material_name           TEXT NOT NULL,
  material_id             UUID,   -- FK to material_catalog added after 002_baseline_tables.sql runs
  quantity                NUMERIC NOT NULL CHECK (quantity > 0),
  unit                    TEXT,
  destination_project     TEXT NOT NULL,           -- human-readable name
  destination_project_id  UUID REFERENCES projects(id),  -- FK when selected from picker
  reason                  TEXT,
  photo_path              TEXT,
  status                  TEXT NOT NULL DEFAULT 'AWAITING'
                          CHECK (status IN ('AWAITING', 'APPROVED', 'REJECTED', 'RECEIVED')),
  reviewed_by             UUID REFERENCES profiles(id),
  reviewed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Patch mtn_requests if it already existed
ALTER TABLE mtn_requests ADD COLUMN IF NOT EXISTS material_id             UUID;
ALTER TABLE mtn_requests ADD COLUMN IF NOT EXISTS unit                    TEXT;
ALTER TABLE mtn_requests ADD COLUMN IF NOT EXISTS destination_project_id  UUID REFERENCES projects(id);
ALTER TABLE mtn_requests ADD COLUMN IF NOT EXISTS reviewed_by             UUID REFERENCES profiles(id);
ALTER TABLE mtn_requests ADD COLUMN IF NOT EXISTS reviewed_at             TIMESTAMPTZ;
ALTER TABLE mtn_requests DROP CONSTRAINT IF EXISTS mtn_requests_status_check;
UPDATE mtn_requests SET status = 'AWAITING' WHERE status NOT IN ('AWAITING', 'APPROVED', 'REJECTED', 'RECEIVED');
ALTER TABLE mtn_requests
  ADD CONSTRAINT mtn_requests_status_check
  CHECK (status IN ('AWAITING', 'APPROVED', 'REJECTED', 'RECEIVED'));

CREATE INDEX IF NOT EXISTS idx_mtn_requests_project ON mtn_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_mtn_requests_dest    ON mtn_requests(destination_project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 11. MATERIAL RECEIPTS (legacy table — backward compat)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id),
  quantity_actual NUMERIC NOT NULL CHECK (quantity_actual > 0),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: receipt_photos is defined in 002_baseline_tables.sql (depends on receipts table)

-- ═══════════════════════════════════════════════════════════════════════
-- 12. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE envelopes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE defects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtn_requests          ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile; admins can read all
DROP POLICY IF EXISTS "profiles_self_read" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
CREATE POLICY "profiles_self_read" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Projects: users can see projects they are assigned to
DROP POLICY IF EXISTS "projects_assigned" ON projects;
CREATE POLICY "projects_assigned" ON projects FOR SELECT USING (
  id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Project assignments: users can see their own assignments
DROP POLICY IF EXISTS "assignments_self" ON project_assignments;
CREATE POLICY "assignments_self" ON project_assignments FOR SELECT USING (user_id = auth.uid());

-- BoQ items: scoped to assigned projects
DROP POLICY IF EXISTS "boq_items_assigned" ON boq_items;
CREATE POLICY "boq_items_assigned" ON boq_items FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Envelopes: scoped to assigned projects
DROP POLICY IF EXISTS "envelopes_assigned" ON envelopes;
CREATE POLICY "envelopes_assigned" ON envelopes FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Purchase orders: scoped to assigned projects
DROP POLICY IF EXISTS "purchase_orders_assigned" ON purchase_orders;
CREATE POLICY "purchase_orders_assigned" ON purchase_orders FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Milestones: scoped to assigned projects
DROP POLICY IF EXISTS "milestones_assigned" ON milestones;
CREATE POLICY "milestones_assigned" ON milestones FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Defects: scoped to assigned projects
DROP POLICY IF EXISTS "defects_assigned" ON defects;
CREATE POLICY "defects_assigned" ON defects FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- Activity log: scoped to assigned projects
DROP POLICY IF EXISTS "activity_log_assigned" ON activity_log;
CREATE POLICY "activity_log_assigned" ON activity_log FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);

-- MTN requests: scoped to source or destination project
DROP POLICY IF EXISTS "mtn_assigned" ON mtn_requests;
CREATE POLICY "mtn_assigned" ON mtn_requests FOR ALL USING (
  project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
  OR destination_project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
);
