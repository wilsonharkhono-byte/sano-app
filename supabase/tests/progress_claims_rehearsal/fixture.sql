-- supabase/tests/progress_claims_rehearsal/fixture.sql
-- Disposable fixture for run.sh: one project, six people, six BoQ rows. Run as supabase_admin.
CREATE SCHEMA IF NOT EXISTS rehearsal;
GRANT USAGE ON SCHEMA rehearsal TO authenticated, postgres;

CREATE OR REPLACE FUNCTION rehearsal.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'a001' WHEN 'est' THEN 'a002' WHEN 'est2' THEN 'a003'
    WHEN 'adm' THEN 'a004' WHEN 'pri' THEN 'a005' WHEN 'out' THEN 'a006' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.p() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT '00000000-0000-4000-8000-00000000b001'::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.row(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000c00' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.as_user(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rehearsal.u(p_name)::text, true)
      || set_config('request.jwt.claim.role', 'authenticated', true)
      || set_config('request.jwt.claims', json_build_object('sub', rehearsal.u(p_name), 'role', 'authenticated')::text, true) $$;
CREATE OR REPLACE FUNCTION rehearsal.expect(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN 'PASS ' ELSE 'FAIL ' END || p_label || COALESCE(' :: ' || p_detail, '') $$;
CREATE OR REPLACE FUNCTION rehearsal.expect_error(p_label TEXT, p_sql TEXT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL ' || p_label || ' :: no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE p_prefix || '%' THEN 'PASS ' ELSE 'FAIL ' END || p_label || ' :: ' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rehearsal TO authenticated, postgres;

DELETE FROM projects WHERE id = rehearsal.p();

INSERT INTO auth.users (id, email)
SELECT rehearsal.u(n), n || '@rehearsal.test' FROM unnest(ARRAY['sup', 'est', 'est2', 'adm', 'pri', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal.u('sup'), 'Rehearsal Supervisor', 'supervisor'),
  (rehearsal.u('est'), 'Rehearsal Estimator', 'estimator'),
  (rehearsal.u('est2'), 'Rehearsal Estimator Two', 'estimator'),
  (rehearsal.u('adm'), 'Rehearsal Admin', 'admin'),
  (rehearsal.u('pri'), 'Rehearsal Principal', 'principal'),
  (rehearsal.u('out'), 'Rehearsal Outsider', 'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

INSERT INTO projects (id, code, name) VALUES (rehearsal.p(), 'REH-1', 'Rehearsal Project');

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal.p(), rehearsal.u('sup')), (rehearsal.p(), rehearsal.u('est')),
  (rehearsal.p(), rehearsal.u('est2')), (rehearsal.p(), rehearsal.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO boq_items (id, project_id, code, label, unit, planned, sort_order) VALUES
  (rehearsal.row(1), rehearsal.p(), 'T1-001', 'Lantai 1 ; Kolom', 'm3', 100, 1),
  (rehearsal.row(2), rehearsal.p(), 'T1-002', 'Lantai 2 ; Balok, Plat Lantai', 'm3', 200, 2),
  (rehearsal.row(3), rehearsal.p(), 'T1-003', 'Tangga', 'm3', 10, 3),
  (rehearsal.row(4), rehearsal.p(), 'T1-004', 'Lantai 1 ; Kolom lama', 'm3', 50, 4),
  (rehearsal.row(5), rehearsal.p(), 'T1-005', 'Lantai 3 ; Dinding', 'm3', 0, 5),
  (rehearsal.row(6), rehearsal.p(), 'T1-006', 'Lantai 3 ; Pile Cap', 'm3', 30, 6);
UPDATE boq_items SET superseded_at = now() WHERE id = rehearsal.row(4);

SELECT 'fixture ready: ' || (SELECT count(*) FROM boq_items WHERE project_id = rehearsal.p()) || ' rows, '
  || (SELECT count(*) FROM project_assignments WHERE project_id = rehearsal.p()) || ' members';
