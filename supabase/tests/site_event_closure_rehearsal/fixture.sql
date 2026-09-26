-- supabase/tests/site_event_closure_rehearsal/fixture.sql
-- Disposable fixture for run.sh: three projects, eight people, three rooms,
-- the events every 105 and 106 check reads. Run as supabase_admin, after 105
-- and 106 are pasted. Re-runnable: it deletes its own projects first, and
-- everything hanging off them goes with the cascade.
CREATE SCHEMA IF NOT EXISTS rehearsal;
GRANT USAGE ON SCHEMA rehearsal TO authenticated, postgres;

CREATE OR REPLACE FUNCTION rehearsal.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'a101' WHEN 'sup2' THEN 'a102' WHEN 'est' THEN 'a103' WHEN 'adm' THEN 'a104'
    WHEN 'adm2' THEN 'a105' WHEN 'pri' THEN 'a106' WHEN 'gone' THEN 'a107' WHEN 'out' THEN 'a108' END)::uuid $$;
-- 1 = REH-CL-A (ACTIVE, everything happens here), 2 = REH-CL-B (ACTIVE, nothing
-- needs attention), 3 = REH-CL-C (ON_HOLD, has an overdue item).
CREATE OR REPLACE FUNCTION rehearsal.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000b10' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.room(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000c10' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.m(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000e1' || lpad(n::text, 2, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.ev(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'cacat' THEN 'd101' WHEN 'isu' THEN 'd102' WHEN 'hambatan' THEN 'd103' WHEN 'bk' THEN 'd104'
    WHEN 'progres' THEN 'd105' WHEN 'info' THEN 'd106' WHEN 'done_cacat' THEN 'd107' WHEN 'outsider' THEN 'd108'
    WHEN 'haz1' THEN 'd109' WHEN 'haz2' THEN 'd110'
    WHEN 'D1' THEN 'd201' WHEN 'D2' THEN 'd202' WHEN 'D3' THEN 'd203' WHEN 'D4' THEN 'd204'
    WHEN 'D5' THEN 'd205' WHEN 'D6' THEN 'd206' WHEN 'D7' THEN 'd207' WHEN 'D8' THEN 'd208' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date $$;
CREATE OR REPLACE FUNCTION rehearsal.wib_midnight() RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT rehearsal.today()::timestamp AT TIME ZONE 'Asia/Jakarta' $$;
CREATE OR REPLACE FUNCTION rehearsal.path(p_event TEXT, p_media INT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'site-events/' || rehearsal.p(1) || '/' || rehearsal.ev(p_event) || '/' || rehearsal.m(p_media) || '.jpg' $$;
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

DELETE FROM projects WHERE id IN (rehearsal.p(1), rehearsal.p(2), rehearsal.p(3));
DELETE FROM storage.objects WHERE bucket_id = 'site-media' AND name LIKE 'site-events/' || rehearsal.p(1) || '/%';

INSERT INTO storage.buckets (id, name, public) VALUES ('site-media', 'site-media', false) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
SELECT rehearsal.u(n), n || '@closure-rehearsal.test'
FROM unnest(ARRAY['sup', 'sup2', 'est', 'adm', 'adm2', 'pri', 'gone', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal.u('sup'),  'Rehearsal Supervisor',     'supervisor'),
  (rehearsal.u('sup2'), 'Rehearsal Supervisor Dua', 'supervisor'),
  (rehearsal.u('est'),  'Rehearsal Estimator',      'estimator'),
  (rehearsal.u('adm'),  'Rehearsal Admin',          'admin'),
  (rehearsal.u('adm2'), 'Rehearsal Admin Lain',     'admin'),
  (rehearsal.u('pri'),  'Rehearsal Principal',      'principal'),
  (rehearsal.u('gone'), 'Rehearsal Keluar',         'supervisor'),
  (rehearsal.u('out'),  'Rehearsal Outsider',       'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

-- 093's trigger adds the principal to each new project; the explicit rows
-- below are idempotent with it.
INSERT INTO projects (id, code, name, status) VALUES
  (rehearsal.p(1), 'REH-CL-A', 'Rehearsal Closure A', 'ACTIVE'),
  (rehearsal.p(2), 'REH-CL-B', 'Rehearsal Closure B', 'ACTIVE'),
  (rehearsal.p(3), 'REH-CL-C', 'Rehearsal Closure C', 'ON_HOLD');

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal.p(1), rehearsal.u('sup')), (rehearsal.p(1), rehearsal.u('sup2')), (rehearsal.p(1), rehearsal.u('est')),
  (rehearsal.p(1), rehearsal.u('adm')), (rehearsal.p(1), rehearsal.u('pri')), (rehearsal.p(1), rehearsal.u('gone')),
  (rehearsal.p(2), rehearsal.u('sup')), (rehearsal.p(2), rehearsal.u('pri')),
  (rehearsal.p(3), rehearsal.u('sup')), (rehearsal.p(3), rehearsal.u('adm')), (rehearsal.p(3), rehearsal.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;
-- 'gone' owned an item and has since been taken off the project.
DELETE FROM project_assignments WHERE project_id = rehearsal.p(1) AND user_id = rehearsal.u('gone');

INSERT INTO rooms (id, project_id, room_code, room_name, floor) VALUES
  (rehearsal.room(1), rehearsal.p(1), 'LT1-R01', 'Kamar Tidur 1', '1'),
  (rehearsal.room(2), rehearsal.p(1), 'LT1-R02', 'Dapur', '1'),
  (rehearsal.room(3), rehearsal.p(3), 'LT1-R01', 'Gudang', '1');

-- Closure events (105): open, owned by sup, due in a week, never attention.
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, captured_at, confirmed_at)
SELECT rehearsal.ev(n), rehearsal.p(1), rehearsal.room(2), rehearsal.u('sup'), 'open', t, 'Uji ' || n,
       rehearsal.u('sup'), rehearsal.today() + 7, now() - interval '1 day', now() - interval '1 day'
FROM (VALUES ('cacat', 'cacat'), ('isu', 'isu'), ('hambatan', 'hambatan'), ('bk', 'butuh_keputusan'),
             ('progres', 'progres'), ('info', 'info'), ('done_cacat', 'cacat'), ('outsider', 'progres'),
             ('haz1', 'cacat'), ('haz2', 'cacat')) AS v(n, t);
UPDATE site_events SET status = 'done', closed_at = now() - interval '1 hour', closed_by = rehearsal.u('sup2')
WHERE id = rehearsal.ev('done_cacat');

-- Files that exist in storage. Deliberately NOT created: m(1), the closure row
-- whose upload never happened.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('site-media', rehearsal.path('isu', 2)),
  ('site-media', rehearsal.path('cacat', 3)),
  ('site-media', rehearsal.path('isu', 4)),
  ('site-media', rehearsal.path('hambatan', 5));

-- Digest events (106), room 1 of project A unless stated.
--   D1 isu, sup, due 3 days ago                 -> overdue 3 (sup's oldest)
--   D2 hambatan, sup, due yesterday, blocking   -> overdue 1 and blocking
--   D3 cacat, gone (removed), due 2 days ago    -> overdue, owner not on project
--   D4 info, no owner, due yesterday            -> overdue, no owner
--   D5 hambatan, adm, due in 5 days, blocking since 23:59 WIB yesterday -> blocking
--   D6 isu, sup, due today                      -> NOT attention (due today is not overdue)
--   D7 hambatan, sup, blocking since 00:01 WIB today -> NOT attention yet
--   D8 isu, sup, due 4 days ago, project C (ON_HOLD) -> attention, but never digested
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, is_blocking, captured_at, confirmed_at) VALUES
  (rehearsal.ev('D1'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'isu', 'Retak dinding kamar', rehearsal.u('sup'), rehearsal.today() - 3, false, now() - interval '5 days', now() - interval '5 days'),
  (rehearsal.ev('D2'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Pompa air mati', rehearsal.u('sup'), rehearsal.today() - 1, true, now() - interval '2 days', now() - interval '2 days'),
  (rehearsal.ev('D3'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'cacat', 'Keramik pecah', rehearsal.u('gone'), rehearsal.today() - 2, false, now() - interval '4 days', now() - interval '4 days'),
  (rehearsal.ev('D4'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'info', 'Catatan tanpa pemilik', NULL, rehearsal.today() - 1, false, now() - interval '3 days', now() - interval '3 days'),
  (rehearsal.ev('D5'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Menunggu material', rehearsal.u('adm'), rehearsal.today() + 5, true, rehearsal.wib_midnight() - interval '1 minute', rehearsal.wib_midnight() - interval '1 minute'),
  (rehearsal.ev('D6'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'isu', 'Jatuh tempo hari ini', rehearsal.u('sup'), rehearsal.today(), false, now() - interval '1 day', now() - interval '1 day'),
  (rehearsal.ev('D7'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Menghambat sejak pagi', rehearsal.u('sup'), rehearsal.today() + 3, true, rehearsal.wib_midnight() + interval '1 minute', rehearsal.wib_midnight() + interval '1 minute'),
  (rehearsal.ev('D8'), rehearsal.p(3), rehearsal.room(3), rehearsal.u('sup'), 'open', 'isu', 'Proyek ditunda', rehearsal.u('sup'), rehearsal.today() - 4, false, now() - interval '6 days', now() - interval '6 days');

-- Yesterday's digest for sup must not stop today's.
INSERT INTO site_event_digest_log (project_id, profile_id, run_date, kind)
VALUES (rehearsal.p(1), rehearsal.u('sup'), rehearsal.today() - 1, 'owner');

SELECT 'fixture ready: ' || (SELECT count(*) FROM site_events WHERE project_id IN (rehearsal.p(1), rehearsal.p(3))) || ' events, '
  || (SELECT count(*) FROM project_assignments WHERE project_id = rehearsal.p(1)) || ' members on A';
