-- ═══════════════════════════════════════════════════════════════════════════
-- 107 - DATUM sync: DATUM's gate words, the pairing, sync-only links, the
-- confirmer stamp, the readiness cache, the run log and the hourly request.
--
-- Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §3, §4
-- Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane M, Task 1)
--
-- WHY. SANO shaped its rooms and gates like DATUM's in release 1 but never
-- talked to DATUM, and the shapes drifted. This file prepares SANO's side of
-- the link the datum-sync edge function makes:
--   * gate_refs takes DATUM's words for A-H (DATUM gates.name, its short chip
--     name GATE_SHORT_NAME, and gates.description verbatim), and
--     datum_gate_code = code. History keeps its letter.
--   * projects.datum_project_code (096) gets its shape CHECK, a partial
--     unique index, and set_datum_project_code() for any office role.
--   * rooms.datum_area_id, site_events.datum_card_id/_url/_escalated_at,
--     site_events.confirmed_by and profiles.datum_staff_id are written only by
--     the service role (the sync), a DEFINER RPC or the Dashboard: three new
--     guard triggers refuse them from app roles.
--   * site_events.confirmed_by is stamped by a trigger when confirmed_at first
--     turns non-null, i.e. inside confirm_site_event, with auth.uid() - the
--     confirmer. Events confirmed before 107 keep NULL: unknown, never guessed.
--   * rooms.area_type widens to DATUM's thirteen area types.
--   * room_datum_gate_status caches DATUM's readiness verbatim; datum_sync_runs
--     logs every run (one open run per project); datum_sync_requests is the
--     hourly queue a Database Webhook delivers to the function.
--
-- PASTE ORDER. After 106. It reads 096's rooms, gate_refs and
-- is_office_role(), 097's site_events and 106's scheduler pattern.
--
-- RE-PASTE SAFETY. UPDATEs to fixed values, ADD COLUMN / CREATE TABLE /
-- CREATE INDEX IF NOT EXISTS, constraints added inside pg_constraint guards,
-- DROP FUNCTION IF EXISTS by exact signature before each CREATE OR REPLACE,
-- DROP TRIGGER / POLICY IF EXISTS before each create, and the cron job
-- unscheduled before it is scheduled again: a second paste changes nothing,
-- EXCEPT that it writes DATUM's gate words again, overwriting any edit made in
-- "Kelola gerbang" since the first paste (as 101 does).
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. Re-pasting 101 after 107
-- restores SANO's old gate words: re-paste 107 after it. Re-pasting 096 keeps
-- the wide area_type CHECK (096 adds its own only when the name is absent).
-- Re-pasting 097, 099, 100 or 105 reverts nothing here: 107 redefines none of
-- their functions and adds its guards as separate triggers.
--
-- SCHEDULER. The last block schedules the hourly request only when pg_cron is
-- enabled. Without it the paste still succeeds and prints a NOTICE; the
-- "Sinkron DATUM" button works either way. No URL and no secret is stored
-- here: delivery is the Database Webhook the owner creates once.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. DATUM's gate words (DATUM 20260531000003_seed_gates_and_checkpoints.sql
--    as amended by 20260625000001:14; short labels from DATUM
--    packages/core/src/gates/labels.ts GATE_SHORT_NAME).
-- ───────────────────────────────────────────────────────────────────────────

UPDATE gate_refs SET
  name_id         = 'MEP Rough-in + Persiapan Struktural',
  short_label     = 'MEP Rough-in',
  description     = 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.',
  datum_gate_code = code
WHERE code = 'A';

UPDATE gate_refs SET
  name_id         = 'Pekerjaan Basah / Waterproofing',
  short_label     = 'Pekerjaan Basah',
  description     = 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.',
  datum_gate_code = code
WHERE code = 'B';

UPDATE gate_refs SET
  name_id         = 'Plafon & Penutupan Selubung',
  short_label     = 'Plafon',
  description     = 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.',
  datum_gate_code = code
WHERE code = 'C';

UPDATE gate_refs SET
  name_id         = 'Finishing Lantai, Dinding & Kusen Aluminium',
  short_label     = 'Lantai & Kusen',
  description     = 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.',
  datum_gate_code = code
WHERE code = 'D';

UPDATE gate_refs SET
  name_id         = 'Finishing Permukaan + Ironwork',
  short_label     = 'Cat & Ironwork',
  description     = 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.',
  datum_gate_code = code
WHERE code = 'E';

UPDATE gate_refs SET
  name_id         = 'Furniture Built-in & Interior',
  short_label     = 'Furniture',
  description     = 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.',
  datum_gate_code = code
WHERE code = 'F';

UPDATE gate_refs SET
  name_id         = 'MEP Fit-out',
  short_label     = 'MEP Fit-out',
  description     = 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.',
  datum_gate_code = code
WHERE code = 'G';

UPDATE gate_refs SET
  name_id         = 'Penyelesaian Akhir & Serah Terima',
  short_label     = 'Serah Terima',
  description     = 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.',
  datum_gate_code = code
WHERE code = 'H';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The pairing: projects.datum_project_code (096) upper case, unique, and
--    set by any office role through one RPC. Direct UPDATEs of projects are
--    already office-only (023/036/037); the CHECK and the index hold whichever
--    path wrote the value, so no trigger is added on projects.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_datum_project_code_shape' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_datum_project_code_shape
      CHECK (datum_project_code IS NULL
             OR (datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code
  ON projects (datum_project_code) WHERE datum_project_code IS NOT NULL;

DROP FUNCTION IF EXISTS set_datum_project_code(UUID, TEXT);

CREATE OR REPLACE FUNCTION set_datum_project_code(p_project_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := NULLIF(upper(btrim(COALESCE(p_code, ''))), '');
BEGIN
  IF NOT is_office_role() THEN
    RAISE EXCEPTION 'DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'DATUM_PAIRING_PROJECT: proyek tidak ditemukan';
  END IF;
  BEGIN
    UPDATE projects SET datum_project_code = v_code WHERE id = p_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain';
  END;
  RETURN jsonb_build_object('code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION set_datum_project_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_datum_project_code(UUID, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. rooms: DATUM's thirteen area types, and a link only the sync writes
--    (rooms_office_all, 096, lets every office role write any column).
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'rooms_area_type_check' AND conrelid = 'public.rooms'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%''exterior''%' THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_area_type_check;
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_area_type_check
      CHECK (area_type IN (
        'bathroom','kitchen','bedroom','living','dining',
        'garden','circulation','utility','general',
        'facade','terrace','hall','exterior'
      ));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION rooms_datum_area_id_sync_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_area_id IS NOT NULL THEN
      RAISE EXCEPTION 'ROOM_DATUM_LINK_SYNC_ONLY: tautan area DATUM hanya diisi oleh sinkron DATUM'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_area_id IS DISTINCT FROM OLD.datum_area_id THEN
    RAISE EXCEPTION 'ROOM_DATUM_LINK_SYNC_ONLY: tautan area DATUM hanya diubah oleh sinkron DATUM'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_datum_area_id_sync_only_trg ON rooms;
CREATE TRIGGER rooms_datum_area_id_sync_only_trg
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_datum_area_id_sync_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. site_events: the escalation columns and the confirmer. A separate guard,
--    not an edit of 097's human-fields guard: a 097 re-paste would revert an
--    edit there (the 105 hazard) and break its pinned shape.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_id      UUID;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_url     TEXT;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_escalated_at TIMESTAMPTZ;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS confirmed_by       UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_site_events_escalation_due
  ON site_events(project_id)
  WHERE status = 'open' AND event_type = 'butuh_keputusan' AND datum_card_id IS NULL;

CREATE OR REPLACE FUNCTION site_events_system_columns_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- The stamp comes before the bypass: confirm_site_event (a DEFINER RPC,
  -- which the bypass lets through) is the only path that moves confirmed_at
  -- from NULL, and auth.uid() still names its caller there.
  IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN
    NEW.confirmed_by := auth.uid();
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_card_id IS NOT NULL
       OR NEW.datum_card_url IS NOT NULL
       OR NEW.datum_escalated_at IS NOT NULL
       OR NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_EVENT_SYSTEM_COLUMNS: kolom ini hanya diisi oleh sistem'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_card_id IS DISTINCT FROM OLD.datum_card_id
     OR NEW.datum_card_url IS DISTINCT FROM OLD.datum_card_url
     OR NEW.datum_escalated_at IS DISTINCT FROM OLD.datum_escalated_at
     OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION 'SITE_EVENT_SYSTEM_COLUMNS: kolom ini hanya diisi oleh sistem'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_system_columns_guard_trg ON site_events;
CREATE TRIGGER site_events_system_columns_guard_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_system_columns_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. profiles.datum_staff_id: one SANO person per DATUM staff row, set only
--    by the sync (profiles_self_update and profiles_update_managers would
--    otherwise let a person, or a manager, point it anywhere).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS datum_staff_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_datum_staff_id
  ON profiles (datum_staff_id) WHERE datum_staff_id IS NOT NULL;

CREATE OR REPLACE FUNCTION profiles_datum_staff_id_sync_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'PROFILE_DATUM_LINK_SYNC_ONLY: tautan staf DATUM hanya diisi oleh sinkron DATUM'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_staff_id IS DISTINCT FROM OLD.datum_staff_id THEN
    RAISE EXCEPTION 'PROFILE_DATUM_LINK_SYNC_ONLY: tautan staf DATUM hanya diubah oleh sinkron DATUM'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_datum_staff_id_sync_only_trg ON profiles;
CREATE TRIGGER profiles_datum_staff_id_sync_only_trg
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_datum_staff_id_sync_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. datum_sync_runs - one row per run. The partial unique index is the lock:
--    one open run per project. Read by members (the board's last good gate
--    read) and office roles (every run: the staff picture is global).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datum_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'import')),
  requested_by  UUID REFERENCES profiles(id),
  request_id    UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  ok            BOOLEAN,
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  differences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS datum_sync_runs_one_open
  ON datum_sync_runs(project_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_datum_sync_runs_project_started
  ON datum_sync_runs(project_id, started_at DESC);

ALTER TABLE datum_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS datum_sync_runs_read ON datum_sync_runs;
CREATE POLICY datum_sync_runs_read ON datum_sync_runs
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 7. room_datum_gate_status - DATUM's readiness per room and gate, verbatim.
--    Upserted by the sync, never deleted: an old row ages into "lama".
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS room_datum_gate_status (
  room_id              UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  gate_code            TEXT NOT NULL REFERENCES gate_refs(code),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  datum_area_id        UUID NOT NULL,
  status               TEXT NOT NULL
                       CHECK (status IN ('not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable')),
  datum_stale          BOOLEAN NOT NULL,
  datum_updated_at     TIMESTAMPTZ,
  datum_recomputed_at  TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL,
  run_id               UUID REFERENCES datum_sync_runs(id),
  PRIMARY KEY (room_id, gate_code)
);

CREATE INDEX IF NOT EXISTS idx_room_datum_gate_status_project
  ON room_datum_gate_status(project_id);

ALTER TABLE room_datum_gate_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_datum_gate_status_read ON room_datum_gate_status;
CREATE POLICY room_datum_gate_status_read ON room_datum_gate_status
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 8. datum_sync_requests - the hourly queue. pg_cron (postgres) inserts, the
--    function (service role) marks each handled. Office roles read it for the
--    "Sinkron otomatis menunggu" line.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datum_sync_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at    TIMESTAMPTZ,
  run_id        UUID REFERENCES datum_sync_runs(id),
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_datum_sync_requests_waiting
  ON datum_sync_requests(project_id, requested_at) WHERE handled_at IS NULL;

ALTER TABLE datum_sync_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS datum_sync_requests_office_read ON datum_sync_requests;
CREATE POLICY datum_sync_requests_office_read ON datum_sync_requests
  FOR SELECT USING (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Scheduler: one request per paired ACTIVE project, every hour. The
--    cron.* statements are planned only when their branch runs, so this
--    block pastes cleanly on a project without pg_cron.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'datum_sync_hourly') THEN
      PERFORM cron.unschedule('datum_sync_hourly');
    END IF;
    PERFORM cron.schedule('datum_sync_hourly', '0 * * * *',
      $cmd$INSERT INTO public.datum_sync_requests (project_id)
           SELECT id FROM public.projects
           WHERE datum_project_code IS NOT NULL AND status = 'ACTIVE'$cmd$);
  ELSE
    RAISE NOTICE '107: pg_cron belum aktif. Aktifkan Cron di Dashboard (Integrations → Cron), lalu paste 107 lagi. Tanpa itu sinkron DATUM hanya berjalan lewat tombol.';
  END IF;
END $$;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- The result grid: DATUM's words per gate, and how many confirmed events now
-- read under each (their letter did not move, their word did).
SELECT g.code, g.short_label, g.name_id, g.datum_gate_code,
       (SELECT count(*) FROM site_events e WHERE e.gate_code = g.code AND e.confirmed_at IS NOT NULL) AS confirmed_events
FROM gate_refs g
ORDER BY g.sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-8 write nothing)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: eight rows A-H, short_label MEP Rough-in, Pekerjaan Basah,
--    Plafon, Lantai & Kusen, Cat & Ironwork, Furniture, MEP Fit-out,
--    Serah Terima, and datum_gate_code equal to code on every row.
--
-- 2. The pairing is guarded and callable by the app:
--      SELECT conname FROM pg_constraint WHERE conname = 'projects_datum_project_code_shape';
--      SELECT proname, prosecdef, has_function_privilege('authenticated', oid, 'EXECUTE') AS app_exec,
--             has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--      FROM pg_proc WHERE proname = 'set_datum_project_code';
--    EXPECTED: one constraint row; one function row with prosecdef = true,
--    app_exec = true and anon_exec = false.
--
-- 3. The three guards are in place:
--      SELECT tgname, tgrelid::regclass FROM pg_trigger
--      WHERE tgname IN ('rooms_datum_area_id_sync_only_trg', 'site_events_system_columns_guard_trg',
--                       'profiles_datum_staff_id_sync_only_trg') ORDER BY 1;
--    EXPECTED: three rows, on profiles, rooms and site_events.
--
-- 4. The confirmer column is embeddable by the app:
--      SELECT conname FROM pg_constraint WHERE conname = 'site_events_confirmed_by_fkey';
--    EXPECTED: one row. The app reads confirmer:profiles!site_events_confirmed_by_fkey.
--
-- 5. Room types are DATUM's thirteen:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'rooms_area_type_check';
--    EXPECTED: 13 quoted types, facade, terrace, hall and exterior among them.
--
-- 6. The three tables read, and only read, through RLS:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('datum_sync_runs', 'room_datum_gate_status', 'datum_sync_requests') ORDER BY 1;
--    EXPECTED: three rows, each cmd = SELECT.
--
-- 7. The schedule exists (after Cron is enabled):
--      SELECT jobname, schedule FROM cron.job WHERE jobname = 'datum_sync_hourly';
--    EXPECTED: one row, 0 * * * *. An error "relation cron.job does not exist"
--    means pg_cron is not enabled: enable it and paste this file again.
--
-- 8. Nobody is linked yet:
--      SELECT count(*) FILTER (WHERE datum_staff_id IS NOT NULL) AS staff_links FROM profiles;
--      SELECT count(*) FILTER (WHERE datum_area_id IS NOT NULL) AS room_links FROM rooms;
--    EXPECTED: 0 and 0 until the first "Sinkron DATUM".
--
-- 9. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-8 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
