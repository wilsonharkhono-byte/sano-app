-- supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql
-- Run by run.sh right after it re-pastes 097 and 096 on top of 107: 107's
-- guards are separate triggers, so neither re-paste reverts them.
\pset tuples_only on
\pset format unaligned

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 after re-pasting 097 a supervisor still cannot set datum_card_id', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
COMMIT;
-- c4 is reported by sup (fixture.sql) but confirmed here by pri: a different
-- person again, so the stamp cannot be mistaken for the reporter.
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 after re-pasting 097 a member confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c4'), 'progres', NULL, NULL, 'Setelah paste ulang', NULL, NULL, NULL, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 after re-pasting 097 the confirmer is still stamped, and it is the confirmer, not the reporter', (SELECT confirmed_by = rehearsal_ds.u('pri') FROM site_events WHERE id = rehearsal_ds.ev('c4')));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 after re-pasting 096 an estimator still cannot set rooms.datum_area_id', format('UPDATE rooms SET datum_area_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.room(2)), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 after re-pasting 096 a terrace is still an accepted room type', rehearsal_ds.touched(format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L)', rehearsal_ds.p(1), 'TERAS', 'Teras Depan', 'terrace')) = 1);
ROLLBACK;
SELECT rehearsal_ds.expect('107 after re-pasting 096 the area_type CHECK still lists exterior', (
  SELECT pg_get_constraintdef(oid) LIKE '%''exterior''%' FROM pg_constraint WHERE conname = 'rooms_area_type_check'));
