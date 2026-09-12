-- ═══════════════════════════════════════════════════════════════════════════
-- 099 - Reassigning an open site event: owner and due date.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §9, §11
-- Plan: docs/superpowers/plans/2026-09-10-papan-ruangan-blueprint.md (task 6)
--
-- WHY. The room timeline lets office roles and the reporter move an open
-- event's owner or its due date. They cannot do it with a PostgREST UPDATE:
-- 097's site_events_human_fields_rpc_only refuses any direct write to
-- owner_id or due_date, deliberately, so that confirm_site_event stays the
-- only path into the human fields (spec §1.1 rule 2). This file adds the one
-- narrow RPC that guard is willing to let through, with every rule
-- confirm_site_event applies to the same two columns applied again here:
-- the owner is a project member, an actionable event keeps BOTH an owner and
-- a due date, and a due date is never moved into the past.
--
-- Like 097's RPCs this runs SECURITY DEFINER, so inside it current_user is the
-- function owner rather than `authenticated`, and 097's guard returns early.
-- That is exactly why the checks below are written out in full: the trigger is
-- not watching this statement.
--
-- PASTE ORDER. After 096, 097 and 098. It calls is_project_member() and
-- is_office_role() (096/097), reads site_events (097), and enqueues the
-- SITE_EVENT_ASSIGNED notification type that 098 added to the
-- notifications.type CHECK. Pasted before 098, every reassignment would
-- silently notify nobody: the enqueue helpers turn a CHECK violation into a
-- WARNING nobody reads.
--
-- RE-PASTE SAFETY. One CREATE OR REPLACE FUNCTION, one REVOKE, one GRANT, and
-- no DDL on any table: a second paste is a no-op. The signature never changes,
-- so no DROP FUNCTION is needed and none is written - a DROP would break the
-- GRANT during the window between the two statements.
-- What a re-paste CAN undo: pasted after a later migration that redefines
-- update_site_event_assignment(), 099 reverts that change. The static test in
-- tools/__tests__/migration099.test.ts fails when a later migration redefines
-- it, so 099 is brought up to date in the same change.
--
-- WHO MAY REASSIGN. Spec §9: office roles and the reporter. Being the current
-- owner is neither a grant nor a bar - an office role or the reporter who
-- happens to also be the owner can still hand the item on; owner-ness is not
-- a third test layered on top of the two the spec names. A non-member of the
-- project is refused before anything else is read.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION update_site_event_assignment(
  p_event_id UUID,
  p_owner_id UUID,
  p_due_date DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_ev       site_events%ROWTYPE;
  v_room     TEXT;
  v_today    DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_changed  BOOLEAN;
  v_notified BOOLEAN := FALSE;
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
  IF v_uid IS NOT NULL AND NOT (is_office_role() OR v_ev.reporter_id = v_uid) THEN
    RAISE EXCEPTION 'SITE_EVENT_ASSIGN_ROLE: hanya pelapor atau peran kantor yang dapat mengubah pemilik dan tenggat'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_ev.status <> 'open' THEN
    RAISE EXCEPTION 'SITE_EVENT_ASSIGN_NOT_OPEN: hanya kejadian terbuka yang bisa diubah pemilik atau tenggatnya.';
  END IF;

  -- Spec §2 decision 5 and enqueue_notification_user (092:100): an owner who is
  -- not on the project cannot see the event and would never be notified.
  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = v_ev.project_id AND pa.user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota tim proyek ini';
  END IF;

  -- Brief §11.4, the same rule 097's site_events_actionable_needs_owner holds:
  -- raised here first so the app shows a sentence, not a trigger message.
  IF v_ev.event_type IN ('isu', 'hambatan', 'cacat', 'butuh_keputusan')
     AND (p_owner_id IS NULL OR p_due_date IS NULL) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_REQUIRED: kejadian % yang terbuka wajib punya pemilik dan tenggat', v_ev.event_type;
  END IF;

  -- Only a MOVED due date is checked against today: an event that is already
  -- overdue must still be reassignable without first inventing a new date.
  IF p_due_date IS NOT NULL
     AND p_due_date IS DISTINCT FROM v_ev.due_date
     AND p_due_date < v_today THEN
    RAISE EXCEPTION 'SITE_EVENT_DUE: tenggat tidak boleh sebelum hari ini (%)', v_today;
  END IF;

  v_changed := (p_owner_id IS DISTINCT FROM v_ev.owner_id)
            OR (p_due_date IS DISTINCT FROM v_ev.due_date);

  UPDATE site_events
  SET owner_id = p_owner_id, due_date = p_due_date
  WHERE id = p_event_id;

  -- Spec §11: the one notification type, to a NEW owner only, and never to the
  -- person doing the assigning. A notification failure must not roll back the
  -- reassignment.
  IF p_owner_id IS NOT NULL
     AND p_owner_id IS DISTINCT FROM v_ev.owner_id
     AND p_owner_id IS DISTINCT FROM v_uid THEN
    BEGIN
      SELECT r.room_name INTO v_room FROM rooms r WHERE r.id = v_ev.room_id;
      PERFORM enqueue_notification_user(
        v_ev.project_id,
        p_owner_id,
        'SITE_EVENT_ASSIGNED',
        left('Anda ditugaskan: ' || COALESCE(v_ev.title, 'Kejadian lapangan') || ' · ' || COALESCE(v_room, 'Ruangan'), 200),
        CASE
          WHEN p_due_date IS NULL THEN 'Kejadian lapangan baru untuk Anda.'
          ELSE 'Tenggat ' || to_char(p_due_date, 'DD-MM-YYYY')
        END,
        'SiteEventDetail',
        jsonb_build_object('eventId', p_event_id, 'projectId', v_ev.project_id),
        p_event_id,
        ARRAY[v_uid]
      );
      -- Report what actually landed, not what was attempted: the helper inserts
      -- zero rows for a non-member and raises nothing. created_at >= now()
      -- bounds the read-back to THIS transaction (confirm_site_event's pattern,
      -- 097): now() is transaction start and notifications.created_at defaults
      -- to now() (034), so a row from an earlier confirm or reassignment of the
      -- same event to the same owner cannot be reported as this call's
      -- notification.
      v_notified := EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.related_entity_id = p_event_id
          AND n.recipient_user_id = p_owner_id
          AND n.type = 'SITE_EVENT_ASSIGNED'
          AND n.created_at >= now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'update_site_event_assignment: notification failed: %', SQLERRM;
      v_notified := FALSE;
    END;
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', 'open',
    'owner_id', p_owner_id,
    'due_date', p_due_date,
    'changed', v_changed,
    'notified', v_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION update_site_event_assignment(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_site_event_assignment(UUID, UUID, DATE) TO authenticated, service_role;

RESET lock_timeout;

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname = 'update_site_event_assignment';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: one row, prosecdef = true, anon_exec = false.
--
-- 2. search_path is pinned:
--      SELECT proconfig FROM pg_proc WHERE proname = 'update_site_event_assignment';
--    EXPECTED: {search_path=public}.
--
-- 3. A non-member is refused. As any signed-in user who is NOT on the event's
--    project, from the app or from the SQL editor with a set role:
--      SELECT update_site_event_assignment('<event id>', NULL, NULL);
--    EXPECTED: ERROR starting SITE_EVENT_AUTH.
--
-- 4. An actionable event cannot lose its owner. Run every check below inside
--    a session that HAS an identity - the SQL editor is `postgres` with no
--    JWT, so an un-wrapped call refuses at the first guard with
--    SITE_EVENT_AUTH before it ever reaches the rule under test:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<REPORTER_OR_OFFICE_UUID>","role":"authenticated"}', true);
--        SELECT update_site_event_assignment('<an open isu/hambatan/cacat id>', NULL, NULL);
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_OWNER_REQUIRED.
--
-- 5. An outsider cannot be made the owner:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<REPORTER_OR_OFFICE_UUID>","role":"authenticated"}', true);
--        SELECT update_site_event_assignment('<event id>', '<a profile NOT on the project>', current_date + 3);
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_OWNER_NOT_MEMBER.
--
-- 6. A real reassignment lands, and 097's guard did not block it. This one
--    COMMITS rather than rolling back: step 7 reads the notification row
--    this call enqueues, so the write has to still be there afterwards.
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<REPORTER_OR_OFFICE_UUID>","role":"authenticated"}', true);
--        SELECT update_site_event_assignment('<event id>', '<a team member>', current_date + 3);
--      COMMIT;
--    EXPECTED: a JSON object with changed = true. Then:
--      SELECT owner_id, due_date FROM site_events WHERE id = '<event id>';
--    EXPECTED: the new pair.
--
-- 7. The new owner was told. Plain read, no role wrapper needed - the SQL
--    editor's `postgres` session bypasses RLS on notifications:
--      SELECT type, title FROM notifications
--      WHERE related_entity_id = '<event id>' AND type = 'SITE_EVENT_ASSIGNED';
--    EXPECTED: at least one row. NO row means 098 was never pasted.
--
-- 8. Re-paste this whole file.
--    EXPECTED: no error, and check 6 still behaves the same way.
-- ═══════════════════════════════════════════════════════════════════════════
