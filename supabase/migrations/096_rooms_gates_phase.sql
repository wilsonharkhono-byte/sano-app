-- ═══════════════════════════════════════════════════════════════════════════
-- 096 - Rooms, gate reference data, and project phase.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §4.1
-- Plan: docs/superpowers/plans/2026-09-10-room-spine-qr.md (task 3)
--
-- WHY. SANO records progress against BoQ rows and work groups, never against
-- "Kamar Mandi Utama, Lt. 2". Without a room there is no place a supervisor can
-- stand in, and so no continuous loop: a photo is filed, a defect is listed,
-- and nothing carries an owner or a due date tied to a location. This migration
-- lays the spatial spine - rooms in DATUM's shape, gates as DATA rather than
-- code, and a project phase the client-report renderer will later switch on.
--
-- PASTE ORDER. 096 first, then 097 (site_events) and finally 098 (daily-log
-- room link + the notification type swap) when those land. 096 seeds the gates
-- that 097's site_events.gate_code references, so it cannot go second.
--
-- RE-PASTE SAFETY. The remote migration history is divergent and
-- `supabase db push` is broken, so this file is pasted into the Supabase
-- Dashboard SQL editor by hand and must survive being pasted twice:
--   • ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS everywhere;
--   • every CHECK and UNIQUE constraint added inside a pg_constraint existence
--     guard;
--   • DROP POLICY IF EXISTS before every CREATE POLICY;
--   • DROP TRIGGER IF EXISTS before every CREATE TRIGGER;
--   • CREATE OR REPLACE for every function;
--   • the gate seed uses ON CONFLICT (code) DO NOTHING, so a re-paste can never
--     overwrite a label or description an office user has edited.
-- The editor runs the paste as one transaction, so a script error rolls the
-- whole paste back rather than half-applying it. lock_timeout (the first
-- statement) turns a paste stuck behind a long transaction into such an error.
-- What a re-paste CAN undo: pasted after a later migration that changes
-- is_office_role(), is_project_member(), rooms_freeze_code(),
-- gate_refs_immutable_code(), a policy on rooms, gate_refs or gate_step_refs,
-- or one of the triggers rooms_freeze_code_trg, gate_refs_immutable_trg and
-- gate_step_refs_immutable_trg, 096 reverts that change: CREATE OR REPLACE,
-- DROP/CREATE POLICY and DROP/CREATE TRIGGER all win. In
-- tools/__tests__/migration096.test.ts the helper-equality test fails CI when a
-- later migration redefines either helper differently, and a sibling test fails
-- when one redefines or drops rooms_freeze_code() or gate_refs_immutable_code(),
-- creates or drops a policy on rooms, gate_refs or gate_step_refs, or touches
-- one of those triggers, so 096 is brought up to date in the same change.
--
-- THE TWO ROOM GUARDS.
--   1. room_code shape. Codes are produced client-side by normalizeRoomCode
--      (tools/roomCodes.ts), a verbatim port of DATUM's normalizeAreaCode, and
--      the CHECK here is the same rule in SQL. It is added NOT VALID and then
--      VALIDATEd only when no existing row violates it: where 035 landed, rooms
--      may already hold free-text codes. A paste against dirty data must REPORT
--      the offending rows, not abort: an abort rolls back the whole paste, and
--      nothing else in this file lands. The price of NOT VALID: while the CHECK
--      is NOT VALID, ANY update to a violating row fails - even a rename or a
--      deactivation - until its code is fixed or cleared in SQL.
--   2. QR freeze. Once qr_printed_at is stamped, the room is behind a printed
--      physical label, /r/{projectCode}/{roomCode} (spec §8); a trigger refuses
--      to move its code or its project, and refuses to clear the stamp. The
--      trigger is BEFORE UPDATE, so an UPDATE that sets a new stamp records
--      now(), not the client's clock. A room INSERTed already stamped keeps the
--      inserted value; the app never inserts one (createRoom in tools/rooms.ts
--      does not send qr_printed_at). Names, floor and type stay editable. To
--      fix a mistyped code before printing, deactivate the room and create it
--      again - the app offers no rename path either.
--
-- ROOMS DO NOT REQUIRE 035. 035 created rooms, but it may never have been
-- applied on the divergent remote (the reason 050 and 051 inline its helpers),
-- and no app code reads or writes rooms, so nothing proves the table exists
-- live. §2 therefore creates it in 035's exact shape when absent; where 035
-- landed that is a no-op.
--
-- WHO WRITES ROOMS. Office roles author rooms; supervisors scan and read (spec
-- decision 2, §9 "Kelola ruangan"). 035 also let every project member insert
-- and update rooms. This file drops those two policies without re-creating
-- them, so a member keeps SELECT only and office roles write through
-- rooms_office_all.
--
-- WHY THE GATES CANNOT BE DELETED. site_events.gate_code (migration 097) is a
-- foreign key to gate_refs(code), and (gate_code, step_code) a composite
-- foreign key to gate_step_refs(gate_code, code). A deleted-and-reused letter
-- would silently re-label a year of history. There is therefore NO delete
-- policy on either reference table, and a trigger refuses DELETE, refuses to
-- move `code`, and refuses to move a step to another gate. Retire a gate with
-- active = false.
--
-- WHAT THIS FILE DOES NOT DO. It creates no "Area Umum" room. A database
-- trigger would fire for every historical project and every test fixture; the
-- app creates it on first room setup, where a human can see it happen
-- (spec §4.1). It also does not widen projects UPDATE: the phase is writable by
-- whoever can already update a project - is_office_manager() on any project
-- (036:73-76), plus an admin, principal or estimator ASSIGNED to it through
-- projects_update_assigned (023:58-60, widened to estimators by 037). No
-- column-level guard restricts phase to managers.
-- ═══════════════════════════════════════════════════════════════════════════

-- A stalled transaction on projects makes this paste fail and roll back after 5 s instead of queueing app reads behind it; re-paste later.
SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 050:85-98 / 051:12-31 pattern)
--    Both already exist where 035 and 036 landed, and CREATE OR REPLACE with
--    the identical body is a no-op there. Together with the rooms table that
--    §2 creates when absent, this keeps the file independent of 035.
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
-- 1. projects - phase, and the reserved DATUM link key
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase              TEXT NOT NULL DEFAULT 'STRUKTUR';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS datum_project_code TEXT;

COMMENT ON COLUMN projects.phase IS
  'STRUKTUR | FINISHING | SERAH_TERIMA. Drives the client-report renderer '
  'switch (spec §10.2). Every existing project defaults to STRUKTUR, so the '
  'current report output is unchanged.';
COMMENT ON COLUMN projects.datum_project_code IS
  'Reserved for the release-2 DATUM link. projects.code (001:49, unique) stays '
  'the SANO-side join key.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_phase_check' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_phase_check
      CHECK (phase IN ('STRUKTUR','FINISHING','SERAH_TERIMA'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. rooms - the 035 table, created here if absent, extended into DATUM's
--    area shape
-- ───────────────────────────────────────────────────────────────────────────

-- 035's definition verbatim (035:40-52). Where 035 landed, all three statements
-- are no-ops; on a remote that never received 035 they create the table the
-- ALTERs below extend, instead of letting the first ALTER abort the paste.
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_code   TEXT,
  room_name   TEXT NOT NULL,
  floor       TEXT,
  area_sqm    NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_project_code
  ON rooms(project_id, room_code) WHERE room_code IS NOT NULL;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS area_type     TEXT NOT NULL DEFAULT 'general';
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS sort_order    INT NOT NULL DEFAULT 0;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS datum_area_id UUID;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS qr_printed_at TIMESTAMPTZ;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS active        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES profiles(id);

COMMENT ON COLUMN rooms.area_type IS
  'DATUM area_type, nine values (packages/core/src/areas/mutations.ts:7-16).';
COMMENT ON COLUMN rooms.qr_printed_at IS
  'Stamped when a label sheet including this room is printed. The trigger is '
  'BEFORE UPDATE: an UPDATE that sets a new stamp records now(), not the client '
  'clock, while a room inserted already stamped keeps the inserted value (the '
  'app never inserts one). Once set, freezes room_code and project_id, and '
  'cannot be cleared.';
COMMENT ON COLUMN rooms.datum_area_id IS
  'Set only by a release-2 sync. NULL in release 1.';

CREATE INDEX IF NOT EXISTS idx_rooms_project_active
  ON rooms(project_id, active);
CREATE INDEX IF NOT EXISTS idx_rooms_project_floor_sort
  ON rooms(project_id, floor, sort_order);

-- area_type over DATUM's nine values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_area_type_check' AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_area_type_check
      CHECK (area_type IN (
        'bathroom','kitchen','bedroom','living','dining',
        'garden','circulation','utility','general'
      ));
  END IF;
END $$;

-- room_code shape. Added NOT VALID, then validated only when the table is
-- already clean, so a re-paste against legacy 035-era codes reports the
-- violation instead of failing the whole script.
DO $$
DECLARE
  v_bad INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_room_code_shape' AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_room_code_shape
      CHECK (
        room_code IS NULL
        OR (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40)
      )
      NOT VALID;
  END IF;

  SELECT count(*) INTO v_bad
  FROM rooms
  WHERE room_code IS NOT NULL
    AND NOT (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40);

  IF v_bad = 0 THEN
    ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;
    RAISE NOTICE '096: rooms_room_code_shape VALIDATED (no existing violations).';
  ELSE
    RAISE WARNING
      '096: rooms_room_code_shape left NOT VALID - % existing row(s) violate it. '
      'Until each code is fixed or cleared, ANY other update to that row fails, even a rename or deactivation. '
      'List them with: SELECT id, project_id, room_code FROM rooms WHERE room_code IS NOT NULL '
      'AND NOT (room_code ~ ''^[A-Z0-9]+(-[A-Z0-9]+)*$'' AND length(room_code) <= 40); '
      'Fix or clear those codes in SQL, then run: ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;',
      v_bad;
  END IF;
END $$;

-- A printed label is a physical object: the code and project behind it cannot move.
CREATE OR REPLACE FUNCTION rooms_freeze_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF OLD.qr_printed_at IS NOT NULL AND NEW.room_code IS DISTINCT FROM OLD.room_code THEN
    RAISE EXCEPTION
      'ROOM_CODE_FROZEN: kode ruangan "%" sudah tercetak pada label QR (%). '
      'Nama, lantai dan tipe boleh diubah; kode tidak. Nonaktifkan ruangan ini '
      'dan buat ruangan baru bila kodenya salah.',
      OLD.room_code, OLD.qr_printed_at;
  END IF;
  -- Clearing the stamp would reopen the code to a second UPDATE. A reprint may
  -- move the stamp forward (to now(), below); nothing may remove it.
  IF OLD.qr_printed_at IS NOT NULL AND NEW.qr_printed_at IS NULL THEN
    RAISE EXCEPTION
      'ROOM_CODE_FROZEN: tanda cetak label QR ruangan "%" tidak boleh dihapus. '
      'Kode ruangan tetap terkunci setelah labelnya dicetak.',
      OLD.room_code;
  END IF;
  -- The label is /r/{projectCode}/{roomCode}: a printed room cannot change
  -- project any more than it can change code.
  IF OLD.qr_printed_at IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'ROOM_CODE_FROZEN: ruangan "%" sudah tercetak; labelnya menunjuk ke proyek ini.', OLD.room_code;
  END IF;
  -- The database owns the stamp, so a client clock never lands: any new stamp,
  -- first print or reprint, records the time of this UPDATE.
  IF NEW.qr_printed_at IS NOT NULL AND NEW.qr_printed_at IS DISTINCT FROM OLD.qr_printed_at THEN
    NEW.qr_printed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_freeze_code_trg ON rooms;
CREATE TRIGGER rooms_freeze_code_trg
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code();

-- RLS. Members read, office roles write (header, WHO WRITES ROOMS). The member
-- read policy (035:267-268) and the office FOR ALL policy (036's table loop)
-- are re-asserted with identical definitions, a no-op where they exist. 035's
-- rooms_office_delete is left as it is; rooms_office_all already covers DELETE.
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_member_read   ON rooms;
CREATE POLICY rooms_member_read   ON rooms FOR SELECT USING (is_project_member(project_id));

-- No member writes. Office roles author rooms, and the freeze trigger alone does
-- not stop a member from renaming, retiring or stamping a room.
DROP POLICY IF EXISTS rooms_member_insert ON rooms;
DROP POLICY IF EXISTS rooms_member_update ON rooms;

DROP POLICY IF EXISTS rooms_office_all   ON rooms;
CREATE POLICY rooms_office_all   ON rooms FOR ALL USING (is_office_role()) WITH CHECK (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 3. gate_refs - the finishing gates, as DATA
--    Mirrors DATUM's gate_code enum A..H. Labels, descriptions, order and the
--    active flag are editable from "Kelola gerbang"; the code never is.
--    The description is fed to the analysis prompt in release 2 so the model
--    picks a gate on meaning rather than on a bare letter.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_refs (
  code            TEXT PRIMARY KEY,
  name_id         TEXT NOT NULL,
  short_label     TEXT NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  datum_gate_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO gate_refs (code, name_id, short_label, description, sort_order) VALUES
  ('A', 'MEP Rough-in', 'MEP Rough-in',
   'Pemasangan jalur listrik, air bersih, air kotor dan pipa AC di dalam dinding atau plafon sebelum ditutup.', 10),
  ('B', 'Pekerjaan Basah / Waterproofing', 'Basah',
   'Plesteran, acian, screed dan waterproofing - pekerjaan yang masih basah dan butuh waktu kering sebelum dilanjutkan.', 20),
  ('C', 'Plafon', 'Plafon',
   'Rangka dan penutup plafon, termasuk drop ceiling, shaft dan lubang perawatan.', 30),
  ('D', 'Finishing Lantai / Dinding / Kusen', 'Finishing',
   'Pemasangan keramik, granit, parket, pelapis dinding, kusen pintu dan jendela.', 40),
  ('E', 'Finishing Permukaan & Ironwork', 'Permukaan',
   'Pengecatan, coating, railing dan pekerjaan besi atau stainless yang menempel pada permukaan jadi.', 50),
  ('F', 'Furniture Built-in', 'Furniture',
   'Kitchen set, lemari tanam, meja built-in dan perabot lain yang dipasang permanen di ruangan.', 60),
  ('G', 'MEP Fit-out', 'Fit-out',
   'Pemasangan armatur lampu, saklar, stop kontak, sanitair, unit AC dan perangkat MEP yang terlihat.', 70),
  ('H', 'Penyelesaian Akhir & Serah Terima', 'Serah Terima',
   'Pembersihan akhir, perbaikan cacat sisa, uji fungsi dan serah terima ruangan kepada pemilik.', 80)
ON CONFLICT (code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. gate_step_refs - the optional level below a gate. Ships EMPTY: steps are
--    detail, and site_events.step_code (097) is nullable, so a pilot that never
--    fills this table still works. Free-text code, e.g. 'B4'.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_step_refs (
  code            TEXT PRIMARY KEY,
  gate_code       TEXT NOT NULL REFERENCES gate_refs(code),
  name_id         TEXT NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  datum_step_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_step_refs_gate
  ON gate_step_refs(gate_code, sort_order);

-- Migration 097 references (gate_code, code) from site_events, so an event
-- cannot carry a step from a different gate. A foreign key needs a unique
-- constraint on exactly its columns; code alone is already the primary key, so
-- this never refuses a row the table would otherwise accept.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gate_step_refs_gate_code_code_key' AND conrelid = 'public.gate_step_refs'::regclass
  ) THEN
    ALTER TABLE gate_step_refs
      ADD CONSTRAINT gate_step_refs_gate_code_code_key UNIQUE (gate_code, code);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Reference codes are immutable and undeletable
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gate_refs_immutable_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'GATE_REF_IMMUTABLE: baris % tidak boleh dihapus - kodenya dipakai sebagai '
      'referensi oleh kejadian lapangan. Nonaktifkan dengan active = false.',
      TG_TABLE_NAME;
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION
      'GATE_REF_IMMUTABLE: kode "%" tidak boleh diubah menjadi "%" - kode adalah '
      'kunci referensi kejadian lapangan. Ubah nama atau labelnya saja.',
      OLD.code, NEW.code;
  END IF;

  -- A step's gate is as fixed as its code: 097 files events under the pair.
  -- Nested, so the gate_refs trigger never evaluates NEW.gate_code, a column
  -- gate_refs does not have.
  IF TG_TABLE_NAME = 'gate_step_refs' THEN
    IF NEW.gate_code IS DISTINCT FROM OLD.gate_code THEN
      RAISE EXCEPTION 'GATE_REF_IMMUTABLE: langkah "%" tidak boleh dipindah dari gerbang % ke %.', OLD.code, OLD.gate_code, NEW.gate_code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gate_refs_immutable_trg ON gate_refs;
CREATE TRIGGER gate_refs_immutable_trg
  BEFORE UPDATE OR DELETE ON gate_refs
  FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code();

DROP TRIGGER IF EXISTS gate_step_refs_immutable_trg ON gate_step_refs;
CREATE TRIGGER gate_step_refs_immutable_trg
  BEFORE UPDATE OR DELETE ON gate_step_refs
  FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. RLS on the reference tables - everyone reads, office roles write.
--    No DELETE policy on either table, deliberately (see the header).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gate_refs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_step_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gate_refs_auth_read     ON gate_refs;
CREATE POLICY gate_refs_auth_read     ON gate_refs FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS gate_refs_office_insert ON gate_refs;
CREATE POLICY gate_refs_office_insert ON gate_refs FOR INSERT WITH CHECK (is_office_role());
DROP POLICY IF EXISTS gate_refs_office_update ON gate_refs;
CREATE POLICY gate_refs_office_update ON gate_refs FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());

DROP POLICY IF EXISTS gate_step_refs_auth_read     ON gate_step_refs;
CREATE POLICY gate_step_refs_auth_read     ON gate_step_refs FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS gate_step_refs_office_insert ON gate_step_refs;
CREATE POLICY gate_step_refs_office_insert ON gate_step_refs FOR INSERT WITH CHECK (is_office_role());
DROP POLICY IF EXISTS gate_step_refs_office_update ON gate_step_refs;
CREATE POLICY gate_step_refs_office_update ON gate_step_refs FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- Close-out: every DDL statement is above this line
-- ───────────────────────────────────────────────────────────────────────────

-- Hand a reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- The result grid the editor shows for this paste. The editor can hide the §2
-- WARNING, so read the outcome here: convalidated = false on
-- rooms_room_code_shape means legacy codes violate the shape (self-check 4).
SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('rooms_room_code_shape','rooms_area_type_check','projects_phase_check','gate_step_refs_gate_code_code_key')
ORDER BY conname;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; copy each query without its leading --).
-- Steps 1-8 change nothing (7 and 8 are meant to abort). Step 9 edits a gate
-- label, step 10 creates a throwaway room and deletes it again, and step 11
-- re-pastes the file and restores the label.
--
-- 1. Columns landed:
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_name = 'rooms' AND column_name IN
--        ('area_type','sort_order','datum_area_id','qr_printed_at','active','created_by');
--    EXPECTED: six rows.
--
-- 2. Rooms policies - members read, office roles write:
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'rooms' ORDER BY 1;
--    EXPECTED: rooms_member_read (SELECT) and rooms_office_all (ALL), plus
--    rooms_office_delete (DELETE) where 035 landed. No member insert or update
--    policy.
--
-- 3. Phase defaulted for every existing project:
--      SELECT phase, count(*) FROM projects GROUP BY 1;
--    EXPECTED: one row, STRUKTUR, = the project count.
--
-- 4. The constraints are VALID, not merely present. The paste's own result grid
--    is this query:
--      SELECT conname, convalidated FROM pg_constraint
--      WHERE conname IN ('rooms_room_code_shape','rooms_area_type_check',
--                        'projects_phase_check','gate_step_refs_gate_code_code_key')
--      ORDER BY conname;
--    EXPECTED: four rows, convalidated = true. A false on rooms_room_code_shape
--    means the §2 WARNING fired. Until it is fixed, ANY update to a violating
--    room fails, even a rename or a deactivation. List those rooms with:
--      SELECT id, project_id, room_code FROM rooms WHERE room_code IS NOT NULL
--      AND NOT (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40);
--    fix or clear their codes in SQL, then run:
--      ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;
--
-- 5. Gates seeded:
--      SELECT code, short_label, active FROM gate_refs ORDER BY sort_order;
--    EXPECTED: eight rows, A..H, all active.
--
-- 6. Step table exists and is empty:
--      SELECT count(*) FROM gate_step_refs;
--    EXPECTED: 0.
--
-- 7. A code cannot be deleted:
--      DELETE FROM gate_refs WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...  (run it; it is safe, it aborts.)
--
-- 8. A code cannot be moved:
--      UPDATE gate_refs SET code = 'Z' WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...
--
-- 9. A label CAN be edited (use a value that differs from the seed, so step 11
--    can tell an edit that survived from a seed that overwrote it):
--      UPDATE gate_refs SET short_label = 'Serah Terima (uji)' WHERE code = 'H';
--    EXPECTED: UPDATE 1.
--
-- 10. The QR freeze, end to end. Run this block as one query: it creates a
--     throwaway room on the first project, proves the freeze, and deletes the
--     room; on any failure the error names the check and the block rolls back.
--      DO $$
--      DECLARE v_id UUID; v_project UUID; v_other UUID;
--      BEGIN
--        INSERT INTO rooms (project_id, room_code, room_name)
--        SELECT id, 'SELFCHECK-096', 'Self-check 096' FROM projects LIMIT 1
--        RETURNING id, project_id INTO v_id, v_project;
--        IF v_id IS NULL THEN RAISE EXCEPTION 'SELF-CHECK: tidak ada proyek'; END IF;
--        UPDATE rooms SET room_code = 'SELFCHECK-096-B' WHERE id = v_id;
--        UPDATE rooms SET qr_printed_at = now() WHERE id = v_id;
--        BEGIN
--          UPDATE rooms SET room_code = 'LAIN' WHERE id = v_id;
--          RAISE EXCEPTION 'SELF-CHECK GAGAL: kode berubah setelah dicetak';
--        EXCEPTION WHEN raise_exception THEN
--          IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--        END;
--        BEGIN
--          UPDATE rooms SET qr_printed_at = NULL WHERE id = v_id;
--          RAISE EXCEPTION 'SELF-CHECK GAGAL: tanda cetak bisa dihapus';
--        EXCEPTION WHEN raise_exception THEN
--          IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--        END;
--        -- Moving a printed room needs a second project to move it to. With
--        -- only one project this sub-check is skipped, and a NOTICE says so.
--        SELECT id INTO v_other FROM projects WHERE id <> v_project LIMIT 1;
--        IF v_other IS NULL THEN
--          RAISE NOTICE 'SELF-CHECK: hanya satu proyek, cek pindah proyek dilewati';
--        ELSE
--          BEGIN
--            UPDATE rooms SET project_id = v_other WHERE id = v_id;
--            RAISE EXCEPTION 'SELF-CHECK GAGAL: ruangan tercetak bisa pindah proyek';
--          EXCEPTION WHEN raise_exception THEN
--            IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--          END;
--        END IF;
--        UPDATE rooms SET room_name = 'Nama Baru' WHERE id = v_id;
--        DELETE FROM rooms WHERE id = v_id;
--      END $$;
--    EXPECTED: DO, with no ERROR. An ERROR starting SELF-CHECK names the guard
--    that is missing, and the throwaway room is gone either way.
--
-- 11. Re-paste this whole file.
--    EXPECTED: no error, and the step-9 edit survived:
--      SELECT short_label FROM gate_refs WHERE code = 'H';
--    EXPECTED: 'Serah Terima (uji)'. Then restore the seed label:
--      UPDATE gate_refs SET short_label = 'Serah Terima' WHERE code = 'H';
-- ═══════════════════════════════════════════════════════════════════════════
