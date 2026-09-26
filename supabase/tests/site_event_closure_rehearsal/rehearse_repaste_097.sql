-- supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql
-- Run by run.sh right after it re-pastes 097 on top of 105: the revert is real.
\pset tuples_only on
\pset format unaligned
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('re-pasting 097 reverts 105: a cacat with no photo closes', (close_site_event(rehearsal.ev('haz1'), NULL) ->> 'status') = 'done');
COMMIT;
SELECT rehearsal.expect('re-pasting 097 reverts 100: the VO re-check is gone', (SELECT prosrc NOT LIKE '%site_event_norm_quote%' FROM pg_proc WHERE proname = 'confirm_site_event'));
