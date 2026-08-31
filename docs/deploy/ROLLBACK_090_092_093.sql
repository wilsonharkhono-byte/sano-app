-- ROLLBACK for the 2026-08-28 application of migrations 090, 092, 093
-- to the SANO production database (project ufntlqvacjhmddwltcxf).
--
-- Applied in this order: 090 -> 092 -> 093.
-- Pre-existing live state at time of application:
--   066 live (9-arg enqueue_notification)   085 live (mr_request_summary)
--   088 live (notify_header_status_change)  089 NOT applied  090 NOT applied
--   notifications_select_own was 034's:  (auth.uid() = recipient_user_id)
--   enforce_profile_role_immutable was 057's version
--   enforce_principal_assignment_guard did not exist
--
-- ── 1. Undo 093's membership back-fill ──────────────────────────────────
-- Exactly the 8 rows that did not exist before. Safe: deletes only these.
-- The principal-roster guard refuses non-principal JWT actors, so run this
-- from the Dashboard SQL editor or service role (auth.uid() IS NULL).

DELETE FROM project_assignments pa
USING (VALUES
  ('ca5696c2-4bdf-438b-949b-9dab767b0dbb','1547ec3b-92ec-47e1-be60-65651fb2bb92'), -- Jeremia  BDG-D-18
  ('b0eb0da4-8ee4-455a-9c12-8d32a642e041','1547ec3b-92ec-47e1-be60-65651fb2bb92'), -- Jeremia  JKT-001
  ('aaaaaaaa-0000-0000-0000-000000000001','1547ec3b-92ec-47e1-be60-65651fb2bb92'), -- Jeremia  PRJ-ALPHA
  ('aaaaaaaa-0000-0000-0000-000000000002','1547ec3b-92ec-47e1-be60-65651fb2bb92'), -- Jeremia  PRJ-BETA
  ('aaaaaaaa-0000-0000-0000-000000000003','1547ec3b-92ec-47e1-be60-65651fb2bb92'), -- Jeremia  PRJ-CHARLIE
  ('11e59d22-5aa8-436e-b82d-ccbd6c2bdd7d','00000000-0000-0000-0000-000000000004'), -- Santoso  SBY-001
  ('aaaaaaaa-0000-0000-0000-000000000002','3e539916-bb3f-4705-a5c5-8af5535de6aa'), -- Wilson   PRJ-BETA
  ('aaaaaaaa-0000-0000-0000-000000000003','3e539916-bb3f-4705-a5c5-8af5535de6aa')  -- Wilson   PRJ-CHARLIE
) AS v(project_id, user_id)
WHERE pa.project_id = v.project_id::uuid AND pa.user_id = v.user_id::uuid;

-- ── 2. Undo 093's auto-assign triggers ──────────────────────────────────
DROP TRIGGER  IF EXISTS projects_auto_assign_principals_trg ON projects;
DROP TRIGGER  IF EXISTS profiles_principal_membership_trg   ON profiles;
DROP FUNCTION IF EXISTS auto_assign_principals_to_project();
DROP FUNCTION IF EXISTS auto_assign_principal_to_all_projects();

-- ── 3. Undo 090's roster guard (it did not exist before) ────────────────
DROP TRIGGER  IF EXISTS project_assignments_principal_guard_trg ON project_assignments;
DROP FUNCTION IF EXISTS enforce_principal_assignment_guard();

-- ── 4. Undo 092's read policy: restore 034's recipient-only rule ────────
DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (auth.uid() = recipient_user_id);

-- ── 5. Undo 092's helper functions ──────────────────────────────────────
DROP FUNCTION IF EXISTS mr_owning_estimator(UUID, UUID);
DROP FUNCTION IF EXISTS enqueue_notification_user(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID[], TEXT[]);

-- ── 6. Restore the replaced notification functions ──────────────────────
-- These are best restored by RE-RUNNING the migration files that owned them,
-- because their bodies are long and must match exactly:
--   notify_header_status_change  -> re-run 088_approval_po_separation.sql section 9
--   notify_po_ready              -> re-run 085_notification_detail.sql section 4
--   notify_receipt_mismatch      -> re-run 085_notification_detail.sql section 5
--   enforce_profile_role_immutable -> re-run 057_lock_profile_role.sql
-- Re-running whole 085 then 088 in that order restores the pre-092 state.
