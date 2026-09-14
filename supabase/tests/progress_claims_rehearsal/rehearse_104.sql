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
