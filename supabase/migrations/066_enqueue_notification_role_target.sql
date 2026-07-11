-- 066 — Role-targeted enqueue_notification (Task 2.1, MED)
--
-- Problem: enqueue_notification (034:80-104) fans out to EVERY
--   project_assignments member for a project, with no way to target just one
--   role. The approval→admin handoff (next task) needs to notify only the
--   admin(s) on a project, not every supervisor/estimator/admin/principal
--   assigned to it.
--
-- Fix: add p_target_role TEXT DEFAULT NULL as a NEW trailing 9th parameter.
--   NULL (the default) preserves current behavior — fan out to all members,
--   unchanged for the 3 existing call sites: 034:187-196
--   (notify_header_status_change, covers AUTO_HOLD/APPROVED/REJECTED),
--   034:226-237 (notify_po_ready, PO_READY), 034:267-278
--   (notify_receipt_mismatch, RECEIPT_MISMATCH). All 3 call
--   enqueue_notification positionally with exactly 8 args and no trailing
--   comma/9th value, so they resolve against the new 9-arg function via the
--   trailing DEFAULT NULL — verified by reading each call site; none needs
--   to change. Non-NULL p_target_role restricts the fan-out to members whose
--   profiles.role matches.
--
-- Overload hazard: adding a 9th DEFAULT param via a bare CREATE OR REPLACE
--   would install a SECOND, ambiguous overload alongside 034's 8-arg
--   version (Postgres treats differing arg counts as distinct signatures
--   even under CREATE OR REPLACE) — an 8-positional-arg call would become
--   ambiguous between "exact 8-arg match" and "9-arg with 1 trailing
--   default", and could break at call time. So — mirroring 055:165-167 and
--   062:81-83 (both submit_receipt, +1 trailing DEFAULT param each) — DROP
--   the exact 8-arg signature first, then CREATE the 9-arg replacement.
--
-- profiles JOIN safety: project_assignments.user_id REFERENCES profiles(id)
--   ON DELETE CASCADE (001_core_tables.sql:78-84) and profiles.role is
--   NOT NULL with a CHECK (001_core_tables.sql:14-15), so the added INNER
--   JOIN cannot silently drop any project_assignments row that the 8-arg
--   version would have notified — every assignment has exactly one matching
--   profiles row with a non-null role. The join only adds the optional role
--   filter; it does not change the NULL-target fan-out set.
--
-- No CHECK on p_target_role: a typo'd role (e.g. 'admni') matches zero
--   profiles and silently notifies nobody for that call. Accepted —
--   enqueue_notification is an internal trigger-only helper (see GRANT note
--   below), not a user-facing input, and raising on an unrecognized role
--   would risk turning a cosmetic typo into a blocked business write inside
--   a trigger's exception-wrapped PERFORM (034's callers all wrap the
--   PERFORM in BEGIN/EXCEPTION WHEN OTHERS to guarantee notifications never
--   block the underlying write — see 034:186-200, 225-239, 266-280). Callers
--   should still spell roles against profiles' CHECK (role IN
--   ('supervisor', 'estimator', 'admin', 'principal')) (001:14-15).
--
-- GRANT state: grepped every migration for "GRANT EXECUTE ON FUNCTION
--   enqueue_notification" — none exists. It has never been directly
--   callable via PostgREST; it is only ever invoked with PERFORM from
--   inside other SECURITY DEFINER trigger functions (034:148-291), which
--   already carry their own definer rights. Nothing to re-grant here.
--
-- Idempotent / re-paste-safe: DROP FUNCTION IF EXISTS + CREATE OR REPLACE.
--   Safe to paste into the Supabase Dashboard SQL editor more than once.

-- Drop the exact 8-arg 034 signature so the 9-arg version below does not
-- install as an ambiguous overload (mirrors 055:165-167, 062:81-83).
DROP FUNCTION IF EXISTS enqueue_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID
);

CREATE OR REPLACE FUNCTION enqueue_notification(
  p_project_id        UUID,
  p_type              TEXT,
  p_title             TEXT,
  p_body              TEXT,
  p_deeplink_screen   TEXT,
  p_deeplink_params   JSONB,
  p_related_entity_id UUID,
  p_exclude_user_id   UUID DEFAULT NULL,
  p_target_role       TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications
    (project_id, recipient_user_id, type, title, body,
     deeplink_screen, deeplink_params, related_entity_id)
  SELECT p_project_id, pa.user_id, p_type, p_title, p_body,
         p_deeplink_screen, p_deeplink_params, p_related_entity_id
  FROM project_assignments pa
  JOIN profiles p ON p.id = pa.user_id
  WHERE pa.project_id = p_project_id
    AND (p_exclude_user_id IS NULL OR pa.user_id <> p_exclude_user_id)
    AND (p_target_role IS NULL OR p.role = p_target_role);
END;
$$;
