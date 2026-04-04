-- SANO — Seed Data for Testing
-- Run AFTER 001_core_tables.sql and 002_baseline_tables.sql.
-- If 004_boq_parser_extensions.sql and 008_labor_opname.sql have also been
-- applied, this file will additionally seed labor trade + opname sample data.
--
-- Creates test auth users directly in auth.users, then seeds all tables.
-- Test login credentials:
--   supervisor@sano.test / password123
--   estimator@sano.test  / password123
--   admin@sano.test      / password123
--   principal@sano.test  / password123
--
-- Run this in the Supabase SQL Editor (which has service-role access).

-- ═══════════════════════════════════════════════════════════════════════
-- TEST USER IDs (replace with real UUIDs from your Supabase Auth panel)
-- ═══════════════════════════════════════════════════════════════════════
-- We use predictable UUIDs for easy reference in this seed.

DO $$
DECLARE
  uid_supervisor  UUID := '00000000-0000-0000-0000-000000000001';
  uid_estimator   UUID := '00000000-0000-0000-0000-000000000002';
  uid_admin       UUID := '00000000-0000-0000-0000-000000000003';
  uid_principal   UUID := '00000000-0000-0000-0000-000000000004';
  pid_alpha       UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  pid_beta        UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  boq1            UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  boq2            UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
  boq3            UUID := 'bbbbbbbb-0000-0000-0000-000000000003';
  boq4            UUID := 'bbbbbbbb-0000-0000-0000-000000000004';
  mat1            UUID := 'cccccccc-0000-0000-0000-000000000001';
  mat2            UUID := 'cccccccc-0000-0000-0000-000000000002';
  mat3            UUID := 'cccccccc-0000-0000-0000-000000000003';
  mat4            UUID := 'cccccccc-0000-0000-0000-000000000004';
  mat5            UUID := 'cccccccc-0000-0000-0000-000000000005';
  boq5            UUID := 'bbbbbbbb-0000-0000-0000-000000000005';
  boq6            UUID := 'bbbbbbbb-0000-0000-0000-000000000006';
  boq7            UUID := 'bbbbbbbb-0000-0000-0000-000000000007';
  boq8            UUID := 'bbbbbbbb-0000-0000-0000-000000000008';
  mat6            UUID := 'cccccccc-0000-0000-0000-000000000006';
  mat7            UUID := 'cccccccc-0000-0000-0000-000000000007';
  po1             UUID := 'dddddddd-0000-0000-0000-000000000001';
  po2             UUID := 'dddddddd-0000-0000-0000-000000000002';
  po3             UUID := 'dddddddd-0000-0000-0000-000000000003';
  po4             UUID := 'dddddddd-0000-0000-0000-000000000004';
  po5             UUID := 'dddddddd-0000-0000-0000-000000000005';
  po6             UUID := 'dddddddd-0000-0000-0000-000000000006';
  ms1             UUID := 'eeeeeeee-0000-0000-0000-000000000001';
  ms2             UUID := 'eeeeeeee-0000-0000-0000-000000000002';
  ms3             UUID := 'eeeeeeee-0000-0000-0000-000000000003';
  ms4             UUID := 'eeeeeeee-0000-0000-0000-000000000004';
  ms5             UUID := 'eeeeeeee-0000-0000-0000-000000000005';
  ahs_ver         UUID := 'ffffffff-0000-0000-0000-000000000001';
  ahs_lab1        UUID := 'ffffffff-0000-0000-0000-000000000101';
  ahs_lab2        UUID := 'ffffffff-0000-0000-0000-000000000102';
  ahs_lab3        UUID := 'ffffffff-0000-0000-0000-000000000103';
  ahs_lab4        UUID := 'ffffffff-0000-0000-0000-000000000104';
  ahs_lab5        UUID := 'ffffffff-0000-0000-0000-000000000105';
  ahs_lab6        UUID := 'ffffffff-0000-0000-0000-000000000106';
  ahs_lab7        UUID := 'ffffffff-0000-0000-0000-000000000107';
  ahs_lab8        UUID := 'ffffffff-0000-0000-0000-000000000108';
  ahs_lab9        UUID := 'ffffffff-0000-0000-0000-000000000109';
  contract1       UUID := '99999999-0000-0000-0000-000000000001';
  contract2       UUID := '99999999-0000-0000-0000-000000000002';
  contract3       UUID := '99999999-0000-0000-0000-000000000003';
  contract4       UUID := '99999999-0000-0000-0000-000000000004';
  rate1           UUID := '98989898-0000-0000-0000-000000000001';
  rate2           UUID := '98989898-0000-0000-0000-000000000002';
  rate3           UUID := '98989898-0000-0000-0000-000000000003';
  rate4           UUID := '98989898-0000-0000-0000-000000000004';
  rate5           UUID := '98989898-0000-0000-0000-000000000005';
  rate6           UUID := '98989898-0000-0000-0000-000000000006';
  worker1         UUID := '95959595-0000-0000-0000-000000000001';
  worker2         UUID := '95959595-0000-0000-0000-000000000002';
  worker3         UUID := '95959595-0000-0000-0000-000000000003';
  worker_rate1    UUID := '94949494-0000-0000-0000-000000000001';
  worker_rate2    UUID := '94949494-0000-0000-0000-000000000002';
  worker_rate3    UUID := '94949494-0000-0000-0000-000000000003';
  overtime_rule1  UUID := '93939393-0000-0000-0000-000000000001';
  head1           UUID := '97979797-0000-0000-0000-000000000001';
  head2           UUID := '97979797-0000-0000-0000-000000000002';
  head3           UUID := '97979797-0000-0000-0000-000000000003';
  head4           UUID := '97979797-0000-0000-0000-000000000004';
  head5           UUID := '97979797-0000-0000-0000-000000000005';
  head6           UUID := '97979797-0000-0000-0000-000000000006';
  alloc1          UUID := '92929292-0000-0000-0000-000000000001';
  alloc2          UUID := '92929292-0000-0000-0000-000000000002';
  alloc3          UUID := '92929292-0000-0000-0000-000000000003';
  prog1           UUID := '91919191-0000-0000-0000-000000000001';
  prog2           UUID := '91919191-0000-0000-0000-000000000002';
  prog3           UUID := '91919191-0000-0000-0000-000000000003';
  prog4           UUID := '91919191-0000-0000-0000-000000000004';
  prog5           UUID := '91919191-0000-0000-0000-000000000005';
  prog6           UUID := '91919191-0000-0000-0000-000000000006';
  prog7           UUID := '91919191-0000-0000-0000-000000000007';
  receipt1        UUID := '90909090-0000-0000-0000-000000000001';
  receipt2        UUID := '90909090-0000-0000-0000-000000000002';
  receipt3        UUID := '90909090-0000-0000-0000-000000000003';
  receipt_line1   UUID := '90919192-0000-0000-0000-000000000001';
  receipt_line2   UUID := '90919192-0000-0000-0000-000000000002';
  receipt_line3   UUID := '90919192-0000-0000-0000-000000000003';
  change1         UUID := '90929293-0000-0000-0000-000000000001';
  change2         UUID := '90929293-0000-0000-0000-000000000002';
  change3         UUID := '90929293-0000-0000-0000-000000000003';
  change4         UUID := '90929293-0000-0000-0000-000000000004';
  change5         UUID := '90929293-0000-0000-0000-000000000005';
  line1           UUID := '96969696-0000-0000-0000-000000000001';
  line2           UUID := '96969696-0000-0000-0000-000000000002';
  line3           UUID := '96969696-0000-0000-0000-000000000003';
  line4           UUID := '96969696-0000-0000-0000-000000000004';
  line5           UUID := '96969696-0000-0000-0000-000000000005';
  line6           UUID := '96969696-0000-0000-0000-000000000006';
  line7           UUID := '96969696-0000-0000-0000-000000000007';
  line8           UUID := '96969696-0000-0000-0000-000000000008';
  line9           UUID := '96969696-0000-0000-0000-000000000009';
  line10          UUID := '96969696-0000-0000-0000-000000000010';
  line11          UUID := '96969696-0000-0000-0000-000000000011';
BEGIN

-- ── Auth Users (required before profiles due to FK) ──
-- These are test-only users. For production, create users via Dashboard.
-- Password hash below = bcrypt of 'password123' (test only!)
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000', uid_supervisor, 'authenticated', 'authenticated',
   'supervisor@sano.test',
   crypt('password123', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Budi Santoso"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', uid_estimator, 'authenticated', 'authenticated',
   'estimator@sano.test',
   crypt('password123', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Rina Estimator"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', uid_admin, 'authenticated', 'authenticated',
   'admin@sano.test',
   crypt('password123', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Admin SANO"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', uid_principal, 'authenticated', 'authenticated',
   'principal@sano.test',
   crypt('password123', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Pak Direktur"}'::jsonb,
   now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- ── Profiles ──
INSERT INTO profiles (id, full_name, phone, role) VALUES
  (uid_supervisor, 'Krisanto Supervisor',   '+6281234500001', 'supervisor'),
  (uid_estimator,  'Saiful Estimator', '+6281234500002', 'estimator'),
  (uid_admin,      'Fanny Admin',     '+6281234500003', 'admin'),
  (uid_principal,  'Santoso Prinsipal',   '+6281234500004', 'principal')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

-- ── Projects ──
INSERT INTO projects (id, code, name, location, client_name, contract_value, start_date, end_date) VALUES
  (pid_alpha, 'PRJ-ALPHA', 'Rumah Tinggal Budi — Cimanggis', 'Cimanggis, Depok', 'Budi Hartono', 850000000, '2026-01-15', '2026-10-31'),
  (pid_beta,  'PRJ-BETA',  'Ruko 3 Lantai — Bekasi Timur',   'Bekasi Timur',     'CV Maju Bersama', 1200000000, '2026-03-01', '2027-02-28')
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
  name = EXCLUDED.name,
  location = EXCLUDED.location,
  client_name = EXCLUDED.client_name,
  contract_value = EXCLUDED.contract_value,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date;

SELECT id INTO pid_alpha FROM projects WHERE code = 'PRJ-ALPHA';
SELECT id INTO pid_beta  FROM projects WHERE code = 'PRJ-BETA';

-- ── Assignments ──
INSERT INTO project_assignments (project_id, user_id) VALUES
  (pid_alpha, uid_supervisor),
  (pid_alpha, uid_estimator),
  (pid_alpha, uid_admin),
  (pid_alpha, uid_principal),
  (pid_beta,  uid_supervisor),
  (pid_beta,  uid_estimator),
  (pid_beta,  uid_admin),
  (pid_beta,  uid_principal)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── BoQ Items — PRJ-ALPHA ──
INSERT INTO boq_items (id, project_id, code, label, unit, planned, installed, progress, tier1_material, tier2_material) VALUES
  (boq1, pid_alpha, 'STR-01', 'Pekerjaan Pondasi Footplat',       'm3',  45.0,  12.5,  28, 'Beton Ready Mix K-250', 'Batu Belah'),
  (boq2, pid_alpha, 'STR-02', 'Kolom Beton Bertulang',            'm3',  28.0,   8.0,  29, 'Beton Ready Mix K-300', NULL),
  (boq3, pid_alpha, 'ARC-01', 'Pasangan Dinding Bata Ringan',     'm2', 320.0,  80.0,  25, 'Bata Ringan 600x200x75', 'Bata Merah'),
  (boq4, pid_alpha, 'FIN-01', 'Plesteran Dinding',                'm2', 640.0,   0.0,   0, 'Semen Portland', NULL),
  (boq5, pid_alpha, 'STR-03', 'Balok Beton Bertulang Lt.1',       'm3',  18.0,   5.5,  31, 'Beton Ready Mix K-300', NULL),
  (boq6, pid_alpha, 'FIN-02', 'Pemasangan Keramik Lantai 60x60',  'm2', 210.0,  45.0,  21, 'Keramik 60x60 Granite', NULL),
  (boq7, pid_alpha, 'MEP-01', 'Instalasi Pipa Air Bersih',        'm',  180.0, 120.0,  67, 'Pipa PPR 3/4 inch', NULL),
  (boq8, pid_alpha, 'ARC-02', 'Pemasangan Kusen Aluminium',       'unit', 24.0,   8.0,  33, 'Kusen Aluminium 4 inch', NULL)
ON CONFLICT (project_id, code) DO UPDATE SET
  label = EXCLUDED.label,
  unit = EXCLUDED.unit,
  planned = EXCLUDED.planned,
  installed = EXCLUDED.installed,
  progress = EXCLUDED.progress,
  tier1_material = EXCLUDED.tier1_material,
  tier2_material = EXCLUDED.tier2_material;

SELECT id INTO boq1 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-01';
SELECT id INTO boq2 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-02';
SELECT id INTO boq3 FROM boq_items WHERE project_id = pid_alpha AND code = 'ARC-01';
SELECT id INTO boq4 FROM boq_items WHERE project_id = pid_alpha AND code = 'FIN-01';
SELECT id INTO boq5 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-03';
SELECT id INTO boq6 FROM boq_items WHERE project_id = pid_alpha AND code = 'FIN-02';
SELECT id INTO boq7 FROM boq_items WHERE project_id = pid_alpha AND code = 'MEP-01';
SELECT id INTO boq8 FROM boq_items WHERE project_id = pid_alpha AND code = 'ARC-02';

-- ── Material Catalog ──
INSERT INTO material_catalog (id, code, name, category, tier, unit, supplier_unit) VALUES
  (mat1, 'CON-RM25',  'Ready mix kelas 25',        'Struktur',       1, 'm3',  'm3'),
  (mat2, 'CON-RM30',  'Ready mix kelas 30',         'Struktur',       1, 'm3',  'm3'),
  (mat3, 'AAC-BL07',  'Bata ringan 7.5 cm',         'Dinding',        2, 'pcs', 'pcs'),
  (mat4, 'CEM-OPC50', 'Semen OPC 50 kg',            'Material Beton', 2, 'zak', 'zak'),
  (mat5, 'REB-DE16',  'Besi beton ulir 16 mm',      'Struktur',       1, 'kg',  'kg'),
  (mat6, 'KRM-GR60',  'Keramik granit 60x60 cm',    'Finishing',      2, 'm2',  'm2'),
  (mat7, 'PPR-34',    'Pipa PPR PN-10 3/4 inch',    'MEP',            2, 'm',   'lonjor')
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  tier = EXCLUDED.tier,
  unit = EXCLUDED.unit,
  supplier_unit = EXCLUDED.supplier_unit;

SELECT id INTO mat1 FROM material_catalog WHERE code = 'CON-RM25';
SELECT id INTO mat2 FROM material_catalog WHERE code = 'CON-RM30';
SELECT id INTO mat3 FROM material_catalog WHERE code = 'AAC-BL07';
SELECT id INTO mat4 FROM material_catalog WHERE code = 'CEM-OPC50';
SELECT id INTO mat5 FROM material_catalog WHERE code = 'REB-DE16';
SELECT id INTO mat6 FROM material_catalog WHERE code = 'KRM-GR60';
SELECT id INTO mat7 FROM material_catalog WHERE code = 'PPR-34';

-- ── Price History ──
INSERT INTO price_history (project_id, material_id, vendor, unit_price)
SELECT pid_alpha, v.material_id, v.vendor, v.unit_price
FROM (
  VALUES
    (mat1, 'PT Holcim Beton',    900000::numeric),
    (mat2, 'PT Holcim Beton',    980000::numeric),
    (mat3, 'Toko Bangunan Maju',   7500::numeric),
    (mat4, 'PT Semen Tiga Roda',  72000::numeric),
    (mat5, 'CV Besi Utama',       14500::numeric),
    (mat6, 'CV Keramik Indah',   185000::numeric),
    (mat7, 'Toko Sanitasi Jaya',  28000::numeric)
) AS v(material_id, vendor, unit_price)
WHERE NOT EXISTS (
  SELECT 1
  FROM price_history ph
  WHERE ph.project_id = pid_alpha
    AND ph.material_id = v.material_id
    AND ph.vendor = v.vendor
);

-- ── AHS Version ──
INSERT INTO ahs_versions (id, project_id, version, published_at) VALUES
  (ahs_ver, pid_alpha, 1, now())
ON CONFLICT (id) DO NOTHING;

-- ── AHS Lines ──
INSERT INTO ahs_lines (ahs_version_id, boq_item_id, material_id, material_spec, tier, usage_rate, unit, waste_factor)
SELECT ahs_ver, v.boq_item_id, v.material_id, v.material_spec, v.tier, v.usage_rate, v.unit, v.waste_factor
FROM (
  VALUES
    (boq1, mat1, 'K-250 slump 12cm',      1::smallint,  1.00::numeric, 'm3',  0.03::numeric),
    (boq2, mat2, 'K-300 slump 12cm',      1::smallint,  1.00::numeric, 'm3',  0.03::numeric),
    (boq2, mat5, 'Ø16 BJTS420',           1::smallint, 85.00::numeric, 'kg',  0.05::numeric),
    (boq3, mat3, '600x200x75 AAC',        1::smallint,  8.30::numeric, 'pcs', 0.05::numeric),
    (boq4, mat4, 'Tipe I / OPC',          1::smallint,  0.35::numeric, 'zak', 0.02::numeric),
    (boq5, mat2, 'K-300 slump 12cm',      1::smallint,  1.00::numeric, 'm3',  0.03::numeric),
    (boq5, mat5, 'Ø16 BJTS420',           1::smallint, 92.00::numeric, 'kg',  0.05::numeric),
    (boq6, mat6, 'Granit 60x60 antislip', 1::smallint,  1.05::numeric, 'm2',  0.05::numeric),
    (boq7, mat7, 'PPR PN-10 3/4 inch',    1::smallint,  1.00::numeric, 'm',   0.03::numeric)
) AS v(boq_item_id, material_id, material_spec, tier, usage_rate, unit, waste_factor)
WHERE NOT EXISTS (
  SELECT 1
  FROM ahs_lines al
  WHERE al.ahs_version_id = ahs_ver
    AND al.boq_item_id = v.boq_item_id
    AND COALESCE(al.material_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v.material_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(al.material_spec, '') = COALESCE(v.material_spec, '')
    AND al.tier = v.tier
    AND al.usage_rate = v.usage_rate
    AND al.unit = v.unit
);

-- ── Labor AHS lines + labor/opname sample data (only if 008 is applied) ──
IF EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'mandor_contracts'
) THEN
  INSERT INTO ahs_lines (
    id, ahs_version_id, boq_item_id, material_id, material_spec, tier, usage_rate, unit, waste_factor,
    line_type, coefficient, unit_price, description, ahs_block_title, source_row, trade_category, trade_confirmed
  ) VALUES
    (ahs_lab1, ahs_ver, boq1, NULL, NULL, 3, 0.55, 'OH', 0, 'labor', 0.55, 125000, 'Tukang cor beton',              'Pekerjaan Pondasi Footplat',          401, 'beton_bekisting', false),
    (ahs_lab2, ahs_ver, boq1, NULL, NULL, 3, 0.90, 'OH', 0, 'labor', 0.90, 110000, 'Pekerja bekisting footplat',    'Pekerjaan Pondasi Footplat',          402, 'beton_bekisting', false),
    (ahs_lab3, ahs_ver, boq2, NULL, NULL, 3, 1.35, 'OH', 0, 'labor', 1.35, 130000, 'Tukang kayu bekisting kolom',   'Kolom Beton Bertulang',              411, 'beton_bekisting', false),
    (ahs_lab4, ahs_ver, boq2, NULL, NULL, 3, 1.55, 'OH', 0, 'labor', 1.55, 135000, 'Tukang besi kolom',             'Kolom Beton Bertulang',              412, 'besi',            false),
    (ahs_lab5, ahs_ver, boq4, NULL, NULL, 3, 0.12, 'OH', 0, 'labor', 0.12, 130000, 'Tukang plester',                'Plesteran Dinding',                  421, 'plesteran',       false),
    (ahs_lab6, ahs_ver, boq4, NULL, NULL, 3, 0.10, 'OH', 0, 'labor', 0.10, 115000, 'Pekerja acian',                 'Plesteran Dinding',                  422, 'plesteran',       false),
    (ahs_lab7, ahs_ver, boq6, NULL, NULL, 3, 0.35, 'OH', 0, 'labor', 0.35, 165000, 'Tukang keramik',                'Pemasangan Keramik Lantai 60x60',    431, 'finishing',       false),
    (ahs_lab8, ahs_ver, boq6, NULL, NULL, 3, 0.20, 'OH', 0, 'labor', 0.20, 125000, 'Pekerja finishing lantai',      'Pemasangan Keramik Lantai 60x60',    432, 'finishing',       false),
    (ahs_lab9, ahs_ver, boq7, NULL, NULL, 3, 0.45, 'OH', 0, 'labor', 0.45, 150000, 'Tukang pipa air bersih',        'Instalasi Pipa Air Bersih',          441, 'mep',             false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO mandor_contracts (
    id, project_id, mandor_name, trade_categories, retention_pct, notes, is_active, created_by
  ) VALUES
    (contract1, pid_alpha, 'Mandor Beton Pak Darto',    '["beton_bekisting","besi"]'::jsonb, 10, 'Menangani pekerjaan struktur beton, bekisting, dan pembesian.', true, uid_estimator),
    (contract2, pid_alpha, 'Mandor Finishing Bu Sari',  '["plesteran","finishing"]'::jsonb,   8, 'Menangani plesteran, acian, dan finishing lantai.',             true, uid_estimator),
    (contract3, pid_alpha, 'Mandor MEP Pak Agus',       '["mep"]'::jsonb,                       5, 'Menangani instalasi pipa air bersih dan item MEP ringan.',     true, uid_estimator)
  ON CONFLICT (project_id, mandor_name) DO UPDATE SET
    trade_categories = EXCLUDED.trade_categories,
    retention_pct = EXCLUDED.retention_pct,
    notes = EXCLUDED.notes,
    is_active = EXCLUDED.is_active,
    created_by = EXCLUDED.created_by;

  SELECT id INTO contract1 FROM mandor_contracts WHERE project_id = pid_alpha AND mandor_name = 'Mandor Beton Pak Darto';
  SELECT id INTO contract2 FROM mandor_contracts WHERE project_id = pid_alpha AND mandor_name = 'Mandor Finishing Bu Sari';
  SELECT id INTO contract3 FROM mandor_contracts WHERE project_id = pid_alpha AND mandor_name = 'Mandor MEP Pak Agus';

  INSERT INTO mandor_contract_rates (
    id, contract_id, boq_item_id, contracted_rate, boq_labor_rate, unit, notes
  ) VALUES
    (rate1, contract1, boq1, 175000, 167750, 'm3', 'Borongan struktur pondasi per m3'),
    (rate2, contract1, boq2, 410000, 384750, 'm3', 'Sudah termasuk bekisting kolom dan pembesian'),
    (rate3, contract1, boq5, 395000, 364750, 'm3', 'Rate balok beton bertulang lantai 1'),
    (rate4, contract2, boq4,  28000,  27100, 'm2', 'Rate plester + aci per m2'),
    (rate5, contract2, boq6,  92000,  82750, 'm2', 'Rate pemasangan keramik per m2'),
    (rate6, contract3, boq7,  68000,  67500, 'm',  'Rate instalasi pipa air bersih per meter')
  ON CONFLICT (contract_id, boq_item_id) DO NOTHING;

  INSERT INTO opname_headers (
    id, project_id, contract_id, week_number, opname_date, status,
    submitted_by, submitted_at, verified_by, verified_at, verifier_notes,
    approved_by, approved_at,
    gross_total, retention_pct, retention_amount, net_to_date, prior_paid, kasbon, net_this_week
  ) VALUES
    (head1, pid_alpha, contract1, 8, '2026-03-05', 'PAID',
      uid_supervisor, '2026-03-05T10:00:00+07', uid_estimator, '2026-03-06T11:30:00+07', 'Sample week 8 structure opname',
      uid_admin, '2026-03-06T16:00:00+07',
      4967100, 10, 496710, 4470390, 0, 0, 4470390),
    (head2, pid_alpha, contract1, 9, '2026-03-12', 'SUBMITTED',
      uid_supervisor, '2026-03-12T17:00:00+07', NULL, NULL, NULL,
      NULL, NULL,
      7799500, 10, 779950, 7019550, 4470390, 0, 2549160),
    (head3, pid_alpha, contract2, 7, '2026-03-15', 'DRAFT',
      NULL, NULL, NULL, NULL, NULL,
      NULL, NULL,
      6428800, 8, 514304, 5914496, 0, 0, 5914496),
    (head4, pid_alpha, contract2, 8, '2026-03-22', 'VERIFIED',
      uid_supervisor, '2026-03-22T16:00:00+07', uid_estimator, '2026-03-23T09:30:00+07', 'Keramik diverifikasi turun 1% pada area tepi.',
      NULL, NULL,
      5796000, 8, 463680, 5332320, 0, 0, 5332320),
    (head5, pid_alpha, contract3, 9, '2026-03-25', 'APPROVED',
      uid_supervisor, '2026-03-25T15:30:00+07', uid_estimator, '2026-03-26T09:00:00+07', 'Sudah sesuai test pressure.',
      uid_admin, '2026-03-26T13:00:00+07',
      8200800, 5, 410040, 7790760, 0, 250000, 7540760)
  ON CONFLICT (contract_id, week_number) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    opname_date = EXCLUDED.opname_date,
    status = EXCLUDED.status,
    submitted_by = EXCLUDED.submitted_by,
    submitted_at = EXCLUDED.submitted_at,
    verified_by = EXCLUDED.verified_by,
    verified_at = EXCLUDED.verified_at,
    verifier_notes = EXCLUDED.verifier_notes,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    gross_total = EXCLUDED.gross_total,
    retention_pct = EXCLUDED.retention_pct,
    retention_amount = EXCLUDED.retention_amount,
    net_to_date = EXCLUDED.net_to_date,
    prior_paid = EXCLUDED.prior_paid,
    kasbon = EXCLUDED.kasbon,
    net_this_week = EXCLUDED.net_this_week;

  SELECT id INTO head1 FROM opname_headers WHERE contract_id = contract1 AND week_number = 8;
  SELECT id INTO head2 FROM opname_headers WHERE contract_id = contract1 AND week_number = 9;
  SELECT id INTO head3 FROM opname_headers WHERE contract_id = contract2 AND week_number = 7;
  SELECT id INTO head4 FROM opname_headers WHERE contract_id = contract2 AND week_number = 8;
  SELECT id INTO head5 FROM opname_headers WHERE contract_id = contract3 AND week_number = 9;

  INSERT INTO opname_lines (
    id, header_id, boq_item_id, description, unit, budget_volume, contracted_rate, boq_labor_rate,
    cumulative_pct, verified_pct, prev_cumulative_pct, cumulative_amount, this_week_amount,
    is_tdk_acc, tdk_acc_reason, notes
  ) VALUES
    (line1, head1, boq1, 'Pekerjaan Pondasi Footplat',      'm3',  45.0, 175000, 167750, 26, NULL,  0, 2047500, 2047500, false, NULL, 'Opname baseline struktur pondasi'),
    (line2, head1, boq2, 'Kolom Beton Bertulang',           'm3',  28.0, 410000, 384750, 18, NULL,  0, 2066400, 2066400, false, NULL, 'Progress kolom minggu 8'),
    (line3, head1, boq5, 'Balok Beton Bertulang Lt.1',      'm3',  18.0, 395000, 364750, 12, NULL,  0,  853200,  853200, false, NULL, 'Balok awal lantai 1'),
    (line7, head2, boq1, 'Pekerjaan Pondasi Footplat',      'm3',  45.0, 175000, 167750, 36, NULL, 26, 2835000,  787500, false, NULL, 'Lanjutan pengecoran footplat'),
    (line8, head2, boq2, 'Kolom Beton Bertulang',           'm3',  28.0, 410000, 384750, 29, NULL, 18, 3329200, 1262800, false, NULL, 'Kolom bertambah sesuai opname supervisor'),
    (line9, head2, boq5, 'Balok Beton Bertulang Lt.1',      'm3',  18.0, 395000, 364750, 23, NULL, 12, 1635300,  782100, false, NULL, 'Balok naik setelah bekisting dibuka'),
    (line4, head3, boq4, 'Plesteran Dinding',               'm2', 640.0,  28000,  27100, 10, NULL,  0, 1792000, 1792000, false, NULL, 'Draft opname plesteran'),
    (line5, head3, boq6, 'Pemasangan Keramik Lantai 60x60', 'm2', 210.0,  92000,  82750, 24, NULL,  0, 4636800, 4636800, false, NULL, 'Draft opname keramik'),
    (line10, head4, boq4, 'Plesteran Dinding',              'm2', 640.0,  28000,  27100, 18, 16,   10, 2867200, 1075200, true,  'Sebagian bidang belum rata, ditahan estimator', 'Ada bidang yang diminta perbaikan'),
    (line11, head4, boq6, 'Pemasangan Keramik Lantai 60x60','m2', 210.0,  92000,  82750, 31, 30,   24, 5796000, 1159200, false, NULL, 'Verifier menurunkan progress 1%'),
    (line6, head5, boq7, 'Instalasi Pipa Air Bersih',       'm',  180.0,  68000,  67500, 67, NULL,  0, 8200800, 8200800, false, NULL, 'Sudah siap dibayar setelah approval admin')
  ON CONFLICT (header_id, boq_item_id) DO NOTHING;

  -- ── Harian mandor sample data (only if 015/017/018 are applied) ──
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mandor_contracts'
      AND column_name = 'payment_mode'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'mandor_workers'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'worker_rates'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'worker_attendance_entries'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'opname_headers'
      AND column_name = 'payment_type'
  ) THEN
    INSERT INTO mandor_contracts (
      id, project_id, mandor_name, trade_categories, retention_pct, notes, is_active, created_by,
      payment_mode, daily_rate
    ) VALUES (
      contract4, pid_alpha, 'Mandor Harian Pak Joko', '["finishing"]'::jsonb, 0,
      'Contoh kontrak harian untuk alur HOK mingguan: roster pekerja, kehadiran, lalu opname mingguan.', true, uid_estimator,
      'harian', 140000
    )
    ON CONFLICT (project_id, mandor_name) DO UPDATE SET
      trade_categories = EXCLUDED.trade_categories,
      retention_pct = EXCLUDED.retention_pct,
      notes = EXCLUDED.notes,
      is_active = EXCLUDED.is_active,
      created_by = EXCLUDED.created_by,
      payment_mode = EXCLUDED.payment_mode,
      daily_rate = EXCLUDED.daily_rate;

    SELECT id INTO contract4
    FROM mandor_contracts
    WHERE project_id = pid_alpha
      AND mandor_name = 'Mandor Harian Pak Joko';

    INSERT INTO mandor_workers (
      id, contract_id, project_id, worker_name, skill_level, is_active, notes, created_by
    ) VALUES
      (worker1, contract4, pid_alpha, 'Jajang Tukang', 'tukang',   true, 'Sample pekerja harian finishing', uid_estimator),
      (worker2, contract4, pid_alpha, 'Udin Kenek',    'kenek',    true, 'Sample pekerja harian finishing', uid_estimator),
      (worker3, contract4, pid_alpha, 'Dede Tukang',   'tukang',   true, 'Sample pekerja harian finishing', uid_estimator)
    ON CONFLICT (contract_id, worker_name) DO UPDATE SET
      skill_level = EXCLUDED.skill_level,
      is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes,
      created_by = EXCLUDED.created_by;

    SELECT id INTO worker1 FROM mandor_workers WHERE contract_id = contract4 AND worker_name = 'Jajang Tukang';
    SELECT id INTO worker2 FROM mandor_workers WHERE contract_id = contract4 AND worker_name = 'Udin Kenek';
    SELECT id INTO worker3 FROM mandor_workers WHERE contract_id = contract4 AND worker_name = 'Dede Tukang';

    INSERT INTO worker_rates (
      id, worker_id, contract_id, daily_rate, effective_from, effective_to, notes, set_by
    ) VALUES
      (worker_rate1, worker1, contract4, 150000, '2026-03-01', NULL, 'Rate tukang finishing harian', uid_estimator),
      (worker_rate2, worker2, contract4, 120000, '2026-03-01', NULL, 'Rate kenek finishing harian',  uid_estimator),
      (worker_rate3, worker3, contract4, 145000, '2026-03-01', NULL, 'Rate tukang finishing harian', uid_estimator)
    ON CONFLICT (id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      contract_id = EXCLUDED.contract_id,
      daily_rate = EXCLUDED.daily_rate,
      effective_from = EXCLUDED.effective_from,
      effective_to = EXCLUDED.effective_to,
      notes = EXCLUDED.notes,
      set_by = EXCLUDED.set_by;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'mandor_overtime_rules'
    ) THEN
      INSERT INTO mandor_overtime_rules (
        id, contract_id, normal_hours, tier1_threshold_hours, tier1_hourly_rate,
        tier2_threshold_hours, tier2_hourly_rate, effective_from, created_by
      ) VALUES (
        overtime_rule1, contract4, 7, 7, 12500, 10, 18000, '2026-03-01', uid_estimator
      )
      ON CONFLICT (contract_id, effective_from) DO UPDATE SET
        normal_hours = EXCLUDED.normal_hours,
        tier1_threshold_hours = EXCLUDED.tier1_threshold_hours,
        tier1_hourly_rate = EXCLUDED.tier1_hourly_rate,
        tier2_threshold_hours = EXCLUDED.tier2_threshold_hours,
        tier2_hourly_rate = EXCLUDED.tier2_hourly_rate,
        created_by = EXCLUDED.created_by;
    END IF;

    INSERT INTO worker_attendance_entries (
      contract_id, project_id, worker_id, attendance_date,
      is_present, overtime_hours,
      daily_rate_snapshot, tier1_rate_snapshot, tier2_rate_snapshot,
      tier1_threshold_snapshot, tier2_threshold_snapshot,
      regular_pay, overtime_pay, day_total,
      status, work_description, recorded_by, confirmed_by, confirmed_at,
      source, app_validated, is_locked
    )
    SELECT
      contract4,
      pid_alpha,
      v.worker_id,
      v.attendance_date::date,
      v.is_present,
      v.overtime_hours,
      v.daily_rate,
      12500,
      18000,
      7,
      10,
      0,
      0,
      0,
      'CONFIRMED',
      v.work_description,
      uid_supervisor,
      uid_supervisor,
      (v.attendance_date::date + time '17:00'),
      'manual',
      false,
      false
    FROM (
      VALUES
        (worker1, '2026-03-23', true, 2::numeric, 150000::numeric, 'Plester area koridor & perapihan list'),
        (worker2, '2026-03-23', true, 0::numeric, 120000::numeric, 'Angkut material mortar dan tools'),
        (worker3, '2026-03-23', true, 0::numeric, 145000::numeric, 'Finishing sudut dan level lantai'),
        (worker1, '2026-03-24', true, 1::numeric, 150000::numeric, 'Perapihan plester area kamar'),
        (worker2, '2026-03-24', true, 0::numeric, 120000::numeric, 'Bantu mixing mortar'),
        (worker3, '2026-03-24', true, 2::numeric, 145000::numeric, 'Acian detail dan koreksi bidang'),
        (worker1, '2026-03-25', true, 0::numeric, 150000::numeric, 'Finishing list pintu'),
        (worker2, '2026-03-25', false, 0::numeric, 120000::numeric, 'Izin keluarga'),
        (worker3, '2026-03-25', true, 1::numeric, 145000::numeric, 'Perapihan nat dan sudut'),
        (worker1, '2026-03-26', true, 2::numeric, 150000::numeric, 'Finishing bidang tangga'),
        (worker2, '2026-03-26', true, 1::numeric, 120000::numeric, 'Angkut dan bersih area kerja'),
        (worker3, '2026-03-26', true, 0::numeric, 145000::numeric, 'Perapihan dinding tangga'),
        (worker1, '2026-03-27', true, 0::numeric, 150000::numeric, 'Acian kamar mandi dan servis'),
        (worker2, '2026-03-27', true, 0::numeric, 120000::numeric, 'Bersih area dan support acian'),
        (worker3, '2026-03-27', true, 0::numeric, 145000::numeric, 'Finishing bidang servis'),
        (worker1, '2026-03-28', true, 1::numeric, 150000::numeric, 'Retouch akhir dan list'),
        (worker2, '2026-03-28', true, 0::numeric, 120000::numeric, 'Support bongkar alat dan pembersihan'),
        (worker3, '2026-03-28', true, 2::numeric, 145000::numeric, 'Perapihan akhir dan punchlist')
    ) AS v(worker_id, attendance_date, is_present, overtime_hours, daily_rate, work_description)
    ON CONFLICT (worker_id, attendance_date) DO UPDATE SET
      contract_id = EXCLUDED.contract_id,
      project_id = EXCLUDED.project_id,
      is_present = EXCLUDED.is_present,
      overtime_hours = EXCLUDED.overtime_hours,
      daily_rate_snapshot = EXCLUDED.daily_rate_snapshot,
      tier1_rate_snapshot = EXCLUDED.tier1_rate_snapshot,
      tier2_rate_snapshot = EXCLUDED.tier2_rate_snapshot,
      tier1_threshold_snapshot = EXCLUDED.tier1_threshold_snapshot,
      tier2_threshold_snapshot = EXCLUDED.tier2_threshold_snapshot,
      regular_pay = EXCLUDED.regular_pay,
      overtime_pay = EXCLUDED.overtime_pay,
      day_total = EXCLUDED.day_total,
      status = EXCLUDED.status,
      work_description = EXCLUDED.work_description,
      recorded_by = EXCLUDED.recorded_by,
      confirmed_by = EXCLUDED.confirmed_by,
      confirmed_at = EXCLUDED.confirmed_at,
      source = EXCLUDED.source,
      app_validated = EXCLUDED.app_validated,
      is_locked = EXCLUDED.is_locked;

    INSERT INTO opname_headers (
      id, project_id, contract_id, week_number, opname_date, status,
      payment_type, retention_pct, week_start, week_end,
      gross_total, retention_amount, net_to_date, prior_paid, kasbon, net_this_week, harian_total
    ) VALUES (
      head6, pid_alpha, contract4, 9, '2026-03-29', 'DRAFT',
      'harian', 0, '2026-03-23', '2026-03-28',
      0, 0, 0, 0, 0, 0, 0
    )
    ON CONFLICT (contract_id, week_number) DO UPDATE SET
      project_id = EXCLUDED.project_id,
      opname_date = EXCLUDED.opname_date,
      status = EXCLUDED.status,
      payment_type = EXCLUDED.payment_type,
      retention_pct = EXCLUDED.retention_pct,
      week_start = EXCLUDED.week_start,
      week_end = EXCLUDED.week_end,
      gross_total = EXCLUDED.gross_total,
      retention_amount = EXCLUDED.retention_amount,
      net_to_date = EXCLUDED.net_to_date,
      prior_paid = EXCLUDED.prior_paid,
      kasbon = EXCLUDED.kasbon,
      net_this_week = EXCLUDED.net_this_week,
      harian_total = EXCLUDED.harian_total;

    SELECT id INTO head6
    FROM opname_headers
    WHERE contract_id = contract4
      AND week_number = 9;

    PERFORM recompute_opname_header_totals(head6);

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'harian_cost_allocations'
    ) THEN
      INSERT INTO harian_cost_allocations (
        id, header_id, project_id, contract_id, boq_item_id, allocation_scope, allocation_pct,
        ai_suggested_pct, ai_reason, supervisor_note, estimator_note, created_by, updated_by
      ) VALUES
        (
          alloc1, head6, pid_alpha, contract4, boq4, 'boq_item', 48,
          52, 'HIGH — Uraian kerja dominan ke plester, acian, dan finishing bidang dinding.', 'Mayoritas tenaga fokus plester + acian area servis dan koridor.', 'Final disesuaikan turun sedikit karena ada support non-BoQ.', uid_supervisor, uid_estimator
        ),
        (
          alloc2, head6, pid_alpha, contract4, boq6, 'boq_item', 22,
          18, 'MEDIUM — Ada pekerjaan finishing lantai dan perapihan level, tetapi porsinya tidak dominan.', 'Sebagian tukang bantu finishing sudut dan level lantai.', 'Porsi dinaikkan karena ada 2 hari fokus detail lantai.', uid_supervisor, uid_estimator
        ),
        (
          alloc3, head6, pid_alpha, contract4, NULL, 'general_support', 30,
          30, 'MEDIUM — Ada angkut material, pembersihan, dan support umum yang tidak tepat dipaksa ke 1 item BoQ.', 'Kenek banyak support mortar, angkut alat, dan bersih area.', 'Biarkan di support umum agar progress fisik tidak dipaksa naik.', uid_supervisor, uid_estimator
        )
      ON CONFLICT (id) DO UPDATE SET
        header_id = EXCLUDED.header_id,
        project_id = EXCLUDED.project_id,
        contract_id = EXCLUDED.contract_id,
        boq_item_id = EXCLUDED.boq_item_id,
        allocation_scope = EXCLUDED.allocation_scope,
        allocation_pct = EXCLUDED.allocation_pct,
        ai_suggested_pct = EXCLUDED.ai_suggested_pct,
        ai_reason = EXCLUDED.ai_reason,
        supervisor_note = EXCLUDED.supervisor_note,
        estimator_note = EXCLUDED.estimator_note,
        created_by = EXCLUDED.created_by,
        updated_by = EXCLUDED.updated_by;
    END IF;
  END IF;
END IF;

-- ── Purchase Orders ──
INSERT INTO purchase_orders (id, project_id, po_number, boq_ref, supplier, material_name, quantity, unit, unit_price, ordered_date, status) VALUES
  (po1, pid_alpha, 'PO-PRJALPHA-001', 'STR-01', 'PT Holcim Beton',      'Ready mix kelas 25',       45.0, 'm3',  900000, '2026-02-10', 'PARTIAL_RECEIVED'),
  (po2, pid_alpha, 'PO-PRJALPHA-002', 'ARC-01', 'Toko Bangunan Maju',   'Bata ringan 7.5 cm',       2660, 'pcs', 7500,   '2026-02-15', 'OPEN'),
  (po3, pid_alpha, 'PO-PRJALPHA-003', 'STR-02', 'CV Besi Utama',        'Besi beton ulir 16 mm',    2380, 'kg',  14500,  '2026-03-01', 'OPEN'),
  (po4, pid_alpha, 'PO-PRJALPHA-004', 'STR-03', 'PT Holcim Beton',      'Ready mix kelas 30',       18.0, 'm3',  980000, '2026-03-10', 'OPEN'),
  (po5, pid_alpha, 'PO-PRJALPHA-005', 'FIN-02', 'CV Keramik Indah',     'Keramik granit 60x60 cm', 210.0, 'm2', 185000, '2026-03-20', 'FULLY_RECEIVED'),
  (po6, pid_alpha, 'PO-PRJALPHA-006', 'MEP-01', 'Toko Sanitasi Jaya',   'Pipa PPR PN-10 3/4 inch', 180.0, 'm',   28000, '2026-04-01', 'PARTIAL_RECEIVED')
ON CONFLICT (po_number) WHERE po_number IS NOT NULL DO UPDATE SET
  project_id = EXCLUDED.project_id,
  boq_ref = EXCLUDED.boq_ref,
  supplier = EXCLUDED.supplier,
  material_name = EXCLUDED.material_name,
  quantity = EXCLUDED.quantity,
  unit = EXCLUDED.unit,
  unit_price = EXCLUDED.unit_price,
  ordered_date = EXCLUDED.ordered_date,
  status = EXCLUDED.status;

-- ── Progress entries (current source-of-truth for Gate 4 history) ──
INSERT INTO progress_entries (
  id, project_id, boq_item_id, reported_by, quantity, unit, work_status, location, note, created_at
) VALUES
  (prog1, pid_alpha, boq1, uid_supervisor, 12.5, 'm3', 'IN_PROGRESS', 'Grid A1-A3',           'Pengecoran footplat batch awal selesai.',     '2026-02-18T09:15:00+07'),
  (prog2, pid_alpha, boq2, uid_supervisor,  8.0, 'm3', 'IN_PROGRESS', 'Kolom K1-K3',          'Kolom utama lantai dasar selesai dicor.',     '2026-02-27T15:40:00+07'),
  (prog3, pid_alpha, boq3, uid_supervisor, 80.0, 'm2', 'IN_PROGRESS', 'Ruang keluarga Lt.1',  'Pasangan bata ringan sisi timur selesai.',    '2026-03-07T16:10:00+07'),
  (prog4, pid_alpha, boq5, uid_supervisor,  5.5, 'm3', 'IN_PROGRESS', 'Balok B1-B3',          'Balok lantai satu tahap awal terpasang.',     '2026-03-10T11:30:00+07'),
  (prog5, pid_alpha, boq6, uid_supervisor, 45.0, 'm2', 'IN_PROGRESS', 'Kamar tamu + koridor', 'Keramik terpasang sebagian, area tepi pending', '2026-03-18T14:20:00+07'),
  (prog6, pid_alpha, boq7, uid_supervisor,120.0, 'm',  'IN_PROGRESS', 'Shaft dapur & toilet', 'Instalasi pipa air bersih rough-in selesai.', '2026-03-21T17:00:00+07'),
  (prog7, pid_alpha, boq8, uid_supervisor,  8.0, 'unit','IN_PROGRESS', 'Fasad depan',         'Kusen aluminium fasad depan terpasang.',      '2026-03-24T13:10:00+07')
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  boq_item_id = EXCLUDED.boq_item_id,
  reported_by = EXCLUDED.reported_by,
  quantity = EXCLUDED.quantity,
  unit = EXCLUDED.unit,
  work_status = EXCLUDED.work_status,
  location = EXCLUDED.location,
  note = EXCLUDED.note,
  created_at = EXCLUDED.created_at;

-- ── Receipt history (current source-of-truth for Gate 3 history) ──
INSERT INTO receipts (
  id, po_id, project_id, received_by, vehicle_ref, gate3_flag, notes, created_at
) VALUES
  (receipt1, po1, pid_alpha, uid_supervisor, 'B 9123 HCB', 'OK',      'Ready mix batch 1 diterima sesuai slump test lapangan.', '2026-02-10T08:30:00+07'),
  (receipt2, po5, pid_alpha, uid_supervisor, 'B 8871 KRM', 'OK',      'Keramik granit diterima lengkap untuk satu lantai.',      '2026-03-20T10:45:00+07'),
  (receipt3, po6, pid_alpha, uid_supervisor, 'B 7742 SAN', 'WARNING', 'Penerimaan pipa parsial, sisa menunggu kiriman berikut.', '2026-04-01T14:05:00+07')
ON CONFLICT (id) DO UPDATE SET
  po_id = EXCLUDED.po_id,
  project_id = EXCLUDED.project_id,
  received_by = EXCLUDED.received_by,
  vehicle_ref = EXCLUDED.vehicle_ref,
  gate3_flag = EXCLUDED.gate3_flag,
  notes = EXCLUDED.notes,
  created_at = EXCLUDED.created_at;

INSERT INTO receipt_lines (
  id, receipt_id, material_name, quantity_actual, unit, created_at
) VALUES
  (receipt_line1, receipt1, 'Ready mix kelas 25',      12.0, 'm3', '2026-02-10T08:35:00+07'),
  (receipt_line2, receipt2, 'Keramik granit 60x60 cm',210.0, 'm2', '2026-03-20T10:50:00+07'),
  (receipt_line3, receipt3, 'Pipa PPR PN-10 3/4 inch',120.0, 'm',  '2026-04-01T14:10:00+07')
ON CONFLICT (id) DO UPDATE SET
  receipt_id = EXCLUDED.receipt_id,
  material_name = EXCLUDED.material_name,
  quantity_actual = EXCLUDED.quantity_actual,
  unit = EXCLUDED.unit,
  created_at = EXCLUDED.created_at;

-- ── Milestones ──
INSERT INTO milestones (id, project_id, label, planned_date, boq_ids, status) VALUES
  (ms1, pid_alpha, 'Selesai Pondasi',              '2026-04-30', ARRAY[boq1],             'AT_RISK'),
  (ms2, pid_alpha, 'Selesai Struktur Lantai 1',    '2026-06-30', ARRAY[boq2, boq5],       'ON_TRACK'),
  (ms3, pid_alpha, 'Selesai Dinding & Plesteran',  '2026-08-31', ARRAY[boq3, boq4],       'ON_TRACK'),
  (ms4, pid_alpha, 'Selesai MEP Rough-In',         '2026-07-31', ARRAY[boq7],             'ON_TRACK'),
  (ms5, pid_alpha, 'Selesai Finishing Lt.1',       '2026-09-30', ARRAY[boq6, boq8],       'DELAYED')
ON CONFLICT (id) DO NOTHING;

-- ── Envelopes ──
INSERT INTO envelopes (project_id, boq_item_id, max_quantity, warning_pct) VALUES
  (pid_alpha, boq1,  50.0, 80),
  (pid_alpha, boq2,  32.0, 80),
  (pid_alpha, boq3, 380.0, 85),
  (pid_alpha, boq4, 700.0, 80),
  (pid_alpha, boq5,  22.0, 80),
  (pid_alpha, boq6, 230.0, 85),
  (pid_alpha, boq7, 200.0, 80),
  (pid_alpha, boq8,  28.0, 85)
ON CONFLICT (project_id, boq_item_id) DO NOTHING;

-- ── Defects ──
INSERT INTO defects (project_id, boq_ref, location, description, severity, status, responsible_party, reported_by) VALUES
  (pid_alpha, 'STR-01 — Pekerjaan Pondasi Footplat',    'Grid A1, Pit Pondasi No.3',       'Permukaan beton keropos — tutupan besi kurang dari 40mm',            'Major',    'OPEN',      'Mandor Struktur',      uid_supervisor),
  (pid_alpha, 'STR-02 — Kolom Beton Bertulang',         'Kolom K3, As C-2',                'Retak rambut memanjang di badan kolom sepanjang ±60 cm',              'Major',    'IN_REPAIR', 'Mandor Struktur',      uid_supervisor),
  (pid_alpha, 'ARC-01 — Pasangan Dinding Bata Ringan',  'Dinding Ruang Keluarga Lt.1',     'Pasangan bata tidak plumb — deviasi 12mm per 2m tinggi',              'Minor',    'VALIDATED', 'Mandor Arsitektur',    uid_supervisor),
  (pid_alpha, 'FIN-02 — Pemasangan Keramik Lantai',     'Kamar Tidur Tamu Lt.1',           'Nat keramik tidak seragam — sebagian nat melebar > 3mm',              'Minor',    'OPEN',      'Mandor Finishing',     uid_supervisor),
  (pid_alpha, 'MEP-01 — Instalasi Pipa Air Bersih',     'Shaft pipa dapur',                'Kebocoran pada sambungan elbow 90° — tekanan test gagal di 8 bar',    'Critical', 'OPEN',      'Mandor MEP',           uid_supervisor),
  (pid_alpha, 'STR-03 — Balok Beton Bertulang',         'Balok B2, Grid B2-B3',            'Selimut beton kurang — tulangan terekspos 5mm dari permukaan',        'Major',    'OPEN',      'Mandor Struktur',      uid_supervisor);

-- ── Sample MTN request ──
INSERT INTO mtn_requests (project_id, requested_by, material_name, material_id, quantity, unit, destination_project, destination_project_id, reason, status)
VALUES (pid_alpha, uid_supervisor, 'Bata Ringan 600x200x75', mat3, 200, 'pcs', 'Ruko 3 Lantai — Bekasi Timur', pid_beta, 'Kelebihan stok dari pengiriman batch 1', 'AWAITING');

-- ── VO Entries ──
INSERT INTO vo_entries (project_id, location, description, requested_by_name, cause, est_material, est_cost, is_micro, status, created_by) VALUES
  (pid_alpha, 'Kamar Tidur Utama Lt.1',   'Perubahan keramik dari 60x60 menjadi 80x80 sesuai permintaan pemilik',           'Budi Hartono',    'client_request',  'Keramik 80x80 +15 dos',                      3750000,  true,  'AWAITING',  uid_supervisor),
  (pid_alpha, 'Teras Depan',              'Penambahan kanopi baja ringan lebar 2m — tidak ada di gambar awal',              'Budi Hartono',    'client_request',  'Rangka baja ringan + atap polycarbonate',    8500000,  false, 'APPROVED',  uid_supervisor),
  (pid_alpha, 'Ruang Tamu',              'Penggantian bata merah menjadi bata ringan AAC akibat perubahan desain',          'Tim Perencana',   'design_revision', 'Bata ringan AAC 120 m2',                     4200000,  false, 'APPROVED',  uid_supervisor),
  (pid_alpha, 'Toilet Lt.1',             'Penambahan exhaust fan & titik listrik tambahan sesuai permintaan owner',         'Budi Hartono',    'client_request',  'Exhaust fan + kabel NYM 3x2.5 10m',          1250000,  true,  'AWAITING',  uid_supervisor),
  (pid_alpha, 'Kolom K5 & K6',           'Perkuatan tulangan kolom akibat koreksi perhitungan struktural',                 'Konsultan MK',    'design_revision', 'Besi ulir D16 tambahan 120 kg',              2640000,  false, 'APPROVED',  uid_supervisor),
  (pid_alpha, 'Lantai Dasar Keseluruhan','Rework plesteran lantai — ketidakrataan melebihi toleransi 5mm per 2m',          'Mandor Struktur', 'contractor_rework','Semen + pasir untuk skim coat',              1800000,  true,  'REVIEWED',  uid_supervisor);

-- ── Unified site changes (current source-of-truth for Catatan Perubahan) ──
IF EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'site_changes'
) THEN
  INSERT INTO site_changes (
    id, project_id, location, description, photo_urls, change_type, boq_item_id, contract_id,
    impact, is_urgent, reported_by, est_cost, cost_bearer, needs_owner_approval,
    decision, reviewed_by, reviewed_at, estimator_note, resolved_at, resolved_by, resolution_note, created_at
  ) VALUES
    (
      change1, pid_alpha, 'Teras depan',
      'Penambahan kanopi baja ringan di teras depan di luar gambar awal.',
      ARRAY[]::text[], 'permintaan_owner', boq8, NULL,
      'sedang', true, uid_supervisor, 8500000, 'owner', true,
      'disetujui', uid_estimator, '2026-03-20T10:00:00+07', 'Masuk perubahan owner, lanjutkan setelah gambar kerja final.', NULL, NULL, NULL, '2026-03-19T15:20:00+07'
    ),
    (
      change2, pid_alpha, 'Lantai dasar keseluruhan',
      'Bidang plesteran tidak rata dan perlu rework sebelum finishing.',
      ARRAY[]::text[], 'rework', boq4, NULL,
      'sedang', false, uid_supervisor, 1800000, 'kontraktor', false,
      'disetujui', uid_estimator, '2026-03-24T09:10:00+07', 'Rework disetujui, jangan naikkan progress sebelum bidang lolos cek ulang.', NULL, NULL, NULL, '2026-03-23T16:45:00+07'
    ),
    (
      change3, pid_alpha, 'Kolom K3 As C-2',
      'Retak rambut memanjang perlu observasi mutu dan tindakan koreksi lokal.',
      ARRAY[]::text[], 'catatan_mutu', boq2, NULL,
      'berat', true, uid_supervisor, NULL, NULL, false,
      'pending', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-21T11:30:00+07'
    ),
    (
      change4, pid_alpha, 'Ruang tamu',
      'Penggantian spesifikasi bata dari bata merah ke AAC mengikuti revisi desain.',
      ARRAY[]::text[], 'revisi_desain', boq3, NULL,
      'sedang', false, uid_supervisor, 4200000, 'owner', true,
      'selesai', uid_admin, '2026-03-18T14:00:00+07', 'Sudah masuk addendum spesifikasi dan area terkait selesai dikerjakan.', '2026-03-28T17:10:00+07', uid_supervisor, 'Perubahan sudah terealisasi di lapangan.', '2026-03-17T09:05:00+07'
    ),
    (
      change5, pid_alpha, 'Toilet Lt.1',
      'Permintaan exhaust fan tambahan ditunda karena belum ada keputusan owner final.',
      ARRAY[]::text[], 'permintaan_owner', boq7, NULL,
      'ringan', false, uid_supervisor, 1250000, 'owner', true,
      'ditolak', uid_admin, '2026-03-27T13:40:00+07', 'Ditolak sementara, menunggu owner konfirmasi revisi final.', NULL, NULL, NULL, '2026-03-26T12:20:00+07'
    )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    location = EXCLUDED.location,
    description = EXCLUDED.description,
    photo_urls = EXCLUDED.photo_urls,
    change_type = EXCLUDED.change_type,
    boq_item_id = EXCLUDED.boq_item_id,
    contract_id = EXCLUDED.contract_id,
    impact = EXCLUDED.impact,
    is_urgent = EXCLUDED.is_urgent,
    reported_by = EXCLUDED.reported_by,
    est_cost = EXCLUDED.est_cost,
    cost_bearer = EXCLUDED.cost_bearer,
    needs_owner_approval = EXCLUDED.needs_owner_approval,
    decision = EXCLUDED.decision,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at,
    estimator_note = EXCLUDED.estimator_note,
    resolved_at = EXCLUDED.resolved_at,
    resolved_by = EXCLUDED.resolved_by,
    resolution_note = EXCLUDED.resolution_note,
    created_at = EXCLUDED.created_at;
END IF;

-- ── Activity log samples ──
INSERT INTO activity_log (project_id, user_id, type, label, flag) VALUES
  (pid_alpha, uid_supervisor, 'permintaan', 'Permintaan STR-01: Beton Ready Mix K-250 x12 m3 — status: Siap Dikirim',                     'OK'),
  (pid_alpha, uid_supervisor, 'terima',     'Beton Ready Mix K-250 12 m3 diterima (Parsial)',                                             'OK'),
  (pid_alpha, uid_supervisor, 'progres',    'STR-01 — 12 m3 terpasang',                                                                  'OK'),
  (pid_alpha, uid_supervisor, 'mtn',        'MTN Bata Ringan 600x200x75 200 pcs → Ruko 3 Lantai — Bekasi Timur',                         'INFO'),
  (pid_alpha, uid_supervisor, 'cacat',      'Cacat OPEN: Kebocoran pipa MEP Grid Dapur — Critical',                                      'WARNING'),
  (pid_alpha, uid_supervisor, 'progres',    'STR-02 — 8 m3 kolom terpasang (29%)',                                                       'OK'),
  (pid_alpha, uid_supervisor, 'permintaan', 'Permintaan ARC-01: Bata ringan 7.5 cm x2660 pcs',                                           'OK'),
  (pid_alpha, uid_supervisor, 'terima',     'Keramik granit 60x60 cm 210 m2 diterima (Full)',                                            'OK'),
  (pid_alpha, uid_supervisor, 'vo',         'VO Disetujui: Kanopi baja ringan teras depan — Rp 8.500.000',                               'WARNING'),
  (pid_alpha, uid_supervisor, 'progres',    'MEP-01 — 120 m pipa terpasang (67%)',                                                       'OK'),
  (pid_alpha, uid_supervisor, 'cacat',      'Cacat IN_REPAIR: Retak rambut Kolom K3 — Major',                                           'WARNING'),
  (pid_alpha, uid_supervisor, 'permintaan', 'Permintaan STR-03: Ready mix K-300 x18 m3 — status: Menunggu Konfirmasi Supplier',          'OK'),
  (pid_alpha, uid_supervisor, 'attendance', 'Opname Minggu 9 diajukan untuk Mandor Beton Pak Darto',                                     'INFO'),
  (pid_alpha, uid_estimator,  'attendance', 'Opname Minggu 8 Finishing diverifikasi dengan 1 item TDK ACC',                              'WARNING'),
  (pid_alpha, uid_admin,      'attendance', 'Opname Minggu 9 Mandor MEP Pak Agus disetujui dengan kasbon Rp 250.000',                   'OK'),
  (pid_alpha, uid_estimator,  'progres',    'ARC-01 — 80 m2 dinding bata ringan terpasang (25%)',                                       'OK'),
  (pid_alpha, uid_estimator,  'terima',     'Pipa PPR 3/4 inch 180 m diterima (Parsial, 120 m)',                                        'OK');

END $$;
