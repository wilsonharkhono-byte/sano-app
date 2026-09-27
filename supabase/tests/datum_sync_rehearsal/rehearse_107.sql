-- supabase/tests/datum_sync_rehearsal/rehearse_107.sql
-- Behaviour checks for migration 107 as real roles. Run by run.sh, as
-- supabase_admin (so SET LOCAL ROLE can become any role), after fixture.sql.
-- Every line prints PASS or FAIL.
\pset tuples_only on
\pset format unaligned

-- A. Gate words (107 has been pasted twice by now)
SELECT rehearsal_ds.expect('107 gate_refs holds exactly eight rows', (SELECT count(*) = 8 FROM gate_refs));
SELECT rehearsal_ds.expect('107 the eight rows carry DATUM''s words and datum_gate_code = code, after two pastes', (
  SELECT count(*) = 8 FROM gate_refs g JOIN (VALUES
    ('A', 'MEP Rough-in + Persiapan Struktural', 'MEP Rough-in', 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.'),
    ('B', 'Pekerjaan Basah / Waterproofing', 'Pekerjaan Basah', 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.'),
    ('C', 'Plafon & Penutupan Selubung', 'Plafon', 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.'),
    ('D', 'Finishing Lantai, Dinding & Kusen Aluminium', 'Lantai & Kusen', 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.'),
    ('E', 'Finishing Permukaan + Ironwork', 'Cat & Ironwork', 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.'),
    ('F', 'Furniture Built-in & Interior', 'Furniture', 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.'),
    ('G', 'MEP Fit-out', 'MEP Fit-out', 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.'),
    ('H', 'Penyelesaian Akhir & Serah Terima', 'Serah Terima', 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.')
  ) AS w(code, name_id, short_label, description)
    ON w.code = g.code AND w.name_id = g.name_id AND w.short_label = g.short_label
   AND w.description = g.description AND g.datum_gate_code = g.code));

-- B. Event columns: app roles cannot write them
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_card_id', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_card_url', format('UPDATE site_events SET datum_card_url = %L WHERE id = %L', 'https://x', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_escalated_at', format('UPDATE site_events SET datum_escalated_at = now() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set confirmed_by', format('UPDATE site_events SET confirmed_by = %L WHERE id = %L', rehearsal_ds.u('sup'), rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying datum_card_id', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, datum_card_id) VALUES (%L, %L, %L, %L, now(), gen_random_uuid())',
  rehearsal_ds.ev('new1'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying confirmed_by', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, confirmed_by) VALUES (%L, %L, %L, %L, now(), %L)',
  rehearsal_ds.ev('new2'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), rehearsal_ds.u('sup')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying datum_card_url', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, datum_card_url) VALUES (%L, %L, %L, %L, now(), %L)',
  rehearsal_ds.ev('new4'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), 'https://x'), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying datum_escalated_at', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, datum_escalated_at) VALUES (%L, %L, %L, %L, now(), now())',
  rehearsal_ds.ev('new5'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect('107 close_site_event still works for a member', (close_site_event(rehearsal_ds.ev('prog'), NULL) ->> 'status') = 'done');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an admin cannot set datum_card_id either', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 an admin cannot insert an event carrying the guarded columns either', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, datum_card_id, confirmed_by) VALUES (%L, %L, %L, %L, now(), gen_random_uuid(), %L)',
  rehearsal_ds.ev('new3'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('adm'), rehearsal_ds.u('adm')), 'SITE_EVENT_SYSTEM_COLUMNS:');
ROLLBACK;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role writes the three datum columns', rehearsal_ds.touched(format(
  'UPDATE site_events SET datum_card_id = %L, datum_card_url = %L, datum_escalated_at = now() WHERE id = %L',
  '00000000-0000-4000-8000-00000000f701', 'https://datum.example/project/rehds-a/cards/pilih-warna-nat', rehearsal_ds.ev('open'))) = 1);
COMMIT;

BEGIN; SET LOCAL ROLE postgres; SELECT rehearsal_ds.as_nobody() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 postgres (the Dashboard) writes confirmed_by', rehearsal_ds.touched(format(
  'UPDATE site_events SET confirmed_by = %L WHERE id = %L', rehearsal_ds.u('adm'), rehearsal_ds.ev('open'))) = 1);
ROLLBACK;

SELECT rehearsal_ds.expect('107 the card columns landed as the service role wrote them', (
  SELECT datum_card_id = '00000000-0000-4000-8000-00000000f701' AND datum_escalated_at IS NOT NULL FROM site_events WHERE id = rehearsal_ds.ev('open')));

-- confirm_site_event is the usual path to confirmed_by (checked in section
-- C below), but the sync itself must also be free to write it directly, the
-- same way it writes the other three system columns.
BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role writes confirmed_by directly, not only through confirm_site_event', rehearsal_ds.touched(format(
  'UPDATE site_events SET confirmed_by = %L WHERE id = %L', rehearsal_ds.u('adm'), rehearsal_ds.ev('open'))) = 1);
COMMIT;

-- C. The confirmer stamp. c1 is reported and owned by sup (fixture.sql /
-- owner_id below) but confirmed by est and closed by adm: a guard that
-- stamped reporter_id or owner_id instead of auth.uid() would still pass a
-- check that used sup throughout, so every actor here is a different person.
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a member confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c1'), 'butuh_keputusan', NULL, NULL, 'Pilih keramik', NULL, rehearsal_ds.u('sup'),
  rehearsal_ds.today() + 7, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 confirm_site_event stamps the confirmer, not the reporter or owner', (SELECT confirmed_by = rehearsal_ds.u('est') FROM site_events WHERE id = rehearsal_ds.ev('c1')));

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c2'), 'progres', NULL, NULL, 'Dikonfirmasi sistem', NULL, NULL, NULL, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 confirm_site_event as service_role stamps NULL: unknown, never guessed', (SELECT confirmed_by IS NULL AND confirmed_at IS NOT NULL FROM site_events WHERE id = rehearsal_ds.ev('c2')));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a third member closes the decision (setup)', (close_site_event(rehearsal_ds.ev('c1'), 'Keramik putih dipilih pemilik') ->> 'status') = 'done');
COMMIT;
SELECT rehearsal_ds.expect('107 a later update never moves the stamp, and confirmer and closer stay distinct people', (SELECT confirmed_by = rehearsal_ds.u('est') AND closed_by = rehearsal_ds.u('adm') FROM site_events WHERE id = rehearsal_ds.ev('c1')));

-- D. Room link and types
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an estimator cannot set rooms.datum_area_id', format('UPDATE rooms SET datum_area_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.room(1)), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect_error('107 an estimator cannot insert a room carrying datum_area_id', format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type, datum_area_id) VALUES (%L, %L, %L, %L, gen_random_uuid())',
  rehearsal_ds.p(1), 'LT2-KAMAR', 'Kamar', 'bedroom'), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 an estimator still renames a room', rehearsal_ds.touched(format(
  'UPDATE rooms SET room_name = %L WHERE id = %L', 'Kamar Mandi Satu', rehearsal_ds.room(1))) = 1);
SELECT rehearsal_ds.expect('107 facade and exterior are accepted room types', rehearsal_ds.touched(format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L), (%L, %L, %L, %L)',
  rehearsal_ds.p(1), 'FASAD', 'Fasad Depan', 'facade', rehearsal_ds.p(1), 'LUAR', 'Carport', 'exterior')) = 2);
SELECT rehearsal_ds.expect_error('107 an unknown room type is refused', format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L)',
  rehearsal_ds.p(1), 'SAUNA', 'Sauna', 'foo'), 'new row for relation "rooms" violates check constraint "rooms_area_type_check"');
COMMIT;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role links a room', rehearsal_ds.touched(format(
  'UPDATE rooms SET datum_area_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f601', rehearsal_ds.room(1))) = 1);
COMMIT;

-- The guard compares NEW.datum_area_id IS DISTINCT FROM OLD.datum_area_id,
-- not merely "IS NOT NULL": room(1) is linked now, and a rename that leaves
-- the link untouched must still be allowed, not just a rename of an
-- unlinked room (which the earlier check above cannot tell apart from a
-- buggy "any non-null value on UPDATE is refused" guard).
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an estimator renames a linked room', rehearsal_ds.touched(format(
  'UPDATE rooms SET room_name = %L WHERE id = %L', 'Kamar Mandi Utama', rehearsal_ds.room(1))) = 1);
COMMIT;

-- E. Staff link
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a user cannot set their own datum_staff_id', format('UPDATE profiles SET datum_staff_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.u('sup')), 'PROFILE_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 a user still renames themself', rehearsal_ds.touched(format(
  'UPDATE profiles SET full_name = %L WHERE id = %L', 'Rehearsal DS Supervisor Baru', rehearsal_ds.u('sup'))) = 1);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an admin cannot set another person''s datum_staff_id', format('UPDATE profiles SET datum_staff_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.u('sup')), 'PROFILE_DATUM_LINK_SYNC_ONLY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role links a profile to a DATUM staff id', rehearsal_ds.touched(format(
  'UPDATE profiles SET datum_staff_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f801', rehearsal_ds.u('sup'))) = 1);
SELECT rehearsal_ds.expect_error('107 a second profile with the same staff id is a unique violation', format(
  'UPDATE profiles SET datum_staff_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f801', rehearsal_ds.u('est')),
  'duplicate key value violates unique constraint "idx_profiles_datum_staff_id"');
COMMIT;

-- The guard compares NEW.datum_staff_id IS DISTINCT FROM OLD.datum_staff_id,
-- not merely "IS NOT NULL": sup is linked now, and a self-rename that leaves
-- the link untouched must still be allowed.
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a linked user renames themself', rehearsal_ds.touched(format(
  'UPDATE profiles SET full_name = %L WHERE id = %L', 'Rehearsal DS Supervisor Tertaut', rehearsal_ds.u('sup'))) = 1);
COMMIT;

-- F. Pairing
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an estimator pairs '' k2-7 '' as K2-7', (set_datum_project_code(rehearsal_ds.p(2), ' k2-7 ') ->> 'code') = 'K2-7');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an admin re-pairs it as AB-1', (set_datum_project_code(rehearsal_ds.p(2), 'ab-1') ->> 'code') = 'AB-1');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a principal pairs it back as K2-7', (set_datum_project_code(rehearsal_ds.p(2), ' k2-7 ') ->> 'code') = 'K2-7');
COMMIT;
SELECT rehearsal_ds.expect('107 the stored code is upper case and trimmed', (SELECT datum_project_code = 'K2-7' FROM projects WHERE id = rehearsal_ds.p(2)));
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a supervisor cannot pair', format('SELECT set_datum_project_code(%L, %L)', rehearsal_ds.p(2), 'X-1'), 'DATUM_PAIRING_AUTH:');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 the same code on a second project is DATUM_PAIRING_TAKEN', format('SELECT set_datum_project_code(%L, %L)', rehearsal_ds.p(3), 'k2-7'), 'DATUM_PAIRING_TAKEN:');
SELECT rehearsal_ds.expect_error('107 an unknown project is refused', format('SELECT set_datum_project_code(%L, %L)', '00000000-0000-4000-8000-00000000ffff', 'Z-1'), 'DATUM_PAIRING_PROJECT:');
SELECT rehearsal_ds.expect('107 a blank code clears the pairing', (set_datum_project_code(rehearsal_ds.p(2), '   ') -> 'code') = 'null'::jsonb);
COMMIT;
SELECT rehearsal_ds.expect('107 project B is unpaired again', (SELECT datum_project_code IS NULL FROM projects WHERE id = rehearsal_ds.p(2)));
SELECT rehearsal_ds.expect_error('107 a lower-case code written directly fails the CHECK', format('UPDATE projects SET datum_project_code = %L WHERE id = %L', 'abc', rehearsal_ds.p(4)),
  'new row for relation "projects" violates check constraint "projects_datum_project_code_shape"');
SELECT rehearsal_ds.expect('107 anon cannot execute the pairing RPC', NOT has_function_privilege('anon', 'set_datum_project_code(uuid, text)', 'EXECUTE'));

-- G. The three tables
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a member reads their project''s runs', (SELECT count(*) = 1 FROM datum_sync_runs WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 a member reads their project''s DATUM status', (SELECT count(*) = 1 FROM room_datum_gate_status WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 a supervisor reads no sync requests', (SELECT count(*) = 0 FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an outsider reads no run, no status and no request', (
  SELECT (SELECT count(*) FROM datum_sync_runs WHERE project_id = rehearsal_ds.p(1)) = 0
     AND (SELECT count(*) FROM room_datum_gate_status WHERE project_id = rehearsal_ds.p(1)) = 0
     AND (SELECT count(*) FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)) = 0));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an office role reads the sync requests', (SELECT count(*) = 1 FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 an office role cannot insert a run', rehearsal_ds.writes_nothing(format('INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'manual')));
SELECT rehearsal_ds.expect('107 an office role cannot update a run', rehearsal_ds.writes_nothing(format('UPDATE datum_sync_runs SET error = %L WHERE id = %L', 'x', rehearsal_ds.run1())));
SELECT rehearsal_ds.expect('107 an office role cannot delete a run', rehearsal_ds.writes_nothing(format('DELETE FROM datum_sync_runs WHERE id = %L', rehearsal_ds.run1())));
SELECT rehearsal_ds.expect('107 an office role cannot insert a status row', rehearsal_ds.writes_nothing(format(
  'INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at) VALUES (%L, %L, %L, gen_random_uuid(), %L, false, now())',
  rehearsal_ds.room(2), 'A', rehearsal_ds.p(1), 'passed')));
SELECT rehearsal_ds.expect('107 an office role cannot update a status row', rehearsal_ds.writes_nothing(format('UPDATE room_datum_gate_status SET status = %L WHERE room_id = %L', 'blocked', rehearsal_ds.room(1))));
SELECT rehearsal_ds.expect('107 an office role cannot delete a status row', rehearsal_ds.writes_nothing(format('DELETE FROM room_datum_gate_status WHERE room_id = %L', rehearsal_ds.room(1))));
SELECT rehearsal_ds.expect('107 an office role cannot insert a request', rehearsal_ds.writes_nothing(format('INSERT INTO datum_sync_requests (project_id) VALUES (%L)', rehearsal_ds.p(1))));
SELECT rehearsal_ds.expect('107 an office role cannot update a request', rehearsal_ds.writes_nothing(format('UPDATE datum_sync_requests SET error = %L WHERE project_id = %L', 'x', rehearsal_ds.p(1))));
SELECT rehearsal_ds.expect('107 an office role cannot delete a request', rehearsal_ds.writes_nothing(format('DELETE FROM datum_sync_requests WHERE project_id = %L', rehearsal_ds.p(1))));
ROLLBACK;

SELECT rehearsal_ds.expect_error('107 the cache refuses a status DATUM does not have', format(
  'INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at) VALUES (%L, %L, %L, gen_random_uuid(), %L, false, now())',
  rehearsal_ds.room(2), 'B', rehearsal_ds.p(1), 'done'), 'new row for relation "room_datum_gate_status" violates check constraint');
SELECT rehearsal_ds.expect('107 source = import is accepted', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (project_id, source, finished_at, ok) VALUES (%L, %L, now(), true)', rehearsal_ds.p(2), 'import')) = 1);

BEGIN;
SELECT rehearsal_ds.expect('107 an open run for project D (setup)', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (id, project_id, source) VALUES (%L, %L, %L)', '00000000-0000-4000-8000-00000000f502', rehearsal_ds.p(4), 'manual')) = 1);
SELECT rehearsal_ds.expect_error('107 a second open run for the same project is a unique violation', format(
  'INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'cron'),
  'duplicate key value violates unique constraint "datum_sync_runs_one_open"');
UPDATE datum_sync_runs SET finished_at = now(), ok = true WHERE id = '00000000-0000-4000-8000-00000000f502';
SELECT rehearsal_ds.expect('107 a new run after finished_at is fine', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'cron')) = 1);
ROLLBACK;
