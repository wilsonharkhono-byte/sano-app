-- supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql
-- Run by run.sh after it re-pastes 100 and then 105: the rule is back.
\pset tuples_only on
\pset format unaligned
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('re-pasting 100 and 105 restores the rule: a cacat with no photo is refused again', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('haz2')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
ROLLBACK;
SELECT rehearsal.expect('re-pasting 100 restores the VO re-check', (SELECT prosrc LIKE '%site_event_norm_quote%' FROM pg_proc WHERE proname = 'confirm_site_event'));
