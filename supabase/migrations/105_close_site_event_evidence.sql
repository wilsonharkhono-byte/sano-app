-- ═══════════════════════════════════════════════════════════════════════════
-- 105 - "Selesai" asks for proof by event type, and the database checks it.
--
-- Spec: docs/superpowers/specs/2026-09-26-closure-evidence-and-digest-design.md §3
-- Plan: docs/superpowers/plans/2026-09-26-closure-evidence-and-digest.md (Lane 1, Task 2)
--
-- WHY. Release 1's close_site_event (097) closes any open event without looking
-- at media; the form called the photo "Opsional". A repair marked done with no
-- picture of the repair is a claim nobody can check. This file re-creates
-- close_site_event with one new rule, by type:
--   * cacat, isu, hambatan: at least one site_event_media row for the event with
--     role 'closure' and kind 'photo' WHOSE FILE EXISTS in storage.objects
--     (bucket 'site-media', name = storage_path). Any member's photo counts:
--     the photo is proof about the event, not about the person who taps Selesai.
--   * butuh_keputusan: a closure note of at least 10 characters after trimming.
--   * progres, info: nothing, as before.
-- Everything else is 097's body verbatim, except that the note is now trimmed
-- of tabs and line breaks as well as spaces (097's btrim default stripped
-- spaces only, so ten newlines passed as a note).
--
-- WHY THE FILE, NOT ONLY THE ROW. site_event_media_insert lets any member
-- insert a row and the path guard checks only the folder prefix, so a row
-- pointing at a file that was never uploaded would otherwise count as proof.
--
-- WHY FULL INDONESIAN SENTENCES IN THE REFUSALS. A phone still on an older
-- bundle has no copy for the two new codes, so tools/siteEvents.ts shows
-- "Gagal menyimpan: " plus the raw text. The raw text therefore has to read
-- as a sentence a supervisor can act on.
--
-- PASTE ORDER. After 097, 098, 099 and 100. It reads site_events and
-- site_event_media (097) and storage.objects.
--
-- PASTE PRECONDITION. The check runs as this function's owner, the role that
-- pastes this file (the Dashboard's postgres), against storage.objects, which
-- supabase_storage_admin owns with RLS on. If that role could not read the
-- table past RLS, the rule would refuse EVERY closure photo, silently. The DO
-- block below therefore stops the paste unless the pasting role (a) has
-- SELECT on storage.objects and (b) is a superuser, has BYPASSRLS, or holds
-- the privileges of the table's owner (and the table does not FORCE row
-- security). The message names which check failed. Its prefix is
-- MIGRATION_105_PRECONDITION, not SITE_EVENT_, so no app copy is ever
-- expected for it.
--
-- RE-PASTE SAFETY. One DO block that writes nothing, one DROP FUNCTION IF
-- EXISTS by exact signature, one CREATE OR REPLACE, one REVOKE, one GRANT, and
-- no DDL on any table, view, policy or trigger: a second paste is a no-op.
-- SET/RESET lock_timeout bracket every statement.
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. 097 still carries its own
-- close_site_event (and confirm_site_event). Re-pasting 097 alone silently
-- reverts both 100 and 105: the functions keep working, without the VO
-- re-check and without the evidence rule. After any re-paste of 097, re-paste
-- 100 and then 105. tools/__tests__/migration105.test.ts fails if a migration
-- numbered above 105 redefines close_site_event.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Paste precondition: the owner can see storage.objects past RLS
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner OID;
  v_force BOOLEAN;
  v_super BOOLEAN;
  v_bypass BOOLEAN;
BEGIN
  SELECT c.relowner, c.relforcerowsecurity INTO v_owner, v_force
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak menemukan tabel storage.objects', current_user;
  END IF;

  IF NOT has_table_privilege(current_user, 'storage.objects', 'SELECT') THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak punya hak SELECT pada storage.objects', current_user;
  END IF;

  SELECT r.rolsuper, r.rolbypassrls INTO v_super, v_bypass FROM pg_roles r WHERE r.rolname = current_user;
  -- USAGE, not MEMBER: RLS exempts the owner through has_privs_of_role, which
  -- is inherited privilege. A NOINHERIT membership would pass MEMBER and
  -- still be filtered by the policies.
  IF NOT (v_super OR v_bypass OR (pg_has_role(current_user, v_owner, 'USAGE') AND NOT v_force)) THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak bisa membaca storage.objects melewati RLS', current_user;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. close_site_event - 097's body plus the trim and the evidence rule
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
  v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, ''), E' \t\r\n'), '');
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

  -- NOT_OPEN before any evidence refusal: a queued close for an event someone
  -- else already closed must learn that, not be told to take a photo it
  -- cannot act on (closure spec §4.4).
  IF v_ev.status <> 'open' THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang %)', v_ev.status;
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE: catatan penutupan maksimal 500 karakter';
  END IF;

  IF v_ev.event_type IN ('cacat', 'isu', 'hambatan') AND NOT EXISTS (
    SELECT 1 FROM site_event_media m
    JOIN storage.objects o ON o.bucket_id = 'site-media' AND o.name = m.storage_path
    WHERE m.event_id = p_event_id AND m.role = 'closure' AND m.kind = 'photo'
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian % hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.', v_ev.event_type;
  END IF;
  IF v_ev.event_type = 'butuh_keputusan' AND (v_note IS NULL OR char_length(v_note) < 10) THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.';
  END IF;

  UPDATE site_events
  SET status = 'done', closed_at = now(), closed_by = v_uid, closure_note = v_note
  WHERE id = p_event_id;

  RETURN jsonb_build_object('event_id', p_event_id, 'status', 'done', 'closed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION close_site_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_site_event(UUID, TEXT) TO authenticated, service_role;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname = 'close_site_event';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; every check below writes nothing, or rolls
-- back what it wrote)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: one row, prosecdef = true, proconfig = {search_path=public},
--    anon_exec = false.
--
-- 2. The rule is in the live function:
--      SELECT prosrc LIKE '%SITE_EVENT_CLOSURE_PHOTO_REQUIRED%' AS photo_rule,
--             prosrc LIKE '%SITE_EVENT_CLOSURE_NOTE_REQUIRED%' AS note_rule
--      FROM pg_proc WHERE proname = 'close_site_event';
--    EXPECTED: one row, both true. Both false means 097 was re-pasted after
--    this file: re-paste 100, then 105.
--
-- 3. The owner can read storage.objects (the precondition, run by hand):
--      SELECT has_table_privilege(current_user, 'storage.objects', 'SELECT') AS can_select,
--             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls;
--    EXPECTED: can_select = true, and bypasses_rls = true or the role holds
--    supabase_storage_admin's privileges.
--
-- 4. A cacat with no closure photo is refused. Every check runs inside a
--    session that HAS an identity - the SQL editor is `postgres` with no JWT,
--    so an un-wrapped call refuses at the first guard with SITE_EVENT_AUTH:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<AN_OPEN_CACAT_WITHOUT_CLOSURE_PHOTO>', 'selesai');
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_CLOSURE_PHOTO_REQUIRED.
--
-- 5. A butuh_keputusan with a short note is refused:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<AN_OPEN_BUTUH_KEPUTUSAN>', 'oke');
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_CLOSURE_NOTE_REQUIRED.
--
-- 6. A closed event still answers NOT_OPEN before any evidence refusal:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<A_DONE_CACAT>', NULL);
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_NOT_OPEN.
--
-- 7. Re-paste this whole file.
--    EXPECTED: no error, and checks 1 and 2 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
