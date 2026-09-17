-- supabase/tests/progress_claims_rehearsal/rehearse_103.sql
-- Behaviour checks for migration 103 as real roles. Every line prints PASS or FAIL. Run by run.sh.
\pset tuples_only on
\pset format unaligned

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup');
SELECT rehearsal.expect('103 supervisor seeds three rows', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(
  jsonb_build_object('boq_item_id', rehearsal.row(1), 'reference_class', 'KOLOM'),
  jsonb_build_object('boq_item_id', rehearsal.row(2), 'reference_class', 'BALOK_PLAT'),
  jsonb_build_object('boq_item_id', rehearsal.row(3), 'reference_class', 'TANGGA'))) = 3);
SELECT rehearsal.expect('103 a second seed inserts nothing and keeps the class', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(
  jsonb_build_object('boq_item_id', rehearsal.row(1), 'reference_class', 'DINDING'))) = 0);
SELECT rehearsal.expect('103 the seeded kolom row carries the KOLOM profile', (SELECT weights = reference_stage_weights('KOLOM') AND source = 'reference' AND reference_class = 'KOLOM' AND updated_by = rehearsal.u('sup') FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(1)));
SELECT rehearsal.expect_error('103 a superseded row cannot be seeded', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(4), 'reference_class', 'KOLOM'))), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 an unknown class is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'ATAP'))), 'WEIGHTS_CLASS:');
SELECT rehearsal.expect_error('103 a malformed row id is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), '[{"boq_item_id":"nope","reference_class":"KOLOM"}]'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 a non-array payload is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), '{"boq_item_id":"x"}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 a supervisor cannot set manual weights', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2}'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('103 a supervisor cannot reset weights', format('SELECT reset_boq_stage_weights(%L, %L)', rehearsal.row(2), 'KOLOM'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('103 a supervisor cannot insert weights directly', format('INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source) VALUES (%L, %L, %L, %L)', rehearsal.p(), rehearsal.row(5), '{"SINGLE":1}', 'manual'), 'new row violates row-level security');
SELECT rehearsal.expect_error('103 a supervisor cannot call the internal actor check', format('SELECT progress_actor_role(%L, ARRAY[%L])', rehearsal.p(), 'supervisor'), 'permission denied');
WITH u AS (UPDATE boq_stage_weights SET source = 'manual', reference_class = NULL RETURNING 1)
SELECT rehearsal.expect('103 a supervisor direct update touches no row', count(*) = 0) FROM u;
SELECT rehearsal.expect('103 a member sees the project weights', (SELECT count(*) FROM boq_stage_weights) = 3);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out');
SELECT rehearsal.expect_error('103 an outsider cannot seed', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))), 'CLAIM_AUTH:');
SELECT rehearsal.expect('103 an outsider sees no weights', (SELECT count(*) FROM boq_stage_weights) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri');
SELECT rehearsal.expect_error('103 the principal cannot seed', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))), 'CLAIM_ROLE:');
SELECT rehearsal.expect('103 the principal reads the weights', (SELECT count(*) FROM boq_stage_weights) = 3);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est');
SELECT rehearsal.expect('103 an estimator sets manual weights', (set_boq_stage_weights(rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2}') ->> 'source') = 'manual');
SELECT rehearsal.expect('103 manual weights clear the reference class', (SELECT source = 'manual' AND reference_class IS NULL AND updated_by = rehearsal.u('est') FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(2)));
SELECT rehearsal.expect_error('103 weights must sum to one', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.1}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 weights must name exactly the three stages', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.5}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 a superseded row cannot get weights', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(4), '{"SINGLE":1}'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 reset refuses an unknown class', format('SELECT reset_boq_stage_weights(%L, %L)', rehearsal.row(2), 'ATAP'), 'WEIGHTS_CLASS:');
SELECT rehearsal.expect('103 an estimator resets a row to its reference class', (reset_boq_stage_weights(rehearsal.row(2), 'BALOK_PLAT') ->> 'source') = 'reference');
SELECT rehearsal.expect('103 the reset row carries the BALOK_PLAT profile', (SELECT weights = reference_stage_weights('BALOK_PLAT') AND reference_class = 'BALOK_PLAT' FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(2)));
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm');
SELECT rehearsal.expect('103 an unassigned admin sets weights as an office role', (set_boq_stage_weights(rehearsal.row(5), '{"SINGLE":1}') ->> 'source') = 'manual');
ROLLBACK;

SELECT rehearsal.expect('103 shape: SINGLE 1', stage_weights_valid('{"SINGLE":1}'));
SELECT rehearsal.expect('103 shape: SINGLE 1.0', stage_weights_valid('{"SINGLE":1.0}'));
SELECT rehearsal.expect('103 shape: SINGLE 2 refused', NOT stage_weights_valid('{"SINGLE":2}'));
SELECT rehearsal.expect('103 shape: SINGLE string refused', NOT stage_weights_valid('{"SINGLE":"1"}'));
SELECT rehearsal.expect('103 shape: scalar refused', NOT stage_weights_valid('"x"'));
SELECT rehearsal.expect('103 shape: empty object refused', NOT stage_weights_valid('{}'));
SELECT rehearsal.expect('103 shape: string stage refused', NOT stage_weights_valid('{"BEKISTING":"0.5","PEMBESIAN":0.3,"PENGECORAN":0.2}'));
SELECT rehearsal.expect('103 shape: sum 0.9995 accepted', stage_weights_valid('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.3335}'));
SELECT rehearsal.expect('103 shape: sum 0.998 refused', NOT stage_weights_valid('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.332}'));
SELECT rehearsal.expect('103 shape: negative refused', NOT stage_weights_valid('{"BEKISTING":-0.1,"PEMBESIAN":0.6,"PENGECORAN":0.5}'));
SELECT rehearsal.expect('103 shape: extra key refused', NOT stage_weights_valid('{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2,"SINGLE":1}'));
SELECT rehearsal.expect('103 reference: every class is a valid shape', (SELECT bool_and(stage_weights_valid(reference_stage_weights(c))) FROM unnest(ARRAY['PILECAP_SLOOF_PLAT_DASAR','KOLOM','BALOK_PLAT','DINDING','TANGGA','BOREDPILE','LAINNYA']) AS c));
SELECT rehearsal.expect('103 reference: unknown class is null', reference_stage_weights('ATAP') IS NULL);
SELECT rehearsal.expect('103 privileges: anon cannot run any 103 function', NOT bool_or(has_function_privilege('anon', oid, 'EXECUTE'))) FROM pg_proc WHERE proname IN ('progress_actor_role','stage_weights_valid','reference_stage_weights','seed_reference_stage_weights','set_boq_stage_weights','reset_boq_stage_weights');
SELECT rehearsal.expect('103 privileges: authenticated cannot run progress_actor_role', NOT has_function_privilege('authenticated', 'progress_actor_role(uuid, text[])', 'EXECUTE'));
