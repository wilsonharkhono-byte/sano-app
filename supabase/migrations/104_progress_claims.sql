-- ═══════════════════════════════════════════════════════════════════════════
-- 104_progress_claims.sql
--
-- Spec: docs/superpowers/specs/2026-09-13-report-driven-progress-design.md §5.4, §5.5, §6.2, §11, §16, §18
-- Plan: docs/superpowers/plans/2026-09-14-report-driven-progress-plan-b.md (Task 9)
--
-- WHY. Tambah progres becomes a weekly stage claim per work area (spec §16),
-- and nothing counts until an estimator verifies it. This file adds:
--   * progress_claims: one claim in progress per project, DRAFT, then
--     SUBMITTED, then VERIFIED or back to RETURNED. week_start is the WIB
--     Monday of the week the claim was opened.
--   * progress_claim_lines: per work-area row, the supervisor's percent per
--     stage, the estimator's verified percent, and what verification wrote.
--   * save_progress_claim_line, remove_progress_claim_line,
--     submit_progress_claim, return_progress_claim, verify_progress_claim:
--     the only doors in. Both tables have read policies only.
--   * verify_progress_claim is the only writer of progress. Per line it sets
--     boq_items.installed to planned x row fraction and progress to the row
--     fraction in percent, and records the change as one progress_entries row
--     whose quantity is the difference from the sum of the row's existing
--     entries. A lower figure becomes a negative correction entry carrying its
--     reason. The entries of a claimed row therefore always sum to
--     boq_items.installed, and every reader of either agrees (spec §18).
--   * Three notification types: PROGRESS_CLAIM_SUBMITTED to the project's
--     estimators other than the submitter (its admins when it has none, and
--     its principals when it has neither, so someone can assign a verifier),
--     PROGRESS_CLAIM_RETURNED and PROGRESS_CLAIM_VERIFIED to the submitter.
--   * Progress gets exactly one writer. The supervisor insert policies on
--     progress_entries and progress_photos (002) and the supervisor progress
--     policy on boq_items (059) are dropped; 036's office FOR ALL policies on
--     progress_entries and progress_photos become read-only; 002's
--     sync_boq_progress() is revoked; and a trigger refuses any change to
--     boq_items.installed or progress unless verify_progress_claim marked its
--     own transaction. Office roles still edit every other boq_items column,
--     which publishing a BoQ needs. progress_entries.quantity may now be
--     negative but never 0.
--   * A row's weights cannot switch between one stage and three once the row
--     has a VERIFIED claim line. An open line is re-checked against the
--     current weights at submit and verify instead, so an estimator can still
--     correct a shape a supervisor seeded.
--   * Two read views with one row per BoQ item (latest verified percents,
--     entry totals), so the claim screens never meet PostgREST's row cap.
--
-- PASTE ORDER. After 103 (progress_actor_role, boq_stage_weights) and 102
-- (progress_ai_runs). It re-creates the notifications type CHECK as 098's
-- thirteen types plus three.
--
-- WHAT A LATER RE-PASTE OF AN OLDER FILE UNDOES. Re-paste 104 after any of:
--   * 098: the three claim types leave the CHECK and every claim notification
--     is dropped with only a WARNING (self-check 4 shows it).
--   * 059: supervisors can write boq_items.installed and progress directly
--     again (self-check 3 shows it).
--   * 002: supervisors can insert progress_entries and progress_photos
--     directly again (self-check 3 shows it).
--   * 036: office roles regain full write access to progress_entries and
--     progress_photos (self-check 3 shows it).
--
-- RE-PASTE SAFETY. CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP POLICY / TRIGGER IF EXISTS before CREATE, and constraint swaps
-- inside DO blocks that drop whichever CHECK they replace: a second paste
-- changes nothing. tools/__tests__/migration104.test.ts pins the rules below.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 096 / 102 / 103 pattern)
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
-- 1. Tables
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  created_by    UUID NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by  UUID REFERENCES profiles(id),
  submitted_at  TIMESTAMPTZ,
  returned_by   UUID REFERENCES profiles(id),
  returned_at   TIMESTAMPTZ,
  return_note   TEXT,
  verified_by   UUID REFERENCES profiles(id),
  verified_at   TIMESTAMPTZ,
  verifier_note TEXT,
  ai_run_id     UUID REFERENCES progress_ai_runs(id) ON DELETE SET NULL,
  CONSTRAINT progress_claims_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED')),
  CONSTRAINT progress_claims_week_monday CHECK (extract(isodow FROM week_start) = 1),
  CONSTRAINT progress_claims_submitted_fields CHECK (status = 'DRAFT' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CONSTRAINT progress_claims_verified_fields CHECK ((status = 'VERIFIED') = (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

-- One claim in progress per project: the supervisor always edits the same
-- draft, and verification never races a second claim over the same rows.
CREATE UNIQUE INDEX IF NOT EXISTS progress_claims_one_open
  ON progress_claims (project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED');
CREATE INDEX IF NOT EXISTS idx_progress_claims_project_week
  ON progress_claims (project_id, week_start DESC);

CREATE TABLE IF NOT EXISTS progress_claim_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          UUID NOT NULL REFERENCES progress_claims(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id       UUID NOT NULL REFERENCES boq_items(id),
  prev_verified     JSONB NOT NULL,
  claimed_pct       JSONB NOT NULL,
  verified_pct      JSONB,
  weights_snapshot  JSONB,
  row_pct_prev      NUMERIC,
  row_pct_new       NUMERIC,
  installed_before  NUMERIC,
  installed_cached_before NUMERIC,
  delta_quantity    NUMERIC,
  regress_reason    TEXT,
  note              TEXT,
  evidence          JSONB NOT NULL DEFAULT '{"photo_refs": [], "report_line_ids": []}'::jsonb,
  flags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_pct            JSONB,
  ai_confidence     TEXT,
  ai_quotes         JSONB,
  ai_flags          JSONB,
  ai_run_id         UUID REFERENCES progress_ai_runs(id) ON DELETE SET NULL,
  progress_entry_id UUID REFERENCES progress_entries(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  updated_by        UUID NOT NULL REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT progress_claim_lines_claim_row UNIQUE (claim_id, boq_item_id),
  CONSTRAINT progress_claim_lines_evidence CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_progress_claim_lines_row ON progress_claim_lines (boq_item_id);
CREATE INDEX IF NOT EXISTS idx_progress_claim_lines_project ON progress_claim_lines (project_id);
-- A database that ran an earlier draft of this file lacks the column.
ALTER TABLE progress_claim_lines ADD COLUMN IF NOT EXISTS installed_cached_before NUMERIC;

-- 102 left progress_ai_runs.claim_id without a foreign key: this table did not exist yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_ai_runs_claim_id_fkey') THEN
    ALTER TABLE progress_ai_runs
      ADD CONSTRAINT progress_ai_runs_claim_id_fkey
      FOREIGN KEY (claim_id) REFERENCES progress_claims(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Stage percent math (pure), the SQL twin of tools/progressClaims
-- ───────────────────────────────────────────────────────────────────────────

-- Exactly the weights' own stages, each a number from 0 to 100
-- (validateClaimPct in claimRules.ts). Nested CASE: SQL does not promise to
-- short-circuit, and casting a JSON string to numeric would raise.
CREATE OR REPLACE FUNCTION stage_pct_valid(p_weights JSONB, p_pct JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_weights IS NULL OR p_pct IS NULL
      OR jsonb_typeof(p_weights) <> 'object' OR jsonb_typeof(p_pct) <> 'object' THEN false
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_pct) AS k)
         IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) THEN false
    ELSE COALESCE((SELECT bool_and(CASE WHEN jsonb_typeof(v) = 'number'
                                        THEN (v #>> '{}')::numeric BETWEEN 0 AND 100
                                        ELSE false END)
                   FROM jsonb_each(p_pct) AS e(k, v)), false)
  END;
$$;

-- One decimal per stage, as clampPct in stageMath.ts. Call only on a valid percent.
CREATE OR REPLACE FUNCTION stage_pct_round(p_pct JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(k, round((v #>> '{}')::numeric, 1)), '{}'::jsonb)
  FROM jsonb_each(p_pct) AS e(k, v);
$$;

-- Row completion 0..1: Σ weight x percent / 100, divided by the weights' sum
-- so 0.333 / 0.333 / 0.333 still reaches 1, rounded to 6 decimals. Same
-- number as rowFraction in stageMath.ts.
CREATE OR REPLACE FUNCTION stage_row_fraction(p_weights JSONB, p_pct JSONB)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(sum((w.v #>> '{}')::numeric), 0) <= 0 THEN 0::numeric
    ELSE round(LEAST(1, GREATEST(0,
           sum((w.v #>> '{}')::numeric * LEAST(100, GREATEST(0, COALESCE((p_pct ->> w.k)::numeric, 0))) / 100)
           / sum((w.v #>> '{}')::numeric))), 6)
  END
  FROM jsonb_each(p_weights) AS w(k, v);
$$;

CREATE OR REPLACE FUNCTION zero_stage_pct(p_weights JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(k, 0), '{}'::jsonb) FROM jsonb_object_keys(p_weights) AS k;
$$;

-- The stage percents of the row's most recent verified claim line, or NULL.
CREATE OR REPLACE FUNCTION latest_verified_stage_pct(p_boq_item_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.verified_pct
  FROM progress_claim_lines l
  JOIN progress_claims c ON c.id = l.claim_id
  WHERE l.boq_item_id = p_boq_item_id
    AND c.status = 'VERIFIED'
    AND l.verified_pct IS NOT NULL
  ORDER BY c.verified_at DESC, l.updated_at DESC
  LIMIT 1;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. A verified row keeps its weight shape
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION boq_stage_weights_shape_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (NEW.weights ? 'SINGLE') IS DISTINCT FROM (OLD.weights ? 'SINGLE')
     AND EXISTS (
       SELECT 1 FROM progress_claim_lines l
       JOIN progress_claims c ON c.id = l.claim_id
       WHERE l.boq_item_id = NEW.boq_item_id AND c.status = 'VERIFIED'
     ) THEN
    RAISE EXCEPTION 'WEIGHTS_SHAPE_LOCKED: baris % sudah punya klaim progres terverifikasi', NEW.boq_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boq_stage_weights_shape_lock_trg ON boq_stage_weights;
CREATE TRIGGER boq_stage_weights_shape_lock_trg
  BEFORE UPDATE OF weights ON boq_stage_weights
  FOR EACH ROW EXECUTE FUNCTION boq_stage_weights_shape_lock();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Read policies (no write policy: the RPCs below are the only writers)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE progress_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_claim_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS progress_claims_select ON progress_claims;
CREATE POLICY progress_claims_select ON progress_claims
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS progress_claim_lines_select ON progress_claim_lines;
CREATE POLICY progress_claim_lines_select ON progress_claim_lines
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 4b. Read views, one row per BoQ item
-- ───────────────────────────────────────────────────────────────────────────

-- security_invoker = on, or a view reads with its owner's rights and skips the
-- caller's RLS (061's lesson).
CREATE OR REPLACE VIEW progress_claim_latest_verified WITH (security_invoker = on) AS
SELECT DISTINCT ON (l.boq_item_id)
  l.project_id, l.boq_item_id, l.verified_pct, c.verified_at
FROM progress_claim_lines l
JOIN progress_claims c ON c.id = l.claim_id
WHERE c.status = 'VERIFIED' AND l.verified_pct IS NOT NULL
ORDER BY l.boq_item_id, c.verified_at DESC, l.updated_at DESC;

CREATE OR REPLACE VIEW progress_entry_totals WITH (security_invoker = on) AS
SELECT project_id, boq_item_id, sum(quantity) AS installed_total, count(*) AS entry_count
FROM progress_entries
GROUP BY project_id, boq_item_id;

REVOKE ALL ON progress_claim_latest_verified, progress_entry_totals FROM PUBLIC, anon;
GRANT SELECT ON progress_claim_latest_verified, progress_entry_totals TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Progress has one writer: verify_progress_claim
-- ───────────────────────────────────────────────────────────────────────────

-- Supervisors: no direct insert into progress_entries or progress_photos (002)
-- and no direct update of boq_items.installed or progress (059).
DROP POLICY IF EXISTS "progress_entries_assigned_insert" ON progress_entries;
DROP POLICY IF EXISTS "progress_photos_assigned_insert" ON progress_photos;
DROP POLICY IF EXISTS "boq_items_assigned_progress_update" ON boq_items;

-- Office roles: 036 gave them FOR ALL on both tables; they only read them.
DROP POLICY IF EXISTS progress_entries_office_all ON progress_entries;
DROP POLICY IF EXISTS progress_entries_office_read ON progress_entries;
CREATE POLICY progress_entries_office_read ON progress_entries
  FOR SELECT TO authenticated
  USING (is_office_role());

DROP POLICY IF EXISTS progress_photos_office_all ON progress_photos;
DROP POLICY IF EXISTS progress_photos_office_read ON progress_photos;
CREATE POLICY progress_photos_office_read ON progress_photos
  FOR SELECT TO authenticated
  USING (is_office_role());

-- 002's sync_boq_progress() rewrote installed and progress from the entries
-- for any caller, rounding progress to whole percents.
DO $$
BEGIN
  IF to_regprocedure('public.sync_boq_progress(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sync_boq_progress(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Office roles still edit boq_items (publishing writes label, planned,
-- superseded_at and more), so the last door is a trigger: installed and
-- progress change only inside verify_progress_claim, which sets
-- sano.progress_writer = 'verify' for its own transaction. PostgREST gives a
-- client no way to set that setting. A session without a JWT (the Dashboard
-- SQL editor, the service role) stays trusted, the same exception 059 makes.
CREATE OR REPLACE FUNCTION boq_items_progress_single_writer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('sano.progress_writer', true) IS NOT DISTINCT FROM 'verify' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.installed, 0) <> 0 OR COALESCE(NEW.progress, 0) <> 0 THEN
      RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER: baris BoQ baru dimulai dari progres 0';
    END IF;
  ELSIF NEW.installed IS DISTINCT FROM OLD.installed OR NEW.progress IS DISTINCT FROM OLD.progress THEN
    RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER: progres baris % hanya berubah lewat verifikasi klaim progres', OLD.code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boq_items_progress_single_writer_trg ON boq_items;
CREATE TRIGGER boq_items_progress_single_writer_trg
  BEFORE INSERT OR UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION boq_items_progress_single_writer();

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.progress_entries'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%quantity%'
  LOOP
    EXECUTE format('ALTER TABLE public.progress_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.progress_entries
    ADD CONSTRAINT progress_entries_quantity_nonzero CHECK (quantity <> 0);
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. notifications.type: 098's thirteen plus the three claim types
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE',
      'RETURNED',
      'SITE_EVENT_ASSIGNED',
      'PROGRESS_CLAIM_SUBMITTED',
      'PROGRESS_CLAIM_RETURNED',
      'PROGRESS_CLAIM_VERIFIED'
    ));
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. The claim RPCs
-- ───────────────────────────────────────────────────────────────────────────

-- Saves the caller's percent per stage for one row into the project's claim in
-- progress, opening a DRAFT for this WIB week when there is none. Saving the
-- same row again edits the same line; p_photo_refs replaces the line's photos.
CREATE OR REPLACE FUNCTION save_progress_claim_line(
  p_project_id     UUID,
  p_boq_item_id    UUID,
  p_claimed_pct    JSONB,
  p_note           TEXT DEFAULT NULL,
  p_photo_refs     JSONB DEFAULT '[]'::jsonb,
  p_regress_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_item    boq_items%ROWTYPE;
  v_weights JSONB;
  v_claim   progress_claims%ROWTYPE;
  v_line    progress_claim_lines%ROWTYPE;
  v_prev    JSONB;
  v_pct     JSONB;
  v_refs    JSONB := COALESCE(p_photo_refs, '[]'::jsonb);
  v_reason  TEXT := NULLIF(btrim(COALESCE(p_regress_reason, '')), '');
  v_week    DATE := date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);

  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND OR v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % bukan baris aktif proyek ini', p_boq_item_id;
  END IF;
  IF COALESCE(v_item.planned, 0) <= 0 THEN
    RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_item.code;
  END IF;

  SELECT weights INTO v_weights FROM boq_stage_weights WHERE boq_item_id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_item.code;
  END IF;
  IF NOT stage_pct_valid(v_weights, p_claimed_pct) THEN
    RAISE EXCEPTION 'CLAIM_PCT: persentase % tidak cocok dengan bobot %', COALESCE(p_claimed_pct::text, 'null'), v_weights;
  END IF;
  v_pct := stage_pct_round(p_claimed_pct);

  -- Photos are storage paths the app uploaded for this project
  -- (pickAndUploadPhoto('progress/<project id>') in tools/storage.ts), at most 12.
  IF jsonb_typeof(v_refs) <> 'array' THEN
    RAISE EXCEPTION 'CLAIM_EVIDENCE: lampiran foto harus berupa array';
  END IF;
  IF jsonb_array_length(v_refs) > 12 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_refs) AS r
       WHERE jsonb_typeof(r) <> 'string'
          OR NOT starts_with(r #>> '{}', 'progress/' || p_project_id::text || '/')
          OR position('..' IN r #>> '{}') > 0
     ) THEN
    RAISE EXCEPTION 'CLAIM_EVIDENCE: lampiran foto tidak valid';
  END IF;

  SELECT * INTO v_claim FROM progress_claims
  WHERE project_id = p_project_id AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO progress_claims (project_id, week_start, status, created_by)
    VALUES (p_project_id, v_week, 'DRAFT', v_uid)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_claim;
    IF v_claim.id IS NULL THEN
      -- A concurrent save opened the claim first; use that one.
      SELECT * INTO v_claim FROM progress_claims
      WHERE project_id = p_project_id AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')
      FOR UPDATE;
    END IF;
  END IF;
  IF v_claim.status = 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_LOCKED: klaim % sedang menunggu verifikasi', v_claim.id;
  END IF;

  v_prev := COALESCE(latest_verified_stage_pct(p_boq_item_id), zero_stage_pct(v_weights));
  IF v_reason IS NULL AND EXISTS (
       SELECT 1 FROM jsonb_each(v_prev) AS e(k, v)
       WHERE (v #>> '{}')::numeric > COALESCE((v_pct ->> k)::numeric, 0)
     ) THEN
    RAISE EXCEPTION 'CLAIM_REGRESS_REASON: baris % turun dari progres terverifikasi', v_item.code;
  END IF;

  INSERT INTO progress_claim_lines AS l
    (claim_id, project_id, boq_item_id, prev_verified, claimed_pct, note, regress_reason, evidence, created_by, updated_by)
  VALUES
    (v_claim.id, p_project_id, p_boq_item_id, v_prev, v_pct,
     NULLIF(btrim(COALESCE(p_note, '')), ''), v_reason,
     jsonb_build_object('photo_refs', v_refs, 'report_line_ids', '[]'::jsonb), v_uid, v_uid)
  ON CONFLICT (claim_id, boq_item_id) DO UPDATE
    SET prev_verified  = EXCLUDED.prev_verified,
        claimed_pct    = EXCLUDED.claimed_pct,
        note           = EXCLUDED.note,
        regress_reason = EXCLUDED.regress_reason,
        evidence       = jsonb_set(l.evidence, '{photo_refs}', EXCLUDED.evidence -> 'photo_refs'),
        updated_by     = EXCLUDED.updated_by,
        updated_at     = now()
  RETURNING * INTO v_line;

  UPDATE progress_claims SET updated_at = now() WHERE id = v_claim.id;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'claim_status', v_claim.status,
    'week_start', v_claim.week_start,
    'line_id', v_line.id,
    'prev_verified', v_line.prev_verified,
    'claimed_pct', v_line.claimed_pct,
    'row_fraction_prev', stage_row_fraction(v_weights, v_line.prev_verified),
    'row_fraction_claimed', stage_row_fraction(v_weights, v_line.claimed_pct)
  );
END;
$$;

CREATE OR REPLACE FUNCTION remove_progress_claim_line(p_line_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line  progress_claim_lines%ROWTYPE;
  v_claim progress_claims%ROWTYPE;
  v_left  INTEGER;
BEGIN
  SELECT * INTO v_line FROM progress_claim_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: baris klaim % tidak ditemukan', p_line_id;
  END IF;
  SELECT * INTO v_claim FROM progress_claims WHERE id = v_line.claim_id FOR UPDATE;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['supervisor', 'estimator', 'admin']);
  IF v_claim.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;

  DELETE FROM progress_claim_lines WHERE id = p_line_id;
  SELECT count(*) INTO v_left FROM progress_claim_lines WHERE claim_id = v_claim.id;
  UPDATE progress_claims SET updated_at = now() WHERE id = v_claim.id;

  RETURN jsonb_build_object('claim_id', v_claim.id, 'lines_left', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION submit_progress_claim(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_claim    progress_claims%ROWTYPE;
  v_row      RECORD;
  v_lines    INTEGER;
  v_project  TEXT;
  v_target   TEXT;
  v_notified INTEGER := 0;
  v_verifiers INTEGER := 0;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['supervisor', 'estimator', 'admin']);
  IF v_claim.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;

  SELECT count(*) INTO v_lines FROM progress_claim_lines WHERE claim_id = p_claim_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'CLAIM_EMPTY: klaim % belum berisi baris', p_claim_id;
  END IF;

  -- Every line again, against the rows and weights as they are now.
  FOR v_row IN
    SELECT l.claimed_pct, b.code, b.planned, b.superseded_at, b.project_id AS row_project, w.weights
    FROM progress_claim_lines l
    JOIN boq_items b ON b.id = l.boq_item_id
    LEFT JOIN boq_stage_weights w ON w.boq_item_id = l.boq_item_id
    WHERE l.claim_id = p_claim_id
    ORDER BY l.created_at, l.id
  LOOP
    IF v_row.superseded_at IS NOT NULL OR v_row.row_project <> v_claim.project_id THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_row.code;
    END IF;
    IF COALESCE(v_row.planned, 0) <= 0 THEN
      RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_row.code;
    END IF;
    IF v_row.weights IS NULL THEN
      RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_row.code;
    END IF;
    IF NOT stage_pct_valid(v_row.weights, v_row.claimed_pct) THEN
      RAISE EXCEPTION 'CLAIM_PCT: persentase baris % tidak cocok dengan bobotnya', v_row.code;
    END IF;
  END LOOP;

  UPDATE progress_claims
  SET status = 'SUBMITTED', submitted_by = v_uid, submitted_at = now(), updated_at = now()
  WHERE id = p_claim_id;

  SELECT name INTO v_project FROM projects WHERE id = v_claim.project_id;
  v_target := CASE WHEN EXISTS (
      SELECT 1 FROM project_assignments pa JOIN profiles p ON p.id = pa.user_id
      WHERE pa.project_id = v_claim.project_id AND p.role = 'estimator' AND pa.user_id <> v_uid
    ) THEN 'estimator' ELSE 'admin' END;

  BEGIN
    PERFORM enqueue_notification(
      v_claim.project_id,
      'PROGRESS_CLAIM_SUBMITTED',
      'Klaim progres menunggu verifikasi',
      format('%s: %s baris, minggu %s', COALESCE(v_project, 'Proyek'), v_lines, to_char(v_claim.week_start, 'DD/MM/YYYY')),
      'ProgressClaimVerify',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim'),
      p_claim_id,
      v_uid,     -- p_exclude_user_id: the submitter is never told about their own claim
      v_target   -- p_target_role (066): estimators, or admins when the project has none
    );
    SELECT count(*) INTO v_verifiers FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_SUBMITTED' AND n.created_at >= now();
    -- Nobody assigned can verify. Notifications are readable only by project
    -- members (092), so an unassigned estimator would never see one; tell the
    -- principals instead (093 makes them members of every project), who can
    -- assign an estimator.
    IF v_verifiers = 0 THEN
      PERFORM enqueue_notification(
        v_claim.project_id,
        'PROGRESS_CLAIM_SUBMITTED',
        'Klaim progres belum punya verifikator',
        format('%s: belum ada estimator atau admin di proyek ini untuk memverifikasi klaim minggu %s. Tugaskan estimator.', COALESCE(v_project, 'Proyek'), to_char(v_claim.week_start, 'DD/MM/YYYY')),
        'ProgressClaimVerify',
        jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim'),
        p_claim_id,
        v_uid,
        'principal'
      );
    END IF;
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_SUBMITTED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'submit_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'claim_id', p_claim_id, 'status', 'SUBMITTED', 'lines', v_lines,
    'notified', v_notified, 'verifiers_notified', v_verifiers
  );
END;
$$;

CREATE OR REPLACE FUNCTION return_progress_claim(p_claim_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_claim    progress_claims%ROWTYPE;
  v_note     TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_notified INTEGER := 0;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['estimator', 'admin']);
  IF v_claim.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'CLAIM_RETURN_NOTE: alasan pengembalian wajib diisi';
  END IF;

  UPDATE progress_claims
  SET status = 'RETURNED', returned_by = v_uid, returned_at = now(), return_note = v_note, updated_at = now()
  WHERE id = p_claim_id;

  BEGIN
    PERFORM enqueue_notification_user(
      v_claim.project_id,
      v_claim.submitted_by,
      'PROGRESS_CLAIM_RETURNED',
      'Klaim progres dikembalikan',
      v_note,
      'ProgressClaim',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim'),
      p_claim_id,
      ARRAY[v_uid],
      NULL
    );
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_RETURNED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'return_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('claim_id', p_claim_id, 'status', 'RETURNED', 'notified', v_notified);
END;
$$;

-- p_lines: [{"line_id": "<uuid>", "verified_pct": {...}, "regress_reason": "..."}]
-- covering every line of the claim exactly once.
CREATE OR REPLACE FUNCTION verify_progress_claim(p_claim_id UUID, p_lines JSONB, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_claim     progress_claims%ROWTYPE;
  v_line      progress_claim_lines%ROWTYPE;
  v_item      boq_items%ROWTYPE;
  v_input     JSONB;
  v_weights   JSONB;
  v_pct       JSONB;
  v_prev      JSONB;
  v_reason    TEXT;
  v_regressed BOOLEAN;
  v_frac_prev NUMERIC;
  v_frac_new  NUMERIC;
  v_before    NUMERIC;
  v_after     NUMERIC;
  v_delta     NUMERIC;
  v_entry_id  UUID;
  v_week      TEXT;
  v_lines     INTEGER;
  v_entries   INTEGER := 0;
  v_regress   INTEGER := 0;
  v_notified  INTEGER := 0;
  v_needs_reason  BOOLEAN;
  v_cached_before NUMERIC;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['estimator', 'admin']);
  IF v_claim.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;
  IF v_claim.submitted_by = v_uid OR EXISTS (
       SELECT 1 FROM progress_claim_lines l
       WHERE l.claim_id = p_claim_id AND (l.created_by = v_uid OR l.updated_by = v_uid)
     ) THEN
    RAISE EXCEPTION 'CLAIM_SELF_VERIFY: klaim ini berisi angka yang Anda kirim atau isi sendiri';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'CLAIM_LINES: daftar baris harus berupa array';
  END IF;
  SELECT count(*) INTO v_lines FROM progress_claim_lines WHERE claim_id = p_claim_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'CLAIM_EMPTY: klaim % belum berisi baris', p_claim_id;
  END IF;
  IF jsonb_array_length(p_lines) <> v_lines
     OR (SELECT count(DISTINCT e ->> 'line_id') FROM jsonb_array_elements(p_lines) AS e) <> v_lines
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) AS e
       WHERE NOT EXISTS (SELECT 1 FROM progress_claim_lines l WHERE l.claim_id = p_claim_id AND l.id::text = e ->> 'line_id')
     ) THEN
    RAISE EXCEPTION 'CLAIM_LINES: daftar baris tidak cocok dengan klaim %', p_claim_id;
  END IF;

  v_week := to_char(v_claim.week_start, 'DD/MM/YYYY');

  -- Unlocks boq_items_progress_single_writer for this transaction only.
  PERFORM set_config('sano.progress_writer', 'verify', true);

  FOR v_line IN SELECT * FROM progress_claim_lines WHERE claim_id = p_claim_id ORDER BY created_at, id LOOP
    SELECT e INTO v_input FROM jsonb_array_elements(p_lines) AS e WHERE e ->> 'line_id' = v_line.id::text;

    SELECT * INTO v_item FROM boq_items WHERE id = v_line.boq_item_id FOR UPDATE;
    IF NOT FOUND OR v_item.project_id <> v_claim.project_id OR v_item.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', COALESCE(v_item.code, v_line.boq_item_id::text);
    END IF;
    IF COALESCE(v_item.planned, 0) <= 0 THEN
      RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_item.code;
    END IF;
    SELECT weights INTO v_weights FROM boq_stage_weights WHERE boq_item_id = v_item.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_item.code;
    END IF;
    IF NOT stage_pct_valid(v_weights, v_input -> 'verified_pct') THEN
      RAISE EXCEPTION 'CLAIM_PCT: persentase verifikasi baris % tidak cocok dengan bobotnya', v_item.code;
    END IF;
    v_pct := stage_pct_round(v_input -> 'verified_pct');

    v_prev := COALESCE(latest_verified_stage_pct(v_item.id), zero_stage_pct(v_weights));
    v_regressed := EXISTS (
      SELECT 1 FROM jsonb_each(v_prev) AS e(k, v)
      WHERE (v #>> '{}')::numeric > COALESCE((v_pct ->> k)::numeric, 0)
    );

    v_frac_prev := stage_row_fraction(v_weights, v_prev);
    v_frac_new  := stage_row_fraction(v_weights, v_pct);
    SELECT COALESCE(sum(quantity), 0) INTO v_before FROM progress_entries WHERE boq_item_id = v_item.id;
    v_cached_before := v_item.installed;
    v_after := round(v_item.planned * v_frac_new, 4);
    v_delta := v_after - v_before;
    v_entry_id := NULL;

    -- A lower figure needs a reason, whether a stage percent dropped or the
    -- quantity fell because the weights or the planned volume changed since
    -- the last verification.
    v_needs_reason := v_regressed OR v_delta < 0;
    v_reason := COALESCE(NULLIF(btrim(COALESCE(v_input ->> 'regress_reason', '')), ''), v_line.regress_reason);
    IF v_needs_reason AND v_reason IS NULL THEN
      RAISE EXCEPTION 'CLAIM_REGRESS_REASON: baris % turun dari progres terverifikasi', v_item.code;
    END IF;

    -- installed set outside the entries (legacy data): the entries win, and
    -- the difference is logged so it is never overwritten silently.
    IF abs(COALESCE(v_cached_before, 0) - v_before) > 0.0001 THEN
      INSERT INTO activity_log (project_id, user_id, type, label, flag)
      VALUES (
        v_claim.project_id, v_uid, 'progres',
        format('%s: terpasang tercatat %s berbeda dari riwayat progres %s; verifikasi mengikuti riwayat',
               v_item.code, trim_scale(COALESCE(v_cached_before, 0)), trim_scale(v_before)),
        'WARNING'
      );
    END IF;

    IF v_delta <> 0 THEN
      INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status, note)
      VALUES (
        v_claim.project_id, v_item.id, v_claim.submitted_by, v_delta, v_item.unit,
        CASE WHEN v_frac_new >= 1 THEN 'COMPLETE' ELSE 'IN_PROGRESS' END,
        CASE WHEN v_delta < 0
          THEN format('Koreksi klaim progres minggu %s: %s', v_week, COALESCE(v_reason, '-'))
          ELSE format('Klaim progres minggu %s, diverifikasi', v_week)
        END
      )
      RETURNING id INTO v_entry_id;
      v_entries := v_entries + 1;

      IF v_delta > 0 THEN
        INSERT INTO progress_photos (progress_entry_id, storage_path)
        SELECT v_entry_id, ref
        FROM jsonb_array_elements_text(COALESCE(v_line.evidence -> 'photo_refs', '[]'::jsonb)) AS ref;
      END IF;

      INSERT INTO activity_log (project_id, user_id, type, label, flag)
      VALUES (
        v_claim.project_id, v_uid, 'progres',
        format('%s: progres %s%% menjadi %s%% (klaim diverifikasi)', v_item.code, round(v_frac_prev * 100, 1), round(v_frac_new * 100, 1)),
        CASE WHEN v_delta < 0 THEN 'WARNING' ELSE 'OK' END
      );
    END IF;
    IF v_needs_reason THEN
      v_regress := v_regress + 1;
    END IF;

    UPDATE boq_items SET installed = v_after, progress = round(v_frac_new * 100, 1) WHERE id = v_item.id;

    UPDATE progress_claim_lines
    SET verified_pct      = v_pct,
        weights_snapshot  = v_weights,
        prev_verified     = v_prev,
        row_pct_prev      = v_frac_prev,
        row_pct_new       = v_frac_new,
        installed_before  = v_before,
        installed_cached_before = v_cached_before,
        delta_quantity    = v_delta,
        regress_reason    = v_reason,
        progress_entry_id = v_entry_id,
        updated_by        = v_uid,
        updated_at        = now()
    WHERE id = v_line.id;
  END LOOP;
  PERFORM set_config('sano.progress_writer', '', true);

  UPDATE progress_claims
  SET status = 'VERIFIED', verified_by = v_uid, verified_at = now(),
      verifier_note = NULLIF(btrim(COALESCE(p_note, '')), ''), updated_at = now()
  WHERE id = p_claim_id;

  BEGIN
    PERFORM enqueue_notification_user(
      v_claim.project_id,
      v_claim.submitted_by,
      'PROGRESS_CLAIM_VERIFIED',
      'Klaim progres diverifikasi',
      format('%s baris, minggu %s', v_lines, v_week),
      'ProgressClaim',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim'),
      p_claim_id,
      ARRAY[v_uid],
      NULL
    );
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_VERIFIED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verify_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'claim_id', p_claim_id, 'status', 'VERIFIED', 'lines', v_lines,
    'entries', v_entries, 'regressions', v_regress, 'notified', v_notified
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Privileges: anon reaches nothing; internal helpers stay internal
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION stage_pct_valid(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_pct_valid(JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION stage_pct_round(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_pct_round(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION stage_row_fraction(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_row_fraction(JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION zero_stage_pct(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION zero_stage_pct(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION latest_verified_stage_pct(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION latest_verified_stage_pct(UUID) TO service_role;

REVOKE ALL ON FUNCTION boq_stage_weights_shape_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION boq_items_progress_single_writer() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION remove_progress_claim_line(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION remove_progress_claim_line(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION submit_progress_claim(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_progress_claim(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION return_progress_claim(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION return_progress_claim(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION verify_progress_claim(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION verify_progress_claim(UUID, JSONB, TEXT) TO authenticated, service_role;

RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing)
--
-- 1. Tables, the one-open-claim index and the line uniqueness landed:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename IN ('progress_claims', 'progress_claim_lines') ORDER BY 1;
--    EXPECTED: seven rows: idx_progress_claim_lines_project,
--    idx_progress_claim_lines_row, idx_progress_claims_project_week,
--    progress_claim_lines_claim_row, progress_claim_lines_pkey,
--    progress_claims_one_open, progress_claims_pkey.
--
-- 2. The claim tables are read-only to the app, and the views apply the
--    caller's RLS:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('progress_claims', 'progress_claim_lines');
--    EXPECTED: two rows, both SELECT.
--      SELECT relname, reloptions FROM pg_class
--      WHERE relname IN ('progress_claim_latest_verified', 'progress_entry_totals') ORDER BY 1;
--    EXPECTED: two rows, each with {security_invoker=on}.
--
-- 3. Progress has one writer:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('progress_entries', 'progress_photos') ORDER BY 1, 2;
--    EXPECTED: SELECT rows only. An INSERT or ALL row means 002 or 036 was
--    re-pasted: re-paste 104.
--      SELECT count(*) FROM pg_policies WHERE policyname = 'boq_items_assigned_progress_update';
--    EXPECTED: 0. A 1 means 059 was re-pasted: re-paste 104.
--      SELECT has_function_privilege('authenticated', 'sync_boq_progress(uuid)', 'EXECUTE'),
--             (SELECT count(*) FROM pg_trigger WHERE tgname = 'boq_items_progress_single_writer_trg');
--    EXPECTED: f, 1.
--
-- 4. The type list is 098's thirteen plus three:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
--    EXPECTED: 16 quoted types, PROGRESS_CLAIM_SUBMITTED, PROGRESS_CLAIM_RETURNED,
--    PROGRESS_CLAIM_VERIFIED and SITE_EVENT_ASSIGNED among them.
--
-- 5. A correction entry may be negative, never zero:
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.progress_entries'::regclass AND contype = 'c';
--    EXPECTED: the work_status check and progress_entries_quantity_nonzero,
--    CHECK ((quantity <> (0)::numeric)).
--
-- 6. The row math matches tools/progressClaims/stageMath.ts:
--      SELECT stage_row_fraction('{"BEKISTING": 0.368, "PEMBESIAN": 0.38, "PENGECORAN": 0.252}',
--                                '{"BEKISTING": 100, "PEMBESIAN": 50, "PENGECORAN": 0}');
--    EXPECTED: 0.558000.
--
-- 7. A supervisor cannot verify (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_SUPERVISOR_UUID>","role":"authenticated"}', true);
--        SELECT verify_progress_claim('<ANY_CLAIM_UUID_OF_THEIR_PROJECT>', '[]');
--      ROLLBACK;
--    EXPECTED: ERROR starting CLAIM_ROLE.
--
-- 8. An office role cannot set installed outside verification (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<AN_ESTIMATOR_UUID>","role":"authenticated"}', true);
--        UPDATE boq_items SET installed = installed + 1 WHERE id = '<ANY_BOQ_ROW_UUID>';
--      ROLLBACK;
--    EXPECTED: ERROR starting PROGRESS_SINGLE_WRITER.
--
-- 9. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-6 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname IN ('stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct',
                  'latest_verified_stage_pct', 'save_progress_claim_line', 'remove_progress_claim_line',
                  'submit_progress_claim', 'return_progress_claim', 'verify_progress_claim',
                  'boq_items_progress_single_writer')
ORDER BY proname;
