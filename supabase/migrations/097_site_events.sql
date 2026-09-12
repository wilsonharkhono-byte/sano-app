-- ═══════════════════════════════════════════════════════════════════════════
-- 097 - Site events: capture, AI draft, human confirm, room board, private media.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §1.1, §4.2
-- Plan: docs/superpowers/plans/2026-09-10-site-event-capture-ai.md (task 4)
--
-- WHY. A photo filed against a BoQ row carries no place, no owner, no due date
-- and no closure. site_events anchors every field observation to a room, lets
-- an edge function turn photos plus Indonesian speech into a DRAFT, and makes a
-- human confirm step the only writer of anything a PM will act on.
--
-- PASTE ORDER. 096 → 097 (this file) → 098. 096 (rooms, gate_refs,
-- gate_step_refs) must already be pasted: site_events references all three.
-- site_events_step_in_gate references gate_step_refs (gate_code, code), which
-- needs 096's gate_step_refs_gate_code_code_key. A 096 pasted before that
-- constraint existed stops this file with "there is no unique constraint
-- matching given keys for referenced table"; re-paste the current 096 first.
-- 098 adds the SITE_EVENT_ASSIGNED notification type; until 098 lands, confirm
-- still works but its notification is refused by the type CHECK, caught, and
-- reported as notified = false.
--
-- RE-PASTE SAFETY. Pasted by hand into the Dashboard SQL editor (remote history
-- is divergent, `supabase db push` is broken), so it must survive a second paste:
-- CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE for functions (plus
-- DROP FUNCTION IF EXISTS on the two RPCs, 092's pattern, so the day a
-- signature changes the old overload cannot survive carrying its GRANT), DROP
-- VIEW IF EXISTS before the view (CREATE OR REPLACE VIEW alone would refuse a
-- future column-list change), DROP TRIGGER IF EXISTS and DROP POLICY IF EXISTS
-- before each create, and ON CONFLICT DO UPDATE for the bucket row (this
-- migration owns that row's public/mime-type settings, so a re-paste always
-- restores them rather than preserving a Dashboard edit). Table CHECKs and the
-- composite step key are inline, so a later change to one needs its own
-- guarded ALTER; a re-paste of this file does not rewrite them. SET/RESET
-- lock_timeout (096's pattern) bracket every statement above, so a paste stuck
-- behind a lock fails after 5 s instead of hanging.
--
-- THE TRUTH CONTRACT, AS DATABASE RULES (spec §1.1).
--   1. AI columns (transcript, ai_draft, ai_confidence, ai_model, ai_mismatch)
--      and the pipeline bookkeeping (last_error, analysis_attempts) are written
--      by the service role only. The guard runs on INSERT as well as UPDATE:
--      members may insert events, and an insert policy alone would let a client
--      arrive with ai_draft already filled in.
--   2. Human fields (type, gate, step, title, summary, owner, due date, blocking,
--      VO flag, related event, confirmation and closure stamps) change only
--      inside confirm_site_event and close_site_event. Those run as the function
--      owner, so a trigger can tell them apart from a direct PostgREST write
--      (current_user is 'authenticated' there). A direct write may only correct
--      the transcript before confirmation, or discard a draft.
--   3. Nothing is deleted. There is no delete policy on events, media, runs or
--      media objects; "Buang" sets status = 'discarded' and keeps every file.
--   4. An open isu / hambatan / cacat / butuh_keputusan always has an owner and
--      a due date. A confirmed VO always has a Catatan Perubahan row behind it,
--      and that row cannot be deleted while it does (foreign key, no cascade).
--
-- WHY A NEW BUCKET. Spec §4.2 allowed the existing photos bucket only if it
-- provably accepts audio and is private. No migration in this repo creates the
-- photos bucket (only 006 creates a bucket, project-files), so neither property
-- can be proven, and tools/storage.ts falls back to a public URL for it. Site
-- media therefore lives in a new PRIVATE bucket, site-media, reached only through
-- signed URLs, with per-project path policies in the 006 style. If the bucket
-- insert below is refused on your project, create it in Dashboard → Storage with
-- exactly these settings and re-run the file.
--
-- OBJECT PATHS. site-media/site-events/{projectId}/{eventId}/{mediaId}.{ext}.
-- Catatan Perubahan rows created by confirm store them as 'site-media:<path>',
-- which tools/storage.ts resolves against this bucket.
-- ═══════════════════════════════════════════════════════════════════════════

-- A stalled transaction on storage.buckets, or on a table a concurrent
-- confirm_site_event call has locked, makes this paste fail and roll back
-- after 5 s instead of queueing app reads behind it; re-paste later.
SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 050 / 051 / 096 pattern)
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
-- 1. site_events
--    id has no default on purpose: the phone generates it, so a retried insert
--    after a lost response is a no-op (ON CONFLICT DO NOTHING), never a twin.
--    room_id is NOT NULL on purpose: an event without a place is exactly what
--    this feature exists to remove. Rooms are retired with active = false,
--    never deleted, so the plain foreign key is safe; a project delete still
--    cascades because rooms and events go in the same statement.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_events (
  id                 UUID PRIMARY KEY,
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_id            UUID NOT NULL REFERENCES rooms(id),
  reporter_id        UUID NOT NULL REFERENCES profiles(id),
  status             TEXT NOT NULL DEFAULT 'pending_analysis'
                     CHECK (status IN ('pending_analysis', 'draft', 'open', 'done', 'discarded')),
  event_type         TEXT
                     CHECK (event_type IS NULL OR event_type IN ('progres', 'isu', 'hambatan', 'cacat', 'butuh_keputusan', 'info')),
  gate_code          TEXT REFERENCES gate_refs(code),
  step_code          TEXT,
  title              TEXT CHECK (title IS NULL OR char_length(title) <= 80),
  summary            TEXT CHECK (summary IS NULL OR char_length(summary) <= 300),
  raw_text           TEXT,
  transcript         TEXT,
  transcript_edited  TEXT,
  ai_draft           JSONB,
  ai_confidence      TEXT CHECK (ai_confidence IS NULL OR ai_confidence IN ('high', 'medium', 'low')),
  ai_mismatch        BOOLEAN NOT NULL DEFAULT false,
  ai_model           TEXT,
  ai_used            BOOLEAN NOT NULL DEFAULT true,
  owner_id           UUID REFERENCES profiles(id),
  due_date           DATE,
  downstream_impact  TEXT,
  is_blocking        BOOLEAN NOT NULL DEFAULT false,
  vo_flag            TEXT NOT NULL DEFAULT 'none'
                     CHECK (vo_flag IN ('none', 'suggested', 'confirmed', 'rejected')),
  site_change_id     UUID REFERENCES site_changes(id),
  related_event_id   UUID REFERENCES site_events(id),
  captured_at        TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  closed_by          UUID REFERENCES profiles(id),
  closure_note       TEXT,
  last_error         TEXT,
  analysis_attempts  INT NOT NULL DEFAULT 0,
  -- A step is only ever named through its gate. The default MATCH SIMPLE skips
  -- the composite key when step_code is NULL, so an event with a gate and no
  -- step (or with neither) passes; the CHECK closes the one hole that leaves, a
  -- step with no gate. 096 provides the UNIQUE (gate_code, code) target and
  -- locks a step's gate_code, so a pair accepted here stays true.
  CONSTRAINT site_events_step_needs_gate CHECK (step_code IS NULL OR gate_code IS NOT NULL),
  CONSTRAINT site_events_step_in_gate FOREIGN KEY (gate_code, step_code)
    REFERENCES gate_step_refs (gate_code, code)
);

COMMENT ON COLUMN site_events.transcript IS
  'Stage 1 output (gpt-4o-mini-transcribe, language id). Service role only.';
COMMENT ON COLUMN site_events.transcript_edited IS
  'The supervisor''s correction. Wins over transcript on re-analysis and in quote matching.';
COMMENT ON COLUMN site_events.ai_draft IS
  'Validated draft plus the validator''s drop reasons. Service role only. Never shown to a client report.';
COMMENT ON COLUMN site_events.ai_used IS
  'False when the event was confirmed with no ai_draft, i.e. authored by hand.';
COMMENT ON COLUMN site_events.vo_flag IS
  'rejected only when the model suggested a VO and a human declined it.';

CREATE INDEX IF NOT EXISTS idx_site_events_project_room_status
  ON site_events(project_id, room_id, status);
CREATE INDEX IF NOT EXISTS idx_site_events_project_due_open
  ON site_events(project_id, due_date) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_site_events_owner_open
  ON site_events(owner_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_site_events_room_confirmed
  ON site_events(room_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_reporter_status
  ON site_events(reporter_id, status);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. site_event_media - evidence rows, immutable once written
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_event_media (
  id            UUID PRIMARY KEY,
  event_id      UUID NOT NULL REFERENCES site_events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo', 'audio', 'video')),
  role          TEXT NOT NULL CHECK (role IN ('context', 'closeup', 'closure', 'audio')),
  storage_path  TEXT NOT NULL,
  mime_type     TEXT,
  duration_s    NUMERIC,
  bytes         BIGINT,
  sort_order    INT NOT NULL DEFAULT 0,
  captured_at   TIMESTAMPTZ,
  CHECK ((kind = 'audio') = (role = 'audio'))
);

CREATE INDEX IF NOT EXISTS idx_site_event_media_event
  ON site_event_media(event_id, sort_order);

-- A media row may only point inside its own event's folder. Without this a
-- member could attach another project's object and the service-role analysis
-- would read it.
CREATE OR REPLACE FUNCTION site_event_media_path_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_prefix     TEXT;
BEGIN
  SELECT project_id INTO v_project_id FROM site_events WHERE id = NEW.event_id;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'SITE_EVENT_MEDIA_PATH: kejadian % tidak ditemukan untuk media ini', NEW.event_id;
  END IF;
  v_prefix := 'site-events/' || v_project_id::text || '/' || NEW.event_id::text || '/';
  IF left(NEW.storage_path, char_length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'SITE_EVENT_MEDIA_PATH: path media harus diawali %', v_prefix;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_event_media_path_guard_trg ON site_event_media;
CREATE TRIGGER site_event_media_path_guard_trg
  BEFORE INSERT OR UPDATE ON site_event_media
  FOR EACH ROW EXECUTE FUNCTION site_event_media_path_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. site_event_ai_runs - one audit row per stage per call (029 ai_draft_runs shape)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_event_ai_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES site_events(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL CHECK (stage IN ('transcribe', 'analyze')),
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
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN site_event_ai_runs.input_summary IS
  'Counts and sizes only (photo count, transcript length, gate list size). Never the media itself.';
COMMENT ON COLUMN site_event_ai_runs.output IS
  'Raw model output BEFORE validation, so a rejected draft can be diagnosed.';

CREATE INDEX IF NOT EXISTS idx_site_event_ai_runs_event
  ON site_event_ai_runs(event_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_event_ai_runs_created
  ON site_event_ai_runs(created_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Guards on site_events
-- ───────────────────────────────────────────────────────────────────────────

-- 4a. Rule 1: AI and bookkeeping columns belong to the edge function.
CREATE OR REPLACE FUNCTION site_events_ai_columns_service_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- The edge function writes with the service role. The two SECURITY DEFINER
  -- RPCs below run as the function owner and never touch these columns (the
  -- static test pins that), and the Dashboard runs as postgres.
  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.transcript IS NOT NULL
       OR NEW.ai_draft IS NOT NULL
       OR NEW.ai_confidence IS NOT NULL
       OR NEW.ai_model IS NOT NULL
       OR NEW.ai_mismatch IS DISTINCT FROM FALSE
       OR NEW.last_error IS NOT NULL
       OR NEW.analysis_attempts IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'SITE_EVENT_AI_COLUMNS: kolom hasil AI hanya boleh diisi oleh fungsi analisis'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.ai_draft IS DISTINCT FROM OLD.ai_draft
     OR NEW.transcript IS DISTINCT FROM OLD.transcript
     OR NEW.ai_confidence IS DISTINCT FROM OLD.ai_confidence
     OR NEW.ai_model IS DISTINCT FROM OLD.ai_model
     OR NEW.ai_mismatch IS DISTINCT FROM OLD.ai_mismatch
     OR NEW.last_error IS DISTINCT FROM OLD.last_error
     OR NEW.analysis_attempts IS DISTINCT FROM OLD.analysis_attempts THEN
    RAISE EXCEPTION 'SITE_EVENT_AI_COLUMNS: kolom hasil AI hanya boleh diubah oleh fungsi analisis'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_ai_columns_service_only_trg ON site_events;
CREATE TRIGGER site_events_ai_columns_service_only_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_ai_columns_service_only();

-- 4b. Rule 2: human fields only through confirm_site_event / close_site_event.
--     A direct write (current_user authenticated or anon) may insert a fresh
--     pending event carrying room, gate hint, note and capture time; may
--     correct the transcript before confirmation; and may discard a draft.
CREATE OR REPLACE FUNCTION site_events_human_fields_rpc_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_analysis'
       OR NEW.reporter_id IS DISTINCT FROM auth.uid()
       OR NEW.event_type IS NOT NULL
       OR NEW.step_code IS NOT NULL
       OR NEW.title IS NOT NULL
       OR NEW.summary IS NOT NULL
       OR NEW.owner_id IS NOT NULL
       OR NEW.due_date IS NOT NULL
       OR NEW.downstream_impact IS NOT NULL
       OR NEW.is_blocking
       OR NEW.vo_flag <> 'none'
       OR NEW.site_change_id IS NOT NULL
       OR NEW.related_event_id IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.closed_at IS NOT NULL
       OR NEW.closed_by IS NOT NULL
       OR NEW.closure_note IS NOT NULL
       OR NEW.transcript_edited IS NOT NULL
       OR NEW.ai_used IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: kiriman baru hanya membawa ruangan, gerbang, catatan dan waktu ambil; sisanya diisi saat konfirmasi'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- id leads the list: an event carries its own primary key into media paths,
  -- notifications and Catatan Perubahan text, so renumbering a row would
  -- orphan all three while leaving the row itself looking untouched.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.raw_text IS DISTINCT FROM OLD.raw_text
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.gate_code IS DISTINCT FROM OLD.gate_code
     OR NEW.step_code IS DISTINCT FROM OLD.step_code
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.downstream_impact IS DISTINCT FROM OLD.downstream_impact
     OR NEW.is_blocking IS DISTINCT FROM OLD.is_blocking
     OR NEW.vo_flag IS DISTINCT FROM OLD.vo_flag
     OR NEW.site_change_id IS DISTINCT FROM OLD.site_change_id
     OR NEW.related_event_id IS DISTINCT FROM OLD.related_event_id
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.closure_note IS DISTINCT FROM OLD.closure_note
     OR NEW.ai_used IS DISTINCT FROM OLD.ai_used THEN
    RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: isi kejadian hanya bisa diubah lewat Konfirmasi atau Selesai'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.transcript_edited IS DISTINCT FROM OLD.transcript_edited
     AND OLD.status NOT IN ('pending_analysis', 'draft') THEN
    RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: transkrip hanya bisa dikoreksi sebelum konfirmasi'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status IN ('pending_analysis', 'draft') AND NEW.status = 'discarded') THEN
    RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: status hanya bisa diubah ke dibuang sebelum konfirmasi'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_human_fields_rpc_only_trg ON site_events;
CREATE TRIGGER site_events_human_fields_rpc_only_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_human_fields_rpc_only();

-- 4c. Brief §11.4 made structural: no open actionable event without an owner and a due date.
CREATE OR REPLACE FUNCTION site_events_actionable_needs_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open'
     AND NEW.event_type IN ('isu', 'hambatan', 'cacat', 'butuh_keputusan')
     AND (NEW.owner_id IS NULL OR NEW.due_date IS NULL) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_REQUIRED: kejadian % yang terbuka wajib punya pemilik dan tenggat', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_actionable_needs_owner_trg ON site_events;
CREATE TRIGGER site_events_actionable_needs_owner_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_actionable_needs_owner();

-- 4d. A confirmed commercial flag with no Catatan Perubahan row is a number with no paper.
CREATE OR REPLACE FUNCTION site_events_vo_needs_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.vo_flag = 'confirmed' AND NEW.site_change_id IS NULL THEN
    RAISE EXCEPTION 'SITE_EVENT_VO_WITHOUT_CHANGE: VO terkonfirmasi wajib punya Catatan Perubahan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_vo_needs_change_trg ON site_events;
CREATE TRIGGER site_events_vo_needs_change_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_vo_needs_change();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. RLS - project members or office roles (the 050/051 shape). No delete
--    policy on any of the three tables, deliberately (rule 3).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE site_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_event_media   ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_event_ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_events_select ON site_events;
CREATE POLICY site_events_select ON site_events
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS site_events_insert ON site_events;
CREATE POLICY site_events_insert ON site_events
  FOR INSERT WITH CHECK ((is_project_member(project_id) OR is_office_role()) AND reporter_id = auth.uid());

DROP POLICY IF EXISTS site_events_update ON site_events;
CREATE POLICY site_events_update ON site_events
  FOR UPDATE USING (is_project_member(project_id) OR is_office_role())
  WITH CHECK (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS site_event_media_select ON site_event_media;
CREATE POLICY site_event_media_select ON site_event_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_events e
      WHERE e.id = site_event_media.event_id
        AND (is_project_member(e.project_id) OR is_office_role())
    )
  );

DROP POLICY IF EXISTS site_event_media_insert ON site_event_media;
CREATE POLICY site_event_media_insert ON site_event_media
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_events e
      WHERE e.id = site_event_media.event_id
        AND (is_project_member(e.project_id) OR is_office_role())
    )
  );

-- Runs: office roles and the event's own reporter may read; only the service
-- role (which bypasses RLS) writes.
DROP POLICY IF EXISTS site_event_ai_runs_select ON site_event_ai_runs;
CREATE POLICY site_event_ai_runs_select ON site_event_ai_runs
  FOR SELECT USING (
    is_office_role()
    OR EXISTS (
      SELECT 1 FROM site_events e
      WHERE e.id = site_event_ai_runs.event_id AND e.reporter_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Private media bucket and per-project object policies (the 006 pattern)
--    25 MB covers a 90 s voice note many times over and matches OpenAI's
--    transcription upload limit. audio/webm is what Chrome records on web.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-media',
  'site-media',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm',
    'video/mp4'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "site_media_select" ON storage.objects;
CREATE POLICY "site_media_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'site-media'
    AND split_part(name, '/', 1) = 'site-events'
    AND (
      public.is_office_role()
      OR EXISTS (
        SELECT 1 FROM public.project_assignments pa
        WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
          AND pa.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "site_media_insert" ON storage.objects;
CREATE POLICY "site_media_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'site-media'
    AND split_part(name, '/', 1) = 'site-events'
    AND (
      public.is_office_role()
      OR EXISTS (
        SELECT 1 FROM public.project_assignments pa
        WHERE pa.project_id::text = split_part(storage.objects.name, '/', 2)
          AND pa.user_id = auth.uid()
      )
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 7. confirm_site_event - the only writer of human fields (spec §4.2)
--    Re-checks every rule the form checks (tools/siteEventRules.ts), because a
--    client can always skip its own validation. The change_type keyword lists
--    mirror VO_OWNER_REQUEST_KEYWORDS / VO_DESIGN_KEYWORDS; the static test
--    builds its expected regex from those constants.
-- ───────────────────────────────────────────────────────────────────────────

-- Drop the exact signature first (092's pattern). CREATE OR REPLACE cannot
-- change a parameter list, so the day this signature moves, the old function
-- would survive as an overload still carrying the GRANT below - callable, and
-- one argument short of the rules added since. The REVOKE/GRANT stay AFTER the
-- CREATE: a DROP takes the function's privileges with it.
DROP FUNCTION IF EXISTS confirm_site_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT
);

CREATE OR REPLACE FUNCTION confirm_site_event(
  p_event_id          UUID,
  p_event_type        TEXT,
  p_gate_code         TEXT,
  p_step_code         TEXT,
  p_title             TEXT,
  p_summary           TEXT,
  p_owner_id          UUID,
  p_due_date          DATE,
  p_downstream_impact TEXT,
  p_is_blocking       BOOLEAN,
  p_vo_confirm        BOOLEAN,
  p_related_event_id  UUID,
  p_transcript_edited TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_ev          site_events%ROWTYPE;
  v_room        rooms%ROWTYPE;
  v_title       TEXT := btrim(COALESCE(p_title, ''));
  v_summary     TEXT := NULLIF(btrim(COALESCE(p_summary, '')), '');
  v_impact      TEXT := NULLIF(btrim(COALESCE(p_downstream_impact, '')), '');
  v_edited      TEXT := NULLIF(btrim(COALESCE(p_transcript_edited, '')), '');
  v_today       DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_step_gate   TEXT;
  v_ai_used     BOOLEAN;
  v_vo_flag     TEXT;
  v_change_id   UUID;
  v_change_type TEXT;
  v_quotes      JSONB;
  v_evidence    TEXT;
  v_excerpt     TEXT;
  v_location    TEXT;
  v_notified    BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_FOUND: kejadian % tidak ditemukan', p_event_id;
  END IF;

  IF v_uid IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_uid IS NOT NULL AND NOT (is_project_member(v_ev.project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A draft, or a pending event the supervisor chose to author by hand.
  IF v_ev.status NOT IN ('pending_analysis', 'draft') THEN
    RAISE EXCEPTION 'SITE_EVENT_STATE: kejadian berstatus % dan tidak bisa dikonfirmasi', v_ev.status;
  END IF;
  v_ai_used := v_ev.ai_draft IS NOT NULL;

  IF p_event_type IS NULL
     OR p_event_type NOT IN ('progres', 'isu', 'hambatan', 'cacat', 'butuh_keputusan', 'info') THEN
    RAISE EXCEPTION 'SITE_EVENT_TYPE: jenis kejadian tidak valid (%)', p_event_type;
  END IF;
  IF char_length(v_title) = 0 OR char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'SITE_EVENT_TITLE: judul wajib 1 sampai 80 karakter';
  END IF;
  IF v_summary IS NOT NULL AND char_length(v_summary) > 300 THEN
    RAISE EXCEPTION 'SITE_EVENT_SUMMARY: ringkasan maksimal 300 karakter';
  END IF;
  IF v_impact IS NOT NULL AND char_length(v_impact) > 300 THEN
    RAISE EXCEPTION 'SITE_EVENT_IMPACT: dampak lanjutan maksimal 300 karakter';
  END IF;

  IF p_gate_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM gate_refs WHERE code = p_gate_code AND active) THEN
    RAISE EXCEPTION 'SITE_EVENT_GATE: gerbang % tidak aktif atau tidak ada', p_gate_code;
  END IF;
  -- The step must sit under the chosen gate. site_events_step_needs_gate and
  -- site_events_step_in_gate would refuse a bad pair at the UPDATE below, but
  -- with a raw constraint error; these say it in words first. A step's
  -- gate_code never changes (096), so this answer cannot go stale.
  IF p_step_code IS NOT NULL AND p_gate_code IS NULL THEN
    RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE: langkah "%" dipilih tanpa gerbang. Pilih gerbangnya dulu.', p_step_code;
  END IF;
  IF p_step_code IS NOT NULL THEN
    SELECT gate_code INTO v_step_gate FROM gate_step_refs WHERE code = p_step_code AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SITE_EVENT_STEP: langkah "%" tidak aktif atau tidak ada', p_step_code;
    END IF;
    IF v_step_gate <> p_gate_code THEN
      RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE: langkah "%" bukan bagian dari gerbang %.', p_step_code, p_gate_code;
    END IF;
  END IF;

  IF p_event_type IN ('isu', 'hambatan', 'cacat', 'butuh_keputusan')
     AND (p_owner_id IS NULL OR p_due_date IS NULL) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_REQUIRED: jenis % wajib punya pemilik dan tenggat', p_event_type;
  END IF;
  -- Owner is a project team member (spec §2 decision 5), which is also what
  -- enqueue_notification_user needs to deliver anything at all.
  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_assignments WHERE project_id = v_ev.project_id AND user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota tim proyek';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date < v_today THEN
    RAISE EXCEPTION 'SITE_EVENT_DUE: tenggat % sudah lewat', p_due_date;
  END IF;

  IF p_related_event_id IS NOT NULL AND (
    p_related_event_id = p_event_id
    OR NOT EXISTS (
      SELECT 1 FROM site_events WHERE id = p_related_event_id AND project_id = v_ev.project_id
    )
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_RELATED: kejadian terkait harus kejadian lain di proyek yang sama';
  END IF;

  SELECT * INTO v_room FROM rooms WHERE id = v_ev.room_id;

  IF p_vo_confirm THEN
    -- The model does not get to assert a commercial claim it cannot point at.
    v_quotes := v_ev.ai_draft -> 'vo' -> 'evidence_quotes';
    -- Type first, in its own IF. jsonb_array_length raises a raw Postgres error
    -- on anything but an array - a draft carrying "evidence_quotes": null, a
    -- string, or an object - and that error reaches the client with no
    -- SITE_EVENT_ prefix for tools/siteEvents.ts to translate. SQL does not
    -- promise to evaluate the arms of an OR left to right, so the length test
    -- cannot ride along in the same condition.
    IF COALESCE(v_ev.ai_draft -> 'vo' ->> 'flag', 'none') <> 'suggested'
       OR v_quotes IS NULL
       OR jsonb_typeof(v_quotes) <> 'array' THEN
      RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar';
    END IF;
    IF jsonb_array_length(v_quotes) = 0 THEN
      RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE: VO hanya bisa dikonfirmasi bila ada kutipan dasar';
    END IF;

    SELECT btrim(regexp_replace(lower(COALESCE(string_agg(q, ' '), '')), '\s+', ' ', 'g'))
      INTO v_evidence
    FROM jsonb_array_elements_text(v_quotes) AS q;

    v_change_type := CASE
      WHEN p_event_type = 'butuh_keputusan' AND v_evidence ~ '(owner|klien|pemilik rumah|minta|permintaan)' THEN 'permintaan_owner'
      WHEN v_evidence ~ '(desain|desainer|gambar|revisi)' THEN 'revisi_desain'
      ELSE 'kondisi_lapangan'
    END;

    v_location := CASE
      WHEN v_room.floor IS NULL OR btrim(v_room.floor) = '' THEN v_room.room_name
      ELSE v_room.room_name || ' · ' || v_room.floor
    END;

    v_excerpt := COALESCE(v_edited, v_ev.transcript_edited, v_ev.transcript);

    -- Pending, unpriced: the estimator prices it in the existing Catatan
    -- Perubahan review. Nothing about cost is decided here.
    INSERT INTO site_changes (
      project_id, location, description, photo_urls, change_type,
      needs_owner_approval, decision, reported_by
    ) VALUES (
      v_ev.project_id,
      v_location,
      COALESCE(v_summary, v_title)
        || CASE
             WHEN v_excerpt IS NULL THEN ''
             ELSE E'\n\nKutipan transkrip: "' || left(v_excerpt, 280)
                  || CASE WHEN char_length(v_excerpt) > 280 THEN '…"' ELSE '"' END
           END
        || E'\n\nSumber: kejadian lapangan ' || p_event_id::text,
      ARRAY(
        SELECT 'site-media:' || m.storage_path
        FROM site_event_media m
        WHERE m.event_id = p_event_id
          AND m.kind = 'photo'
          AND m.role IN ('context', 'closeup')
        ORDER BY (m.role <> 'context'), m.sort_order
      ),
      v_change_type,
      TRUE,
      'pending',
      v_ev.reporter_id
    )
    RETURNING id INTO v_change_id;
  END IF;

  v_vo_flag := CASE
    WHEN p_vo_confirm THEN 'confirmed'
    WHEN COALESCE(v_ev.ai_draft -> 'vo' ->> 'flag', 'none') = 'suggested' THEN 'rejected'
    ELSE 'none'
  END;

  UPDATE site_events SET
    event_type        = p_event_type,
    gate_code         = p_gate_code,
    step_code         = p_step_code,
    title             = v_title,
    summary           = v_summary,
    owner_id          = p_owner_id,
    due_date          = p_due_date,
    downstream_impact = v_impact,
    is_blocking       = COALESCE(p_is_blocking, FALSE),
    vo_flag           = v_vo_flag,
    site_change_id    = v_change_id,
    related_event_id  = p_related_event_id,
    transcript_edited = COALESCE(v_edited, transcript_edited),
    ai_used           = v_ai_used,
    status            = 'open',
    confirmed_at      = now()
  WHERE id = p_event_id;

  -- Spec §11: one notification type, to a different owner only, and a
  -- notification failure must never roll back the confirm.
  IF p_owner_id IS NOT NULL AND p_owner_id <> v_ev.reporter_id THEN
    BEGIN
      PERFORM enqueue_notification_user(
        v_ev.project_id,
        p_owner_id,
        'SITE_EVENT_ASSIGNED',
        left('Anda ditugaskan: ' || v_title || ' · ' || v_room.room_name, 200),
        CASE
          WHEN p_due_date IS NULL THEN 'Kejadian lapangan baru untuk Anda.'
          ELSE 'Tenggat ' || to_char(p_due_date, 'DD-MM-YYYY')
        END,
        'SiteEventDetail',
        jsonb_build_object('eventId', p_event_id, 'projectId', v_ev.project_id),
        p_event_id,
        ARRAY[v_uid]
      );
      -- enqueue_notification_user swallows nothing itself but inserts zero rows
      -- for a non-member; report what actually landed, not what was attempted.
      -- created_at >= now() bounds the read-back to THIS transaction: now() is
      -- transaction start and notifications.created_at defaults to now() (034),
      -- so a row this call enqueued passes and a row from an earlier confirm of
      -- the same event to the same owner - a re-confirm after a reopen, say -
      -- cannot be reported as this call's notification.
      v_notified := EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.related_entity_id = p_event_id
          AND n.recipient_user_id = p_owner_id
          AND n.type = 'SITE_EVENT_ASSIGNED'
          AND n.created_at >= now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'confirm_site_event: notification failed: %', SQLERRM;
      v_notified := FALSE;
    END;
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', 'open',
    'vo_flag', v_vo_flag,
    'site_change_id', v_change_id,
    'ai_used', v_ai_used,
    'notified', v_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_site_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_site_event(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. close_site_event - "Selesai" (spec §5.5). Closure evidence is offered, not
--    required, in release 1: a closure photo is a site_event_media row with
--    role 'closure', inserted by the client before this call.
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS close_site_event(UUID, TEXT);

CREATE OR REPLACE FUNCTION close_site_event(
  p_event_id     UUID,
  p_closure_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ev   site_events%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, '')), '');
BEGIN
  SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_FOUND: kejadian % tidak ditemukan', p_event_id;
  END IF;

  IF v_uid IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_uid IS NOT NULL AND NOT (is_project_member(v_ev.project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_ev.status <> 'open' THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang %)', v_ev.status;
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE: catatan penutupan maksimal 500 karakter';
  END IF;

  UPDATE site_events
  SET status = 'done', closed_at = now(), closed_by = v_uid, closure_note = v_note
  WHERE id = p_event_id;

  RETURN jsonb_build_object('event_id', p_event_id, 'status', 'done', 'closed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION close_site_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_site_event(UUID, TEXT) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. v_room_board - one row per room, under the caller's own RLS
--    Quiet = no confirmed event in 3 days (spec §18 item 4: a constant, not a
--    setting). Owner initials read profiles, which every authenticated user
--    may read (023 profiles_any_read).
-- ───────────────────────────────────────────────────────────────────────────

-- CREATE OR REPLACE VIEW only tolerates an identical or appended column list;
-- it is refused ("cannot change name of view column" / "cannot drop columns
-- from view") the day this view's shape changes under a later edit of this
-- same file. DROP first so a re-paste can never be stopped by that.
DROP VIEW IF EXISTS v_room_board;
CREATE OR REPLACE VIEW v_room_board
  WITH (security_invoker = true) AS
WITH open_counts AS (
  SELECT
    e.room_id,
    count(*) FILTER (WHERE e.event_type = 'progres')         AS n_progres,
    count(*) FILTER (WHERE e.event_type = 'isu')             AS n_isu,
    count(*) FILTER (WHERE e.event_type = 'hambatan')        AS n_hambatan,
    count(*) FILTER (WHERE e.event_type = 'cacat')           AS n_cacat,
    count(*) FILTER (WHERE e.event_type = 'butuh_keputusan') AS n_butuh_keputusan,
    count(*) FILTER (WHERE e.event_type = 'info')            AS n_info,
    -- Jakarta, not UTC. confirm_site_event floors a due date at the Jakarta
    -- date (v_today), so a UTC current_date here would disagree with the RPC
    -- between 00:00 and 07:00 WIB: an item due yesterday WIB would not be
    -- counted overdue on the board that accepted it.
    count(*) FILTER (WHERE e.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS n_overdue
  FROM site_events e
  WHERE e.status = 'open'
  GROUP BY e.room_id
),
last_confirmed AS (
  SELECT DISTINCT ON (e.room_id)
    e.room_id, e.confirmed_at, e.gate_code, e.step_code
  FROM site_events e
  WHERE e.confirmed_at IS NOT NULL
  ORDER BY e.room_id, e.confirmed_at DESC, e.id DESC
),
owner_marks AS (
  SELECT x.room_id, array_agg(x.initials ORDER BY x.initials) AS initials
  FROM (
    SELECT DISTINCT
      e.room_id,
      upper(
        left(split_part(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'), ' ', 1), 1) ||
        left(split_part(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g'), ' ', 2), 1)
      ) AS initials
    FROM site_events e
    JOIN profiles p ON p.id = e.owner_id
    WHERE e.status = 'open' AND btrim(p.full_name) <> ''
  ) x
  GROUP BY x.room_id
)
SELECT
  r.id                                       AS room_id,
  r.project_id                               AS project_id,
  r.room_code                                AS room_code,
  r.room_name                                AS room_name,
  r.floor                                    AS floor,
  r.sort_order                               AS sort_order,
  r.area_type                                AS area_type,
  r.active                                   AS active,
  COALESCE(o.n_progres, 0)::int              AS open_progres,
  COALESCE(o.n_isu, 0)::int                  AS open_isu,
  COALESCE(o.n_hambatan, 0)::int             AS open_hambatan,
  COALESCE(o.n_cacat, 0)::int                AS open_cacat,
  COALESCE(o.n_butuh_keputusan, 0)::int      AS open_butuh_keputusan,
  COALESCE(o.n_info, 0)::int                 AS open_info,
  COALESCE(o.n_overdue, 0)::int              AS overdue_count,
  l.confirmed_at                             AS last_event_at,
  l.gate_code                                AS last_gate_code,
  l.step_code                                AS last_step_code,
  (l.confirmed_at IS NULL OR l.confirmed_at < now() - interval '3 days') AS is_quiet,
  COALESCE(w.initials, ARRAY[]::text[])      AS owner_initials
FROM rooms r
LEFT JOIN open_counts o    ON o.room_id = r.id
LEFT JOIN last_confirmed l ON l.room_id = r.id
LEFT JOIN owner_marks w    ON w.room_id = r.id;

GRANT SELECT ON v_room_board TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Close-out: every DDL statement is above this line
-- ───────────────────────────────────────────────────────────────────────────

-- Hand a reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-7 write nothing)
--
-- 1. Tables and view exist:
--      SELECT to_regclass('public.site_events'), to_regclass('public.site_event_media'),
--             to_regclass('public.site_event_ai_runs'), to_regclass('public.v_room_board');
--    EXPECTED: four non-null names.
--
-- 2. The bucket is private and accepts audio:
--      SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'site-media';
--    EXPECTED: one row, public = false, audio/mp4 and audio/webm in the list.
--    If there is no row, the bucket INSERT was refused - and the Dashboard runs
--    this paste as ONE transaction, so nothing in this file landed; create the
--    bucket in Dashboard → Storage (private, 25 MB, the listed MIME types),
--    then paste the file again.
--
-- 3. The four event guards and the media guard are attached:
--      SELECT tgrelid::regclass, tgname FROM pg_trigger
--      WHERE tgrelid IN ('public.site_events'::regclass, 'public.site_event_media'::regclass)
--        AND NOT tgisinternal ORDER BY 1, 2;
--    EXPECTED: five rows.
--
-- 4. The RPCs are SECURITY DEFINER and not executable by anon:
--      SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--      FROM pg_proc WHERE proname IN ('confirm_site_event', 'close_site_event');
--    EXPECTED: two rows, prosecdef = true, anon_exec = false.
--
-- 5. The board runs as the caller:
--      SELECT relname, reloptions FROM pg_class WHERE relname = 'v_room_board';
--    EXPECTED: reloptions = {security_invoker=true}.
--
-- 6. No delete policy exists on the new tables or the bucket:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('site_events', 'site_event_media', 'site_event_ai_runs')
--         OR policyname LIKE 'site_media_%';
--    EXPECTED: eight rows, none with cmd = 'DELETE'.
--
-- 7. An event's step is keyed through its gate:
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.site_events'::regclass
--        AND conname IN ('site_events_step_needs_gate', 'site_events_step_in_gate')
--      ORDER BY conname;
--    EXPECTED: two rows, the CHECK (step_code IS NULL OR gate_code IS NOT NULL)
--    and FOREIGN KEY (gate_code, step_code) REFERENCES gate_step_refs(gate_code, code).
--
-- 8. A direct client write to a human field is refused (on a TEST event you
--    inserted through the app; everything is rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims', '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        UPDATE site_events SET title = 'x' WHERE id = '<TEST_EVENT_UUID>';
--      ROLLBACK;
--    EXPECTED: ERROR  SITE_EVENT_HUMAN_FIELDS: ...
--
-- 9. Re-paste this whole file.
--    EXPECTED: no error.
-- ═══════════════════════════════════════════════════════════════════════════
