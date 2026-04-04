-- ============================================
-- SAN Contractor — Supabase Database Schema
-- Pengawas Lapangan (Field Supervisor) App
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES (linked to Supabase Auth)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'supervisor' CHECK (role IN ('supervisor', 'estimator', 'principal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read projects" ON projects FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================
-- PROJECT ASSIGNMENTS
-- ============================================
CREATE TABLE project_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own assignments" ON project_assignments
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- BOQ ITEMS (Bill of Quantities)
-- ============================================
CREATE TABLE boq_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  tier1_material TEXT,
  tier2_material TEXT,
  progress NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  planned NUMERIC(12,2) NOT NULL CHECK (planned > 0),
  installed NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (installed >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read boq_items" ON boq_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = boq_items.project_id AND pa.user_id = auth.uid()
    )
  );

-- ============================================
-- MATERIALS CATALOG
-- ============================================
CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  unit TEXT NOT NULL,
  supplier_unit TEXT NOT NULL
);

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read materials" ON materials
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================
-- MATERIAL ENVELOPES (budget tracking)
-- ============================================
CREATE TABLE envelopes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  planned NUMERIC(12,2) NOT NULL CHECK (planned > 0),
  received NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (received >= 0),
  unit TEXT NOT NULL,
  ai_adjustment NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  UNIQUE (project_id, material_name)
);

ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read envelopes" ON envelopes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = envelopes.project_id AND pa.user_id = auth.uid()
    )
  );

-- ============================================
-- MILESTONES
-- ============================================
CREATE TABLE milestones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  planned_date DATE NOT NULL,
  boq_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ON_TRACK' CHECK (status IN ('ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETE'))
);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read milestones" ON milestones
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = milestones.project_id AND pa.user_id = auth.uid()
    )
  );

-- ============================================
-- MATERIAL REQUESTS (Gate 1)
-- ============================================
CREATE TABLE material_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES profiles(id),
  material_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  target_date DATE NOT NULL,
  notes TEXT,
  gate1_flag TEXT NOT NULL CHECK (gate1_flag IN ('OK', 'INFO', 'WARNING', 'CRITICAL')),
  gate1_details JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_HOLD')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE material_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read requests" ON material_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = material_requests.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create requests" ON material_requests
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

-- ============================================
-- PURCHASE ORDERS
-- ============================================
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  supplier TEXT NOT NULL,
  ordered_date DATE NOT NULL,
  boq_ref TEXT,
  flag TEXT NOT NULL DEFAULT 'OK' CHECK (flag IN ('OK', 'INFO', 'WARNING', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RECEIVED', 'PARTIAL', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read POs" ON purchase_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = purchase_orders.project_id AND pa.user_id = auth.uid()
    )
  );

-- ============================================
-- MATERIAL RECEIPTS (Gate 3)
-- ============================================
CREATE TABLE material_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_by UUID NOT NULL REFERENCES profiles(id),
  quantity_actual NUMERIC(12,2) NOT NULL CHECK (quantity_actual > 0),
  unit TEXT NOT NULL,
  gate3_flag TEXT NOT NULL CHECK (gate3_flag IN ('OK', 'INFO', 'WARNING', 'CRITICAL')),
  gate3_details JSONB,
  gps_lat NUMERIC(10,7),
  gps_lon NUMERIC(10,7),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE material_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read receipts" ON material_receipts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = material_receipts.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create receipts" ON material_receipts
  FOR INSERT WITH CHECK (auth.uid() = received_by);

-- ============================================
-- RECEIPT PHOTOS
-- ============================================
CREATE TABLE receipt_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id UUID NOT NULL REFERENCES material_receipts(id) ON DELETE CASCADE,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('surat_jalan', 'material_site', 'vehicle', 'tiket_timbang')),
  storage_path TEXT NOT NULL,
  gps_lat NUMERIC(10,7),
  gps_lon NUMERIC(10,7),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE receipt_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read receipt photos" ON receipt_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM material_receipts mr
      JOIN project_assignments pa ON pa.project_id = mr.project_id
      WHERE mr.id = receipt_photos.receipt_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can insert receipt photos" ON receipt_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM material_receipts mr WHERE mr.id = receipt_photos.receipt_id AND mr.received_by = auth.uid()
    )
  );

-- ============================================
-- PROGRESS REPORTS (Gate 4)
-- ============================================
CREATE TABLE progress_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE RESTRICT,
  reported_by UUID NOT NULL REFERENCES profiles(id),
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  work_status TEXT NOT NULL CHECK (work_status IN ('IN_PROGRESS', 'COMPLETE', 'COMPLETE_DEFECT')),
  location TEXT,
  photo_before_path TEXT,
  photo_after_path TEXT,
  gps_lat NUMERIC(10,7),
  gps_lon NUMERIC(10,7),
  gate4_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE progress_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read progress" ON progress_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = progress_reports.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create progress" ON progress_reports
  FOR INSERT WITH CHECK (auth.uid() = reported_by);

-- ============================================
-- DEFECTS / PUNCH LIST
-- ============================================
CREATE TABLE defects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_ref TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Minor', 'Major', 'Critical')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN REPAIR', 'RESOLVED', 'VERIFIED')),
  photo_path TEXT,
  repair_photo_path TEXT,
  reported_by UUID NOT NULL REFERENCES profiles(id),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ
);

ALTER TABLE defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read defects" ON defects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = defects.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create defects" ON defects
  FOR INSERT WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "Supervisors can update defects" ON defects
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = defects.project_id AND pa.user_id = auth.uid()
    )
  );

-- ============================================
-- ATTENDANCE
-- ============================================
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  worker_count INTEGER NOT NULL CHECK (worker_count > 0),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, date, recorded_by)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read attendance" ON attendance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = attendance.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create attendance" ON attendance
  FOR INSERT WITH CHECK (auth.uid() = recorded_by);

-- ============================================
-- MTN (Material Transfer Notes)
-- ============================================
CREATE TABLE mtn_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id),
  material_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  destination_project TEXT NOT NULL,
  reason TEXT NOT NULL,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'AWAITING' CHECK (status IN ('AWAITING', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mtn_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read MTNs" ON mtn_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = mtn_requests.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create MTNs" ON mtn_requests
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

-- ============================================
-- MICRO VARIATION ORDERS
-- ============================================
CREATE TABLE micro_vos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id),
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  est_material TEXT,
  est_cost NUMERIC(14,2),
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'AWAITING' CHECK (status IN ('AWAITING', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE micro_vos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read micro VOs" ON micro_vos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = micro_vos.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create micro VOs" ON micro_vos
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

-- ============================================
-- ACTIVITY LOG
-- ============================================
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL CHECK (type IN ('progres', 'terima', 'permintaan', 'cacat', 'mtn', 'micro_vo', 'attendance')),
  label TEXT NOT NULL,
  flag TEXT NOT NULL DEFAULT 'OK' CHECK (flag IN ('OK', 'INFO', 'WARNING', 'CRITICAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_log_project_date ON activity_log(project_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can read activity" ON activity_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = activity_log.project_id AND pa.user_id = auth.uid()
    )
  );
CREATE POLICY "Supervisors can create activity" ON activity_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- MATERIAL RECEIPT TOTALS (materialized view)
-- ============================================
CREATE OR REPLACE VIEW material_receipt_totals AS
SELECT
  po.project_id,
  po.material_name,
  SUM(mr.quantity_actual) AS total_received,
  m.unit
FROM material_receipts mr
JOIN purchase_orders po ON po.id = mr.po_id
LEFT JOIN materials m ON m.name = po.material_name
GROUP BY po.project_id, po.material_name, m.unit;

-- ============================================
-- FUNCTION: auto-update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_boq_items
  BEFORE UPDATE ON boq_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- FUNCTION: auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Supervisor'),
    NEW.phone
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- STORAGE BUCKETS
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', false);

CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos' AND auth.role() = 'authenticated');
