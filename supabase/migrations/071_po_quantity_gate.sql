-- 071 — Hard quantity gate at PO creation (Signal 1, PO-time enforcement)
-- (Task 2.6; design docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §3)
--
-- Paste order: AFTER 068 (which re-modelled v_material_envelope_status so that
--   total_ordered = non-CANCELLED SANO purchase-order lines — this gate keys off
--   that PO-based figure) and AFTER 070 (latest applied migration). Apply via the
--   Dashboard SQL Editor (remote migration history diverged — see project memory).
--   Idempotent / re-paste-safe throughout (ADD COLUMN IF NOT EXISTS, DROP FUNCTION
--   IF EXISTS + CREATE, GRANT re-issued).
--
-- Problem this closes:
--   create_purchase_order (055:84-148, SECURITY INVOKER) writes header + lines +
--   price_history + activity_log atomically but has NO quantity check. Gate 2 today
--   is price-only and advisory. Per the locked two-signal design, PO creation is
--   the ONE hard quantity gate: cumulative ordered must not exceed the current
--   published plan without a principal override.
--
-- What this migration does:
--   1. approval_tasks.override_payload JSONB — carries the escalation contract
--      [{material_id, attempted_qty, remaining_at_escalation}] for a PO-quantity
--      override task (entity_type='po_qty_gate'). A dedicated column (not `reason`)
--      because the principal's verdict UPDATE overwrites `reason` — the payload
--      must survive approval so this RPC can read it.
--   2. approval_tasks_office_insert (060) re-created with the verdict columns
--      pinned to NULL on INSERT — closes a forgery path where an assigned office
--      user could INSERT an already-"APPROVED" po_qty_gate task via REST, skipping
--      the principal entirely. See "Override contract" below.
--   3. create_purchase_order re-created with a NEW trailing param
--      p_override_task_id UUID DEFAULT NULL and a per-material quantity gate.
--
-- ── The gate (step-by-step) ────────────────────────────────────────────────
--   • Aggregate attempted qty PER material_id across the incoming lines (a single
--     over-order split into two lines is caught as the material total — same GROUP
--     BY the client mirror tools/poQuantityGate.ts does).
--   • remaining = total_planned − total_ordered, read from v_material_envelope_status
--     (068: total_ordered excludes CANCELLED POs; CLOSED_SHORT is capped at received
--     via the view's LEAST(...) arm — forward-compatible, no CLOSED_SHORT rows exist
--     until Task 2.7/072). If attempted > remaining → the material BREACHES.
--   • Only materials with total_planned > 0 are measurable. Free-text lines
--     (material_id NULL) never join the envelope, and a linked material with no
--     envelope row / zero plan is treated as UNMEASURED — never blocked (design §3:
--     "no baseline → unknown, never blocks"). Unmeasured over-orders are where the
--     worst overages hide, but a quantity we cannot compare against a plan must not
--     be fabricated into a block.
--   • Any breach ⇒ RAISE (whole transaction aborts, nothing written) UNLESS a valid
--     override covers every breaching material.
--
-- ── Override contract ──────────────────────────────────────────────────────
--   p_override_task_id must reference an approval_tasks row that:
--     - exists AND project_id = p_project_id
--     - entity_type = 'po_qty_gate'
--     - action IN ('APPROVE', 'OVERRIDE')   (the principal's verdict; see
--       Gate2Screen. OVERRIDE is accepted belt-and-suspenders for any legacy
--       row written before Gate2Screen restricted po_qty_gate cards to
--       Approve/Reject only — see post-review fix below.)
--   and whose override_payload contains each breaching material with
--   attempted_qty >= this PO's attempted qty for that material. A material not in
--   the payload, or approved for a smaller qty, stays uncovered → RAISE.
--   Known v1 limitation (documented): an APPROVED override is not consumed/marked
--   single-use, so it authorises up to attempted_qty and could in principle back a
--   second identical over-order until a future task adds single-use enforcement.
--   The audit trail (approval_tasks row + activity_log) records each use. A
--   related consequence: because the ceiling is attempted_qty-based and remaining
--   is not rechecked at use time, an override approved when remaining was R still
--   passes after remaining shrinks — the effective overage can exceed what the
--   principal saw at escalation.
--
--   Post-review (genuinely principal-gated): approval_tasks_office_insert (060)
--   is re-created below with the verdict columns pinned — WITH CHECK now requires
--   action IS NULL AND acted_at IS NULL on INSERT. An assigned office user can
--   therefore only create a *pending* po_qty_gate task; the verdict (action/
--   acted_at) can be written ONLY through 060's approval_tasks_principal_update
--   policy (principal + assigned). Before this fix, the INSERT policy had no
--   column constraints, so an assigned admin/estimator could INSERT a task with
--   action='APPROVE' and an arbitrary override_payload directly via REST and feed
--   its id to this RPC — zero principal involvement. Residual (design-accepted)
--   bypass: office can still insert PO lines directly via 002's
--   po_lines_office_insert, which this gate does not touch — that path was never
--   in scope for the quantity gate and remains a known, accepted gap.
--
-- ── Error contract ─────────────────────────────────────────────────────────
--   On an uncovered breach the RPC RAISEs with the default errcode (P0001 /
--   raise_exception) and a stable machine-readable prefix 'PO_QTY_BREACH:' in the
--   message so the client can branch on it. The message lists each uncovered
--   material with its remaining + attempted.
--
-- ── Security composition (verified) ────────────────────────────────────────
--   This RPC is SECURITY INVOKER; it is called by office users (admin/estimator —
--   post-060 supervisors are read-only on POs). v_material_envelope_status is
--   security_invoker=on (061/068), so the view resolves rows under the caller's
--   RLS. Office roles have global project read (036) + read policies on the
--   envelope base tables, and approval_tasks_office_read (060) lets them SELECT the
--   override task. So INVOKER-RPC + invoker-view compose cleanly: the gate sees the
--   same envelope figures the caller would see directly. No SECURITY DEFINER is
--   needed or wanted here (a definer gate reading an invoker view would run the
--   view as the definer, decoupling it from RLS — avoided).
--
-- ── Overload hygiene / re-paste safety ─────────────────────────────────────
--   Adding a trailing param changes the signature (12 args → 13). A bare
--   `CREATE OR REPLACE FUNCTION` with the new 13-arg signature would leave BOTH
--   the old 12-arg and new 13-arg functions installed as an overload (Postgres
--   treats a different arg list as a different function); a bare positional call
--   could then route to the stale one. So we DROP the exact 055 12-arg signature
--   FIRST (removes that stale overload), then `CREATE OR REPLACE FUNCTION` the
--   13-arg version — NOT a bare `CREATE FUNCTION`, which fails with 42723
--   ("function already exists") the second time this migration is pasted (same
--   mistake 0529a4c fixed for 055's submit_receipt — this migration's header
--   claimed re-paste-safety while the body wasn't; now it is: the DROP is a no-op
--   on repaste since the 12-arg signature no longer exists, and CREATE OR REPLACE
--   on the 13-arg signature is idempotent). The new last param has a DEFAULT, so
--   existing named-arg callers that pass only the original 12 keep resolving.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. approval_tasks.override_payload — survives the principal's verdict UPDATE.
--    (Column-level default NULL; existing rows read NULL. Covered by the table's
--     existing authenticated grants and 060's row-level policies — no new grant.)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE approval_tasks
  ADD COLUMN IF NOT EXISTS override_payload JSONB;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. approval_tasks_office_insert — pin the verdict columns so an INSERT can
--    never masquerade as an already-decided task. Re-created from 060's exact
--    policy body (is_office_role() + assigned-project subquery), with two ANDed
--    pins added: action IS NULL AND acted_at IS NULL. A verdict (action/
--    acted_at) can then be written ONLY through 060's
--    approval_tasks_principal_update policy (principal + assigned) — the only
--    path that can turn a po_qty_gate task into something this RPC will accept
--    as p_override_task_id. Both app escalation writers already insert without
--    action/acted_at (Gate2Screen.tsx handleEscalate / handleEscalateQuantity),
--    so this is a pure tightening — no legitimate insert changes behavior.
--    Idempotent: DROP POLICY IF EXISTS + CREATE POLICY, safe to re-paste.
-- ═══════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "approval_tasks_office_insert" ON approval_tasks;
CREATE POLICY "approval_tasks_office_insert" ON approval_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_office_role()
    AND project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
    AND action IS NULL
    AND acted_at IS NULL
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. create_purchase_order — DROP the 055 12-arg signature, re-create with the
--    quantity gate + p_override_task_id. Header/lines/price_history/activity_log
--    bodies are byte-identical to 055 (including request_line_id plumbing).
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS create_purchase_order(
  UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, UUID, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION create_purchase_order(
  p_project_id      UUID,
  p_po_number       TEXT,
  p_boq_ref         TEXT,
  p_supplier        TEXT,
  p_material_name   TEXT,
  p_quantity        NUMERIC,
  p_unit            TEXT,
  p_unit_price      NUMERIC,
  p_ordered_date    DATE,
  p_user_id         UUID,
  p_activity_label  TEXT,
  p_lines           JSONB,
  p_override_task_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_po_id     UUID;
  v_breaches  JSONB;
  v_payload   JSONB;
  v_uncovered TEXT;
BEGIN
  -- ── QUANTITY GATE (runs BEFORE any write) ─────────────────────────────
  -- Per-material attempted (linked lines only) vs remaining = planned − ordered.
  -- Only measurable materials (total_planned > 0) can breach.
  WITH incoming AS (
    SELECT NULLIF(line->>'material_id', '')::UUID AS material_id,
           SUM((line->>'quantity')::NUMERIC)      AS attempted
    FROM jsonb_array_elements(p_lines) AS line
    WHERE NULLIF(line->>'material_id', '') IS NOT NULL
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
           'material_id',   i.material_id,
           'material_name', COALESCE(env.material_name, mc.name, 'material'),
           'remaining',     (env.total_planned - env.total_ordered),
           'attempted',     i.attempted))
  INTO v_breaches
  FROM incoming i
  JOIN v_material_envelope_status env
    ON env.project_id = p_project_id
   AND env.material_id = i.material_id
  LEFT JOIN material_catalog mc ON mc.id = i.material_id
  WHERE env.total_planned > 0
    AND i.attempted > (env.total_planned - env.total_ordered);

  IF v_breaches IS NOT NULL AND jsonb_array_length(v_breaches) > 0 THEN
    -- Load the override payload only from a VALID, decided-in-the-principal's-
    -- favor po_qty_gate task for THIS project. action IN ('APPROVE', 'OVERRIDE')
    -- — OVERRIDE accepted belt-and-suspenders for any legacy row (Gate2Screen now
    -- renders only Approve/Reject for po_qty_gate cards, so new rows are always
    -- APPROVE, but a pre-existing OVERRIDE-verdict row must still be usable, not
    -- a dead end). A missing/mismatched/HOLD/REJECT task leaves v_payload NULL,
    -- so every breach stays uncovered and we RAISE below.
    IF p_override_task_id IS NOT NULL THEN
      SELECT override_payload
      INTO v_payload
      FROM approval_tasks
      WHERE id = p_override_task_id
        AND project_id = p_project_id
        AND entity_type = 'po_qty_gate'
        AND action IN ('APPROVE', 'OVERRIDE');
    END IF;

    -- A breaching material passes ONLY if the payload lists it with an authorised
    -- attempted_qty >= this PO's attempted qty. Collect the ones that do NOT.
    SELECT string_agg(
             format('%s (sisa %s, diminta %s)',
                    b.material_name, round(b.remaining, 3), round(b.attempted, 3)),
             '; ' ORDER BY b.material_name)
    INTO v_uncovered
    FROM jsonb_to_recordset(v_breaches)
         AS b(material_id UUID, material_name TEXT, remaining NUMERIC, attempted NUMERIC)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_payload, '[]'::JSONB)) AS e
      WHERE (e->>'material_id')::UUID = b.material_id
        AND (e->>'attempted_qty')::NUMERIC >= b.attempted
    );

    IF v_uncovered IS NOT NULL THEN
      RAISE EXCEPTION 'PO_QTY_BREACH: melebihi alokasi — %', v_uncovered
        USING HINT = 'Eskalasi ke prinsipal untuk override kuantitas, lalu buat ulang PO dengan task yang disetujui.';
    END IF;
    -- else: every breaching material covered by the approved override → proceed.
  END IF;

  -- ── Writes (identical to 055) ─────────────────────────────────────────
  -- 1. Header
  INSERT INTO purchase_orders (
    project_id, po_number, boq_ref, supplier, material_name,
    quantity, unit, unit_price, ordered_date, status
  )
  VALUES (
    p_project_id, p_po_number, p_boq_ref, p_supplier, p_material_name,
    p_quantity, p_unit, p_unit_price, p_ordered_date, 'OPEN'
  )
  RETURNING id INTO v_po_id;

  -- 2. Lines (carrying request_line_id when the caller supplies one)
  INSERT INTO purchase_order_lines (
    po_id, material_id, material_name, quantity, unit, unit_price, scope_tag,
    request_line_id
  )
  SELECT
    v_po_id,
    NULLIF(line->>'material_id', '')::UUID,
    line->>'material_name',
    (line->>'quantity')::NUMERIC,
    line->>'unit',
    (line->>'unit_price')::NUMERIC,
    NULLIF(line->>'scope_tag', ''),
    NULLIF(line->>'request_line_id', '')::UUID
  FROM jsonb_array_elements(p_lines) AS line;

  -- 3. Price history (one row per line)
  INSERT INTO price_history (project_id, material_id, vendor, unit_price, recorded_at)
  SELECT
    p_project_id,
    NULLIF(line->>'material_id', '')::UUID,
    p_supplier,
    (line->>'unit_price')::NUMERIC,
    now()
  FROM jsonb_array_elements(p_lines) AS line;

  -- 4. Activity log
  INSERT INTO activity_log (project_id, user_id, type, label, flag)
  VALUES (p_project_id, p_user_id, 'permintaan', p_activity_label, 'INFO');

  RETURN v_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase_order(
  UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, DATE, UUID, TEXT, JSONB, UUID
) TO authenticated;
