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
--   • every CHECK added inside a pg_constraint existence guard;
--   • DROP POLICY IF EXISTS before every CREATE POLICY;
--   • DROP TRIGGER IF EXISTS before every CREATE TRIGGER;
--   • CREATE OR REPLACE for every function;
--   • the gate seed uses ON CONFLICT (code) DO NOTHING, so a re-paste can never
--     overwrite a label or description an office user has edited.
--
-- THE TWO ROOM GUARDS.
--   1. room_code shape. Codes are produced client-side by normalizeRoomCode
--      (tools/roomCodes.ts), a verbatim port of DATUM's normalizeAreaCode, and
--      the CHECK here is the same rule in SQL. It is added NOT VALID and then
--      VALIDATEd only when no existing row violates it: rooms has existed since
--      035 and may hold free-text codes. A re-paste against dirty data must
--      REPORT the offending rows, not abort the script half-applied.
--   2. Code freeze. Once qr_printed_at is stamped, the code is behind a printed
--      physical label; a trigger refuses to move it. Names, floor and type stay
--      editable. To fix a mistyped code before printing, deactivate the room and
--      create it again - the app offers no rename path either.
--
-- WHY THE GATES CANNOT BE DELETED. site_events.gate_code (migration 097) is a
-- foreign key to gate_refs(code). A deleted-and-reused letter would silently
-- re-label a year of history. There is therefore NO delete policy on either
-- reference table, and a trigger refuses DELETE and refuses to move `code`.
-- Retire a gate with active = false.
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

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 050:85-98 / 051:12-31 pattern)
--    Both already exist (035, 036). CREATE OR REPLACE with the identical body
--    is a no-op where they do. Unlike 050/051, this does NOT make the file
--    independent of 035: §2 alters the rooms table 035 creates, so on a remote
--    that never received 035 the paste errors at the first ALTER TABLE rooms.
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
-- 2. rooms - extend the 035 table into DATUM's area shape
-- ───────────────────────────────────────────────────────────────────────────

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
  'Stamped when a label sheet including this room is printed. Freezes room_code.';
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
      'List them with: SELECT id, project_id, room_code FROM rooms WHERE room_code IS NOT NULL '
      'AND NOT (room_code ~ ''^[A-Z0-9]+(-[A-Z0-9]+)*$'' AND length(room_code) <= 40); '
      'Fix or clear those codes, then run: ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;',
      v_bad;
  END IF;
END $$;

-- A printed label is a physical object: the code behind it cannot move.
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
  -- move the stamp forward (markRoomsPrinted sets now()); nothing may remove it.
  IF OLD.qr_printed_at IS NOT NULL AND NEW.qr_printed_at IS NULL THEN
    RAISE EXCEPTION
      'ROOM_CODE_FROZEN: tanda cetak label QR ruangan "%" tidak boleh dihapus. '
      'Kode ruangan tetap terkunci setelah labelnya dicetak.',
      OLD.room_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_freeze_code_trg ON rooms;
CREATE TRIGGER rooms_freeze_code_trg
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code();

-- RLS. 035:266-274 gave rooms member-scoped policies and 036 added the office
-- FOR ALL policy through its table loop. Both are re-asserted here so this file
-- is self-contained; the definitions are identical, so this is a no-op where
-- they already exist.
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_member_read   ON rooms;
CREATE POLICY rooms_member_read   ON rooms FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS rooms_member_insert ON rooms;
CREATE POLICY rooms_member_insert ON rooms FOR INSERT WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS rooms_member_update ON rooms;
CREATE POLICY rooms_member_update ON rooms FOR UPDATE USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
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

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; none of these writes anything)
--
-- 1. Columns landed:
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_name = 'rooms' AND column_name IN
--        ('area_type','sort_order','datum_area_id','qr_printed_at','active','created_by');
--    EXPECTED: six rows.
--
-- 2. Phase defaulted for every existing project:
--      SELECT phase, count(*) FROM projects GROUP BY 1;
--    EXPECTED: one row, STRUKTUR, = the project count.
--
-- 3. The room_code CHECK is VALID (not merely present):
--      SELECT conname, convalidated FROM pg_constraint
--      WHERE conname IN ('rooms_room_code_shape','rooms_area_type_check','projects_phase_check');
--    EXPECTED: three rows, convalidated = true. A false on rooms_room_code_shape
--    means the RAISE WARNING above fired - fix those codes and VALIDATE by hand.
--
-- 4. Gates seeded:
--      SELECT code, short_label, active FROM gate_refs ORDER BY sort_order;
--    EXPECTED: eight rows, A..H, all active.
--
-- 5. Step table exists and is empty:
--      SELECT count(*) FROM gate_step_refs;
--    EXPECTED: 0.
--
-- 6. A code cannot be deleted:
--      DELETE FROM gate_refs WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...  (run it; it is safe, it aborts.)
--
-- 7. A code cannot be moved:
--      UPDATE gate_refs SET code = 'Z' WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...
--
-- 8. A label CAN be edited (use a value that differs from the seed, so step 10
--    can tell an edit that survived from a seed that overwrote it):
--      UPDATE gate_refs SET short_label = 'Serah Terima (uji)' WHERE code = 'H';
--    EXPECTED: UPDATE 1.
--
-- 9. The freeze trigger bites only after printing (on a TEST room):
--      UPDATE rooms SET qr_printed_at = now() WHERE id = '<TEST_ROOM_UUID>';
--      UPDATE rooms SET room_code = 'LAIN' WHERE id = '<TEST_ROOM_UUID>';
--    EXPECTED: ERROR  ROOM_CODE_FROZEN: ...
--      UPDATE rooms SET qr_printed_at = NULL WHERE id = '<TEST_ROOM_UUID>';
--    EXPECTED: ERROR  ROOM_CODE_FROZEN: ... (the stamp cannot be cleared)
--      UPDATE rooms SET room_name = 'Nama Baru' WHERE id = '<TEST_ROOM_UUID>';
--    EXPECTED: UPDATE 1.
--
-- 10. Re-paste this whole file.
--    EXPECTED: no error, and the step-8 edit survived:
--      SELECT short_label FROM gate_refs WHERE code = 'H';
--    EXPECTED: 'Serah Terima (uji)'. Then restore the seed label:
--      UPDATE gate_refs SET short_label = 'Serah Terima' WHERE code = 'H';
-- ═══════════════════════════════════════════════════════════════════════════
