-- ═══════════════════════════════════════════════════════════════════════════
-- 103_boq_stage_weights.sql
--
-- Spec: docs/superpowers/specs/2026-09-13-report-driven-progress-design.md §5.3, §7, §17, §18
-- Plan: docs/superpowers/plans/2026-09-14-report-driven-progress-plan-b.md (Task 8)
--
-- WHY. A weekly progress claim (migration 104) is a percent per construction
-- stage of a work-area row: bekisting, pembesian, pengecoran. Turning those
-- percents into an installed quantity needs the share of the row's value each
-- stage carries. Neither live project stores it (both are simplified-input
-- publishes with no costs, spec §17), so this file adds:
--   * boq_stage_weights: one row per BoQ row with the weights, their source
--     (reference or manual now; rab and input_sheet later) and, for reference
--     weights, the class they came from.
--   * seed_reference_stage_weights(project, rows): a supervisor, estimator or
--     admin fills rows that have NO weights yet with the reference profile of
--     a class. The client sends only the class. The numbers live in
--     reference_stage_weights() below, pinned to
--     tools/progressClaims/referenceStageWeights.data.ts by
--     tools/__tests__/migration103.test.ts. It never overwrites a row.
--   * set_boq_stage_weights(row, weights): estimator or admin, source manual.
--   * reset_boq_stage_weights(row, class): estimator or admin, back to the
--     reference profile of a class.
-- Nothing here writes progress. A row without weights cannot be claimed (104
-- refuses it), so no percent is ever turned into quantity with guessed weights.
--
-- PASTE ORDER. After 102. Needs projects, profiles, project_assignments and
-- boq_items (001, 074). Migration 104 adds a trigger to this table and calls
-- progress_actor_role(), so paste 104 after this file.
--
-- RE-PASTE SAFETY. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS before CREATE POLICY, REVOKE before GRANT: a second
-- paste changes nothing. The reference numbers are data inside a function
-- body. When the profile is regenerated, update this file in the same change
-- (tools/__tests__/migration103.test.ts fails until you do) and re-paste it.
-- Stored rows keep the numbers they were seeded with until an estimator
-- resets them.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 096 / 102 pattern)
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

-- Who may act on a project's progress data. Every progress RPC in 103 and 104
-- calls this first, so the refusals read the same everywhere:
--   CLAIM_AUTH  no session, or a session that is neither a project member nor
--               an office role;
--   CLAIM_ROLE  a caller whose role is not in p_allowed_roles (the principal
--               reads progress and never writes it).
-- A session-less caller is refused outright, service role included: every
-- progress write carries the name of the person who made it.
CREATE OR REPLACE FUNCTION progress_actor_role(p_project_id UUID, p_allowed_roles TEXT[])
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CLAIM_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_project_member(p_project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'CLAIM_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR NOT (v_role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'CLAIM_ROLE: peran % tidak dapat melakukan aksi ini', COALESCE(v_role, '-')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_role;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Weight shape and the reference profile (pure)
-- ───────────────────────────────────────────────────────────────────────────

-- The accepted shapes, identical to validateStageWeights in
-- tools/progressClaims/stageWeights.ts: {"SINGLE": 1}, or exactly BEKISTING,
-- PEMBESIAN and PENGECORAN, each a number from 0 to 1, summing to 1 ± 0.001.
-- Nested CASE, not AND: SQL does not promise to short-circuit, and casting a
-- JSON string to numeric would raise instead of returning false.
CREATE OR REPLACE FUNCTION stage_weights_valid(p_weights JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_weights IS NULL OR jsonb_typeof(p_weights) <> 'object' THEN false
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) = ARRAY['SINGLE'] THEN
      CASE WHEN jsonb_typeof(p_weights -> 'SINGLE') = 'number'
           THEN (p_weights ->> 'SINGLE')::numeric = 1
           ELSE false END
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) = ARRAY['BEKISTING', 'PEMBESIAN', 'PENGECORAN'] THEN
      CASE WHEN (SELECT bool_and(jsonb_typeof(v) = 'number') FROM jsonb_each(p_weights) AS e(k, v))
           THEN (SELECT bool_and((v #>> '{}')::numeric BETWEEN 0 AND 1) FROM jsonb_each(p_weights) AS e(k, v))
                AND abs((SELECT sum((v #>> '{}')::numeric) FROM jsonb_each(p_weights) AS e(k, v)) - 1) <= 0.001
           ELSE false END
    ELSE false
  END;
$$;

-- Reference profile per work-area class (spec §17 table). GENERATED numbers:
-- copy them from tools/progressClaims/referenceStageWeights.data.ts, never by
-- hand. Classes the RABs do not price by stage are {"SINGLE": 1}, the same as
-- referenceWeightsFor() in tools/progressClaims/stageWeights.ts.
CREATE OR REPLACE FUNCTION reference_stage_weights(p_class TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_class
    WHEN 'PILECAP_SLOOF_PLAT_DASAR' THEN '{"BEKISTING": 0.131, "PEMBESIAN": 0.476, "PENGECORAN": 0.393}'::jsonb
    WHEN 'KOLOM'                    THEN '{"BEKISTING": 0.326, "PEMBESIAN": 0.486, "PENGECORAN": 0.188}'::jsonb
    WHEN 'BALOK_PLAT'               THEN '{"BEKISTING": 0.368, "PEMBESIAN": 0.38, "PENGECORAN": 0.252}'::jsonb
    WHEN 'DINDING'                  THEN '{"BEKISTING": 0.312, "PEMBESIAN": 0.356, "PENGECORAN": 0.332}'::jsonb
    WHEN 'TANGGA'                   THEN '{"SINGLE": 1}'::jsonb
    WHEN 'BOREDPILE'                THEN '{"SINGLE": 1}'::jsonb
    WHEN 'LAINNYA'                  THEN '{"SINGLE": 1}'::jsonb
    ELSE NULL
  END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. boq_stage_weights
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boq_stage_weights (
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id     UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  weights         JSONB NOT NULL,
  source          TEXT NOT NULL,
  reference_class TEXT,
  basis           JSONB,
  updated_by      UUID REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, boq_item_id),
  CONSTRAINT boq_stage_weights_item_unique UNIQUE (boq_item_id),
  CONSTRAINT boq_stage_weights_shape CHECK (stage_weights_valid(weights)),
  CONSTRAINT boq_stage_weights_source CHECK (source IN ('rab', 'input_sheet', 'reference', 'manual')),
  CONSTRAINT boq_stage_weights_reference_class CHECK ((source = 'reference') = (reference_class IS NOT NULL))
);

-- Read for members and office roles. No write policy at all: every write goes
-- through the three functions below, which derive project_id from the row.
ALTER TABLE boq_stage_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boq_stage_weights_select ON boq_stage_weights;
CREATE POLICY boq_stage_weights_select ON boq_stage_weights
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Writers
-- ───────────────────────────────────────────────────────────────────────────

-- p_rows: [{"boq_item_id": "<uuid>", "reference_class": "KOLOM"}, ...].
-- Insert-only: a row that already has weights (reference or manual) is left
-- untouched, so a supervisor opening the claim form can never undo an
-- estimator's decision. Returns the number of rows inserted.
CREATE OR REPLACE FUNCTION seed_reference_stage_weights(p_project_id UUID, p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_entry    JSONB;
  v_item     boq_items%ROWTYPE;
  v_class    TEXT;
  v_weights  JSONB;
  v_count    INTEGER;
  v_inserted INTEGER := 0;
BEGIN
  PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'WEIGHTS_INVALID: daftar baris harus berupa array';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_class := v_entry ->> 'reference_class';
    v_weights := reference_stage_weights(v_class);
    IF v_weights IS NULL THEN
      RAISE EXCEPTION 'WEIGHTS_CLASS: kelas referensi % tidak dikenal', COALESCE(v_class, '-');
    END IF;

    IF COALESCE(v_entry ->> 'boq_item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % tidak dikenal', COALESCE(v_entry ->> 'boq_item_id', '-');
    END IF;
    SELECT * INTO v_item FROM boq_items WHERE id = (v_entry ->> 'boq_item_id')::uuid;
    IF NOT FOUND OR v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % bukan baris aktif proyek ini', v_entry ->> 'boq_item_id';
    END IF;

    INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, updated_by)
    VALUES (p_project_id, v_item.id, v_weights, 'reference', v_class, v_uid)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_inserted := v_inserted + v_count;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION set_boq_stage_weights(p_boq_item_id UUID, p_weights JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_item boq_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % tidak ditemukan', p_boq_item_id;
  END IF;
  PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);
  IF v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_item.code;
  END IF;
  IF NOT stage_weights_valid(p_weights) THEN
    RAISE EXCEPTION 'WEIGHTS_INVALID: %', COALESCE(p_weights::text, 'null');
  END IF;

  INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, basis, updated_by, updated_at)
  VALUES (v_item.project_id, v_item.id, p_weights, 'manual', NULL, NULL, v_uid, now())
  ON CONFLICT (project_id, boq_item_id) DO UPDATE
    SET weights         = EXCLUDED.weights,
        source          = 'manual',
        reference_class = NULL,
        updated_by      = EXCLUDED.updated_by,
        updated_at      = now();

  RETURN jsonb_build_object('boq_item_id', v_item.id, 'weights', p_weights, 'source', 'manual');
END;
$$;

CREATE OR REPLACE FUNCTION reset_boq_stage_weights(p_boq_item_id UUID, p_reference_class TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_item    boq_items%ROWTYPE;
  v_weights JSONB := reference_stage_weights(p_reference_class);
BEGIN
  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % tidak ditemukan', p_boq_item_id;
  END IF;
  PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);
  IF v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_item.code;
  END IF;
  IF v_weights IS NULL THEN
    RAISE EXCEPTION 'WEIGHTS_CLASS: kelas referensi % tidak dikenal', COALESCE(p_reference_class, '-');
  END IF;

  INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, basis, updated_by, updated_at)
  VALUES (v_item.project_id, v_item.id, v_weights, 'reference', p_reference_class, NULL, v_uid, now())
  ON CONFLICT (project_id, boq_item_id) DO UPDATE
    SET weights         = EXCLUDED.weights,
        source          = 'reference',
        reference_class = EXCLUDED.reference_class,
        basis           = NULL,
        updated_by      = EXCLUDED.updated_by,
        updated_at      = now();

  RETURN jsonb_build_object('boq_item_id', v_item.id, 'weights', v_weights, 'source', 'reference', 'reference_class', p_reference_class);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Privileges: anon reaches nothing; the actor check is internal only
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION progress_actor_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION progress_actor_role(UUID, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION stage_weights_valid(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_weights_valid(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION reference_stage_weights(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reference_stage_weights(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION seed_reference_stage_weights(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION seed_reference_stage_weights(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION set_boq_stage_weights(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_boq_stage_weights(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION reset_boq_stage_weights(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reset_boq_stage_weights(UUID, TEXT) TO authenticated, service_role;

RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing)
--
-- 1. The table and its rules landed:
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.boq_stage_weights'::regclass ORDER BY 1;
--    EXPECTED: eight rows: boq_stage_weights_boq_item_id_fkey,
--    boq_stage_weights_item_unique, boq_stage_weights_pkey,
--    boq_stage_weights_project_id_fkey, boq_stage_weights_reference_class,
--    boq_stage_weights_shape, boq_stage_weights_source,
--    boq_stage_weights_updated_by_fkey.
--
-- 2. Members read, nobody writes directly:
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'boq_stage_weights';
--    EXPECTED: one row, boq_stage_weights_select, SELECT.
--
-- 3. The reference profile matches spec §17:
--      SELECT c, reference_stage_weights(c)
--      FROM unnest(ARRAY['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING',
--                        'TANGGA', 'BOREDPILE', 'LAINNYA']) AS c;
--    EXPECTED: 13.1/47.6/39.3, 32.6/48.6/18.8, 36.8/38/25.2, 31.2/35.6/33.2
--    as fractions, then three {"SINGLE": 1}.
--
-- 4. The shape rule:
--      SELECT stage_weights_valid('{"SINGLE": 1}'),
--             stage_weights_valid('{"BEKISTING": 0.5, "PEMBESIAN": 0.3, "PENGECORAN": 0.2}'),
--             stage_weights_valid('{"BEKISTING": 0.5, "PEMBESIAN": 0.3, "PENGECORAN": 0.1}'),
--             stage_weights_valid('{"SINGLE": "1"}');
--    EXPECTED: t, t, f, f.
--
-- 5. A supervisor cannot set manual weights (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_SUPERVISOR_UUID>","role":"authenticated"}', true);
--        SELECT set_boq_stage_weights('<A_ROW_OF_THEIR_PROJECT>', '{"SINGLE": 1}');
--      ROLLBACK;
--    EXPECTED: ERROR starting CLAIM_ROLE.
--
-- 6. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-4 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname IN ('progress_actor_role', 'stage_weights_valid', 'reference_stage_weights',
                  'seed_reference_stage_weights', 'set_boq_stage_weights', 'reset_boq_stage_weights')
ORDER BY proname;
