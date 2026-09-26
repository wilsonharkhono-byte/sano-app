-- supabase/tests/site_event_closure_rehearsal/rehearse_106.sql
-- Behaviour checks for migration 106 as real roles. Run by run.sh, as postgres,
-- after rehearse_105.sql. Every line prints PASS or FAIL. The cases that must
-- see a WARNING run in a second psql inside the container and pass through two
-- files under the container's /tmp, removed afterwards (see E).
\pset tuples_only on
\pset format unaligned

-- A. The view under RLS
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an outsider sees no attention row', (SELECT count(*) FROM v_site_event_attention) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 a supervisor sees the five attention items of project A',
  (SELECT count(*) FROM v_site_event_attention WHERE project_id = rehearsal.p(1)) = 5,
  (SELECT string_agg(title, ', ' ORDER BY title) FROM v_site_event_attention WHERE project_id = rehearsal.p(1)));
SELECT rehearsal.expect('106 owner_on_project is NULL on a colleague''s item for a supervisor',
  (SELECT owner_on_project IS NULL FROM v_site_event_attention WHERE event_id = rehearsal.ev('D3'))
  AND (SELECT owner_on_project IS NULL FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5')));
SELECT rehearsal.expect('106 owner_on_project is exact on the supervisor''s own item and on an item with no owner',
  (SELECT owner_on_project FROM v_site_event_attention WHERE event_id = rehearsal.ev('D1'))
  AND (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D4')));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an office role reads exact owner_on_project values',
  (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D3'))
  AND (SELECT owner_on_project IS TRUE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5'))
  AND (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D4')));
ROLLBACK;

SELECT rehearsal.expect('106 due today is not overdue', NOT EXISTS (SELECT 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D6')));
SELECT rehearsal.expect('106 due yesterday is one day overdue', (SELECT is_overdue AND days_overdue = 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D2')));
SELECT rehearsal.expect('106 blocking since this morning is not attention yet', NOT EXISTS (SELECT 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D7')));
SELECT rehearsal.expect('106 blocking since yesterday is attention, not overdue', (SELECT is_blocking AND NOT is_overdue AND days_overdue = 0 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5')));

-- B. Refusals before anything is sent
SELECT rehearsal.expect_error('106 a run for tomorrow is refused', format('SELECT enqueue_site_event_digests(%L::date)', rehearsal.today() + 1), 'DIGEST_RUN_DATE:');
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('106 an app user cannot run the digest', 'SELECT enqueue_site_event_digests()', 'permission denied for function enqueue_site_event_digests');
ROLLBACK;
-- Supabase's default privileges grant EXECUTE on every new function to
-- service_role, the key edge functions hold; only postgres (pg_cron, the
-- Dashboard) may run a round of pushes.
SELECT rehearsal.expect('106 service_role cannot execute the digest or its day label',
  NOT has_function_privilege('service_role', 'enqueue_site_event_digests(date)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'site_event_digest_day(date)', 'EXECUTE'),
  'digest=' || has_function_privilege('service_role', 'enqueue_site_event_digests(date)', 'EXECUTE')
  || ' day=' || has_function_privilege('service_role', 'site_event_digest_day(date)', 'EXECUTE'));

BEGIN;
UPDATE site_events SET status = 'done' WHERE status = 'open';
SELECT rehearsal.expect('106 nothing to send: zero messages and no log row',
  enqueue_site_event_digests() = 0 AND NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE run_date = rehearsal.today()));
ROLLBACK;

-- C. Today's run
SELECT enqueue_site_event_digests() AS sent1 \gset
SELECT rehearsal.expect('106 the first run reaches three people', :'sent1'::int = 3, :'sent1');

SELECT rehearsal.expect('106 the owner gets one message: own counts, and the oldest overdue item',
  (SELECT count(*) = 1 AND bool_and(
      n.title = '2 tugas lapangan perlu ditindak · REH-CL-A'
      AND n.body = '2 lewat tenggat, 1 menghambat. Terlama: LT1-R01 – Retak dinding kamar (tenggat ' || site_event_digest_day(rehearsal.today() - 3) || ').'
      AND n.deeplink_screen = 'RoomBoard'
      AND n.deeplink_params = jsonb_build_object('projectId', rehearsal.p(1), 'attention', true, 'mine', true))
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('sup') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(title || ' | ' || body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('sup') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 an admin who also owns an item gets only the office summary, with 1 milik Anda',
  (SELECT count(*) = 1 AND bool_and(
      n.title = '5 tugas lapangan perlu ditindak · REH-CL-A'
      AND n.body = '4 lewat tenggat, 2 menghambat. 2 tanpa penanggung jawab. 1 milik Anda.'
      AND n.deeplink_params = jsonb_build_object('projectId', rehearsal.p(1), 'attention', true, 'mine', false))
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('adm') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(title || ' | ' || body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('adm') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 the principal gets the office summary, counting a removed owner and a missing owner as tanpa penanggung jawab',
  (SELECT count(*) = 1 AND bool_and(n.body = '4 lewat tenggat, 2 menghambat. 2 tanpa penanggung jawab.')
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('pri') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('pri') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 one log row per person, of the right kind',
  (SELECT count(*) = 3
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('sup') AND kind = 'owner') = 1
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('adm') AND kind = 'office') = 1
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('pri') AND kind = 'office') = 1
   FROM site_event_digest_log WHERE run_date = rehearsal.today()));
SELECT rehearsal.expect('106 yesterday''s log row did not stop today''s', (SELECT count(*) = 2 FROM site_event_digest_log WHERE profile_id = rehearsal.u('sup')));
SELECT rehearsal.expect('106 the removed owner gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('gone')) AND NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = rehearsal.u('gone')));
SELECT rehearsal.expect('106 an admin not assigned to the project gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('adm2')));
SELECT rehearsal.expect('106 an estimator is neither an owner nor an office recipient', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('est')));
SELECT rehearsal.expect('106 a project that is not ACTIVE gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE project_id = rehearsal.p(3)));
SELECT rehearsal.expect('106 an ACTIVE project with nothing to do gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE project_id = rehearsal.p(2)));
SELECT rehearsal.expect('106 every log row has its notification', (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = (SELECT count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST'));

SELECT enqueue_site_event_digests() AS sent2 \gset
SELECT rehearsal.expect('106 a second run the same day sends nothing and logs nothing',
  :'sent2'::int = 0
  AND (SELECT count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST') = 3
  AND (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = 3, :'sent2');

-- D. Who can read the log and the health line
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 a supervisor reads no log row', (SELECT count(*) FROM site_event_digest_log) = 0);
SELECT rehearsal.expect('106 a supervisor reads no health row', (SELECT count(*) FROM v_site_event_digest_health) = 0);
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an office role reads the log', (SELECT count(*) FROM site_event_digest_log) = 4);
SELECT rehearsal.expect('106 the health line names today and three people',
  (SELECT count(*) = 1 AND bool_and(last_run_date = rehearsal.today() AND recipients = 3 AND last_sent_at IS NOT NULL) FROM v_site_event_digest_health));
ROLLBACK;

-- A WARNING cannot be caught in SQL, so the cases below that must see one (or
-- prove there was none) run in a second psql session inside this container.
-- Each such session works inside BEGIN ... ROLLBACK, so nothing it does
-- outlives it, and its whole output, WARNINGs and any ERROR included, is read
-- back into `capture` with \copy. `prelude` opens that transaction, starts
-- from a morning on which nobody has been told yet (C already told three
-- people; the rollback puts them back), and names people instead of UUIDs.
CREATE TEMP TABLE capture (line TEXT);
SELECT $p$
BEGIN;
DELETE FROM site_event_digest_log WHERE run_date = rehearsal.today();
DELETE FROM notifications WHERE type = 'SITE_EVENT_DIGEST';
CREATE FUNCTION pg_temp.who(p UUID) RETURNS TEXT LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT n FROM unnest(ARRAY['sup', 'sup2', 'est', 'adm', 'adm2', 'pri', 'gone', 'out']) AS n WHERE rehearsal.u(n) = p), p::text) $f$;
CREATE FUNCTION pg_temp.logged() RETURNS TEXT LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg(pg_temp.who(profile_id) || ':' || kind, ',' ORDER BY pg_temp.who(profile_id)), '')
  FROM site_event_digest_log WHERE run_date = rehearsal.today() $f$;
$p$ AS prelude \gset

-- E. One recipient's notification never lands (spec §6): a BEFORE INSERT
-- trigger drops the supervisor's SITE_EVENT_DIGEST row, as a failed insert
-- would. The others are served, the supervisor's log row rolls back with a
-- WARNING, and a second run the same day retries only the supervisor.
\o /tmp/rehearse_106_sub.sql
SELECT :'prelude' || $s$
CREATE FUNCTION public.rehearsal_drop_sup_digest() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.type = 'SITE_EVENT_DIGEST' AND NEW.recipient_user_id = rehearsal.u('sup') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER rehearsal_drop_sup_digest BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION public.rehearsal_drop_sup_digest();
SELECT 'first=' || enqueue_site_event_digests();
SELECT 'logged_first=' || pg_temp.logged();
DROP TRIGGER rehearsal_drop_sup_digest ON notifications;
SELECT 'retry=' || enqueue_site_event_digests();
SELECT 'logged_retry=' || pg_temp.logged();
SELECT 'sup_notified=' || count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST' AND recipient_user_id = rehearsal.u('sup');
ROLLBACK;
$s$;
\o
\! psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/rehearse_106_sub.sql < /dev/null > /tmp/rehearse_106_out.txt 2>&1
TRUNCATE capture;
\copy capture (line) FROM '/tmp/rehearse_106_out.txt' WITH (FORMAT text, DELIMITER E'\x01')
SELECT rehearsal.expect('106 a digest that never lands: the others are served and the supervisor''s log row rolls back',
  EXISTS (SELECT 1 FROM capture WHERE line = 'first=2')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'logged_first=adm:office,pri:office')
  AND NOT EXISTS (SELECT 1 FROM capture WHERE line LIKE '%ERROR%'),
  (SELECT string_agg(line, ' | ') FROM capture WHERE line NOT LIKE '%WARNING:%'));
SELECT rehearsal.expect('106 the failed recipient raises one WARNING, DIGEST_NOT_LANDED, naming them and the project',
  (SELECT count(*) FROM capture WHERE line LIKE '%WARNING:%') = 1
  AND EXISTS (SELECT 1 FROM capture WHERE line LIKE '%WARNING:  enqueue_site_event_digests: ' || rehearsal.u('sup') || ' pada proyek ' || rehearsal.p(1) || ': DIGEST_NOT_LANDED: %'),
  (SELECT string_agg(line, ' | ') FROM capture WHERE line LIKE '%WARNING%'));
SELECT rehearsal.expect('106 a second run the same day retries only the failed recipient, and now logs them',
  EXISTS (SELECT 1 FROM capture WHERE line = 'retry=1')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'logged_retry=adm:office,pri:office,sup:owner')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'sup_notified=1'),
  (SELECT string_agg(line, ' | ') FROM capture WHERE line NOT LIKE '%WARNING:%'));
SELECT rehearsal.expect('106 the failed-landing session left nothing behind: no trigger, and C''s three log rows',
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rehearsal_drop_sup_digest')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rehearsal_drop_sup_digest')
  AND (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = 3
  AND (SELECT count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST') = 3);
\! rm -f /tmp/rehearse_106_sub.sql /tmp/rehearse_106_out.txt

-- F. Every item closes between the recipient query and a recipient's count
-- (spec §5.3): the two are separate snapshots. An AFTER INSERT trigger closes
-- all of project A's open items the moment the first digest lands, and D1
-- moves to sup2 so an owner is counted after that as well as the admin and
-- the principal. Recipients go in UUID order: sup, sup2, adm, pri. Only sup
-- is told; the three counted at zero get no log row, no "0 tugas" message
-- and no WARNING.
\o /tmp/rehearse_106_sub.sql
SELECT :'prelude' || $s$
UPDATE site_events SET owner_id = rehearsal.u('sup2') WHERE id = rehearsal.ev('D1');
CREATE FUNCTION public.rehearsal_close_all_open() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE site_events SET status = 'done' WHERE project_id = rehearsal.p(1) AND status = 'open';
  RETURN NULL;
END $f$;
CREATE TRIGGER rehearsal_close_all_open AFTER INSERT ON notifications
  FOR EACH ROW WHEN (NEW.type = 'SITE_EVENT_DIGEST') EXECUTE FUNCTION public.rehearsal_close_all_open();
SELECT 'sent=' || enqueue_site_event_digests();
SELECT 'logged=' || pg_temp.logged();
SELECT 'told=' || COALESCE(string_agg(pg_temp.who(recipient_user_id) || ':' || title, ',' ORDER BY pg_temp.who(recipient_user_id)), '')
FROM notifications WHERE type = 'SITE_EVENT_DIGEST';
ROLLBACK;
$s$;
\o
\! psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/rehearse_106_sub.sql < /dev/null > /tmp/rehearse_106_out.txt 2>&1
TRUNCATE capture;
\copy capture (line) FROM '/tmp/rehearse_106_out.txt' WITH (FORMAT text, DELIMITER E'\x01')
SELECT rehearsal.expect('106 office recipients whose items all closed after the recipient query get no "0 tugas" message and no log row',
  EXISTS (SELECT 1 FROM capture WHERE line = 'sent=1')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'logged=sup:owner')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'told=sup:1 tugas lapangan perlu ditindak · REH-CL-A')
  AND NOT EXISTS (SELECT 1 FROM capture WHERE line LIKE '%ERROR%'),
  (SELECT string_agg(line, ' | ') FROM capture));
SELECT rehearsal.expect('106 an owner whose items all closed meanwhile is skipped too, and nobody gets a WARNING',
  NOT EXISTS (SELECT 1 FROM capture WHERE line LIKE '%WARNING%')
  AND EXISTS (SELECT 1 FROM capture WHERE line = 'logged=sup:owner'),
  (SELECT string_agg(line, ' | ') FROM capture));
SELECT rehearsal.expect('106 the zero-count session left nothing behind: no trigger, D1 still sup''s and open, C''s three log rows',
  NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rehearsal_close_all_open')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rehearsal_close_all_open')
  AND (SELECT owner_id = rehearsal.u('sup') AND status = 'open' FROM site_events WHERE id = rehearsal.ev('D1'))
  AND (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = 3);
\! rm -f /tmp/rehearse_106_sub.sql /tmp/rehearse_106_out.txt
