-- SANO — Clean Demo Seed for Onboarding
-- Run this in Supabase SQL Editor after the current migration chain is applied.
--
-- What this seed does:
-- 1. Wipes project-scoped trial/demo data so onboarding starts clean.
-- 2. Rebuilds exactly 3 demo projects:
--    - Project Alpha   → rich example flow (baseline + requests + PO + receipt + progress + defects + mandor/opname)
--    - Project Beta    → baseline parsed only
--    - Project Charlie → empty shell project
-- 3. Recreates the four demo users below (or refreshes their profile data).
--
-- Demo login credentials:
--   supervisor@sano.test / password123
--   estimator@sano.test  / password123
--   admin@sano.test      / password123
--   principal@sano.test  / password123
--
-- Important note:
-- - This resets database rows, not Storage bucket files. Old uploaded photos/files
--   may still exist in bucket storage, but they will no longer appear in the app.

DO $$
DECLARE
  uid_supervisor UUID := '00000000-0000-0000-0000-000000000001';
  uid_estimator  UUID := '00000000-0000-0000-0000-000000000002';
  uid_admin      UUID := '00000000-0000-0000-0000-000000000003';
  uid_principal  UUID := '00000000-0000-0000-0000-000000000004';

  pid_alpha      UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  pid_beta       UUID := 'aaaaaaaa-0000-0000-0000-000000000002';
  pid_charlie    UUID := 'aaaaaaaa-0000-0000-0000-000000000003';

  mat_rm25       UUID;
  mat_rm30       UUID;
  mat_aac        UUID;
  mat_cement     UUID;
  mat_rebar      UUID;
  mat_tile       UUID;
  mat_ppr        UUID;
  mat_alum       UUID;

  alpha_str01    UUID;
  alpha_str02    UUID;
  alpha_arc01    UUID;
  alpha_fin01    UUID;
  alpha_fin02    UUID;
  alpha_mep01    UUID;
  alpha_arc02    UUID;
  alpha_str03    UUID;

  beta_str01     UUID;
  beta_arc01     UUID;
  beta_fin01     UUID;
  beta_mep01     UUID;

  ahs_alpha      UUID;
  ahs_beta       UUID;
  master_alpha   UUID;
  master_beta    UUID;

  req_readymix   UUID;
  req_tile_hold  UUID;
  line_readymix  UUID;
  line_tile_hold UUID;

  po_alpha_1     UUID;
  po_alpha_2     UUID;
  po_alpha_3     UUID;
  po_alpha_4     UUID;

  contract_struct UUID;
  contract_harian UUID;
  header_struct_paid UUID;
  header_struct_draft UUID;
  header_harian_draft UUID;
  worker_jajang UUID;
  worker_udin UUID;
  worker_dede UUID;

  tbl TEXT;
BEGIN
  -- ── Demo reset: clear trial data while preserving auth/profiles ───────────
  FOREACH tbl IN ARRAY ARRAY[
    'harian_cost_allocations',
    'worker_overtime_rules',
    'opname_line_revisions',
    'opname_lines',
    'opname_headers',
    'mandor_kasbon',
    'worker_attendance_entries',
    'mandor_overtime_rules',
    'worker_rates',
    'mandor_workers',
    'mandor_attendance',
    'mandor_contract_rates',
    'mandor_contracts',
    'site_changes',
    'approval_tasks',
    'audit_cases',
    'anomaly_events',
    'performance_scores',
    'vendor_scorecards',
    'weekly_digests',
    'report_exports',
    'receipt_photos',
    'receipt_lines',
    'receipts',
    'progress_photos',
    'progress_entries',
    'rework_photos',
    'rework_entries',
    'formal_vos',
    'vo_photos',
    'vo_entries',
    'defect_photos',
    'mtn_photos',
    'material_request_line_allocations',
    'material_request_lines',
    'material_request_headers',
    'purchase_order_lines',
    'price_history',
    'project_material_master_lines',
    'project_material_master',
    'ahs_lines',
    'ahs_versions',
    'project_markup_factors',
    'import_anomalies',
    'import_staging_rows',
    'import_sessions',
    'milestone_revisions',
    'purchase_orders',
    'material_receipts',
    'mtn_requests',
    'activity_log',
    'defects',
    'milestones',
    'envelopes',
    'boq_items',
    'project_assignments',
    'projects',
    'material_aliases',
    'material_specs',
    'material_catalog',
    'ai_chat_log'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', tbl);
    END IF;
  END LOOP;

  -- Remove stale demo/test auth users from earlier seed iterations.
  DELETE FROM auth.users
  WHERE email LIKE '%@sano.test'
    AND id NOT IN (uid_supervisor, uid_estimator, uid_admin, uid_principal);

  -- ── Demo auth users ───────────────────────────────────────────────────────
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      uid_supervisor,
      'authenticated',
      'authenticated',
      'supervisor@sano.test',
      crypt('password123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Supervisor"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_estimator,
      'authenticated',
      'authenticated',
      'estimator@sano.test',
      crypt('password123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Estimator"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_admin,
      'authenticated',
      'authenticated',
      'admin@sano.test',
      crypt('password123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      uid_principal,
      'authenticated',
      'authenticated',
      'principal@sano.test',
      crypt('password123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Principal"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  INSERT INTO profiles (id, full_name, phone, role)
  VALUES
    (uid_supervisor, 'Krisanto Supervisor',  '+6281234500001', 'supervisor'),
    (uid_estimator,  'Saiful Estimator',   '+6281234500002', 'estimator'),
    (uid_admin,      'Fanny Admin',        '+6281234500003', 'admin'),
    (uid_principal,  'Santoso Principal',  '+6281234500004', 'principal')
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role;

  -- ── Projects (exactly 3) ──────────────────────────────────────────────────
  INSERT INTO projects (
    id, code, name, location, client_name, contract_value, start_date, end_date, status
  )
  VALUES
    (pid_alpha,   'PRJ-ALPHA',   'Project Alpha',   'Cimanggis, Depok', 'Budi Hartono',    850000000,  '2026-01-15', '2026-10-31', 'ACTIVE'),
    (pid_beta,    'PRJ-BETA',    'Project Beta',    'Bekasi Timur',     'CV Maju Bersama', 1200000000, '2026-03-01', '2027-02-28', 'ACTIVE'),
    (pid_charlie, 'PRJ-CHARLIE', 'Project Charlie', 'Karawang Barat',   'PT Demo Nusantara', NULL,       NULL,         NULL,         'ACTIVE');

  INSERT INTO project_assignments (project_id, user_id)
  VALUES
    (pid_alpha, uid_supervisor), (pid_alpha, uid_estimator), (pid_alpha, uid_admin), (pid_alpha, uid_principal),
    (pid_beta, uid_supervisor),  (pid_beta, uid_estimator),  (pid_beta, uid_admin),  (pid_beta, uid_principal),
    (pid_charlie, uid_supervisor), (pid_charlie, uid_estimator), (pid_charlie, uid_admin), (pid_charlie, uid_principal);

  -- ── Shared material catalog (full 190-item master from parsed BOQ CSV) ───
  INSERT INTO material_catalog (code, name, category, tier, unit, supplier_unit)
  VALUES
    ('BRK-CL01', 'Bata merah standar', 'Dinding', 2, 'pcs', 'pcs'),
    ('BRK-CL02', 'Bata merah press', 'Dinding', 2, 'pcs', 'pcs'),
    ('AAC-BL07', 'Bata ringan 7.5 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('AAC-BL10', 'Bata ringan 10 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('AAC-BL12', 'Bata ringan 12.5 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('AAC-BL15', 'Bata ringan 15 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('AAC-BL20', 'Bata ringan 20 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('BTK-SM10', 'Batako semen 10 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('BTK-SM12', 'Batako semen 12 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('BTK-SM15', 'Batako semen 15 cm', 'Dinding', 2, 'pcs', 'pcs'),
    ('MRT-INST', 'Mortar instan pasangan bata', 'Dinding', 3, 'zak', 'zak'),
    ('MRT-PLST', 'Mortar instan plester', 'Dinding', 3, 'zak', 'zak'),
    ('MRT-ACI', 'Mortar instan acian', 'Dinding', 3, 'zak', 'zak'),
    ('CEM-OPC40', 'Semen OPC 40 kg', 'Material Beton', 2, 'zak', 'zak'),
    ('CEM-OPC50', 'Semen OPC 50 kg', 'Material Beton', 2, 'zak', 'zak'),
    ('CEM-PCC40', 'Semen PCC 40 kg', 'Material Beton', 2, 'zak', 'zak'),
    ('CEM-PCC50', 'Semen PCC 50 kg', 'Material Beton', 2, 'zak', 'zak'),
    ('CEM-WHT20', 'Semen putih 20 kg', 'Material Beton', 2, 'zak', 'zak'),
    ('SND-CST', 'Pasir cor', 'Material Beton', 2, 'm3', 'm3'),
    ('SND-PLS', 'Pasir pasang', 'Material Beton', 2, 'm3', 'm3'),
    ('SND-SLC', 'Pasir silika', 'Material Beton', 2, 'kg', 'kg'),
    ('AGG-SP10', 'Batu split 1/2', 'Material Beton', 2, 'm3', 'm3'),
    ('AGG-SP20', 'Batu split 2/3', 'Material Beton', 2, 'm3', 'm3'),
    ('AGG-BSR', 'Abu batu', 'Material Beton', 2, 'm3', 'm3'),
    ('AGG-KRL', 'Kerikil', 'Material Beton', 2, 'm3', 'm3'),
    ('CON-RM17', 'Ready mix mutu rendah', 'Struktur', 1, 'm3', 'm3'),
    ('CON-RM21', 'Ready mix kelas 21', 'Struktur', 1, 'm3', 'm3'),
    ('CON-RM25', 'Ready mix kelas 25', 'Struktur', 1, 'm3', 'm3'),
    ('CON-RM30', 'Ready mix kelas 30', 'Struktur', 1, 'm3', 'm3'),
    ('CON-RM35', 'Ready mix kelas 35', 'Struktur', 1, 'm3', 'm3'),
    ('CON-SM10', 'Beton site mix 10', 'Struktur', 1, 'm3', 'm3'),
    ('CON-SM15', 'Beton site mix 15', 'Struktur', 1, 'm3', 'm3'),
    ('CON-SM20', 'Beton site mix 20', 'Struktur', 1, 'm3', 'm3'),
    ('REB-DE10', 'Besi beton ulir 10 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE13', 'Besi beton ulir 13 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE16', 'Besi beton ulir 16 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE19', 'Besi beton ulir 19 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE22', 'Besi beton ulir 22 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE25', 'Besi beton ulir 25 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-DE32', 'Besi beton ulir 32 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-PL06', 'Besi beton polos 6 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-PL08', 'Besi beton polos 8 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-PL10', 'Besi beton polos 10 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-PL12', 'Besi beton polos 12 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-WR01', 'Kawat bendrat', 'Struktur', 1, 'kg', 'kg'),
    ('REB-CHR06', 'Chair bar 6 mm', 'Struktur', 1, 'kg', 'kg'),
    ('REB-CHR08', 'Chair bar 8 mm', 'Struktur', 1, 'kg', 'kg'),
    ('WMS-M610', 'Wiremesh M6 lembar', 'Struktur', 3, 'lbr', 'lbr'),
    ('WMS-M810', 'Wiremesh M8 lembar', 'Struktur', 3, 'lbr', 'lbr'),
    ('WMS-M1010', 'Wiremesh M10 lembar', 'Struktur', 3, 'lbr', 'lbr'),
    ('WMS-M6RL', 'Wiremesh M6 roll', 'Struktur', 3, 'roll', 'roll'),
    ('STL-WF150', 'WF 150', 'Struktur', 1, 'btg', 'btg'),
    ('STL-WF200', 'WF 200', 'Struktur', 1, 'btg', 'btg'),
    ('STL-WF250', 'WF 250', 'Struktur', 1, 'btg', 'btg'),
    ('STL-WF300', 'WF 300', 'Struktur', 1, 'btg', 'btg'),
    ('STL-WF350', 'WF 350', 'Struktur', 1, 'btg', 'btg'),
    ('STL-WF400', 'WF 400', 'Struktur', 1, 'btg', 'btg'),
    ('STL-HB200', 'H-Beam 200', 'Struktur', 1, 'btg', 'btg'),
    ('STL-HB300', 'H-Beam 300', 'Struktur', 1, 'btg', 'btg'),
    ('STL-CN75', 'CNP 75', 'Struktur', 1, 'btg', 'btg'),
    ('STL-CN100', 'CNP 100', 'Struktur', 1, 'btg', 'btg'),
    ('STL-UN65', 'UNP 65', 'Struktur', 1, 'btg', 'btg'),
    ('STL-UN80', 'UNP 80', 'Struktur', 1, 'btg', 'btg'),
    ('STL-UN100', 'UNP 100', 'Struktur', 1, 'btg', 'btg'),
    ('STL-HL40', 'Hollow 40x40', 'Struktur', 1, 'btg', 'btg'),
    ('STL-HL50', 'Hollow 50x50', 'Struktur', 1, 'btg', 'btg'),
    ('STL-HL100', 'Hollow 100x50', 'Struktur', 1, 'btg', 'btg'),
    ('STL-PL03', 'Plat besi 3 mm', 'Struktur', 1, 'lbr', 'lbr'),
    ('STL-PL06', 'Plat besi 6 mm', 'Struktur', 1, 'lbr', 'lbr'),
    ('STL-PL09', 'Plat besi 9 mm', 'Struktur', 1, 'lbr', 'lbr'),
    ('STL-PL12', 'Plat besi 12 mm', 'Struktur', 1, 'lbr', 'lbr'),
    ('STL-PP25', 'Pipa besi 1 inch', 'Struktur', 1, 'btg', 'btg'),
    ('STL-PP32', 'Pipa besi 1 1/4 inch', 'Struktur', 1, 'btg', 'btg'),
    ('STL-PP50', 'Pipa besi 2 inch', 'Struktur', 1, 'btg', 'btg'),
    ('PLY-FF12', 'Plywood film faced 12 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-FF15', 'Plywood film faced 15 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-FF18', 'Plywood film faced 18 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-MR09', 'Plywood meranti 9 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-MR12', 'Plywood meranti 12 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-MR15', 'Plywood meranti 15 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PLY-MR18', 'Plywood meranti 18 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('WOD-KLS34', 'Kayu kelas 3 4/6', 'Kayu & Bekisting', 2, 'btg', 'btg'),
    ('WOD-KLS46', 'Kayu kelas 3 5/7', 'Kayu & Bekisting', 2, 'btg', 'btg'),
    ('WOD-KLS58', 'Kayu kelas 3 6/8', 'Kayu & Bekisting', 2, 'btg', 'btg'),
    ('WOD-MRC01', 'Kayu meranti rough', 'Kayu & Bekisting', 2, 'm3', 'm3'),
    ('WOD-KMP01', 'Kayu kamper rough', 'Kayu & Bekisting', 2, 'm3', 'm3'),
    ('WOD-BNG01', 'Kayu bengkirai rough', 'Kayu & Bekisting', 2, 'm3', 'm3'),
    ('WOD-JTI01', 'Kayu jati rough', 'Kayu & Bekisting', 2, 'm3', 'm3'),
    ('WOD-SRN01', 'Kayu sungkai rough', 'Kayu & Bekisting', 2, 'm3', 'm3'),
    ('MDF-ST09', 'MDF standard 9 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('MDF-ST12', 'MDF standard 12 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('MDF-ST15', 'MDF standard 15 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('MDF-ST18', 'MDF standard 18 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('BLB-ST15', 'Blockboard 15 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('BLB-ST18', 'Blockboard 18 mm', 'Kayu & Bekisting', 2, 'lbr', 'lbr'),
    ('PBR-ST18', 'Particle board 18 mm', 'Kayu & Bekisting', 3, 'lbr', 'lbr'),
    ('HPL-SUB18', 'Substrate panel for HPL 18 mm', 'Kayu & Bekisting', 3, 'lbr', 'lbr'),
    ('WPC-DSK25', 'WPC decking board 25 mm', 'Kayu & Bekisting', 3, 'm2', 'm2'),
    ('WPC-CLD20', 'WPC cladding board 20 mm', 'Kayu & Bekisting', 3, 'm2', 'm2'),
    ('FMW-SCAF', 'Scaffolding set', 'Kayu & Bekisting', 3, 'set', 'set'),
    ('FMW-JACK', 'Jack base / U-head', 'Kayu & Bekisting', 3, 'pcs', 'pcs'),
    ('FMW-TIE01', 'Tie rod bekisting', 'Kayu & Bekisting', 3, 'pcs', 'pcs'),
    ('ROF-MTL03', 'Metal roof sheet 0.30 mm', 'Atap', 1, 'm2', 'm2'),
    ('ROF-MTL04', 'Metal roof sheet 0.40 mm', 'Atap', 1, 'm2', 'm2'),
    ('ROF-ASP03', 'Atap aspal shingle', 'Atap', 1, 'm2', 'm2'),
    ('ROF-UPVC25', 'uPVC roof sheet', 'Atap', 1, 'm2', 'm2'),
    ('ROF-PVC25', 'PVC roof sheet', 'Atap', 1, 'm2', 'm2'),
    ('ROF-INS01', 'Aluminium foil insulation', 'Atap', 1, 'roll', 'roll'),
    ('ROF-UND01', 'Roof underlayer', 'Atap', 1, 'roll', 'roll'),
    ('RST-TR75', 'Reng / truss light steel 0.75', 'Atap', 1, 'btg', 'btg'),
    ('RST-BT45', 'Batten light steel 0.45', 'Atap', 1, 'btg', 'btg'),
    ('WPF-CEM01', 'Waterproofing cementitious 2K', 'Waterproofing', 1, 'set', 'set'),
    ('WPF-MEM01', 'Membrane bakar', 'Waterproofing', 1, 'roll', 'roll'),
    ('WPF-LQD01', 'Waterproofing liquid coating', 'Waterproofing', 1, 'pail', 'pail'),
    ('WPF-INJ01', 'Injection PU / epoxy grout', 'Waterproofing', 1, 'kg', 'kg'),
    ('GYP-BD09', 'Gypsum board 9 mm', 'Plafon & Partisi', 3, 'lbr', 'lbr'),
    ('GYP-BD12', 'Gypsum board 12 mm', 'Plafon & Partisi', 3, 'lbr', 'lbr'),
    ('GYP-MR09', 'Gypsum moisture resistant 9 mm', 'Plafon & Partisi', 3, 'lbr', 'lbr'),
    ('GYP-MR12', 'Gypsum moisture resistant 12 mm', 'Plafon & Partisi', 3, 'lbr', 'lbr'),
    ('GYP-FR12', 'Gypsum fire resistant 12 mm', 'Plafon & Partisi', 3, 'lbr', 'lbr'),
    ('SKM-INT20', 'Skim coat interior 20 kg', 'Plafon & Partisi', 3, 'zak', 'zak'),
    ('SKM-EXT20', 'Skim coat exterior 20 kg', 'Plafon & Partisi', 3, 'zak', 'zak'),
    ('CEL-MR38', 'Metal furring 38', 'Plafon & Partisi', 3, 'btg', 'btg'),
    ('CEL-TRK01', 'Track gypsum partition', 'Plafon & Partisi', 3, 'btg', 'btg'),
    ('CEL-STD01', 'Stud gypsum partition', 'Plafon & Partisi', 3, 'btg', 'btg'),
    ('TIL-CR30', 'Keramik 30x30', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('TIL-CR60', 'Keramik 60x60', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('TIL-GRT60', 'Homogeneous tile 60x60', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('TIL-GRT80', 'Homogeneous tile 80x80', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('TIL-SLB12', 'Porcelain slab 1200 series', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('STN-MRB20', 'Marble slab 20 mm', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('STN-GRN20', 'Granite slab 20 mm', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('STN-TRV20', 'Travertine slab 20 mm', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('STN-AND20', 'Andesite 20 mm', 'Lantai & Dinding Finishing', 1, 'm2', 'm2'),
    ('TIL-ADH20', 'Tile adhesive 20 kg', 'Lantai & Dinding Finishing', 1, 'zak', 'zak'),
    ('TIL-GRT05', 'Tile grout 5 kg', 'Lantai & Dinding Finishing', 1, 'zak', 'zak'),
    ('PNT-WAL01', 'Cat dinding interior standard', 'Finishing & Coating', 3, 'pail', 'pail'),
    ('PNT-WEX01', 'Cat dinding exterior standard', 'Finishing & Coating', 3, 'pail', 'pail'),
    ('PNT-PRM01', 'Wall primer', 'Finishing & Coating', 3, 'pail', 'pail'),
    ('PNT-SLR01', 'Sealer dinding', 'Finishing & Coating', 3, 'pail', 'pail'),
    ('PNT-WPU01', 'PU wood coating', 'Finishing & Coating', 3, 'set', 'set'),
    ('PNT-WNC01', 'Wood stain / NC', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-WPR01', 'Wood primer', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-WTP01', 'Wood top coat', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-MPR01', 'Metal primer', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-MTC01', 'Metal finish coat', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-ZRC01', 'Zinc chromate primer', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('COT-EPX01', 'Epoxy floor coating', 'Finishing & Coating', 3, 'set', 'set'),
    ('COT-CLR01', 'Clear protective coating', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PLB-PVC20', 'Pipa PVC 1/2 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PVC25', 'Pipa PVC 3/4 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PVC32', 'Pipa PVC 1 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PVC50', 'Pipa PVC 1 1/2 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PVC75', 'Pipa PVC 2 1/2 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PVC100', 'Pipa PVC 4 inch', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PPR20', 'Pipa PPR 20 mm', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PPR25', 'Pipa PPR 25 mm', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-PPR32', 'Pipa PPR 32 mm', 'Plumbing', 1, 'btg', 'btg'),
    ('PLB-FIT20', 'Fitting PVC 1/2 class generic', 'Plumbing', 1, 'pcs', 'pcs'),
    ('PLB-FIT25', 'Fitting PVC 3/4 class generic', 'Plumbing', 1, 'pcs', 'pcs'),
    ('ELC-CBL15', 'Kabel 1.5 mm2', 'Elektrikal', 3, 'roll', 'roll'),
    ('ELC-CBL25', 'Kabel 2.5 mm2', 'Elektrikal', 3, 'roll', 'roll'),
    ('ELC-CBL40', 'Kabel 4 mm2', 'Elektrikal', 3, 'roll', 'roll'),
    ('ELC-CBL60', 'Kabel 6 mm2', 'Elektrikal', 3, 'roll', 'roll'),
    ('ELC-CND20', 'Conduit 20 mm', 'Elektrikal', 3, 'btg', 'btg'),
    ('ELC-CND25', 'Conduit 25 mm', 'Elektrikal', 3, 'btg', 'btg'),
    ('ELC-SWT01', 'Switch standard', 'Elektrikal', 3, 'pcs', 'pcs'),
    ('ELC-SCK01', 'Socket outlet standard', 'Elektrikal', 3, 'pcs', 'pcs'),
    ('ELC-MCB01', 'MCB standard', 'Elektrikal', 3, 'pcs', 'pcs'),
    ('ELC-DB01', 'Distribution box standard', 'Elektrikal', 3, 'unit', 'unit'),
    ('SND-KRT', 'Pasir Kertosono', 'Material Beton', 2, 'm3', 'm3'),
    ('SND-LMJ', 'Pasir Lumajang', 'Material Beton', 2, 'm3', 'm3'),
    ('WTR-WRK', 'Air kerja', 'Material Beton', 3, 'm3', 'm3'),
    ('CON-RM22', 'Ready mix K-225', 'Struktur', 1, 'm3', 'm3'),
    ('FST-NL01', 'Paku 5-12cm', 'Kayu & Bekisting', 3, 'kg', 'kg'),
    ('FMW-OIL', 'Minyak bekisting', 'Kayu & Bekisting', 3, 'liter', 'liter'),
    ('WPF-ACI', 'Acian waterproof', 'Waterproofing', 1, 'kg', 'kg'),
    ('PNT-MNI01', 'Cat meni / menie', 'Finishing & Coating', 3, 'liter', 'liter'),
    ('PNT-PLM01', 'Plamir tembok', 'Finishing & Coating', 3, 'kg', 'kg'),
    ('PLB-CLS01', 'Closet duduk', 'Plumbing', 1, 'unit', 'unit'),
    ('PLB-WST01', 'Wastafel', 'Plumbing', 1, 'unit', 'unit'),
    ('PLB-FDR01', 'Floor drain', 'Plumbing', 1, 'pcs', 'pcs'),
    ('PLB-KRN01', 'Kran air', 'Plumbing', 1, 'pcs', 'pcs'),
    ('ELC-LMP01', 'Lampu standar', 'Elektrikal', 3, 'pcs', 'pcs'),
    ('EXC-FIL01', 'Tanah urug', 'Earthwork', 2, 'm3', 'm3'),
    ('STN-RVR01', 'Batu kali', 'Material Beton', 2, 'm3', 'm3'),
    ('AGG-SRT', 'Sirtu (pasir batu)', 'Material Beton', 2, 'm3', 'm3'),
    ('KWD-BDR01', 'Kawat bendrat', 'Struktur', 3, 'kg', 'kg'),
    ('ANK-BT01', 'Angkur baut', 'Struktur', 3, 'pcs', 'pcs'),
    ('ALM-KSN4', 'Kusen aluminium 4 inch', 'Arsitektur', 2, 'unit', 'unit');

  -- ── Material aliases (common alternative names → canonical codes) ─────────
  INSERT INTO material_aliases (alias, material_id)
  VALUES
    ('Bata Biasa', (SELECT id FROM material_catalog WHERE code = 'BRK-CL01')),
    ('Bata Biasa (poklu'')', (SELECT id FROM material_catalog WHERE code = 'BRK-CL01')),
    ('Bata merah poklu', (SELECT id FROM material_catalog WHERE code = 'BRK-CL01')),
    ('Bata merah biasa', (SELECT id FROM material_catalog WHERE code = 'BRK-CL01')),
    ('Semen PC @50kg', (SELECT id FROM material_catalog WHERE code = 'CEM-PCC50')),
    ('Semen PC @40kg', (SELECT id FROM material_catalog WHERE code = 'CEM-PCC40')),
    ('Semen Portland 50 kg', (SELECT id FROM material_catalog WHERE code = 'CEM-OPC50')),
    ('Semen Portland 40 kg', (SELECT id FROM material_catalog WHERE code = 'CEM-OPC40')),
    ('Pasir Pasang', (SELECT id FROM material_catalog WHERE code = 'SND-PLS')),
    ('Pasir Cor', (SELECT id FROM material_catalog WHERE code = 'SND-CST')),
    ('Pasir Kertosono', (SELECT id FROM material_catalog WHERE code = 'SND-KRT')),
    ('Pasir Lumajang', (SELECT id FROM material_catalog WHERE code = 'SND-LMJ')),
    ('Batu Split 2/3', (SELECT id FROM material_catalog WHERE code = 'AGG-SP20')),
    ('Batu Split 1/2', (SELECT id FROM material_catalog WHERE code = 'AGG-SP10')),
    ('Besi beton D-10', (SELECT id FROM material_catalog WHERE code = 'REB-DE10')),
    ('Besi beton D-13', (SELECT id FROM material_catalog WHERE code = 'REB-DE13')),
    ('Besi beton D-16', (SELECT id FROM material_catalog WHERE code = 'REB-DE16')),
    ('Besi beton D-19', (SELECT id FROM material_catalog WHERE code = 'REB-DE19')),
    ('Besi beton D-22', (SELECT id FROM material_catalog WHERE code = 'REB-DE22')),
    ('Besi beton D-25', (SELECT id FROM material_catalog WHERE code = 'REB-DE25')),
    ('Besi beton P-6', (SELECT id FROM material_catalog WHERE code = 'REB-PL06')),
    ('Besi beton P-8', (SELECT id FROM material_catalog WHERE code = 'REB-PL08')),
    ('Besi beton P-10', (SELECT id FROM material_catalog WHERE code = 'REB-PL10')),
    ('Besi beton P-12', (SELECT id FROM material_catalog WHERE code = 'REB-PL12')),
    ('Multiplek 12 mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF12')),
    ('Multiplek 15 mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF15')),
    ('Multiplek 18 mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF18')),
    ('Plywood 12mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF12')),
    ('Plywood 15mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF15')),
    ('Plywood 18mm', (SELECT id FROM material_catalog WHERE code = 'PLY-FF18')),
    ('Kawat Beton', (SELECT id FROM material_catalog WHERE code = 'KWD-BDR01')),
    ('Kawat Bendrat', (SELECT id FROM material_catalog WHERE code = 'KWD-BDR01')),
    ('Paku 5cm', (SELECT id FROM material_catalog WHERE code = 'FST-NL01')),
    ('Paku 7cm', (SELECT id FROM material_catalog WHERE code = 'FST-NL01')),
    ('Paku 10cm', (SELECT id FROM material_catalog WHERE code = 'FST-NL01')),
    ('Paku 12cm', (SELECT id FROM material_catalog WHERE code = 'FST-NL01')),
    ('Minyak Bekisting', (SELECT id FROM material_catalog WHERE code = 'FMW-OIL')),
    ('Readymix K-225', (SELECT id FROM material_catalog WHERE code = 'CON-RM22')),
    ('Readymix K-250', (SELECT id FROM material_catalog WHERE code = 'CON-RM25')),
    ('Readymix K-300', (SELECT id FROM material_catalog WHERE code = 'CON-RM30')),
    ('Readymix K-350', (SELECT id FROM material_catalog WHERE code = 'CON-RM35')),
    ('Ready Mix K-225', (SELECT id FROM material_catalog WHERE code = 'CON-RM22')),
    ('Ready Mix K-250', (SELECT id FROM material_catalog WHERE code = 'CON-RM25')),
    ('Ready Mix K-300', (SELECT id FROM material_catalog WHERE code = 'CON-RM30')),
    ('Ready Mix K-350', (SELECT id FROM material_catalog WHERE code = 'CON-RM35')),
    ('Beton Ready Mix K225', (SELECT id FROM material_catalog WHERE code = 'CON-RM22')),
    ('Beton Ready Mix K250', (SELECT id FROM material_catalog WHERE code = 'CON-RM25')),
    ('Beton Ready Mix K300', (SELECT id FROM material_catalog WHERE code = 'CON-RM30')),
    ('Bata Ringan 600x200x75', (SELECT id FROM material_catalog WHERE code = 'AAC-BL07')),
    ('Besi Tulangan Ø16', (SELECT id FROM material_catalog WHERE code = 'REB-DE16')),
    ('Baja H 300', (SELECT id FROM material_catalog WHERE code = 'STL-HB300')),
    ('Bendrat', (SELECT id FROM material_catalog WHERE code = 'KWD-BDR01')),
    ('Air Kerja', (SELECT id FROM material_catalog WHERE code = 'WTR-WRK')),
    ('Cat Meni', (SELECT id FROM material_catalog WHERE code = 'PNT-MNI01')),
    ('Cat Menie', (SELECT id FROM material_catalog WHERE code = 'PNT-MNI01')),
    ('Plamir Tembok', (SELECT id FROM material_catalog WHERE code = 'PNT-PLM01')),
    ('Tanah Urug', (SELECT id FROM material_catalog WHERE code = 'EXC-FIL01')),
    ('Batu Kali', (SELECT id FROM material_catalog WHERE code = 'STN-RVR01')),
    ('Sirtu', (SELECT id FROM material_catalog WHERE code = 'AGG-SRT')),
    ('Keramik 30x30', (SELECT id FROM material_catalog WHERE code = 'TIL-CR30')),
    ('Keramik 60x60', (SELECT id FROM material_catalog WHERE code = 'TIL-CR60')),
    ('Keramik lantai 30x30', (SELECT id FROM material_catalog WHERE code = 'TIL-CR30')),
    ('Keramik lantai 60x60', (SELECT id FROM material_catalog WHERE code = 'TIL-CR60')),
    ('Keramik dinding 30x30', (SELECT id FROM material_catalog WHERE code = 'TIL-CR30')),
    ('Pipa PVC 4"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC100')),
    ('Pipa PVC 2 1/2"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC75')),
    ('Pipa PVC 1 1/2"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC50')),
    ('Pipa PVC 1"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC32')),
    ('Pipa PVC 3/4"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC25')),
    ('Pipa PVC 1/2"', (SELECT id FROM material_catalog WHERE code = 'PLB-PVC20')),
    ('Wiremesh M6', (SELECT id FROM material_catalog WHERE code = 'WMS-M610')),
    ('Wiremesh M8', (SELECT id FROM material_catalog WHERE code = 'WMS-M810')),
    ('Wiremesh M10', (SELECT id FROM material_catalog WHERE code = 'WMS-M1010')),
    ('Gypsum 9mm', (SELECT id FROM material_catalog WHERE code = 'GYP-BD09')),
    ('Gypsum 12mm', (SELECT id FROM material_catalog WHERE code = 'GYP-BD12')),
    ('Gypsum Board 9mm', (SELECT id FROM material_catalog WHERE code = 'GYP-BD09')),
    ('Gypsum Board 12mm', (SELECT id FROM material_catalog WHERE code = 'GYP-BD12'));

  SELECT id INTO mat_rm25   FROM material_catalog WHERE code = 'CON-RM25';
  SELECT id INTO mat_rm30   FROM material_catalog WHERE code = 'CON-RM30';
  SELECT id INTO mat_aac    FROM material_catalog WHERE code = 'AAC-BL07';
  SELECT id INTO mat_cement FROM material_catalog WHERE code = 'CEM-OPC50';
  SELECT id INTO mat_rebar  FROM material_catalog WHERE code = 'REB-DE16';
  SELECT id INTO mat_tile   FROM material_catalog WHERE code = 'TIL-CR60';
  SELECT id INTO mat_ppr    FROM material_catalog WHERE code = 'PLB-PPR25';
  SELECT id INTO mat_alum   FROM material_catalog WHERE code = 'ALM-KSN4';

  -- ── Project Alpha: populated example flow ────────────────────────────────
  INSERT INTO boq_items (
    project_id, code, label, unit, planned, installed, progress, tier1_material, tier2_material
  )
  VALUES
    (pid_alpha, 'STR-01', 'Pekerjaan Pondasi Footplat',      'm3',   45.0,  12.5, 27.8, 'Ready mix kelas 25',      'Batu belah'),
    (pid_alpha, 'STR-02', 'Kolom Beton Bertulang',           'm3',   28.0,   8.0, 28.6, 'Ready mix kelas 30',      'Besi beton ulir 16 mm'),
    (pid_alpha, 'ARC-01', 'Pasangan Dinding Bata Ringan',    'm2',  320.0,  80.0, 25.0, 'Bata ringan 7.5 cm',      NULL),
    (pid_alpha, 'FIN-01', 'Plester & Acian Dinding',         'm2',  640.0,   0.0,  0.0, 'Semen OPC 50 kg',         NULL),
    (pid_alpha, 'FIN-02', 'Pemasangan Keramik Lantai 60x60', 'm2',  210.0,  45.0, 21.4, 'Keramik 60x60', NULL),
    (pid_alpha, 'MEP-01', 'Instalasi Pipa Air Bersih',       'm',   180.0, 120.0, 66.7, 'Pipa PPR 25 mm', NULL),
    (pid_alpha, 'ARC-02', 'Pemasangan Kusen Aluminium',      'unit',  24.0,   8.0, 33.3, 'Kusen aluminium 4 inch', NULL),
    (pid_alpha, 'STR-03', 'Balok Beton Bertulang Lt.1',      'm3',   18.0,   5.5, 30.6, 'Ready mix kelas 30',      'Besi beton ulir 16 mm');

  SELECT id INTO alpha_str01 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-01';
  SELECT id INTO alpha_str02 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-02';
  SELECT id INTO alpha_arc01 FROM boq_items WHERE project_id = pid_alpha AND code = 'ARC-01';
  SELECT id INTO alpha_fin01 FROM boq_items WHERE project_id = pid_alpha AND code = 'FIN-01';
  SELECT id INTO alpha_fin02 FROM boq_items WHERE project_id = pid_alpha AND code = 'FIN-02';
  SELECT id INTO alpha_mep01 FROM boq_items WHERE project_id = pid_alpha AND code = 'MEP-01';
  SELECT id INTO alpha_arc02 FROM boq_items WHERE project_id = pid_alpha AND code = 'ARC-02';
  SELECT id INTO alpha_str03 FROM boq_items WHERE project_id = pid_alpha AND code = 'STR-03';

  -- ── Project Beta: parsed baseline only ───────────────────────────────────
  INSERT INTO boq_items (
    project_id, code, label, unit, planned, installed, progress, tier1_material, tier2_material
  )
  VALUES
    (pid_beta, 'STR-01', 'Pekerjaan Pondasi Tapak',          'm3',  32.0,  0.0, 0.0, 'Ready mix kelas 25',      'Besi beton ulir 16 mm'),
    (pid_beta, 'ARC-01', 'Pasangan Dinding Bata Ringan',     'm2', 280.0,  0.0, 0.0, 'Bata ringan 7.5 cm',      NULL),
    (pid_beta, 'FIN-01', 'Pemasangan Keramik Lantai 60x60',  'm2', 165.0,  0.0, 0.0, 'Keramik 60x60', NULL),
    (pid_beta, 'MEP-01', 'Instalasi Pipa Air Bersih',        'm',  150.0,  0.0, 0.0, 'Pipa PPR 25 mm', NULL);

  SELECT id INTO beta_str01 FROM boq_items WHERE project_id = pid_beta AND code = 'STR-01';
  SELECT id INTO beta_arc01 FROM boq_items WHERE project_id = pid_beta AND code = 'ARC-01';
  SELECT id INTO beta_fin01 FROM boq_items WHERE project_id = pid_beta AND code = 'FIN-01';
  SELECT id INTO beta_mep01 FROM boq_items WHERE project_id = pid_beta AND code = 'MEP-01';

  -- ── Baseline envelopes so Gate 1 has capacity references ─────────────────
  INSERT INTO envelopes (project_id, boq_item_id, max_quantity, warning_pct)
  VALUES
    (pid_alpha, alpha_str01,  50.0, 80),
    (pid_alpha, alpha_str02,  32.0, 80),
    (pid_alpha, alpha_arc01, 380.0, 85),
    (pid_alpha, alpha_fin01, 700.0, 80),
    (pid_alpha, alpha_fin02, 230.0, 85),
    (pid_alpha, alpha_mep01, 200.0, 80),
    (pid_alpha, alpha_arc02,  28.0, 85),
    (pid_alpha, alpha_str03,  22.0, 80),
    (pid_beta,  beta_str01,   36.0, 80),
    (pid_beta,  beta_arc01,  320.0, 85),
    (pid_beta,  beta_fin01,  180.0, 85),
    (pid_beta,  beta_mep01,  165.0, 80);

  -- ── Project Alpha price references for Gate 2 ────────────────────────────
  INSERT INTO price_history (project_id, material_id, vendor, unit_price)
  VALUES
    (pid_alpha, mat_rm25,   'PT Holcim Beton',    900000),
    (pid_alpha, mat_rm30,   'PT Holcim Beton',    980000),
    (pid_alpha, mat_aac,    'Toko Bangunan Maju',   7600),
    (pid_alpha, mat_cement, 'PT Semen Tiga Roda',  72000),
    (pid_alpha, mat_rebar,  'CV Besi Utama',       14500),
    (pid_alpha, mat_tile,   'CV Keramik Indah',   185000),
    (pid_alpha, mat_ppr,    'Toko Sanitasi Jaya',  28000),
    (pid_alpha, mat_alum,   'CV Aluminium Prima', 850000);

  INSERT INTO vendor_scorecards (vendor, project_id, score, notes)
  VALUES
    ('PT Holcim Beton',    pid_alpha, 88, 'Lead time stabil dan mutu beton konsisten.'),
    ('CV Keramik Indah',   pid_alpha, 83, 'Pengiriman rapi, variasi warna perlu dicek batch.'),
    ('Toko Sanitasi Jaya', pid_alpha, 79, 'Harga baik, pengiriman kadang parsial.');

  -- ── Parsed AHS baseline: Alpha + Beta ────────────────────────────────────
  INSERT INTO ahs_versions (project_id, version, published_at)
  VALUES (pid_alpha, 1, now())
  RETURNING id INTO ahs_alpha;

  INSERT INTO ahs_versions (project_id, version, published_at)
  VALUES (pid_beta, 1, now())
  RETURNING id INTO ahs_beta;

  INSERT INTO ahs_lines (
    ahs_version_id, boq_item_id, material_id, material_spec, tier, usage_rate, unit, waste_factor,
    line_type, coefficient, unit_price, description, ahs_block_title, source_row, trade_category, trade_confirmed
  )
  VALUES
    (ahs_alpha, alpha_str01, mat_rm25,   'K-250 slump 12cm',         1,  1.00, 'm3', 0.03, 'material',  1.00,  900000, NULL,                           'Pondasi Footplat',            101, NULL,                true),
    (ahs_alpha, alpha_str01, mat_rebar,  'Ø16 BJTS420',              1, 78.00, 'kg', 0.05, 'material', 78.00,   14500, NULL,                           'Pondasi Footplat',            102, NULL,                true),
    (ahs_alpha, alpha_str02, mat_rm30,   'K-300 slump 12cm',         1,  1.00, 'm3', 0.03, 'material',  1.00,  980000, NULL,                           'Kolom Beton Bertulang',       111, NULL,                true),
    (ahs_alpha, alpha_str02, mat_rebar,  'Ø16 BJTS420',              1, 85.00, 'kg', 0.05, 'material', 85.00,   14500, NULL,                           'Kolom Beton Bertulang',       112, NULL,                true),
    (ahs_alpha, alpha_arc01, mat_aac,    '600x200x75 AAC',           2,  8.30, 'pcs',0.05, 'material',  8.30,    7600, NULL,                           'Dinding Bata Ringan',         121, NULL,                true),
    (ahs_alpha, alpha_fin01, mat_cement, 'Tipe I / OPC',             2,  0.35, 'zak',0.02, 'material',  0.35,   72000, NULL,                           'Plester & Acian Dinding',     131, NULL,                true),
    (ahs_alpha, alpha_fin02, mat_tile,   'Granit 60x60 antislip',    2,  1.05, 'm2', 0.05, 'material',  1.05,  185000, NULL,                           'Keramik Lantai 60x60',        141, NULL,                true),
    (ahs_alpha, alpha_mep01, mat_ppr,    'PPR PN-10 3/4 inch',       2,  1.00, 'm',  0.03, 'material',  1.00,   28000, NULL,                           'Instalasi Pipa Air Bersih',   151, NULL,                true),
    (ahs_alpha, alpha_arc02, mat_alum,   'Kusen aluminium 4 inch',   2,  1.00, 'unit',0.02,'material',  1.00,  850000, NULL,                           'Kusen Aluminium',             161, NULL,                true),
    (ahs_alpha, alpha_str03, mat_rm30,   'K-300 slump 12cm',         1,  1.00, 'm3', 0.03, 'material',  1.00,  980000, NULL,                           'Balok Beton Lt.1',            171, NULL,                true),
    (ahs_alpha, alpha_str03, mat_rebar,  'Ø16 BJTS420',              1, 92.00, 'kg', 0.05, 'material', 92.00,   14500, NULL,                           'Balok Beton Lt.1',            172, NULL,                true),
    (ahs_alpha, alpha_str01, NULL,       NULL,                       3,  0.55, 'OH', 0.00, 'labor',     0.55,  125000, 'Tukang cor beton',            'Pondasi Footplat',            201, 'beton_bekisting',  true),
    (ahs_alpha, alpha_str01, NULL,       NULL,                       3,  0.90, 'OH', 0.00, 'labor',     0.90,  110000, 'Pekerja bekisting footplat',  'Pondasi Footplat',            202, 'beton_bekisting',  true),
    (ahs_alpha, alpha_str02, NULL,       NULL,                       3,  1.35, 'OH', 0.00, 'labor',     1.35,  130000, 'Tukang bekisting kolom',      'Kolom Beton Bertulang',       211, 'beton_bekisting',  true),
    (ahs_alpha, alpha_str02, NULL,       NULL,                       3,  1.55, 'OH', 0.00, 'labor',     1.55,  135000, 'Tukang besi kolom',           'Kolom Beton Bertulang',       212, 'besi',             true),
    (ahs_alpha, alpha_fin01, NULL,       NULL,                       3,  0.22, 'OH', 0.00, 'labor',     0.22,  128000, 'Tukang plester & acian',      'Plester & Acian Dinding',     221, 'plesteran',        true),
    (ahs_alpha, alpha_fin02, NULL,       NULL,                       3,  0.35, 'OH', 0.00, 'labor',     0.35,  165000, 'Tukang keramik',              'Keramik Lantai 60x60',        231, 'finishing',        true),
    (ahs_alpha, alpha_mep01, NULL,       NULL,                       3,  0.45, 'OH', 0.00, 'labor',     0.45,  150000, 'Tukang pipa air bersih',      'Instalasi Pipa Air Bersih',   241, 'mep',              true),
    (ahs_beta,  beta_str01,  mat_rm25,   'K-250 slump 12cm',         1,  1.00, 'm3', 0.03, 'material',  1.00,  900000, NULL,                           'Pondasi Tapak',               301, NULL,                true),
    (ahs_beta,  beta_str01,  mat_rebar,  'Ø16 BJTS420',              1, 76.00, 'kg', 0.05, 'material', 76.00,   14500, NULL,                           'Pondasi Tapak',               302, NULL,                true),
    (ahs_beta,  beta_arc01,  mat_aac,    '600x200x75 AAC',           2,  8.20, 'pcs',0.05, 'material',  8.20,    7600, NULL,                           'Dinding Bata Ringan',         311, NULL,                true),
    (ahs_beta,  beta_fin01,  mat_tile,   'Granit 60x60 antislip',    2,  1.05, 'm2', 0.05, 'material',  1.05,  185000, NULL,                           'Keramik Lantai 60x60',        321, NULL,                true),
    (ahs_beta,  beta_mep01,  mat_ppr,    'PPR PN-10 3/4 inch',       2,  1.00, 'm',  0.03, 'material',  1.00,   28000, NULL,                           'Instalasi Pipa Air Bersih',   331, NULL,                true),
    (ahs_beta,  beta_str01,  NULL,       NULL,                       3,  0.60, 'OH', 0.00, 'labor',     0.60,  125000, 'Tukang beton pondasi',        'Pondasi Tapak',               401, 'beton_bekisting', false),
    (ahs_beta,  beta_arc01,  NULL,       NULL,                       3,  0.18, 'OH', 0.00, 'labor',     0.18,  120000, 'Tukang pasangan bata ringan', 'Dinding Bata Ringan',         411, 'pasangan',         false),
    (ahs_beta,  beta_fin01,  NULL,       NULL,                       3,  0.32, 'OH', 0.00, 'labor',     0.32,  165000, 'Tukang keramik',              'Keramik Lantai 60x60',        421, 'finishing',        false),
    (ahs_beta,  beta_mep01,  NULL,       NULL,                       3,  0.40, 'OH', 0.00, 'labor',     0.40,  150000, 'Tukang pipa',                 'Instalasi Pipa Air Bersih',   431, 'mep',              false);

  INSERT INTO project_material_master (project_id, ahs_version_id)
  VALUES (pid_alpha, ahs_alpha)
  RETURNING id INTO master_alpha;

  INSERT INTO project_material_master_lines (master_id, material_id, boq_item_id, planned_quantity, unit)
  VALUES
    (master_alpha, mat_rm25,   alpha_str01,  46.35,   'm3'),
    (master_alpha, mat_rebar,  alpha_str01, 3685.50,  'kg'),
    (master_alpha, mat_rm30,   alpha_str02,  28.84,   'm3'),
    (master_alpha, mat_rebar,  alpha_str02, 2499.00,  'kg'),
    (master_alpha, mat_aac,    alpha_arc01, 2788.80,  'pcs'),
    (master_alpha, mat_cement, alpha_fin01,  228.48,  'zak'),
    (master_alpha, mat_tile,   alpha_fin02,  231.53,  'm2'),
    (master_alpha, mat_ppr,    alpha_mep01,  185.40,  'm'),
    (master_alpha, mat_alum,   alpha_arc02,   24.48,  'unit'),
    (master_alpha, mat_rm30,   alpha_str03,   18.54,  'm3'),
    (master_alpha, mat_rebar,  alpha_str03, 1738.80,  'kg');

  INSERT INTO project_material_master (project_id, ahs_version_id)
  VALUES (pid_beta, ahs_beta)
  RETURNING id INTO master_beta;

  INSERT INTO project_material_master_lines (master_id, material_id, boq_item_id, planned_quantity, unit)
  VALUES
    (master_beta, mat_rm25,  beta_str01,  32.96,  'm3'),
    (master_beta, mat_rebar, beta_str01, 2553.60, 'kg'),
    (master_beta, mat_aac,   beta_arc01, 2410.80, 'pcs'),
    (master_beta, mat_tile,  beta_fin01, 181.91,  'm2'),
    (master_beta, mat_ppr,   beta_mep01, 154.50,  'm');

  -- ── Alpha request examples (Gate 1) ──────────────────────────────────────
  INSERT INTO material_request_headers (
    project_id, boq_item_id, requested_by, target_date, urgency, common_note,
    overall_flag, overall_status, reviewed_by, reviewed_at, request_basis
  )
  VALUES (
    pid_alpha, alpha_str01, uid_supervisor, '2026-02-09', 'NORMAL',
    'Permintaan pengecoran pondasi tahap awal.',
    'OK', 'APPROVED', uid_estimator, '2026-02-08T15:00:00+07', 'BOQ'
  )
  RETURNING id INTO req_readymix;

  INSERT INTO material_request_headers (
    project_id, boq_item_id, requested_by, target_date, urgency, common_note,
    overall_flag, overall_status, request_basis
  )
  VALUES (
    pid_alpha, alpha_fin02, uid_supervisor, '2026-03-17', 'URGENT',
    'Permintaan keramik melewati kapasitas paket minggu ini sehingga ditahan untuk review.',
    'CRITICAL', 'AUTO_HOLD', 'BOQ'
  )
  RETURNING id INTO req_tile_hold;

  INSERT INTO material_request_lines (
    request_header_id, material_id, custom_material_name, tier, material_spec_reference,
    quantity, unit, line_flag, line_check_details
  )
  VALUES (
    req_readymix, mat_rm25, NULL, 1, 'K-250 slump 12cm',
    12.0, 'm3', 'OK', '{"check":"gate1","msg":"Masih dalam envelope pondasi."}'::jsonb
  )
  RETURNING id INTO line_readymix;

  INSERT INTO material_request_lines (
    request_header_id, material_id, custom_material_name, tier, material_spec_reference,
    quantity, unit, line_flag, line_check_details
  )
  VALUES (
    req_tile_hold, mat_tile, NULL, 2, 'Granit 60x60 antislip',
    260.0, 'm2', 'CRITICAL', '{"check":"gate1","msg":"Melebihi envelope finishing dan perlu override."}'::jsonb
  )
  RETURNING id INTO line_tile_hold;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'material_request_line_allocations'
  ) THEN
    INSERT INTO material_request_line_allocations (
      request_line_id, boq_item_id, allocated_quantity, proportion_pct, allocation_basis
    )
    VALUES
      (line_readymix,  alpha_str01, 12.0, 100, 'DIRECT'),
      (line_tile_hold, alpha_fin02, 260.0, 100, 'DIRECT');
  END IF;

  -- ── Alpha PO + receipt examples (Gate 2 / Gate 3) ────────────────────────
  INSERT INTO purchase_orders (
    project_id, po_number, boq_ref, supplier, material_name, quantity, unit, unit_price, ordered_date, status
  )
  VALUES
    (pid_alpha, 'PO-ALPHA-001', 'STR-01', 'PT Holcim Beton',    'Ready mix kelas 25',      45.0,  'm3',  900000, '2026-02-10', 'PARTIAL_RECEIVED'),
    (pid_alpha, 'PO-ALPHA-002', 'ARC-01', 'Toko Bangunan Maju', 'Bata ringan 7.5 cm',     2660.0, 'pcs',   7600, '2026-02-15', 'OPEN'),
    (pid_alpha, 'PO-ALPHA-003', 'FIN-02', 'CV Keramik Indah',   'Keramik 60x60', 210.0, 'm2',  185000, '2026-03-20', 'FULLY_RECEIVED'),
    (pid_alpha, 'PO-ALPHA-004', 'MEP-01', 'Toko Sanitasi Jaya', 'Pipa PPR 25 mm', 180.0, 'm',    28000, '2026-04-01', 'PARTIAL_RECEIVED');

  SELECT id INTO po_alpha_1 FROM purchase_orders WHERE po_number = 'PO-ALPHA-001';
  SELECT id INTO po_alpha_2 FROM purchase_orders WHERE po_number = 'PO-ALPHA-002';
  SELECT id INTO po_alpha_3 FROM purchase_orders WHERE po_number = 'PO-ALPHA-003';
  SELECT id INTO po_alpha_4 FROM purchase_orders WHERE po_number = 'PO-ALPHA-004';

  INSERT INTO purchase_order_lines (po_id, material_id, material_name, quantity, unit, unit_price)
  VALUES
    (po_alpha_1, mat_rm25,  'Ready mix kelas 25',      45.0,  'm3',  900000),
    (po_alpha_2, mat_aac,   'Bata ringan 7.5 cm',     2660.0, 'pcs',   7600),
    (po_alpha_3, mat_tile,  'Keramik 60x60', 210.0, 'm2',  185000),
    (po_alpha_4, mat_ppr,   'Pipa PPR 25 mm', 180.0, 'm',    28000);

  INSERT INTO receipts (po_id, project_id, received_by, vehicle_ref, gate3_flag, notes, created_at)
  VALUES
    (po_alpha_1, pid_alpha, uid_supervisor, 'B 9123 HCB', 'OK',      'Ready mix batch awal diterima sesuai kebutuhan footplat.', '2026-02-10T08:30:00+07'),
    (po_alpha_3, pid_alpha, uid_supervisor, 'B 8871 KRM', 'OK',      'Keramik diterima lengkap untuk satu lantai.',              '2026-03-20T10:45:00+07'),
    (po_alpha_4, pid_alpha, uid_supervisor, 'B 7742 SAN', 'WARNING', 'Penerimaan pipa parsial, sisa menunggu kiriman berikut.', '2026-04-01T14:05:00+07');

  INSERT INTO receipt_lines (receipt_id, material_name, quantity_actual, unit, created_at)
  SELECT r.id, v.material_name, v.quantity_actual, v.unit, v.created_at
  FROM receipts r
  JOIN (
    VALUES
      (po_alpha_1, 'Ready mix kelas 25',      12.0::numeric, 'm3', '2026-02-10T08:35:00+07'::timestamptz),
      (po_alpha_3, 'Keramik 60x60', 210.0::numeric,'m2', '2026-03-20T10:50:00+07'::timestamptz),
      (po_alpha_4, 'Pipa PPR 25 mm', 120.0::numeric,'m',  '2026-04-01T14:10:00+07'::timestamptz)
  ) AS v(po_id, material_name, quantity_actual, unit, created_at)
    ON v.po_id = r.po_id;

  -- ── Alpha progress examples (Gate 4) ──────────────────────────────────────
  INSERT INTO progress_entries (
    project_id, boq_item_id, reported_by, quantity, unit, work_status, location, note, created_at
  )
  VALUES
    (pid_alpha, alpha_str01, uid_supervisor, 12.5, 'm3',   'IN_PROGRESS', 'Grid A1-A3',          'Pengecoran footplat batch awal selesai.',              '2026-02-18T09:15:00+07'),
    (pid_alpha, alpha_str02, uid_supervisor,  8.0, 'm3',   'IN_PROGRESS', 'Kolom K1-K3',         'Kolom utama lantai dasar selesai dicor.',              '2026-02-27T15:40:00+07'),
    (pid_alpha, alpha_arc01, uid_supervisor, 80.0, 'm2',   'IN_PROGRESS', 'Ruang keluarga Lt.1', 'Pasangan bata ringan sisi timur selesai.',             '2026-03-07T16:10:00+07'),
    (pid_alpha, alpha_str03, uid_supervisor,  5.5, 'm3',   'IN_PROGRESS', 'Balok B1-B3',         'Balok lantai satu tahap awal terpasang.',              '2026-03-10T11:30:00+07'),
    (pid_alpha, alpha_fin02, uid_supervisor, 45.0, 'm2',   'IN_PROGRESS', 'Kamar tamu + koridor','Keramik terpasang sebagian, area tepi masih ditahan.', '2026-03-18T14:20:00+07'),
    (pid_alpha, alpha_mep01, uid_supervisor,120.0, 'm',    'IN_PROGRESS', 'Shaft dapur',         'Instalasi pipa air bersih rough-in selesai.',          '2026-03-21T17:00:00+07'),
    (pid_alpha, alpha_arc02, uid_supervisor,  8.0, 'unit', 'IN_PROGRESS', 'Fasad depan',         'Kusen aluminium fasad depan terpasang.',               '2026-03-24T13:10:00+07');

  -- ── Alpha milestone examples ──────────────────────────────────────────────
  INSERT INTO milestones (project_id, label, planned_date, boq_ids, status)
  VALUES
    (pid_alpha, 'Selesai Pondasi',             '2026-04-30', ARRAY[alpha_str01],                       'AT_RISK'),
    (pid_alpha, 'Selesai Struktur Lantai 1',   '2026-06-30', ARRAY[alpha_str02, alpha_str03],         'ON_TRACK'),
    (pid_alpha, 'Selesai Dinding & Plesteran', '2026-08-31', ARRAY[alpha_arc01, alpha_fin01],         'ON_TRACK'),
    (pid_alpha, 'Selesai Finishing Lt.1',      '2026-09-30', ARRAY[alpha_fin02, alpha_arc02],         'DELAYED');

  -- ── Alpha defects example ─────────────────────────────────────────────────
  INSERT INTO defects (
    project_id, boq_ref, location, description, severity, status, responsible_party, reported_by
  )
  VALUES
    (pid_alpha, 'STR-01 — Pekerjaan Pondasi Footplat',   'Grid A1, Pit 3',        'Permukaan beton keropos, perlu patching lokal.',                     'Major',    'OPEN',      'Mandor Struktur',  uid_supervisor),
    (pid_alpha, 'STR-02 — Kolom Beton Bertulang',        'Kolom K3, As C-2',      'Retak rambut memanjang perlu observasi mutu dan injeksi lokal.',    'Major',    'IN_REPAIR', 'Mandor Struktur',  uid_supervisor),
    (pid_alpha, 'MEP-01 — Instalasi Pipa Air Bersih',    'Shaft dapur',           'Kebocoran sambungan elbow 90° saat pressure test.',                 'Critical', 'OPEN',      'Mandor MEP',       uid_supervisor);

  -- ── Alpha MTN example ─────────────────────────────────────────────────────
  INSERT INTO mtn_requests (
    project_id, requested_by, material_name, material_id, quantity, unit,
    destination_project, destination_project_id, reason, status
  )
  VALUES (
    pid_alpha,
    uid_supervisor,
    'Bata ringan 7.5 cm',
    mat_aac,
    200,
    'pcs',
    'Project Beta',
    pid_beta,
    'Kelebihan stok batch awal, dipindahkan untuk menjaga cashflow proyek.',
    'AWAITING'
  );

  -- ── Unified site changes example ──────────────────────────────────────────
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'site_changes'
  ) THEN
    INSERT INTO site_changes (
      project_id, location, description, photo_urls, change_type, boq_item_id, contract_id,
      impact, is_urgent, reported_by, est_cost, cost_bearer, needs_owner_approval,
      decision, reviewed_by, reviewed_at, estimator_note, resolved_at, resolved_by, resolution_note, created_at
    )
    VALUES
      (
        pid_alpha, 'Teras depan',
        'Owner meminta tambahan kanopi baja ringan di area teras depan.',
        ARRAY[]::text[], 'permintaan_owner', alpha_arc02, NULL,
        'sedang', true, uid_supervisor, 8500000, 'owner', true,
        'disetujui', uid_estimator, '2026-03-20T10:00:00+07', 'Masuk perubahan owner, lanjut setelah gambar kerja final diterima.', NULL, NULL, NULL, '2026-03-19T15:20:00+07'
      ),
      (
        pid_alpha, 'Lantai dasar keseluruhan',
        'Bidang plesteran tidak rata dan perlu rework sebelum finishing dilanjutkan.',
        ARRAY[]::text[], 'rework', alpha_fin01, NULL,
        'sedang', false, uid_supervisor, 1800000, 'kontraktor', false,
        'disetujui', uid_estimator, '2026-03-24T09:10:00+07', 'Rework disetujui, progress finishing jangan dinaikkan sebelum lolos cek ulang.', NULL, NULL, NULL, '2026-03-23T16:45:00+07'
      ),
      (
        pid_alpha, 'Kolom K3 As C-2',
        'Retak rambut memanjang perlu observasi mutu dan tindakan koreksi lokal.',
        ARRAY[]::text[], 'catatan_mutu', alpha_str02, NULL,
        'berat', true, uid_supervisor, NULL, NULL, false,
        'pending', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-21T11:30:00+07'
      ),
      (
        pid_alpha, 'Ruang tamu',
        'Penggantian spesifikasi bata dari bata merah ke AAC mengikuti revisi desain.',
        ARRAY[]::text[], 'revisi_desain', alpha_arc01, NULL,
        'sedang', false, uid_supervisor, 4200000, 'owner', true,
        'selesai', uid_admin, '2026-03-18T14:00:00+07', 'Sudah masuk addendum spesifikasi dan area terkait selesai dikerjakan.', '2026-03-28T17:10:00+07', uid_supervisor, 'Perubahan sudah terealisasi di lapangan.', '2026-03-17T09:05:00+07'
      );
  END IF;

  -- ── Alpha mandor / opname examples ────────────────────────────────────────
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'mandor_contracts'
  ) THEN
    INSERT INTO mandor_contracts (
      project_id, mandor_name, trade_categories, retention_pct, notes, is_active, created_by, payment_mode, daily_rate
    )
    VALUES
      (
        pid_alpha,
        'Mandor Struktur Pak Darto',
        '["beton_bekisting","besi"]'::jsonb,
        10,
        'Contoh kontrak borongan struktur untuk alur rate, opname, dan pembayaran.',
        true,
        uid_estimator,
        'borongan',
        0
      )
    RETURNING id INTO contract_struct;

    INSERT INTO mandor_contracts (
      project_id, mandor_name, trade_categories, retention_pct, notes, is_active, created_by, payment_mode, daily_rate
    )
    VALUES
      (
        pid_alpha,
        'Mandor Harian Pak Joko',
        '["plesteran","finishing"]'::jsonb,
        0,
        'Contoh kontrak harian untuk alur pekerja, kehadiran, dan alokasi biaya mingguan.',
        true,
        uid_estimator,
        'harian',
        140000
      )
    RETURNING id INTO contract_harian;

    INSERT INTO mandor_contract_rates (
      contract_id, boq_item_id, contracted_rate, boq_labor_rate, unit, notes
    )
    VALUES
      (contract_struct, alpha_str01, 175000, 167750, 'm3', 'Rate borongan pondasi'),
      (contract_struct, alpha_str02, 410000, 384750, 'm3', 'Rate borongan kolom'),
      (contract_struct, alpha_str03, 395000, 364750, 'm3', 'Rate borongan balok lt.1');

    INSERT INTO opname_headers (
      project_id, contract_id, week_number, opname_date, status, payment_type,
      submitted_by, submitted_at, verified_by, verified_at, verifier_notes,
      approved_by, approved_at, retention_pct, kasbon
    )
    VALUES (
      pid_alpha,
      contract_struct,
      11,
      '2026-03-05',
      'PAID',
      'borongan',
      uid_supervisor,
      '2026-03-05T10:00:00+07',
      uid_estimator,
      '2026-03-06T11:30:00+07',
      'Contoh opname struktur yang sudah dibayar.',
      uid_admin,
      '2026-03-06T16:00:00+07',
      10,
      0
    )
    RETURNING id INTO header_struct_paid;

    INSERT INTO opname_headers (
      project_id, contract_id, week_number, opname_date, status, payment_type, retention_pct, kasbon
    )
    VALUES (
      pid_alpha,
      contract_struct,
      12,
      '2026-03-12',
      'DRAFT',
      'borongan',
      10,
      0
    )
    RETURNING id INTO header_struct_draft;

    INSERT INTO opname_lines (
      header_id, boq_item_id, description, unit, budget_volume, contracted_rate, boq_labor_rate,
      cumulative_pct, verified_pct, prev_cumulative_pct, cumulative_amount, this_week_amount, is_tdk_acc, tdk_acc_reason, notes
    )
    VALUES
      (header_struct_paid,  alpha_str01, 'Pekerjaan Pondasi Footplat', 'm3', 45.0, 175000, 167750, 26, NULL,  0, 2047500, 2047500, false, NULL, 'Opname struktur minggu 11'),
      (header_struct_paid,  alpha_str02, 'Kolom Beton Bertulang',      'm3', 28.0, 410000, 384750, 18, NULL,  0, 2066400, 2066400, false, NULL, 'Kolom utama lantai dasar'),
      (header_struct_paid,  alpha_str03, 'Balok Beton Bertulang Lt.1', 'm3', 18.0, 395000, 364750, 12, NULL,  0,  853200,  853200, false, NULL, 'Balok tahap awal'),
      (header_struct_draft, alpha_str01, 'Pekerjaan Pondasi Footplat', 'm3', 45.0, 175000, 167750, 36, NULL, 26, 2835000,  787500, false, NULL, 'Draft opname lanjutan pondasi'),
      (header_struct_draft, alpha_str02, 'Kolom Beton Bertulang',      'm3', 28.0, 410000, 384750, 29, NULL, 18, 3329200, 1262800, false, NULL, 'Draft opname kolom'),
      (header_struct_draft, alpha_str03, 'Balok Beton Bertulang Lt.1', 'm3', 18.0, 395000, 364750, 23, NULL, 12, 1635300,  782100, false, NULL, 'Draft opname balok');

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'mandor_workers'
    ) THEN
      INSERT INTO mandor_workers (
        contract_id, project_id, worker_name, skill_level, is_active, notes, created_by
      )
      VALUES
        (contract_harian, pid_alpha, 'Jajang Tukang', 'tukang', true, 'Pekerja harian contoh untuk finishing/plester.', uid_estimator),
        (contract_harian, pid_alpha, 'Udin Kenek',    'kenek',  true, 'Support material dan kebersihan area kerja.',   uid_estimator),
        (contract_harian, pid_alpha, 'Dede Tukang',   'tukang', true, 'Pekerja detail finishing dan acian.',           uid_estimator);

      SELECT id INTO worker_jajang FROM mandor_workers WHERE contract_id = contract_harian AND worker_name = 'Jajang Tukang';
      SELECT id INTO worker_udin   FROM mandor_workers WHERE contract_id = contract_harian AND worker_name = 'Udin Kenek';
      SELECT id INTO worker_dede   FROM mandor_workers WHERE contract_id = contract_harian AND worker_name = 'Dede Tukang';

      INSERT INTO worker_rates (
        worker_id, contract_id, daily_rate, effective_from, notes, set_by
      )
      VALUES
        (worker_jajang, contract_harian, 150000, '2026-03-01', 'Rate tukang finishing', uid_estimator),
        (worker_udin,   contract_harian, 120000, '2026-03-01', 'Rate kenek finishing',  uid_estimator),
        (worker_dede,   contract_harian, 145000, '2026-03-01', 'Rate tukang finishing', uid_estimator);

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'mandor_overtime_rules'
      ) THEN
        INSERT INTO mandor_overtime_rules (
          contract_id, normal_hours, tier1_threshold_hours, tier1_hourly_rate,
          tier2_threshold_hours, tier2_hourly_rate, effective_from, created_by
        )
        VALUES (
          contract_harian, 7, 7, 12500, 10, 18000, '2026-03-01', uid_estimator
        );
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'worker_overtime_rules'
      ) THEN
        INSERT INTO worker_overtime_rules (
          worker_id, contract_id, tier1_hourly_rate, tier2_threshold_hours, tier2_hourly_rate,
          effective_from, notes, set_by
        )
        VALUES (
          worker_jajang, contract_harian, 15000, 10, 22000,
          '2026-03-01', 'Contoh aturan lembur khusus tukang senior.', uid_estimator
        );
      END IF;

      INSERT INTO worker_attendance_entries (
        contract_id, project_id, worker_id, attendance_date,
        is_present, overtime_hours,
        daily_rate_snapshot, tier1_rate_snapshot, tier2_rate_snapshot,
        tier1_threshold_snapshot, tier2_threshold_snapshot,
        status, work_description, recorded_by, confirmed_by, confirmed_at,
        source, app_validated, is_locked
      )
      VALUES
        (contract_harian, pid_alpha, worker_jajang, '2026-03-23', true, 2, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Plester koridor dan area servis.',                    uid_supervisor, uid_supervisor, '2026-03-23T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-23', true, 0, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Angkut mortar dan bantu persiapan alat.',            uid_supervisor, uid_supervisor, '2026-03-23T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-23', true, 1, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Finishing sudut dan koreksi bidang.',               uid_supervisor, uid_supervisor, '2026-03-23T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_jajang, '2026-03-24', true, 1, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Perapihan plester kamar tamu.',                     uid_supervisor, uid_supervisor, '2026-03-24T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-24', true, 0, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Mixing mortar dan bersih area kerja.',             uid_supervisor, uid_supervisor, '2026-03-24T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-24', true, 2, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Acian detail dan koreksi bidang dinding.',          uid_supervisor, uid_supervisor, '2026-03-24T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_jajang, '2026-03-25', true, 0, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Finishing list pintu dan servis.',                uid_supervisor, uid_supervisor, '2026-03-25T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-25', false,0, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Izin keluarga.',                                  uid_supervisor, uid_supervisor, '2026-03-25T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-25', true, 1, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Perapihan nat dan sudut lantai.',                 uid_supervisor, uid_supervisor, '2026-03-25T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_jajang, '2026-03-26', true, 2, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Finishing bidang tangga dan bordes.',             uid_supervisor, uid_supervisor, '2026-03-26T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-26', true, 1, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Support angkut alat dan material ringan.',       uid_supervisor, uid_supervisor, '2026-03-26T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-26', true, 0, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Perapihan dinding tangga.',                      uid_supervisor, uid_supervisor, '2026-03-26T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_jajang, '2026-03-27', true, 0, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Acian kamar mandi dan area servis.',            uid_supervisor, uid_supervisor, '2026-03-27T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-27', true, 0, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Bersih area dan support acian.',                 uid_supervisor, uid_supervisor, '2026-03-27T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-27', true, 0, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Finishing bidang servis.',                      uid_supervisor, uid_supervisor, '2026-03-27T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_jajang, '2026-03-28', true, 1, 150000, 15000, 22000, 7, 10, 'CONFIRMED', 'Retouch akhir dan list pekerjaan.',            uid_supervisor, uid_supervisor, '2026-03-28T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_udin,   '2026-03-28', true, 0, 120000, 12500, 18000, 7, 10, 'CONFIRMED', 'Support bongkar alat dan pembersihan akhir.',   uid_supervisor, uid_supervisor, '2026-03-28T17:05:00+07', 'manual', false, false),
        (contract_harian, pid_alpha, worker_dede,   '2026-03-28', true, 2, 145000, 12500, 18000, 7, 10, 'CONFIRMED', 'Perapihan akhir dan punchlist finishing.',     uid_supervisor, uid_supervisor, '2026-03-28T17:05:00+07', 'manual', false, false);

      INSERT INTO opname_headers (
        project_id, contract_id, week_number, opname_date, status, payment_type,
        retention_pct, week_start, week_end, kasbon
      )
      VALUES (
        pid_alpha,
        contract_harian,
        13,
        '2026-03-29',
        'DRAFT',
        'harian',
        0,
        '2026-03-23',
        '2026-03-28',
        0
      )
      RETURNING id INTO header_harian_draft;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'harian_cost_allocations'
      ) THEN
        INSERT INTO harian_cost_allocations (
          header_id, project_id, contract_id, boq_item_id, allocation_scope, allocation_pct,
          ai_suggested_pct, ai_reason, supervisor_note, estimator_note, created_by, updated_by
        )
        VALUES
          (
            header_harian_draft, pid_alpha, contract_harian, alpha_fin01, 'boq_item', 50,
            52, 'Porsi kerja dominan ke plester dan acian area servis/koridor.', 'Mayoritas tukang fokus plester + acian.', 'Disetujui sedikit diturunkan untuk sisakan support umum.', uid_supervisor, uid_estimator
          ),
          (
            header_harian_draft, pid_alpha, contract_harian, alpha_fin02, 'boq_item', 25,
            23, 'Ada pekerjaan finishing sudut dan lantai, tetapi bukan mayoritas.', 'Sebagian waktu dipakai finishing sudut dan detail lantai.', 'Naikkan sedikit karena ada 2 hari fokus detail.', uid_supervisor, uid_estimator
          ),
          (
            header_harian_draft, pid_alpha, contract_harian, NULL, 'general_support', 25,
            25, 'Sebagian jam kerja adalah support mortar, angkut alat, dan pembersihan.', 'Kenek banyak support area kerja dan material.', 'Biarkan di support umum agar progress fisik tidak dipaksa naik.', uid_supervisor, uid_estimator
          );
      END IF;
    END IF;

    PERFORM recompute_opname_header_totals(header_struct_paid);
    PERFORM recompute_opname_header_totals(header_struct_draft);
    IF header_harian_draft IS NOT NULL THEN
      PERFORM recompute_opname_header_totals(header_harian_draft);
    END IF;
  END IF;

  -- ── Activity log (clean, current examples only) ──────────────────────────
  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES
    (pid_alpha, uid_supervisor, 'permintaan', 'Permintaan STR-01: Ready mix kelas 25 x12 m3 — APPROVED',         'OK'),
    (pid_alpha, uid_supervisor, 'permintaan', 'Permintaan FIN-02: Keramik 60x60 x260 m2 — AUTO_HOLD',            'WARNING'),
    (pid_alpha, uid_supervisor, 'terima',     'Ready mix kelas 25 diterima 12 m3 (parsial)',                     'OK'),
    (pid_alpha, uid_supervisor, 'progres',    'STR-01 — 12.5 m3 footplat terpasang',                             'OK'),
    (pid_alpha, uid_supervisor, 'progres',    'MEP-01 — 120 m pipa air bersih terpasang',                        'OK'),
    (pid_alpha, uid_supervisor, 'cacat',      'Kebocoran sambungan MEP di shaft dapur — Critical',               'WARNING'),
    (pid_alpha, uid_supervisor, 'mtn',        'MTN 200 pcs bata ringan → Project Beta',                          'INFO'),
    (pid_alpha, uid_estimator,  'vo',         'Catatan perubahan owner: tambahan kanopi teras depan',            'WARNING'),
    (pid_alpha, uid_estimator,  'attendance', 'Opname borongan minggu 12 disiapkan untuk review estimator',      'INFO'),
    (pid_alpha, uid_admin,      'attendance', 'Kehadiran harian minggu 13 siap dialokasikan ke BoQ',             'OK');
END $$;
