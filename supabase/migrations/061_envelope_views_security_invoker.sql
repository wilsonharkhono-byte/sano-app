-- 061 — Stop cross-tenant reads through envelope/budget views + RPCs
-- (Task 0.5, audit gap G8)
--
-- Problem: v_material_envelopes (004, re-created 054), v_material_envelope_status
--   (004, re-created 055) and v_material_budget_status (047) were created WITHOUT
--   `security_invoker`, so they execute with the view OWNER's privileges and
--   BYPASS RLS on every underlying table. Any authenticated user — assigned to
--   any project or none — could SELECT any project's planned quantities,
--   benchmark prices and budget totals straight through the views. This is the
--   exact bug class 042_secure_contract_totals.sql closed for the unsettled-total
--   RPCs; 042's assert_contract_access is the model for the guard below.
--
-- Fix — three pieces:
--   1. assert_project_access(p_project_id) — reusable guard, modeled verbatim
--      on assert_contract_access (042:17-44): office role (admin/principal/
--      estimator, per is_office_role() from 036) OR caller assigned to the
--      project, else RAISE with ERRCODE 'insufficient_privilege'. An exception,
--      NOT an empty result — empty would leak "project exists" semantics and
--      feed silent zeros into gate math. auth.uid() IS NULL (service-role key /
--      Dashboard SQL editor — no JWT) is allowed through, the same trusted-
--      context exception as 057/059/060.
--   2. Flip the three views to `security_invoker = on` via ALTER VIEW ... SET.
--      Deliberately NOT re-CREATEing the bodies: the bodies stay whatever the
--      latest migration defined (054 for v_material_envelopes, 055 for
--      v_material_envelope_status, 047 for v_material_budget_status), so this
--      migration cannot drift from them. ALTER VIEW ... SET is idempotent;
--      each is wrapped in a to_regclass() guard so a re-paste on a remote
--      where a view doesn't exist yet skips instead of aborting the batch.
--   3. CREATE OR REPLACE the four envelope RPCs with the guard as their first
--      statement. Bodies otherwise preserved from their latest definitions:
--        get_material_envelope       — 004_boq_parser_extensions.sql:127-150
--        get_envelope_boq_breakdown  — 004_boq_parser_extensions.sql:153-180
--        get_workgroup_envelope      — 041_workgroup_envelope_installed.sql
--                                      (041 superseded 039; same 3-arg signature)
--        get_material_budget         — 047_material_tier_budget_control.sql:93-117
--      All four were LANGUAGE sql; converted to plpgsql so the guard can RAISE
--      (same conversion 042 did for get_unsettled_worker_attendance_total).
--      In plpgsql, RETURNS TABLE column names become variables, so previously
--      unqualified column references (which would now be ambiguous) are
--      table-qualified via an alias — a mechanical change, not a semantic one.
--      Signatures (names, arg types, return shapes) are byte-identical, so
--      existing callers (tools/envelopes.ts, PermintaanScreen.tsx) resolve
--      unchanged and CREATE OR REPLACE introduces no overload.
--
--   The RPCs stay SECURITY INVOKER (their default before this migration): with
--   the views now invoker too, RLS on the underlying tables applies through the
--   whole chain, and the guard adds clean error semantics on top (defense in
--   depth — the RPCs never leaked by themselves).
--
-- Why flipping the views does NOT blank the app for assigned supervisors —
-- every underlying table already has assigned-SELECT (or read-all) coverage:
--   project_material_master        — assigned_select   010:129-137
--   project_material_master_lines  — assigned_select   010:200-210
--   material_request_headers       — assigned_select   002:896-902
--   material_request_lines         — assigned_select   002:936-946
--   receipts                       — assigned_select   002:1013-1019
--   receipt_lines                  — assigned_select   002:1031-1041
--   material_request_line_allocations — assigned_select 005:73-84
--   boq_items                      — assigned_read     059:99-101
--   material_catalog               — read-all (authenticated) 002:717-719
--   ahs_price_book                 — read-all (authenticated) 047:45-47
-- Office users on unassigned projects keep working via 036's *_office_all
-- FOR ALL policies (SELECT included) on the project-scoped tables above plus
-- is_office_role() in the guard. The service role bypasses RLS entirely
-- (rolbypassrls), and the Dashboard runs as the table owner — both unaffected.
--
-- Trigger-path check (no regression): compute_tier2_flag (033:55) and
-- compute_tier3_flag (048:38) SELECT from v_material_envelope_status /
-- v_material_budget_status, but both are SECURITY DEFINER owned by the
-- migration role — inside a DEFINER function the views' "invoker" is the
-- function owner, which owns the underlying tables, so RLS does not filter
-- and the Gate-1 trigger machinery is unchanged. compute_tier1_workgroup_flag
-- (056) re-derives from base tables and calls NONE of the four RPCs, so the
-- guard never runs in trigger context.
--
-- ⚠ SEQUENCING (for future migrations): a later migration (planned 068,
--   envelope re-model / task 2.3 ordered-from-PO) will re-CREATE
--   v_material_envelope_status. CREATE OR REPLACE VIEW **resets reloptions**
--   unless restated, so that migration MUST carry
--   `WITH (security_invoker = on)` explicitly or it silently reopens this
--   leak. The same rule applies to ANY future re-CREATE of these three views.
--
-- Idempotent / re-paste-safe: CREATE OR REPLACE + guarded ALTER VIEW ... SET.
-- Apply via Dashboard SQL Editor (remote migration history diverged).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Reusable guard — modeled on assert_contract_access (042).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_project_access(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role key / Dashboard SQL editor: no JWT, auth.uid() IS NULL.
  -- Trusted execution context — same exception as 057/059/060.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- auth.uid() reflects the request JWT even inside SECURITY DEFINER, so the
  -- membership check is evaluated against the *caller*, not the function owner.
  IF is_office_role() OR EXISTS (
    SELECT 1
    FROM project_assignments
    WHERE user_id = auth.uid()
      AND project_id = p_project_id
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'not authorized for project %', p_project_id
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

GRANT EXECUTE ON FUNCTION assert_project_access(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Flip the three views to security_invoker. Bodies untouched (see header).
--    to_regclass() guard: skip (not abort) on a remote missing a view.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v TEXT;
  views TEXT[] := ARRAY[
    'v_material_envelopes',       -- body: 054 (originally 004)
    'v_material_envelope_status', -- body: 055 (originally 004)
    'v_material_budget_status'    -- body: 047
  ];
BEGIN
  FOREACH v IN ARRAY views LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3a. get_material_envelope — body from 004:127-150, guard prepended.
--     Column refs qualified with alias `v` (plpgsql ambiguity, see header).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_material_envelope(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  tier SMALLINT,
  unit TEXT,
  total_planned NUMERIC,
  total_ordered NUMERIC,
  total_received NUMERIC,
  remaining_to_order NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  SELECT
    v.material_id, v.material_name, v.tier, v.unit,
    v.total_planned, v.total_ordered, v.total_received,
    v.remaining_to_order, v.burn_pct, v.boq_item_count
  FROM v_material_envelope_status v
  WHERE v.project_id = p_project_id
    AND v.material_id = p_material_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3b. get_envelope_boq_breakdown — body from 004:153-180, guard prepended.
--     Body refs were already table-qualified; copied verbatim.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_envelope_boq_breakdown(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  boq_item_id UUID,
  boq_code TEXT,
  boq_label TEXT,
  planned_quantity NUMERIC,
  pct_of_total NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  SELECT
    pmml.boq_item_id,
    bi.code,
    bi.label,
    pmml.planned_quantity,
    CASE
      WHEN SUM(pmml.planned_quantity) OVER () > 0
      THEN ROUND((pmml.planned_quantity / SUM(pmml.planned_quantity) OVER ()) * 100, 1)
      ELSE 0
    END AS pct_of_total
  FROM project_material_master_lines pmml
  JOIN project_material_master pmm ON pmm.id = pmml.master_id
  JOIN boq_items bi ON bi.id = pmml.boq_item_id
  WHERE pmm.project_id = p_project_id
    AND pmml.material_id = p_material_id
  ORDER BY pmml.planned_quantity DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3c. get_workgroup_envelope — body from 041 (superseded 039's shape; 041
--     already DROPped the old overload), guard prepended. Body refs were
--     already table/CTE-qualified; copied verbatim.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_workgroup_envelope(
  p_project_id UUID,
  p_material_id UUID,
  p_boq_item_ids UUID[]
)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  unit TEXT,
  total_planned NUMERIC,
  total_ordered NUMERIC,
  total_installed NUMERIC,
  remaining_to_order NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  WITH planned AS (
    SELECT
      SUM(pmml.planned_quantity)        AS qty,
      SUM(pmml.planned_quantity * CASE WHEN bi.planned > 0
            THEN LEAST(bi.installed / bi.planned, 1) ELSE 0 END) AS installed_qty,
      MAX(pmml.unit)                    AS unit,
      COUNT(DISTINCT pmml.boq_item_id)  AS cnt
    FROM project_material_master_lines pmml
    JOIN boq_items bi ON bi.id = pmml.boq_item_id
    WHERE pmml.master_id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      ORDER BY created_at DESC
      LIMIT 1
    )
      AND pmml.material_id = p_material_id
      AND pmml.boq_item_id = ANY(p_boq_item_ids)
  ),
  ordered AS (
    SELECT COALESCE(SUM(a.allocated_quantity), 0) AS qty
    FROM material_request_line_allocations a
    JOIN material_request_lines l   ON l.id = a.request_line_id
    JOIN material_request_headers h ON h.id = l.request_header_id
    WHERE h.project_id = p_project_id
      AND l.material_id = p_material_id
      AND a.boq_item_id = ANY(p_boq_item_ids)
      AND h.overall_status NOT IN ('REJECTED')
  )
  SELECT
    p_material_id                                            AS material_id,
    mc.name                                                  AS material_name,
    COALESCE(planned.unit, mc.unit)                          AS unit,
    COALESCE(planned.qty, 0)                                 AS total_planned,
    COALESCE(ordered.qty, 0)                                 AS total_ordered,
    COALESCE(planned.installed_qty, 0)                       AS total_installed,
    COALESCE(planned.qty, 0) - COALESCE(ordered.qty, 0)      AS remaining_to_order,
    CASE
      WHEN COALESCE(planned.qty, 0) > 0
      THEN ROUND((COALESCE(ordered.qty, 0) / planned.qty) * 100, 1)
      ELSE 0
    END                                                      AS burn_pct,
    COALESCE(planned.cnt, 0)                                 AS boq_item_count
  FROM planned
  CROSS JOIN ordered
  CROSS JOIN material_catalog mc
  WHERE mc.id = p_material_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3d. get_material_budget — body from 047:93-117, guard prepended.
--     Column refs qualified with alias `v` (plpgsql ambiguity, see header).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_material_budget(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  material_id          UUID,
  material_name        TEXT,
  tier                 SMALLINT,
  unit                 TEXT,
  benchmark_unit_price NUMERIC,
  total_planned        NUMERIC,
  budget_total_rupiah  NUMERIC,
  committed_rupiah     NUMERIC,
  remaining_rupiah     NUMERIC,
  burn_pct             NUMERIC,
  boq_item_count       BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  SELECT v.material_id, v.material_name, v.tier, v.unit, v.benchmark_unit_price,
         v.total_planned, v.budget_total_rupiah, v.committed_rupiah,
         v.remaining_rupiah, v.burn_pct, v.boq_item_count
  FROM v_material_budget_status v
  WHERE v.project_id = p_project_id
    AND v.material_id = p_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_material_budget(UUID, UUID) TO authenticated;
