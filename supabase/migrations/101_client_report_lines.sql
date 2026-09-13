-- ═══════════════════════════════════════════════════════════════════════════
-- 101_client_report_lines.sql
--
-- WHY. Issued client reports (client_progress_reports.snapshot) are the only
-- consistent site record on the live projects, and today nothing links a
-- report line to a BoQ work-area row. Plan A of
-- docs/superpowers/specs/2026-09-13-report-driven-progress-design.md adds:
--   * progress_ai_runs       — one audit row per AI call (link now, prefill in Plan B)
--   * client_report_lines    — one row per snapshot.updates[] line: the model's
--                              suggestion (ai_*) and the supervisor's decision
--   * confirm_report_lines_bulk(report_id) — "Konfirmasi semua saran"
-- The snapshot itself stays frozen. Nothing here writes progress.
--
-- PASTE ORDER. After 100. Needs client_progress_reports (050), boq_items,
-- projects, profiles. Re-pasting 098 later does not affect this file.
--
-- RE-PASTE SAFETY. Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP IF
-- EXISTS before every policy and trigger.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 050 / 051 / 096 / 097 pattern)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. progress_ai_runs — one audit row per AI call (097 site_event_ai_runs shape,
--    plus project_id so the daily cap is one filter, and report_id / claim_id
--    so the same table serves Plan B).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress_ai_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_id      UUID REFERENCES client_progress_reports(id) ON DELETE CASCADE,
  claim_id       UUID,                           -- Plan B adds the FK to progress_claims
  stage          TEXT NOT NULL CHECK (stage IN ('link', 'prefill')),
  model          TEXT NOT NULL,
  prompt_hash    TEXT NOT NULL,
  input_summary  JSONB NOT NULL,
  output         JSONB,
  tokens_in      INT,
  tokens_out     INT,
  cost_usd       NUMERIC,
  latency_ms     INT,
  status         TEXT NOT NULL CHECK (status IN ('ok', 'rejected', 'error')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT progress_ai_runs_one_target CHECK ((report_id IS NULL) <> (claim_id IS NULL))
);

COMMENT ON COLUMN progress_ai_runs.input_summary IS
  'Counts and sizes only (line count, row count, photo count). Never the photos themselves.';
COMMENT ON COLUMN progress_ai_runs.output IS
  'Validated links plus what the validator dropped, so a bad suggestion can be diagnosed.';

CREATE INDEX IF NOT EXISTS idx_progress_ai_runs_project_stage
  ON progress_ai_runs(project_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_ai_runs_report
  ON progress_ai_runs(report_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. client_report_lines — one row per snapshot.updates[] line
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_report_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES client_progress_reports(id) ON DELETE CASCADE,
  line_index        INT NOT NULL CHECK (line_index >= 0),
  line_text         TEXT NOT NULL,               -- "<area> :: <note>", frozen; quotes validate against this
  boq_item_id       UUID CONSTRAINT client_report_lines_boq_item_id_fkey REFERENCES boq_items(id) ON DELETE SET NULL,
  stage             TEXT CHECK (stage IN ('GALIAN', 'LANTAI_KERJA', 'MARKING', 'STEK', 'BEKISTING', 'PEMBESIAN',
                                          'PENGECORAN', 'BONGKAR_BEKISTING', 'CURING', 'PERSIAPAN', 'LAINNYA')),
  activity_state    TEXT CHECK (activity_state IN ('MULAI', 'LANJUT', 'SELESAI')),
  status            TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'CONFIRMED', 'DISMISSED')),
  confirmed_by      UUID REFERENCES profiles(id),
  confirmed_at      TIMESTAMPTZ,
  ai_boq_item_id    UUID CONSTRAINT client_report_lines_ai_boq_item_id_fkey REFERENCES boq_items(id) ON DELETE SET NULL,
  ai_stage          TEXT CHECK (ai_stage IN ('GALIAN', 'LANTAI_KERJA', 'MARKING', 'STEK', 'BEKISTING', 'PEMBESIAN',
                                             'PENGECORAN', 'BONGKAR_BEKISTING', 'CURING', 'PERSIAPAN', 'LAINNYA')),
  ai_activity_state TEXT CHECK (ai_activity_state IN ('MULAI', 'LANJUT', 'SELESAI')),
  ai_confidence     TEXT CHECK (ai_confidence IN ('high', 'medium', 'low')),
  ai_quote          TEXT,
  ai_model          TEXT,
  ai_run_id         UUID REFERENCES progress_ai_runs(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_report_lines_unique_line UNIQUE (report_id, line_index),
  -- A confirmed line points at a row; "no row" is DISMISSED, not CONFIRMED.
  CONSTRAINT client_report_lines_confirmed_has_row CHECK (status <> 'CONFIRMED' OR boq_item_id IS NOT NULL)
);

COMMENT ON TABLE client_report_lines IS
  'Spec 2026-09-13 §5.1. The snapshot stays frozen; this is the link of each of its lines to a BoQ row and stage.';

CREATE INDEX IF NOT EXISTS idx_client_report_lines_report
  ON client_report_lines(report_id, line_index);
CREATE INDEX IF NOT EXISTS idx_client_report_lines_confirmed_row
  ON client_report_lines(boq_item_id) WHERE status = 'CONFIRMED';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Guard: the edge function (service role) owns inserts, line identity and
--    every ai_* column. Clients may only decide (status, boq_item_id, stage,
--    activity_state, confirmed_*).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION client_report_lines_ai_columns_service_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'CLIENT_REPORT_LINES_SERVICE_ONLY: baris tautan hanya dibuat oleh fungsi analisis'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.line_index IS DISTINCT FROM OLD.line_index
     OR NEW.line_text IS DISTINCT FROM OLD.line_text
     OR NEW.ai_boq_item_id IS DISTINCT FROM OLD.ai_boq_item_id
     OR NEW.ai_stage IS DISTINCT FROM OLD.ai_stage
     OR NEW.ai_activity_state IS DISTINCT FROM OLD.ai_activity_state
     OR NEW.ai_confidence IS DISTINCT FROM OLD.ai_confidence
     OR NEW.ai_quote IS DISTINCT FROM OLD.ai_quote
     OR NEW.ai_model IS DISTINCT FROM OLD.ai_model
     OR NEW.ai_run_id IS DISTINCT FROM OLD.ai_run_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CLIENT_REPORT_LINES_AI_COLUMNS: kolom saran AI hanya boleh diubah oleh fungsi analisis'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_report_lines_ai_columns_service_only_trg ON client_report_lines;
CREATE TRIGGER client_report_lines_ai_columns_service_only_trg
  BEFORE INSERT OR UPDATE ON client_report_lines
  FOR EACH ROW EXECUTE FUNCTION client_report_lines_ai_columns_service_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. RLS — project members or office roles read and decide; nobody deletes;
--    only the service role (bypasses RLS) inserts lines or writes runs.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE progress_ai_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_report_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS progress_ai_runs_select ON progress_ai_runs;
CREATE POLICY progress_ai_runs_select ON progress_ai_runs
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS client_report_lines_select ON client_report_lines;
CREATE POLICY client_report_lines_select ON client_report_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM client_progress_reports r
      WHERE r.id = client_report_lines.report_id
        AND (is_project_member(r.project_id) OR is_office_role())
    )
  );

DROP POLICY IF EXISTS client_report_lines_update ON client_report_lines;
CREATE POLICY client_report_lines_update ON client_report_lines
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM client_progress_reports r
      WHERE r.id = client_report_lines.report_id
        AND (is_project_member(r.project_id) OR is_office_role())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM client_progress_reports r
      WHERE r.id = client_report_lines.report_id
        AND (is_project_member(r.project_id) OR is_office_role())
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. "Konfirmasi semua saran": accept every still-SUGGESTED line whose
--    suggestion names a row with high or medium confidence. SECURITY INVOKER
--    on purpose — RLS above decides who may, and the trigger sees the caller.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_report_lines_bulk(p_report_id UUID)
RETURNS INT LANGUAGE sql SET search_path = public
AS $$
  WITH updated AS (
    UPDATE client_report_lines
    SET boq_item_id    = ai_boq_item_id,
        stage          = ai_stage,
        activity_state = COALESCE(ai_activity_state, 'LANJUT'),
        status         = 'CONFIRMED',
        confirmed_by   = auth.uid(),
        confirmed_at   = now()
    WHERE report_id = p_report_id
      AND status = 'SUGGESTED'
      AND ai_boq_item_id IS NOT NULL
      AND ai_confidence IN ('high', 'medium')
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM updated;
$$;
GRANT EXECUTE ON FUNCTION confirm_report_lines_bulk(UUID) TO authenticated;

-- Close-out: every DDL statement is above this line.
RESET lock_timeout;

SELECT to_regclass('public.progress_ai_runs') AS runs, to_regclass('public.client_report_lines') AS lines;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-5 write nothing, check 6 ROLLBACKs)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: one row, both names non-null.
--
-- 2. The guard is attached and the FK names the app relies on exist:
--      SELECT tgname FROM pg_trigger
--      WHERE tgrelid = 'public.client_report_lines'::regclass AND NOT tgisinternal;
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.client_report_lines'::regclass
--        AND conname IN ('client_report_lines_boq_item_id_fkey', 'client_report_lines_ai_boq_item_id_fkey',
--                        'client_report_lines_unique_line', 'client_report_lines_confirmed_has_row');
--    EXPECTED: client_report_lines_ai_columns_service_only_trg; four constraint names.
--
-- 3. Policies: reads and updates only, never insert or delete for clients:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('progress_ai_runs', 'client_report_lines') ORDER BY 1, 2;
--    EXPECTED: three rows — progress_ai_runs_select (SELECT),
--    client_report_lines_select (SELECT), client_report_lines_update (UPDATE).
--
-- 4. The bulk RPC runs as the caller (not SECURITY DEFINER) and anon cannot call it:
--      SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--      FROM pg_proc WHERE proname = 'confirm_report_lines_bulk';
--    EXPECTED: one row, prosecdef = false, anon_exec = false.
--
-- 5. A run row must point at exactly one target:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'progress_ai_runs_one_target';
--    EXPECTED: CHECK ((report_id IS NULL) <> (claim_id IS NULL)).
--
-- 6. A client cannot insert a line, and cannot touch an ai_* column on one the
--    function created (everything rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims', '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        INSERT INTO client_report_lines (report_id, line_index, line_text)
--        VALUES ('<AN_ISSUED_REPORT_UUID>', 999, 'x');
--      ROLLBACK;
--    EXPECTED: ERROR  CLIENT_REPORT_LINES_SERVICE_ONLY: ...
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims', '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        UPDATE client_report_lines SET ai_confidence = 'high' WHERE report_id = '<A_LINKED_REPORT_UUID>';
--      ROLLBACK;
--    EXPECTED: ERROR  CLIENT_REPORT_LINES_AI_COLUMNS: ... (once at least one line exists).
--
-- 7. Re-paste this whole file.
--    EXPECTED: no error, and checks 2-5 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
