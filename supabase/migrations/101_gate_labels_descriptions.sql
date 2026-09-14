-- ═══════════════════════════════════════════════════════════════════════════
-- 101 - Renaming the eight gates and giving each a real description.
--
-- Decision: the site owner's, 2026-09-13, reading the capture screen with a
-- supervisor. "A · MEP Rough-in" through "H · Serah Terima" (096's seed) read
-- like internal shorthand, not the two trades a chip actually covers, and
-- carried no description a supervisor - or the release-2 AI classifier
-- (supabase/functions/site-event-analyze/prompt.ts, which reads short_label,
-- name_id and description straight off this table) - could use to tell two
-- neighbouring gates apart.
--
-- WHAT THIS FILE DOES. Eight idempotent UPDATEs, one per code A-H, each
-- setting name_id, short_label and description to the new copy below. Nothing
-- else moves: not code (096's gate_refs_immutable_code trigger would refuse
-- it anyway), not sort_order, not active, not datum_gate_code, and no row in
-- gate_step_refs - DATUM shares the A-H codes and gate_step_refs ships empty
-- (096 §4; nothing has seeded a step yet, see tools/__tests__/migration101's
-- companion note in the PR description).
--
--   Code  Old short_label   New name_id / short_label (identical)
--   A     MEP Rough-in      MEP rough-in + persiapan sipil
--   B     Basah             Waterproofing + kamar mandi
--   C     Plafon            Plafon + benangan
--   D     Finishing         Lantai + kusen
--   E     Permukaan         Cat + ironwork
--   F     Furniture         Built-in & interior
--   G     Fit-out           MEP fit-out
--   H     Serah Terima      Cleaning + dekoratif
--
-- name_id and short_label are set to the SAME string per gate: the office
-- asked for one name, not a long form and a short chip form that could drift
-- apart again. gateChipLabel (tools/gateRefs.ts) still renders "A · MEP
-- rough-in + persiapan sipil" unchanged - it only concatenates code and
-- short_label.
--
-- NO LENGTH CHECK EXISTS ON THESE COLUMNS. 096 declares name_id and
-- short_label as TEXT NOT NULL and description as plain TEXT - no CHECK,
-- unlike site_events.title/summary (097) which do carry one. The new copy is
-- well under 300 characters regardless, so there is nothing to widen here;
-- if a future migration adds such a CHECK it must accommodate the longest row
-- this file writes.
--
-- PASTE ORDER. After 100. Independent of 097-100's own ordering - it only
-- touches gate_refs, which 096 creates and seeds; it does not need 097's
-- site_events or 098-100's confirm/assignment RPCs to exist first.
--
-- RE-PASTE SAFETY. Every statement is `UPDATE gate_refs SET ... WHERE
-- code = 'X'` - re-running this file after it has already landed writes the
-- same three columns to the same values, a true no-op. There is no INSERT, so
-- a second paste can never re-seed a row 096 already created, and no DELETE,
-- so it cannot remove one either. An office edit made through "Kelola
-- gerbang" after this paste is NOT protected the way 096 protects its own
-- seed with ON CONFLICT DO NOTHING: a re-paste of 101 overwrites a
-- since-edited name_id/short_label/description back to the copy below. Paste
-- 101 exactly once per environment, before any office user hand-edits a gate
-- label.
-- ═══════════════════════════════════════════════════════════════════════════

-- A stalled transaction on gate_refs makes this paste fail and roll back
-- after 5 s instead of queueing app reads behind it; re-paste later.
SET lock_timeout = '5s';

UPDATE gate_refs SET
  name_id     = 'MEP rough-in + persiapan sipil',
  short_label = 'MEP rough-in + persiapan sipil',
  description = 'Pemasangan jalur listrik, pipa air bersih dan air kotor, serta pipa AC di dalam dinding atau plafon sebelum ditutup, termasuk pekerjaan persiapan sipil seperti pasangan bata partisi dan marking ketinggian lantai.'
WHERE code = 'A';

UPDATE gate_refs SET
  name_id     = 'Waterproofing + kamar mandi',
  short_label = 'Waterproofing + kamar mandi',
  description = 'Lapisan waterproofing pada kamar mandi, dak dan area basah lainnya, kemiringan lantai ke floor drain, serta pasangan keramik dan sanitair kamar mandi.'
WHERE code = 'B';

UPDATE gate_refs SET
  name_id     = 'Plafon + benangan',
  short_label = 'Plafon + benangan',
  description = 'Rangka dan penutup plafon termasuk drop ceiling dan shaft, serta benangan: garis sudut plesteran dan acian yang rapi pada pertemuan dinding, plafon dan kusen.'
WHERE code = 'C';

UPDATE gate_refs SET
  name_id     = 'Lantai + kusen',
  short_label = 'Lantai + kusen',
  description = 'Pemasangan keramik, granit atau parket lantai, serta kusen pintu dan jendela berikut daun pintunya.'
WHERE code = 'D';

UPDATE gate_refs SET
  name_id     = 'Cat + ironwork',
  short_label = 'Cat + ironwork',
  description = 'Pengecatan dinding dan plafon, coating, serta pekerjaan besi atau stainless seperti railing tangga dan balkon yang menempel pada permukaan jadi.'
WHERE code = 'E';

UPDATE gate_refs SET
  name_id     = 'Built-in & interior',
  short_label = 'Built-in & interior',
  description = 'Kitchen set, lemari tanam, meja built-in dan perabot interior lain yang dipasang permanen di ruangan.'
WHERE code = 'F';

UPDATE gate_refs SET
  name_id     = 'MEP fit-out',
  short_label = 'MEP fit-out',
  description = 'Pemasangan armatur lampu, saklar, stop kontak, unit AC dan perangkat MEP lain yang terlihat setelah dinding dan plafon selesai.'
WHERE code = 'G';

UPDATE gate_refs SET
  name_id     = 'Cleaning + dekoratif',
  short_label = 'Cleaning + dekoratif',
  description = 'Pembersihan akhir ruangan, pemasangan elemen dekoratif terakhir, serta perbaikan cacat sisa sebelum serah terima ruangan kepada pemilik.'
WHERE code = 'H';

-- Close-out: every DML statement is above this line.
RESET lock_timeout;

-- The result grid the editor shows for this paste.
SELECT code, short_label, description FROM gate_refs ORDER BY sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; copy each query without its leading --).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. All eight new names landed, in order:
--      SELECT code, short_label, description FROM gate_refs ORDER BY sort_order;
--    EXPECTED (short_label column):
--      A  MEP rough-in + persiapan sipil
--      B  Waterproofing + kamar mandi
--      C  Plafon + benangan
--      D  Lantai + kusen
--      E  Cat + ironwork
--      F  Built-in & interior
--      G  MEP fit-out
--      H  Cleaning + dekoratif
--    Every row also carries a non-null description.
--
-- 2. Nothing else moved:
--      SELECT code, sort_order, active, datum_gate_code FROM gate_refs ORDER BY sort_order;
--    EXPECTED: sort_order 10,20,...,80 in order, active = true on all eight,
--    datum_gate_code unchanged (NULL, unless a release-2 sync set it).
--
-- 3. gate_step_refs untouched:
--      SELECT count(*) FROM gate_step_refs;
--    EXPECTED: same count as before this paste (096 ships it empty; if the
--    office has since added steps, that count is unaffected either way).
--
-- 4. Re-paste this whole file.
--    EXPECTED: no error, and the grid from the close-out query is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
