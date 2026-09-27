-- supabase/tests/datum_sync_rehearsal/fixture.sql
-- Disposable fixture for run.sh: four projects, five people, four rooms, the
-- events the confirmer-stamp and guard checks read, one run, one cache row
-- and one request. Run as supabase_admin, after 107 is pasted. Re-runnable: it
-- deletes its own projects first (everything hanging off them cascades) and
-- clears the staff links it may have set on its own profiles last time.
CREATE SCHEMA IF NOT EXISTS rehearsal_ds;
GRANT USAGE ON SCHEMA rehearsal_ds TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION rehearsal_ds.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'f101' WHEN 'est' THEN 'f102' WHEN 'adm' THEN 'f103' WHEN 'pri' THEN 'f104' WHEN 'out' THEN 'f105' END)::uuid $$;
-- 1 = REH-DS-A (ACTIVE, paired REHDS-A), 2 = REH-DS-B (ACTIVE, unpaired: the
-- pairing checks use it and leave it unpaired), 3 = REH-DS-C (ON_HOLD, paired
-- REHDS-C), 4 = REH-DS-D (ACTIVE, unpaired, nobody's).
CREATE OR REPLACE FUNCTION rehearsal_ds.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f20' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.room(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f30' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.ev(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'open' THEN 'f401' WHEN 'prog' THEN 'f402' WHEN 'c1' THEN 'f403' WHEN 'c2' THEN 'f404'
    WHEN 'c4' THEN 'f405' WHEN 'new1' THEN 'f406' WHEN 'new2' THEN 'f407' WHEN 'new3' THEN 'f408'
    WHEN 'new4' THEN 'f409' WHEN 'new5' THEN 'f40a' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.run1() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT '00000000-0000-4000-8000-00000000f501'::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.as_user(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rehearsal_ds.u(p_name)::text, true)
      || set_config('request.jwt.claim.role', 'authenticated', true)
      || set_config('request.jwt.claims', json_build_object('sub', rehearsal_ds.u(p_name), 'role', 'authenticated')::text, true) $$;
-- The datum-sync function's identity: service_role in the JWT, no subject.
CREATE OR REPLACE FUNCTION rehearsal_ds.as_service() RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true)
      || set_config('request.jwt.claim.role', 'service_role', true)
      || set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true) $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.as_nobody() RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true)
      || set_config('request.jwt.claim.role', '', true)
      || set_config('request.jwt.claims', '', true) $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.expect(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN 'PASS ' ELSE 'FAIL ' END || p_label || COALESCE(' :: ' || p_detail, '') $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.expect_error(p_label TEXT, p_sql TEXT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL ' || p_label || ' :: no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE p_prefix || '%' THEN 'PASS ' ELSE 'FAIL ' END || p_label || ' :: ' || SQLERRM;
END $$;
-- Runs a statement and returns how many rows it touched: an UPDATE or DELETE
-- that RLS filters is not an error, it just touches nothing.
CREATE OR REPLACE FUNCTION rehearsal_ds.touched(p_sql TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- True when a write by the current role changed nothing: RLS filtered every
-- row (0 touched), or refused it outright (SQLSTATE 42501, which is both an
-- INSERT's "new row violates row-level security policy" and a missing grant).
CREATE OR REPLACE FUNCTION rehearsal_ds.writes_nothing(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 0;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN TRUE;
END $$;
-- A deterministic count of every constraint (including foreign keys),
-- trigger and policy 107 creates, so a re-paste that duplicates one (a
-- missing pg_constraint guard, DROP TRIGGER/POLICY IF EXISTS) changes this
-- number. Indexes are covered separately (they are all CREATE ... IF NOT
-- EXISTS already).
CREATE OR REPLACE FUNCTION rehearsal_ds.datum_catalog_count() RETURNS INT LANGUAGE sql AS $$
  SELECT
      (SELECT count(*) FROM pg_constraint WHERE conname = 'projects_datum_project_code_shape')
    + (SELECT count(*) FROM pg_constraint WHERE conname = 'site_events_confirmed_by_fkey')
    + (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname IN ('datum_sync_runs', 'room_datum_gate_status', 'datum_sync_requests'))
    + (SELECT count(*) FROM pg_trigger
         WHERE tgname IN ('rooms_datum_area_id_sync_only_trg', 'site_events_system_columns_guard_trg', 'profiles_datum_staff_id_sync_only_trg'))
    + (SELECT count(*) FROM pg_policies
         WHERE policyname IN ('datum_sync_runs_read', 'room_datum_gate_status_read', 'datum_sync_requests_office_read'))
$$;
CREATE TABLE IF NOT EXISTS rehearsal_ds.catalog_snapshot (n INT NOT NULL);

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rehearsal_ds TO authenticated, service_role, postgres;
GRANT SELECT, INSERT, DELETE ON rehearsal_ds.catalog_snapshot TO authenticated, service_role, postgres;

DELETE FROM projects WHERE id IN (rehearsal_ds.p(1), rehearsal_ds.p(2), rehearsal_ds.p(3), rehearsal_ds.p(4));

INSERT INTO auth.users (id, email)
SELECT rehearsal_ds.u(n), n || '@datum-rehearsal.test'
FROM unnest(ARRAY['sup', 'est', 'adm', 'pri', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal_ds.u('sup'), 'Rehearsal DS Supervisor', 'supervisor'),
  (rehearsal_ds.u('est'), 'Rehearsal DS Estimator',  'estimator'),
  (rehearsal_ds.u('adm'), 'Rehearsal DS Admin',      'admin'),
  (rehearsal_ds.u('pri'), 'Rehearsal DS Principal',  'principal'),
  (rehearsal_ds.u('out'), 'Rehearsal DS Outsider',   'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
-- supabase_admin is not an app role, so 107's guard lets this through.
UPDATE profiles SET datum_staff_id = NULL
WHERE id IN (rehearsal_ds.u('sup'), rehearsal_ds.u('est'), rehearsal_ds.u('adm'), rehearsal_ds.u('pri'), rehearsal_ds.u('out'));

INSERT INTO projects (id, code, name, status, datum_project_code) VALUES
  (rehearsal_ds.p(1), 'REH-DS-A', 'Rehearsal DATUM A', 'ACTIVE',  'REHDS-A'),
  (rehearsal_ds.p(2), 'REH-DS-B', 'Rehearsal DATUM B', 'ACTIVE',  NULL),
  (rehearsal_ds.p(3), 'REH-DS-C', 'Rehearsal DATUM C', 'ON_HOLD', 'REHDS-C'),
  (rehearsal_ds.p(4), 'REH-DS-D', 'Rehearsal DATUM D', 'ACTIVE',  NULL);

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal_ds.p(1), rehearsal_ds.u('sup')), (rehearsal_ds.p(1), rehearsal_ds.u('est')),
  (rehearsal_ds.p(1), rehearsal_ds.u('adm')), (rehearsal_ds.p(1), rehearsal_ds.u('pri')),
  (rehearsal_ds.p(2), rehearsal_ds.u('sup')), (rehearsal_ds.p(2), rehearsal_ds.u('pri')),
  (rehearsal_ds.p(3), rehearsal_ds.u('sup')), (rehearsal_ds.p(3), rehearsal_ds.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO rooms (id, project_id, room_code, room_name, floor, area_type) VALUES
  (rehearsal_ds.room(1), rehearsal_ds.p(1), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom'),
  (rehearsal_ds.room(2), rehearsal_ds.p(1), 'LT1-DAPUR', 'Dapur',         'Lt. 1', 'kitchen'),
  (rehearsal_ds.room(3), rehearsal_ds.p(2), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom'),
  (rehearsal_ds.room(4), rehearsal_ds.p(3), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom');

-- 'open' and 'prog' are confirmed already (inserted open, as the Dashboard
-- could); c1, c2 and c4 wait for confirm_site_event, which stamps confirmed_by.
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, captured_at, confirmed_at) VALUES
  (rehearsal_ds.ev('open'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), 'open', 'butuh_keputusan', 'Pilih warna nat', rehearsal_ds.u('sup'), rehearsal_ds.today() + 7, now() - interval '1 day', now() - interval '1 day'),
  (rehearsal_ds.ev('prog'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), 'open', 'progres', 'Acian selesai', NULL, NULL, now() - interval '1 day', now() - interval '1 day');
INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at) VALUES
  (rehearsal_ds.ev('c1'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours'),
  (rehearsal_ds.ev('c2'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours'),
  (rehearsal_ds.ev('c4'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours');

-- One finished run, one cache row and one waiting request on project A.
INSERT INTO datum_sync_runs (id, project_id, source, started_at, finished_at, ok, counts)
VALUES (rehearsal_ds.run1(), rehearsal_ds.p(1), 'cron', now() - interval '1 hour', now() - interval '59 minutes', true,
        '{"steps": {"areas": "ok", "gate_status": "ok"}}'::jsonb);
INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at, run_id)
VALUES (rehearsal_ds.room(1), 'A', rehearsal_ds.p(1), '00000000-0000-4000-8000-00000000f601', 'passed', false, now() - interval '59 minutes', rehearsal_ds.run1());
INSERT INTO datum_sync_requests (project_id, requested_at) VALUES (rehearsal_ds.p(1), now() - interval '3 hours');

-- Snapshot the catalog now: 107 has just been pasted twice, so this is what
-- one clean paste produces. rehearse_repaste.sql and run.sh compare against
-- it after every later re-paste in the run.
DELETE FROM rehearsal_ds.catalog_snapshot;
INSERT INTO rehearsal_ds.catalog_snapshot (n) VALUES (rehearsal_ds.datum_catalog_count());

SELECT 'fixture ready: ' || (SELECT count(*) FROM site_events WHERE project_id = rehearsal_ds.p(1)) || ' events on A, '
  || (SELECT count(*) FROM rooms WHERE project_id IN (rehearsal_ds.p(1), rehearsal_ds.p(2), rehearsal_ds.p(3))) || ' rooms';
