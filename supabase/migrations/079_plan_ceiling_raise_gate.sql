-- 079 — Principal gate on overage-absolving ceiling raises (Task 2.12, HIGH)
--
-- Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md
--   §5 step 4 ("Principal gate, narrowly scoped"): a re-publish that RAISES the
--   planned qty of a material CURRENTLY in overage (ordered > current planned)
--   holds until the principal approves. All other re-publishes flow with the
--   2.11 diff-and-acknowledge checklist only.
--
-- NUMBERING: this is 079, pasted AFTER 078 (plan_revisions). Apply via the
--   Dashboard SQL Editor (remote migration history diverged — see project memory
--   "Migration history divergence"). Idempotent / re-paste-safe throughout
--   (CREATE OR REPLACE, DROP … IF EXISTS, GRANT re-issued, DO-block CHECK swap).
--
-- ── The problem ─────────────────────────────────────────────────────────
--   The estimator both approves material requests AND publishes the plan. Without
--   this gate the estimator can "approve" an existing overage by simply
--   re-publishing a bigger plan: the material that was ordered above its ceiling
--   is now within a raised ceiling, Signal 1 recomputes green, and the only trace
--   is the permanent Signal-2 drift badge + the 2.11 plan_revisions row. The
--   spec's fix: that specific re-publish — a RAISE that ABSOLVES an already-placed
--   overage — needs principal authority, not the estimator's self-sign-off.
--
-- ── Enforcement boundary (HONEST — read this) ───────────────────────────
--   The publish is CLIENT-orchestrated across many statements (ahs_versions
--   demote/insert → boq_items → ahs_lines → master + lines → snapshots →
--   plan_revisions); there is no server publish endpoint to hang an absolute
--   DB-trigger gate on (moving publish server-side is out of scope — see 078's
--   "HONESTY BOUNDARY" comment and 2.11's RevisionContext note). So enforcement
--   here is, exactly as 2.11:
--     (1) SERVER-SIDE RECOMPUTE inside SECURITY DEFINER RPCs — both the breach
--         CLASSIFICATION and the approval VERIFICATION are computed from DB state
--         (current master plan + envelope ordered), NEVER from the client's 2.11
--         diff. A hostile client that omits/mislabels RAISE_ABSOLVING_OVERAGE
--         lines cannot skip the gate: assert_ceiling_raise_gate recomputes.
--     (2) APP-PATH ENFORCEMENT — tools/publishBaselineV2.ts calls
--         assert_ceiling_raise_gate before the version flip; a breach RAISEs and
--         the publish aborts with zero rows written.
--   ACCEPTED RESIDUAL (same as 2.11): a direct-REST / service-role / Dashboard
--   writer that bypasses publishBaselineV2 entirely can still rewrite the master
--   without calling the gate. Closing THAT requires a server-side publish
--   transaction (out of scope). This migration closes the app-path hole and makes
--   the classification/verification un-spoofable by the client that DOES use the
--   publish path — it is not a database-level guarantee against a rogue writer.
--
--   The one input the gate trusts from the client is p_proposed — the aggregated
--   per-material planned of the WOULD-BE new master (the same numbers the client
--   is about to write). If the client lies here it is simply writing different
--   numbers than it claimed, which the plan_revisions trail records anyway; the
--   SERVER-computed halves (planned_before, ordered) are what the gate keys off.
--
-- ── Notification asymmetry (pre-existing gap, deliberately NOT fixed here) ─
--   Section 3 adds an AFTER INSERT principal notification for plan_ceiling_raise
--   escalations. NOTE the asymmetry: the existing po_qty_gate (071) and price
--   (po_line) escalations have NO principal notification trigger at all — the
--   principal learns of those only by opening the queue. Fixing that is out of
--   THIS task's scope; it is called out so the inconsistency is a known, recorded
--   decision, not an oversight.
--
-- ── entity_type is free TEXT — nothing to widen ─────────────────────────
--   approval_tasks.entity_type is a plain TEXT column with no CHECK (002:412);
--   071 introduced 'po_qty_gate' the same way. This migration uses
--   entity_type='plan_ceiling_raise' with no schema change to approval_tasks
--   beyond reusing 071's override_payload JSONB column and 071's pinned INSERT
--   policy (action IS NULL AND acted_at IS NULL) which admits the pending row.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Widen notifications.type CHECK by shape (+ PLAN_CEILING_RAISE).
--    Pattern: 078:174-194 / 067:68-87 — shape-match the sole type CHECK, drop +
--    re-add with the full explicit domain. Strict superset of 078's list
--    (which already added PLAN_REVISED) — nothing dropped. Re-paste-safe.
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
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE'
    ));
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2a. compute_ceiling_breaches — the ONLY source of the breach set.
--
--   SECURITY DEFINER, assert_project_access-gated (061). Given the project and
--   p_proposed (the aggregated per-material planned of the would-be new master,
--   [{material_id, planned_qty}]), returns the materials that ARE in overage
--   and whose ceiling is being raised:
--     planned_before  — the CURRENT latest master's plan for the material. Read
--                       from v_material_envelope_status.total_planned, which is
--                       already scoped to the latest master (054/068) — so it is
--                       exactly the "before" the 2.11 diff and the client's
--                       fetchCurrentMaster compare against.
--     ordered         — v_material_envelope_status.total_ordered (068: non-
--                       CANCELLED SANO PO lines, CLOSED_SHORT capped at received).
--     proposed        — the client-supplied would-be new plan (see header: the
--                       one trusted input; the numbers being written).
--   BREACH ⇔ ordered > planned_before AND proposed > planned_before. This is the
--   server twin of tools/planRevisionDiff.classifyPlanChange's
--   RAISE_ABSOLVING_OVERAGE (inCurrent && inNew && after>before && ordered>before):
--   the INNER JOIN to the envelope view guarantees the material is in the current
--   master (inCurrent); p_proposed guarantees inNew.
--
--   Security composition: the function is SECURITY DEFINER but
--   v_material_envelope_status is security_invoker=on (061/068). Inside a DEFINER
--   function current_user is the function owner, so the view's underlying-table
--   RLS resolves under the owner (table owner / superuser → no RLS filtering).
--   auth.uid() still reflects the caller's JWT, so assert_project_access below
--   authorizes the REAL caller, not the owner. Net: an authorized caller sees the
--   project's true envelope figures; an unauthorized one is rejected before any
--   read. Service-role / Dashboard (auth.uid() IS NULL) pass assert_project_access
--   and bypass RLS — used by the SQL walkthrough.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_ceiling_breaches(
  p_project_id UUID,
  p_proposed   JSONB
) RETURNS TABLE (
  material_id    UUID,
  material_name  TEXT,
  planned_before NUMERIC,
  proposed       NUMERIC,
  ordered        NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Resolve any name that matches both a query column and this function's OUT
-- params (material_id/planned_before/proposed/ordered) to the COLUMN — belt-and-
-- suspenders against plpgsql's default variable_conflict=error, even though every
-- real reference below is already table-qualified.
#variable_conflict use_column
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  WITH proposed AS (
    -- Aggregate defensively: if the client sends a material twice, sum it (the
    -- gate compares a single per-material ceiling, matching the master's grain).
    SELECT (e->>'material_id')::UUID          AS material_id,
           SUM((e->>'planned_qty')::NUMERIC)  AS proposed
    FROM jsonb_array_elements(COALESCE(p_proposed, '[]'::jsonb)) AS e
    WHERE NULLIF(e->>'material_id', '') IS NOT NULL
    GROUP BY 1
  )
  SELECT
    p.material_id,
    COALESCE(env.material_name, mc.name, 'material') AS material_name,
    env.total_planned                                AS planned_before,
    p.proposed                                       AS proposed,
    COALESCE(env.total_ordered, 0)                   AS ordered
  FROM proposed p
  JOIN v_material_envelope_status env
    ON env.project_id = p_project_id
   AND env.material_id = p.material_id
  LEFT JOIN material_catalog mc ON mc.id = p.material_id
  WHERE env.total_planned > 0
    AND COALESCE(env.total_ordered, 0) > env.total_planned  -- currently in overage
    AND p.proposed > env.total_planned;                     -- and the ceiling is raised
END;
$$;

GRANT EXECUTE ON FUNCTION compute_ceiling_breaches(UUID, JSONB) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2b. assert_ceiling_raise_gate — the publish-path gate.
--
--   SECURITY DEFINER, assert_project_access-gated. Recomputes the breach set by
--   calling compute_ceiling_breaches (shared logic, one source of truth). If the
--   set is empty → returns silently (no gate). Otherwise requires an approval
--   task that:
--     - is referenced by p_approval_task_id,
--     - exists AND project_id = p_project_id,
--     - entity_type = 'plan_ceiling_raise',
--     - action IN ('APPROVE','OVERRIDE')  (the principal's verdict; OVERRIDE
--       accepted belt-and-suspenders, mirroring 071's po_qty_gate handling),
--   and whose override_payload covers EVERY breaching material with an authorised
--   proposed_qty >= the current proposed ceiling (071's coverage pattern, keyed
--   on proposed_qty here instead of attempted_qty). A material absent from the
--   payload, or approved for a smaller ceiling than the estimator now proposes,
--   stays uncovered → RAISE.
--
--   Error contract: RAISEs with the stable machine-readable prefix
--   'PLAN_CEILING_BREACH:' so the client can branch on it (tools/publishBaselineV2
--   sets ceilingApprovalRequired; BaselineScreen renders the breach panel). The
--   message lists each uncovered material.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assert_ceiling_raise_gate(
  p_project_id       UUID,
  p_proposed         JSONB,
  p_approval_task_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload   JSONB;
  v_uncovered TEXT;
BEGIN
  PERFORM assert_project_access(p_project_id);

  -- Load the override payload only from a VALID, decided-in-the-principal's-favor
  -- plan_ceiling_raise task for THIS project. A missing / mismatched / HOLD /
  -- REJECT / NULL task leaves v_payload NULL, so every breach stays uncovered.
  IF p_approval_task_id IS NOT NULL THEN
    SELECT override_payload
    INTO v_payload
    FROM approval_tasks
    WHERE id = p_approval_task_id
      AND project_id = p_project_id
      AND entity_type = 'plan_ceiling_raise'
      AND action IN ('APPROVE', 'OVERRIDE');
  END IF;

  -- Recompute the breach set (server-side, from DB state) and collect any
  -- breaching material NOT covered by the approved payload. string_agg over an
  -- empty breach set is NULL → no RAISE → silent pass (the no-breach / fully
  -- covered cases).
  SELECT string_agg(
           format('%s (rencana lama %s, diusulkan %s, sudah order %s)',
                  b.material_name,
                  round(b.planned_before, 3),
                  round(b.proposed, 3),
                  round(b.ordered, 3)),
           '; ' ORDER BY b.material_name)
  INTO v_uncovered
  FROM compute_ceiling_breaches(p_project_id, p_proposed) AS b
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_payload, '[]'::jsonb)) AS e
    WHERE (e->>'material_id')::UUID = b.material_id
      AND (e->>'proposed_qty')::NUMERIC >= b.proposed
  );

  IF v_uncovered IS NOT NULL THEN
    RAISE EXCEPTION 'PLAN_CEILING_BREACH: kenaikan plafon material yang sedang over-order perlu persetujuan prinsipal — %', v_uncovered
      USING HINT = 'Eskalasi ke prinsipal, tunggu persetujuan, lalu publish ulang dengan task yang disetujui; atau kembalikan rencana material tsb ke nilai lama.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assert_ceiling_raise_gate(UUID, JSONB, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Principal notification on escalation insert.
--
--   AFTER INSERT trigger on approval_tasks, fired only for the
--   plan_ceiling_raise rows (WHEN clause), enqueues a principal-targeted
--   PLAN_CEILING_RAISE notification deeplinking to the Approvals queue (066's
--   p_target_role, 067's enqueue pattern). EXCEPTION-wrapped so a notification
--   failure can never sink the escalation INSERT (034/067 never-block).
--
--   Deeplink 'ApprovalsScreen' → the principal's Approvals tab (their reachable
--   approval queue; tools/notificationRouting.ts resolves ApprovalsScreen →
--   'Approvals' for the principal). That is where office/screens/ApprovalsScreen
--   renders the plan_ceiling_raise card (Gate2Screen/Procurement is NOT in the
--   principal's navigation).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_plan_ceiling_raise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM enqueue_notification(
      NEW.project_id,
      'PLAN_CEILING_RAISE',
      'Persetujuan kenaikan plafon material',
      'Re-publish menaikkan plafon material yang sudah melebihi order — perlu keputusan prinsipal.',
      'ApprovalsScreen',
      jsonb_build_object('taskId', NEW.id),
      NEW.id,
      NULL,          -- p_exclude_user_id: none
      'principal'    -- p_target_role (066)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_plan_ceiling_raise failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS approval_tasks_notify_ceiling_raise_trg ON approval_tasks;
CREATE TRIGGER approval_tasks_notify_ceiling_raise_trg
  AFTER INSERT ON approval_tasks
  FOR EACH ROW
  WHEN (NEW.entity_type = 'plan_ceiling_raise')
  EXECUTE FUNCTION notify_plan_ceiling_raise();
