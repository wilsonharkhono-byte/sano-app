-- 078 — plan_revisions audit trail + re-publish acknowledgment record
--        (Task 2.11, Phase 2 — HIGH)
--
-- Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md
--   §5 "Re-publish flow — diff, acknowledge, gate". The classifications,
--   activity scoping, acknowledgment UX and notification recipients below are
--   BINDING per that spec.
--
-- NUMBERING: this is 078, pasted AFTER 077 (material_baseline_snapshots).
--   Apply via the Dashboard SQL Editor (remote migration history diverged —
--   see project memory "Migration history divergence"). Idempotent, safe to
--   re-paste throughout.
--
-- ── The problem ─────────────────────────────────────────────────────────
--   A BoQ re-publish silently rewrites planned quantities under in-flight
--   requests/POs — the exact "signal erased by re-publish" the two-signal
--   design exists to prevent (spec §5). Today nothing records that a
--   re-publish happened, who acknowledged which ceiling change, or what was
--   in flight at the time. An auditor asking "who raised this material's
--   ceiling, when, and what was already ordered against the old plan?" has no
--   answer.
--
-- ── The fix ─────────────────────────────────────────────────────────────
--   Two append-only tables written by the client-orchestrated publish path
--   (tools/publishBaselineV2.ts) after the new ahs_version lands:
--     plan_revisions       — one row per re-publish over an existing master.
--     plan_revision_lines  — one row per material that has activity AND whose
--                            planned qty changed, classified per spec §5.
--   Plus a SECURITY DEFINER helper RPC notify_plan_revised the client calls to
--   fan a PLAN_REVISED notification out to supervisors ("Baseline diperbarui")
--   and an FYI to the principal.
--
-- ── Insert-after-acknowledge → append-only, no UPDATE policy ─────────────
--   The client acknowledges the diff BEFORE calling publish; publish then
--   writes the plan_revisions row with acknowledged_at ALREADY set. There is
--   therefore no "insert then later acknowledge" transition to support — the
--   row is complete at insert, so NO UPDATE policy exists on either table.
--   RLS-enabled + zero matching policies for a command denies it outright for
--   every non-owner role — this keeps the audit trail append-only by
--   construction, exactly as 077 does for baseline snapshots.
--
-- ── Why a client-called RPC and not a DB trigger for the notification ────
--   The publish is client-orchestrated across many statements (ahs_versions
--   demote/insert → boq_items → ahs_lines → master + lines → snapshots →
--   plan_revisions), not a single DB statement — a trigger has nothing atomic
--   to hang off. So the client calls notify_plan_revised after writing the
--   revision. The RPC is SECURITY DEFINER, asserts project access via
--   assert_project_access (061), and wraps each enqueue in its own EXCEPTION
--   handler so a notification failure can never sink the publish (034/067
--   never-block pattern).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_revisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The demoted (previous current) ahs_version, NULL on a project's very first
  -- publish (there is no prior version). A first publish writes NO revision at
  -- all (nothing was revised); this column is nullable only for forward-safety.
  old_ahs_version_id  UUID REFERENCES ahs_versions(id),
  new_ahs_version_id  UUID NOT NULL REFERENCES ahs_versions(id),
  published_by        UUID REFERENCES profiles(id),
  -- Set at INSERT time to the moment the client-side acknowledgment completed
  -- (insert-after-acknowledge, see header). Never NULL for a real revision.
  acknowledged_at     TIMESTAMPTZ,
  -- PlanRevisionSummary (tools/planRevisionDiff.ts): per-class counts +
  -- noActivityChanged + warningCount. The collapsed no-activity change count
  -- lives here, never as individual UNCHANGED_SUMMARY lines.
  summary             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE plan_revisions IS
  'Append-only audit trail of BoQ re-publishes over an existing master: who '
  'acknowledged which ceiling changes, when, and a summary of the classified '
  'diff. INSERT-only (insert-after-acknowledge) — no UPDATE/DELETE policy by '
  'design. See docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §5.';

CREATE INDEX IF NOT EXISTS plan_revisions_project_idx
  ON plan_revisions (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plan_revision_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id       UUID NOT NULL REFERENCES plan_revisions(id) ON DELETE CASCADE,
  material_id       UUID NOT NULL REFERENCES material_catalog(id),
  planned_before    NUMERIC NOT NULL,   -- base units; 0 for an ADDED material
  planned_after     NUMERIC NOT NULL,   -- base units; 0 for a REMOVED material
  ordered_at_time   NUMERIC NOT NULL DEFAULT 0,  -- non-cancelled PO qty at revision time
  requested_at_time NUMERIC NOT NULL DEFAULT 0,  -- non-rejected request qty at revision time
  -- Classification per spec §5 + controller's record-completeness additions.
  -- Only the first four are WARNING classes (needing an explicit tick);
  -- ADDED/LOWER are warning-free record lines. UNCHANGED_SUMMARY is permitted
  -- for completeness but the app never writes it as an individual line — its
  -- collapsed count lives in plan_revisions.summary.
  classification    TEXT NOT NULL CHECK (classification IN (
    'RAISE_ABSOLVING_OVERAGE',
    'RAISE',
    'LOWER_BELOW_ORDERED',
    'REMOVED_WITH_ACTIVITY',
    'ADDED',
    'LOWER',
    'UNCHANGED_SUMMARY'
  )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE plan_revision_lines IS
  'Per-material classified line of a re-publish diff (only materials WITH '
  'activity whose planned qty changed). Append-only — no UPDATE/DELETE policy.';

CREATE INDEX IF NOT EXISTS plan_revision_lines_revision_idx
  ON plan_revision_lines (revision_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS — SELECT for assigned ∪ office; INSERT for office (publish path);
--    NO UPDATE/DELETE policies (append-only, see header).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_revision_lines ENABLE ROW LEVEL SECURITY;

-- plan_revisions SELECT — assigned members (any role), mirrors the <assigned>
-- subquery used across the schema (059/077).
DROP POLICY IF EXISTS "plan_revisions_assigned_read" ON plan_revisions;
CREATE POLICY "plan_revisions_assigned_read" ON plan_revisions
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
  );

-- plan_revisions SELECT — office roles read across every project (036 model).
DROP POLICY IF EXISTS "plan_revisions_office_read" ON plan_revisions;
CREATE POLICY "plan_revisions_office_read" ON plan_revisions
  FOR SELECT USING (is_office_role());

-- plan_revisions INSERT — office only. Publish runs as the estimator (office
-- role); a supervisor's client can never write here.
DROP POLICY IF EXISTS "plan_revisions_office_insert" ON plan_revisions;
CREATE POLICY "plan_revisions_office_insert" ON plan_revisions
  FOR INSERT WITH CHECK (is_office_role());

-- plan_revision_lines SELECT — inherit the parent revision's read visibility
-- (assigned ∪ office). The line table carries no project_id, so it joins up.
DROP POLICY IF EXISTS "plan_revision_lines_read" ON plan_revision_lines;
CREATE POLICY "plan_revision_lines_read" ON plan_revision_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_revisions pr
      WHERE pr.id = plan_revision_lines.revision_id
        AND (
          pr.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
          OR is_office_role()
        )
    )
  );

-- plan_revision_lines INSERT — office only (same publish path as the header).
DROP POLICY IF EXISTS "plan_revision_lines_office_insert" ON plan_revision_lines;
CREATE POLICY "plan_revision_lines_office_insert" ON plan_revision_lines
  FOR INSERT WITH CHECK (is_office_role());

-- No UPDATE policy. No DELETE policy on either table. RLS-enabled + zero
-- matching policies for a command denies it outright for every non-owner role
-- — this IS the append-only enforcement, not just app-code discipline.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Widen notifications.type CHECK by shape (+ PLAN_REVISED).
--    Pattern: 067:68-87 (shape-match the sole type CHECK, drop + re-add with
--    the full explicit domain). Strict superset of 067's list — nothing dropped.
--    Re-paste-safe: the re-added constraint still matches the shape next run.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.notifications'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED'
    ));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. notify_plan_revised — client-called fan-out (supervisors + principal FYI).
--
--    The publish is client-orchestrated (see header), so the CLIENT invokes
--    this RPC after writing the revision. SECURITY DEFINER so it can enqueue;
--    assert_project_access (061) gates it to assigned/office callers (service
--    role / Dashboard pass through — auth.uid() IS NULL). Each enqueue is
--    EXCEPTION-wrapped: a notification failure logs and continues, never
--    surfacing to the publishing client (034/067 never-block pattern).
--
--    p_summary is a short human sentence built client-side (e.g. "3 material
--    dinaikkan, 1 melebihi order") — carried as the notification body.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_plan_revised(
  p_project_id  UUID,
  p_revision_id UUID,
  p_summary     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body TEXT := COALESCE(NULLIF(p_summary, ''), 'Rencana material proyek diperbarui.');
BEGIN
  -- Assigned/office gate (061). RAISEs insufficient_privilege for a caller with
  -- no access; the client treats notify failure as non-fatal, so this cannot
  -- corrupt an otherwise-successful publish.
  PERFORM assert_project_access(p_project_id);

  -- Supervisors: "Baseline diperbarui" — they finally learn a re-publish
  -- touching materials-with-activity happened at all (spec §5 step 5).
  BEGIN
    PERFORM enqueue_notification(
      p_project_id,
      'PLAN_REVISED',
      'Baseline diperbarui',
      v_body,
      'BaselineScreen',
      jsonb_build_object('revisionId', p_revision_id),
      p_revision_id,
      NULL,          -- p_exclude_user_id: none
      'supervisor'   -- p_target_role (066)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_plan_revised (supervisor) failed: %', SQLERRM;
  END;

  -- Principal: FYI on the ceiling change (spec §5 step 5 — the non-gate FYI;
  -- the Task 2.12 principal APPROVAL for RAISE_ABSOLVING_OVERAGE is separate).
  BEGIN
    PERFORM enqueue_notification(
      p_project_id,
      'PLAN_REVISED',
      'Baseline diperbarui',
      v_body,
      'BaselineScreen',
      jsonb_build_object('revisionId', p_revision_id),
      p_revision_id,
      NULL,          -- p_exclude_user_id: none
      'principal'    -- p_target_role (066)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_plan_revised (principal) failed: %', SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION notify_plan_revised(UUID, UUID, TEXT) TO authenticated;
