-- supabase/tests/010_opname_rebuild.test.sql
-- pgTAP tests for the opname architecture rebuild.
-- Run with: supabase test db

BEGIN;
SELECT plan(14);

-- ── RPC existence tests ─────────────────────────────────────────────
SELECT has_function('update_opname_line_progress',
  'RPC update_opname_line_progress should exist');

SELECT has_function('submit_opname',
  'RPC submit_opname should exist');

SELECT has_function('verify_opname',
  'RPC verify_opname should exist');

SELECT has_function('approve_opname',
  'RPC approve_opname should exist');

SELECT has_function('mark_opname_paid',
  'RPC mark_opname_paid should exist');

SELECT has_function('promote_verified_pct',
  'RPC promote_verified_pct should exist');

SELECT has_function('refresh_prior_paid',
  'RPC refresh_prior_paid should exist');

SELECT has_function('apply_detected_trade_categories',
  'RPC apply_detected_trade_categories should exist');

-- ── View existence tests ────────────────────────────────────────────
SELECT has_view('v_opname_progress_reconciliation',
  'View v_opname_progress_reconciliation should exist');

SELECT has_view('v_labor_payment_summary',
  'View v_labor_payment_summary should exist');

-- ── Table existence tests ───────────────────────────────────────────
SELECT has_table('opname_line_revisions',
  'Audit table opname_line_revisions should exist');

-- ── Index tests ─────────────────────────────────────────────────────
SELECT has_index('ahs_lines', 'idx_ahs_lines_trade_category',
  'Index on ahs_lines.trade_category should exist');

SELECT has_index('ahs_lines', 'idx_ahs_lines_line_type_trade',
  'Composite index on ahs_lines(line_type, trade_category) should exist');

-- ── Trigger tests ───────────────────────────────────────────────────
SELECT has_trigger('opname_lines', 'trg_recompute_opname_totals',
  'Trigger trg_recompute_opname_totals should exist on opname_lines');

SELECT * FROM finish();
ROLLBACK;
