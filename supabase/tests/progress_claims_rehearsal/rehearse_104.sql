-- supabase/tests/progress_claims_rehearsal/rehearse_104.sql
-- Behaviour checks for migration 104 as real roles, after rehearse_103.sql. Run by run.sh.
\pset tuples_only on
\pset format unaligned

-- A. The supervisor builds this week's draft
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}', 'Kolom lantai 1', jsonb_build_array('progress/' || rehearsal.p() || '/1.jpg')) ->> 'claim_id' AS claim1 \gset
SELECT rehearsal.expect('104 the first save opens a DRAFT claim for this WIB week', (SELECT status = 'DRAFT' AND week_start = date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date AND created_by = rehearsal.u('sup') FROM progress_claims WHERE id = :'claim1'));
SELECT rehearsal.expect('104 saving the same row again edits the same line', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}', 'Kolom lantai 1', jsonb_build_array('progress/' || rehearsal.p() || '/2.jpg', 'progress/' || rehearsal.p() || '/3.jpg')) ->> 'row_fraction_claimed')::numeric = 0.6176);
SELECT rehearsal.expect('104 one line whose percents and photos were replaced', (SELECT count(*) = 1 AND bool_and(claimed_pct = '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb AND jsonb_array_length(evidence -> 'photo_refs') = 2 AND prev_verified = '{"BEKISTING":0,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb) FROM progress_claim_lines WHERE claim_id = :'claim1'));
SELECT rehearsal.expect('104 a percent with two decimals keeps one', ((save_progress_claim_line(rehearsal.p(), rehearsal.row(3), '{"SINGLE":40.26}') -> 'claimed_pct') ->> 'SINGLE')::numeric = 40.3);
SELECT rehearsal.expect_error('104 a split percent on a SINGLE row is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"BEKISTING":10,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a percent above 100 is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":101,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a string percent is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":"50","PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a row with planned 0 is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(5), '{"SINGLE":10}'), 'CLAIM_NO_PLANNED:');
SELECT rehearsal.expect_error('104 a row without weights is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(6), '{"SINGLE":10}'), 'CLAIM_NO_WEIGHTS:');
SELECT rehearsal.expect_error('104 a superseded row is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(4), '{"SINGLE":10}'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('104 a photo of another project is refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', '["progress/00000000-0000-4000-8000-000000000000/x.jpg"]'), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 a path that climbs out of the folder is refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', jsonb_build_array('progress/' || rehearsal.p() || '/../x.jpg')), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 thirteen photos are refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', (SELECT jsonb_agg('progress/' || rehearsal.p() || '/' || g || '.jpg') FROM generate_series(1, 13) AS g)), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 a supervisor cannot write a claim directly', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-14', rehearsal.u('sup')), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 a supervisor cannot insert progress directly', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 5, %L, %L)', rehearsal.p(), rehearsal.row(1), rehearsal.u('sup'), 'm3', 'IN_PROGRESS'), 'new row violates row-level security');
WITH u AS (UPDATE boq_items SET installed = 99 WHERE project_id = rehearsal.p() RETURNING 1)
SELECT rehearsal.expect('104 a supervisor cannot update installed directly', count(*) = 0) FROM u;
COMMIT;

SELECT id AS line_row3 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(3) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the principal cannot claim', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":10}'), 'CLAIM_ROLE:');
SELECT rehearsal.expect('104 the principal reads the claim', (SELECT count(*) FROM progress_claims WHERE project_id = rehearsal.p()) = 1);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an outsider cannot claim', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":10}'), 'CLAIM_AUTH:');
SELECT rehearsal.expect('104 an outsider sees no claim and no line', (SELECT count(*) FROM progress_claims) = 0 AND (SELECT count(*) FROM progress_claim_lines) = 0);
ROLLBACK;

-- B. Submit, return, fix, resubmit
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 submit tells both estimators', (submit_progress_claim(:'claim1') ->> 'notified')::int = 2);
SELECT rehearsal.expect_error('104 a submitted claim takes no new line', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":10,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_LOCKED:');
SELECT rehearsal.expect_error('104 a submitted claim cannot lose a line', format('SELECT remove_progress_claim_line(%L)', :'line_row3'), 'CLAIM_STATE:');
SELECT rehearsal.expect_error('104 a claim cannot be submitted twice', format('SELECT submit_progress_claim(%L)', :'claim1'), 'CLAIM_STATE:');
SELECT rehearsal.expect_error('104 a supervisor cannot return a claim', format('SELECT return_progress_claim(%L, %L)', :'claim1', 'x'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('104 a supervisor cannot verify a claim', format('SELECT verify_progress_claim(%L, %L)', :'claim1', '[]'), 'CLAIM_ROLE:');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a return needs a note', format('SELECT return_progress_claim(%L, %L)', :'claim1', '   '), 'CLAIM_RETURN_NOTE:');
SELECT rehearsal.expect('104 an estimator returns the claim and the supervisor is told', (return_progress_claim(:'claim1', 'Foto pembesian kurang jelas') ->> 'notified')::int = 1);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 a returned claim takes edits and stays RETURNED', (save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}') ->> 'claim_status') = 'RETURNED');
SELECT rehearsal.expect('104 a line can be removed from a returned claim', (remove_progress_claim_line(:'line_row3') ->> 'lines_left')::int = 2);
SELECT rehearsal.expect('104 resubmitting works', (submit_progress_claim(:'claim1') ->> 'status') = 'SUBMITTED');
COMMIT;

SELECT id AS line_row1 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS line_row2 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(2) \gset

-- C. Verification
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 verify needs every line', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))), 'CLAIM_LINES:');
SELECT rehearsal.expect_error('104 verify refuses a line listed twice', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))), 'CLAIM_LINES:');
SELECT rehearsal.expect_error('104 verify refuses a wrong-shaped percent', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'line_row2', 'verified_pct', '{"SINGLE":50}'::jsonb))), 'CLAIM_PCT:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT verify_progress_claim(:'claim1', jsonb_build_array(
  jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'line_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb)), 'Sesuai foto') AS verify1 \gset
COMMIT;

SELECT rehearsal.expect('104 verify reports two entries, no regression, one notification', (:'verify1'::jsonb ->> 'entries')::int = 2 AND (:'verify1'::jsonb ->> 'regressions')::int = 0 AND (:'verify1'::jsonb ->> 'notified')::int = 1, :'verify1');
SELECT rehearsal.expect('104 kolom row installed 61.76 = 100 x (0.326 + 0.486 x 0.6), progress 61.8', (SELECT installed = 61.76 AND progress = 61.8 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 balok row installed 73.6 = 200 x 0.368, progress 36.8', (SELECT installed = 73.6 AND progress = 36.8 FROM boq_items WHERE id = rehearsal.row(2)));
SELECT rehearsal.expect('104 each verified row has one entry by the submitter equal to installed', (SELECT count(*) = 2 AND bool_and(e.reported_by = rehearsal.u('sup') AND e.quantity = b.installed AND e.work_status = 'IN_PROGRESS') FROM progress_entries e JOIN boq_items b ON b.id = e.boq_item_id WHERE e.project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the kolom entry carries the two claim photos', (SELECT count(*) = 2 FROM progress_photos ph JOIN progress_entries e ON e.id = ph.progress_entry_id WHERE e.boq_item_id = rehearsal.row(1)));
SELECT rehearsal.expect('104 the claim is VERIFIED by the second estimator with the note', (SELECT status = 'VERIFIED' AND verified_by = rehearsal.u('est2') AND verifier_note = 'Sesuai foto' AND return_note = 'Foto pembesian kurang jelas' FROM progress_claims WHERE id = :'claim1'));
SELECT rehearsal.expect('104 the lines record what verification wrote', (SELECT bool_and(weights_snapshot IS NOT NULL AND verified_pct IS NOT NULL AND installed_before = 0 AND delta_quantity > 0 AND progress_entry_id IS NOT NULL) FROM progress_claim_lines WHERE claim_id = :'claim1'));
SELECT rehearsal.expect('104 two activity rows were logged', (SELECT count(*) = 2 FROM activity_log WHERE project_id = rehearsal.p() AND type = 'progres'));
SELECT rehearsal.expect('104 the supervisor was told of the return and the verification', (SELECT count(*) FILTER (WHERE type = 'PROGRESS_CLAIM_RETURNED') = 1 AND count(*) FILTER (WHERE type = 'PROGRESS_CLAIM_VERIFIED') = 1 FROM notifications WHERE recipient_user_id = rehearsal.u('sup') AND related_entity_id = :'claim1'));
SELECT rehearsal.expect('104 both estimators were told of both submissions', (SELECT count(*) = 4 FROM notifications WHERE type = 'PROGRESS_CLAIM_SUBMITTED' AND related_entity_id = :'claim1'));

-- D. A second claim: a correction, an estimator submitter, self-verify
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') AS save2 \gset
SELECT rehearsal.expect('104 after verification the previous figures are the verified ones', (:'save2'::jsonb -> 'prev_verified') = '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb);
SELECT rehearsal.expect('104 a new claim opened after the verified one', (:'save2'::jsonb ->> 'claim_id') <> :'claim1');
SELECT rehearsal.expect_error('104 claiming below the verified figure needs a reason', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'), 'CLAIM_REGRESS_REASON:');
SELECT rehearsal.expect('104 with a reason the lower figure is saved', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}', NULL, '[]', 'Salah hitung begel minggu lalu') ->> 'claim_id') = (:'save2'::jsonb ->> 'claim_id'));
COMMIT;

SELECT :'save2'::jsonb ->> 'claim_id' AS claim2 \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator may submit', (submit_progress_claim(:'claim2') ->> 'status') = 'SUBMITTED');
COMMIT;
SELECT rehearsal.expect('104 the estimator who submits is not told, the other estimator is', (SELECT count(*) = 1 AND bool_and(recipient_user_id = rehearsal.u('est2')) FROM notifications WHERE related_entity_id = :'claim2' AND type = 'PROGRESS_CLAIM_SUBMITTED'));

SELECT id AS c2_row1 FROM progress_claim_lines WHERE claim_id = :'claim2' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS c2_row2 FROM progress_claim_lines WHERE claim_id = :'claim2' AND boq_item_id = rehearsal.row(2) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 whoever submitted cannot verify', format('SELECT verify_progress_claim(%L, %L)', :'claim2', jsonb_build_array(jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_SELF_VERIFY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the verifier cannot lower a figure without a reason', format('SELECT verify_progress_claim(%L, %L)', :'claim2', jsonb_build_array(jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":80,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_REGRESS_REASON:');
SELECT verify_progress_claim(:'claim2', jsonb_build_array(
  jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))) AS verify2 \gset
COMMIT;

SELECT rehearsal.expect('104 verify 2 reports two entries and one regression', (:'verify2'::jsonb ->> 'entries')::int = 2 AND (:'verify2'::jsonb ->> 'regressions')::int = 1, :'verify2');
SELECT rehearsal.expect('104 the kolom correction is one negative entry of -9.72 carrying the reason', (SELECT count(*) = 1 AND bool_and(quantity = -9.72 AND note LIKE '%Salah hitung begel%') FROM progress_entries WHERE boq_item_id = rehearsal.row(1) AND quantity < 0));
SELECT rehearsal.expect('104 kolom installed 52.04, progress 52.0', (SELECT installed = 52.04 AND progress = 52.0 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 balok installed 111.6 = 200 x (0.368 + 0.38 x 0.5), progress 55.8', (SELECT installed = 111.6 AND progress = 55.8 FROM boq_items WHERE id = rehearsal.row(2)));
SELECT rehearsal.expect('104 for every claimed row the entries sum to installed', (SELECT bool_and(b.installed = COALESCE((SELECT sum(quantity) FROM progress_entries e WHERE e.boq_item_id = b.id), 0)) FROM boq_items b WHERE b.id IN (SELECT boq_item_id FROM progress_claim_lines WHERE project_id = rehearsal.p())));
SELECT rehearsal.expect('104 the correction was logged as a WARNING', (SELECT count(*) = 1 FROM activity_log WHERE project_id = rehearsal.p() AND flag = 'WARNING'));
SELECT rehearsal.expect('104 the correction entry has no photos', (SELECT count(*) = 0 FROM progress_photos ph JOIN progress_entries e ON e.id = ph.progress_entry_id WHERE e.quantity < 0));

-- E. Weights, uniqueness, the math, the catalog
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a claimed row cannot switch to a single stage', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(1), '{"SINGLE":1}'), 'WEIGHTS_SHAPE_LOCKED:');
SELECT rehearsal.expect('104 a claimed row can still change its split', (set_boq_stage_weights(rehearsal.row(1), '{"BEKISTING":0.3,"PEMBESIAN":0.5,"PENGECORAN":0.2}') ->> 'source') = 'manual');
SELECT rehearsal.expect('104 a row whose only line was removed can switch shape', (set_boq_stage_weights(rehearsal.row(3), '{"BEKISTING":0.3,"PEMBESIAN":0.4,"PENGECORAN":0.3}') ->> 'source') = 'manual');
ROLLBACK;

BEGIN;
INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (rehearsal.p(), '2026-09-14', rehearsal.u('sup'));
SELECT rehearsal.expect_error('104 a second open claim for one project is impossible', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-14', rehearsal.u('sup')), 'duplicate key value violates unique constraint "progress_claims_one_open"');
ROLLBACK;
SELECT rehearsal.expect_error('104 week_start must be a Monday', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-15', rehearsal.u('sup')), 'new row for relation "progress_claims" violates check constraint "progress_claims_week_monday"');
SELECT rehearsal.expect_error('104 a progress entry of zero is refused', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 0, %L, %L)', rehearsal.p(), rehearsal.row(1), rehearsal.u('sup'), 'm3', 'IN_PROGRESS'), 'new row for relation "progress_entries" violates check constraint "progress_entries_quantity_nonzero"');

SELECT rehearsal.expect('104 fraction: 0.368 + 0.38 x 0.5 = 0.558 (stageMath test)', stage_row_fraction('{"BEKISTING":0.368,"PEMBESIAN":0.38,"PENGECORAN":0.252}', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') = 0.558);
SELECT rehearsal.expect('104 fraction: weights summing to 0.999 still reach 1', stage_row_fraction('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.333}', '{"BEKISTING":100,"PEMBESIAN":100,"PENGECORAN":100}') = 1);
SELECT rehearsal.expect('104 fraction: SINGLE 55 = 0.55', stage_row_fraction('{"SINGLE":1}', '{"SINGLE":55}') = 0.55);
SELECT rehearsal.expect('104 pct: keys must match the weights', NOT stage_pct_valid('{"SINGLE":1}', '{"BEKISTING":10}'));
SELECT rehearsal.expect('104 pct: scalar refused', NOT stage_pct_valid('{"SINGLE":1}', '5'));
SELECT rehearsal.expect('104 pct: negative refused', NOT stage_pct_valid('{"SINGLE":1}', '{"SINGLE":-1}'));
SELECT rehearsal.expect('104 pct: empty against empty refused', NOT stage_pct_valid('{}', '{}'));
SELECT rehearsal.expect('104 notifications: sixteen types with the three claim types', (SELECT array_length(regexp_split_to_array(d, '::text'), 1) - 1 = 16 AND d LIKE '%PROGRESS_CLAIM_SUBMITTED%' AND d LIKE '%PROGRESS_CLAIM_RETURNED%' AND d LIKE '%PROGRESS_CLAIM_VERIFIED%' AND d LIKE '%SITE_EVENT_ASSIGNED%' FROM (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'notifications_type_check') t));
SELECT rehearsal.expect('104 policies: the supervisor progress write policies are gone', (SELECT count(*) = 0 FROM pg_policies WHERE policyname IN ('progress_entries_assigned_insert', 'boq_items_assigned_progress_update')));
SELECT rehearsal.expect('104 privileges: anon runs none of the 104 functions', NOT bool_or(has_function_privilege('anon', oid, 'EXECUTE'))) FROM pg_proc WHERE proname IN ('stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct', 'latest_verified_stage_pct', 'save_progress_claim_line', 'remove_progress_claim_line', 'submit_progress_claim', 'return_progress_claim', 'verify_progress_claim');
SELECT rehearsal.expect('104 privileges: authenticated cannot call latest_verified_stage_pct', NOT has_function_privilege('authenticated', 'latest_verified_stage_pct(uuid)', 'EXECUTE'));

-- F. Review fixes: one writer of progress, re-weighting between verifications,
--    a verifier-less project, line authors, legacy installed, the read views.

-- F1. Nobody but verification writes progress, and publishing still works
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the principal cannot insert a progress entry', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 50, %L, %L)', rehearsal.p(), rehearsal.row(2), rehearsal.u('pri'), 'm3', 'IN_PROGRESS'), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 the principal cannot set installed', format('UPDATE boq_items SET installed = 9.5, progress = 95 WHERE id = %L', rehearsal.row(2)), 'PROGRESS_SINGLE_WRITER:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an estimator cannot call sync_boq_progress', format('SELECT sync_boq_progress(%L)', rehearsal.p()), 'permission denied');
SELECT rehearsal.expect_error('104 an estimator cannot insert a progress photo', format('INSERT INTO progress_photos (progress_entry_id, storage_path) SELECT id, %L FROM progress_entries WHERE project_id = %L LIMIT 1', 'progress/x.jpg', rehearsal.p()), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 a new BoQ row cannot start with progress', format('INSERT INTO boq_items (project_id, code, label, unit, planned, installed) VALUES (%L, %L, %L, %L, 10, 5)', rehearsal.p(), 'T1-099', 'Uji', 'm3'), 'PROGRESS_SINGLE_WRITER:');
WITH u AS (UPDATE boq_items SET label = label || ' (uji)' WHERE id = rehearsal.row(2) RETURNING 1)
SELECT rehearsal.expect('104 an estimator still edits other BoQ columns, as publishing needs', count(*) = 1) FROM u;
ROLLBACK;

-- F2. Claim 3: re-weighting, an estimator reshaping a supervisor seed, a line author, legacy installed
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator re-weights a verified row without changing its shape', (set_boq_stage_weights(rehearsal.row(1), '{"BEKISTING":0.2,"PEMBESIAN":0.5,"PENGECORAN":0.3}') ->> 'source') = 'manual');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 a supervisor seeds a one-stage class on a row without weights', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(6), 'reference_class', 'LAINNYA'))) = 1);
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(6), '{"SINGLE":100}') ->> 'claim_id' AS claim3 \gset
SELECT rehearsal.expect('104 the same stage percents on the re-weighted row save without a reason', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}') ->> 'claim_id') = :'claim3');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator reshapes a row whose only claim line is still open', (reset_boq_stage_weights(rehearsal.row(6), 'PILECAP_SLOOF_PLAT_DASAR') ->> 'source') = 'reference');
SELECT rehearsal.expect('104 an estimator may also fill a line', (save_progress_claim_line(rehearsal.p(), rehearsal.row(3), '{"SINGLE":50}') ->> 'claim_id') = :'claim3');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 submit re-checks an open line against reshaped weights', format('SELECT submit_progress_claim(%L)', :'claim3'), 'CLAIM_PCT:');
SELECT rehearsal.expect('104 the supervisor re-enters the reshaped row', (save_progress_claim_line(rehearsal.p(), rehearsal.row(6), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') ->> 'claim_id') = :'claim3');
COMMIT;

UPDATE boq_items SET installed = 4 WHERE id = rehearsal.row(3);
SELECT rehearsal.expect('104 a session without a JWT (the SQL editor) may still set installed', (SELECT installed = 4 FROM boq_items WHERE id = rehearsal.row(3)));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 claim 3 submits and reaches only the estimator who filled no line', (submit_progress_claim(:'claim3') ->> 'verifiers_notified')::int = 1);
COMMIT;
SELECT rehearsal.expect('104 the estimator who filled a line is not asked to verify, the other one is',
  (SELECT count(*) = 0 FROM notifications WHERE related_entity_id = :'claim3' AND type = 'PROGRESS_CLAIM_SUBMITTED' AND recipient_user_id = rehearsal.u('est'))
  AND (SELECT count(*) = 1 FROM notifications WHERE related_entity_id = :'claim3' AND type = 'PROGRESS_CLAIM_SUBMITTED' AND recipient_user_id = rehearsal.u('est2')));

SELECT id AS c3_row1 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS c3_row3 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(3) \gset
SELECT id AS c3_row6 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(6) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an estimator who filled a line cannot verify the claim', format('SELECT verify_progress_claim(%L, %L)', :'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_SELF_VERIFY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a quantity drop from re-weighting needs a reason even when no percent dropped', format('SELECT verify_progress_claim(%L, %L)', :'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_REGRESS_REASON:');
SELECT verify_progress_claim(:'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb, 'regress_reason', 'Bobot kolom diubah estimator'),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))) AS verify3 \gset
COMMIT;

SELECT rehearsal.expect('104 re-weighting writes a -12.04 correction that carries its reason', (SELECT count(*) = 1 AND bool_and(note LIKE '%Bobot kolom diubah estimator%') FROM progress_entries WHERE boq_item_id = rehearsal.row(1) AND quantity = -12.04));
SELECT rehearsal.expect('104 kolom installed 40 = 100 x (0.2 + 0.5 x 0.4)', (SELECT installed = 40 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 the reshaped pile cap row installed 11.07 = 30 x (0.131 + 0.476 x 0.5)', (SELECT installed = 11.07 FROM boq_items WHERE id = rehearsal.row(6)));
SELECT rehearsal.expect('104 legacy installed 4 gives way to the entries and the difference is logged',
  (SELECT installed = 5 FROM boq_items WHERE id = rehearsal.row(3))
  AND (SELECT count(*) = 1 FROM activity_log WHERE project_id = rehearsal.p() AND flag = 'WARNING' AND label LIKE 'T1-003: terpasang tercatat 4 berbeda dari riwayat progres 0%')
  AND (SELECT installed_cached_before = 4 AND installed_before = 0 FROM progress_claim_lines WHERE id = :'c3_row3'));
SELECT rehearsal.expect('104 after claim 3 every claimed row still sums its entries to installed', (SELECT bool_and(b.installed = COALESCE((SELECT sum(quantity) FROM progress_entries e WHERE e.boq_item_id = b.id), 0)) FROM boq_items b WHERE b.id IN (SELECT boq_item_id FROM progress_claim_lines WHERE project_id = rehearsal.p())));

-- F3. No estimator or admin assigned: the principal hears about the claim
BEGIN;
DELETE FROM project_assignments WHERE project_id = rehearsal.p() AND user_id IN (rehearsal.u('est'), rehearsal.u('est2'));
SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') ->> 'claim_id' AS claim4 \gset
SELECT submit_progress_claim(:'claim4') AS submit4 \gset
RESET ROLE;
SELECT rehearsal.expect('104 with no verifier assigned the principal is told instead',
  (:'submit4'::jsonb ->> 'verifiers_notified')::int = 0
  AND (:'submit4'::jsonb ->> 'notified')::int = 1
  AND (SELECT count(*) = 1 FROM notifications WHERE related_entity_id = :'claim4' AND type = 'PROGRESS_CLAIM_SUBMITTED' AND recipient_user_id = rehearsal.u('pri')));
ROLLBACK;

-- F3b. The only estimator left filled a line: nobody who can verify is assigned, so the principal hears
BEGIN;
DELETE FROM project_assignments WHERE project_id = rehearsal.p() AND user_id = rehearsal.u('est2');
SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') ->> 'claim_id' AS claim4b \gset
SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT submit_progress_claim(:'claim4b') AS submit4b \gset
RESET ROLE;
SELECT rehearsal.expect('104 a line author is never the only one asked, so the principal is told',
  (:'submit4b'::jsonb ->> 'verifiers_notified')::int = 0
  AND (SELECT count(*) = 0 FROM notifications WHERE related_entity_id = :'claim4b' AND recipient_user_id = rehearsal.u('est'))
  AND (SELECT count(*) = 1 FROM notifications WHERE related_entity_id = :'claim4b' AND type = 'PROGRESS_CLAIM_SUBMITTED' AND recipient_user_id = rehearsal.u('pri')));
ROLLBACK;

-- F4. Removing the last line, an admin verifying, the principal reading, estimator seeding, the views
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') AS save5 \gset
SELECT rehearsal.expect('104 removing the last line leaves an empty claim', (remove_progress_claim_line((:'save5'::jsonb ->> 'line_id')::uuid) ->> 'lines_left')::int = 0);
SELECT rehearsal.expect_error('104 an empty claim cannot be submitted', format('SELECT submit_progress_claim(%L)', :'save5'::jsonb ->> 'claim_id'), 'CLAIM_EMPTY:');
SELECT rehearsal.expect('104 the emptied claim takes a line again', (save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') ->> 'claim_id') = (:'save5'::jsonb ->> 'claim_id'));
SELECT rehearsal.expect('104 and submits', (submit_progress_claim((:'save5'::jsonb ->> 'claim_id')::uuid) ->> 'status') = 'SUBMITTED');
COMMIT;

SELECT id AS c5_line FROM progress_claim_lines WHERE claim_id = (:'save5'::jsonb ->> 'claim_id')::uuid \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an unassigned admin verifies as an office role', (verify_progress_claim((:'save5'::jsonb ->> 'claim_id')::uuid, jsonb_build_array(jsonb_build_object('line_id', :'c5_line', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))) ->> 'status') = 'VERIFIED');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 the principal reads claim lines', (SELECT count(*) > 0 FROM progress_claim_lines WHERE project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the latest verified view has one row per verified BoQ row', (SELECT count(*) = 4 FROM progress_claim_latest_verified WHERE project_id = rehearsal.p()));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 the entry totals view equals installed for every claimed row', (SELECT bool_and(t.installed_total = b.installed) FROM progress_entry_totals t JOIN boq_items b ON b.id = t.boq_item_id WHERE t.project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the latest verified view shows row 2 at its newest figure', (SELECT verified_pct = '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb FROM progress_claim_latest_verified WHERE boq_item_id = rehearsal.row(2)));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an outsider reads nothing through the views', (SELECT count(*) FROM progress_claim_latest_verified) = 0 AND (SELECT count(*) FROM progress_entry_totals) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator seeds reference weights too', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))) = 1);
ROLLBACK;

SELECT rehearsal.expect('104 privileges: anon cannot read the views', NOT has_table_privilege('anon', 'progress_claim_latest_verified', 'SELECT') AND NOT has_table_privilege('anon', 'progress_entry_totals', 'SELECT'));
SELECT rehearsal.expect('104 privileges: the views run with the caller rights', (SELECT bool_and(reloptions @> ARRAY['security_invoker=on']) FROM pg_class WHERE relname IN ('progress_claim_latest_verified', 'progress_entry_totals')));
