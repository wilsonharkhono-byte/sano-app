-- supabase/tests/site_event_closure_rehearsal/rehearse_105.sql
-- Behaviour checks for migration 105 as real roles. Run by run.sh, as postgres,
-- after fixture.sql. Every line prints PASS or FAIL.
\pset tuples_only on
\pset format unaligned

-- A. Proof by type, as the supervisor who owns every closure event
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('105 a cacat with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('cacat'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
SELECT rehearsal.expect_error('105 an isu with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('isu'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
SELECT rehearsal.expect_error('105 a hambatan with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('hambatan'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(1), rehearsal.ev('cacat'), 'photo', 'closure', rehearsal.path('cacat', 1));
SELECT rehearsal.expect_error('105 a closure row whose file was never uploaded is no proof', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('cacat')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(2), rehearsal.ev('isu'), 'photo', 'context', rehearsal.path('isu', 2));
SELECT rehearsal.expect_error('105 a context photo is not a closure photo', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('isu')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
-- A direct insert (no app needed): a closure row pointing at the context photo's file, which exists.
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(6), rehearsal.ev('isu'), 'photo', 'closure', rehearsal.path('isu', 2));
SELECT rehearsal.expect_error('105 a closure row that reuses the context photo''s path is refused', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('isu')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(3), rehearsal.ev('cacat'), 'photo', 'closure', rehearsal.path('cacat', 3));
SELECT rehearsal.expect('105 a cacat closes with a closure row and its file', (close_site_event(rehearsal.ev('cacat'), 'Sudah ditambal') ->> 'status') = 'done');
-- The first member uploads the isu's closure photo; a second member closes it below.
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(4), rehearsal.ev('isu'), 'photo', 'closure', rehearsal.path('isu', 4));
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(5), rehearsal.ev('hambatan'), 'photo', 'closure', rehearsal.path('hambatan', 5));
SELECT rehearsal.expect('105 a hambatan closes with a closure row and its file', (close_site_event(rehearsal.ev('hambatan'), NULL) ->> 'status') = 'done');

SELECT rehearsal.expect_error('105 a decision with no note is refused', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('bk')), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a decision with nine characters is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), 'Sembilan.'), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a decision with ten newlines is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), repeat(E'\n', 10)), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a 501-character note still gets SITE_EVENT_CLOSURE_NOTE', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), repeat('x', 501)), 'SITE_EVENT_CLOSURE_NOTE:');
SELECT rehearsal.expect('105 a decision closes with ten characters padded by spaces and newlines', (close_site_event(rehearsal.ev('bk'), E' \n\tGanti cat!\r\n ') ->> 'status') = 'done');

SELECT rehearsal.expect('105 a progres closes with nothing', (close_site_event(rehearsal.ev('progres'), NULL) ->> 'status') = 'done');
SELECT rehearsal.expect('105 an info closes with nothing', (close_site_event(rehearsal.ev('info'), NULL) ->> 'status') = 'done');
SELECT rehearsal.expect_error('105 a closed cacat with no photo gets NOT_OPEN, not the photo refusal', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('done_cacat')), 'SITE_EVENT_NOT_OPEN:');
COMMIT;

-- B. Any member's photo is proof about the event
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('105 a second member closes an isu with the photo the first member uploaded', (close_site_event(rehearsal.ev('isu'), NULL) ->> 'status') = 'done');
COMMIT;

-- C. Outsiders
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('105 an outsider gets AUTH', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('outsider')), 'SITE_EVENT_AUTH:');
ROLLBACK;

-- D. What landed
SELECT rehearsal.expect('105 the decision note is stored trimmed', (SELECT closure_note = 'Ganti cat!' FROM site_events WHERE id = rehearsal.ev('bk')));
SELECT rehearsal.expect('105 closed_by and closed_at name the second member on the isu', (SELECT status = 'done' AND closed_by = rehearsal.u('sup2') AND closed_at IS NOT NULL FROM site_events WHERE id = rehearsal.ev('isu')));
SELECT rehearsal.expect('105 closed_by and closed_at name the supervisor on the cacat', (SELECT status = 'done' AND closed_by = rehearsal.u('sup') AND closed_at IS NOT NULL FROM site_events WHERE id = rehearsal.ev('cacat')));
SELECT rehearsal.expect('105 the outsider changed nothing', (SELECT status = 'open' AND closed_by IS NULL FROM site_events WHERE id = rehearsal.ev('outsider')));
SELECT rehearsal.expect('105 the already-closed cacat kept its original closer', (SELECT closed_by = rehearsal.u('sup2') FROM site_events WHERE id = rehearsal.ev('done_cacat')));
