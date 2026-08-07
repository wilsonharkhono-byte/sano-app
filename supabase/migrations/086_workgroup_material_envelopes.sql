-- 086 — get_workgroup_material_envelopes: one work group, every material, one call
--       (BoQ-first Permintaan + Mode Besi; design authority
--        docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §6)
--
-- Paste order: AFTER 085 (latest applied migration). Apply via the Dashboard SQL
--   Editor (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe: DROP FUNCTION IF EXISTS + CREATE, GRANT re-issued.
--
-- WHY: get_workgroup_envelope (039 → 041 → 061, its live plpgsql body) answers
--   "planned vs already-requested
--   for ONE material across this work-group's BoQ rows". The BoQ-first request
--   flow needs those numbers for EVERY material in the group at once (one round
--   trip instead of N), and Mode Besi needs them per work group across up to ten
--   rebar diameters. This function is that generalization — read-only, adding no
--   semantics of its own.
--
-- BURN DEFINITIONS (copied from the lineage, not invented):
--   planned   — SUM(project_material_master_lines.planned_quantity) over the
--               passed BoQ rows, scoped to the project's LATEST
--               project_material_master header only (039:50-55 / 041:38-43),
--               with the `id DESC` tiebreaker 054:55-60 added so "latest" is a
--               single deterministic row even when two headers share a
--               created_at second. Summing across generations is the 038/054
--               double-count bug class.
--   ordered   — the group's demand that has become a SANO purchase order:
--               allocations on those rows whose request line is linked to a
--               non-CANCELLED PO (purchase_order_lines.request_line_id — the
--               "fulfilled line" definition from 069's header as amended by
--               073 Part B; CLOSED_SHORT stays fulfilled, only CANCELLED
--               un-fulfills). request_line_id is populated from Task 2.8 onward,
--               so this leg reads 0 for older data and self-improves as admins
--               link POs — the same self-improving property 069 documents.
--   requested — the rest: non-rejected allocations NOT linked to a live PO
--               ("other open requests", 069 header).
--
--   ordered + requested is therefore EXACTLY get_workgroup_envelope's
--   total_ordered (039:59-68 / 041:47-56 sum every non-rejected allocation with
--   no PO split). The VERIFICATION query at the bottom asserts that identity.
--
-- UNITS: base units throughout (kg for rebar), like every other envelope
--   surface. Supplier-unit display (batang) happens client-side via
--   tools/materialUnitConversion.ts displayQty.
--
-- SECURITY INVOKER (spec §6): RLS composes on every table read, matching
--   get_workgroup_envelope (039/041 were LANGUAGE sql, i.e. INVOKER by default;
--   061_envelope_views_security_invoker.sql:229-299 re-created it as plpgsql,
--   still SECURITY INVOKER — that 061 body is the function's live definition
--   today, cited throughout this file). assert_project_access (061) runs first
--   so a caller outside the project fails loudly instead of silently receiving
--   an empty set.

DROP FUNCTION IF EXISTS get_workgroup_material_envelopes(UUID, UUID[]);

CREATE FUNCTION get_workgroup_material_envelopes(
  p_project_id UUID,
  p_boq_item_ids UUID[]
)
RETURNS TABLE (
  material_id UUID,
  planned NUMERIC,
  ordered NUMERIC,
  requested NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  WITH planned_rows AS (
    SELECT
      pmml.material_id            AS mat_id,
      SUM(pmml.planned_quantity)  AS qty
    FROM project_material_master_lines pmml
    WHERE pmml.master_id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
      AND pmml.boq_item_id = ANY(p_boq_item_ids)
      AND pmml.material_id IS NOT NULL
    GROUP BY pmml.material_id
  ),
  allocation_rows AS (
    -- Every non-rejected allocation on the group's rows, split by whether its
    -- request line is already fulfilled by a live PO. The two FILTERed sums add
    -- back up to get_workgroup_envelope's total_ordered.
    SELECT
      l.material_id AS mat_id,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NOT NULL), 0) AS ordered_qty,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NULL), 0)     AS requested_qty
    FROM material_request_line_allocations a
    JOIN material_request_lines   l ON l.id = a.request_line_id
    JOIN material_request_headers h ON h.id = l.request_header_id
    LEFT JOIN LATERAL (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id = l.id
        AND po.status <> 'CANCELLED'
      LIMIT 1
    ) po_link ON true
    WHERE h.project_id = p_project_id
      AND l.material_id IS NOT NULL
      AND a.boq_item_id = ANY(p_boq_item_ids)
      AND h.overall_status NOT IN ('REJECTED')
    GROUP BY l.material_id
  )
  -- FULL OUTER JOIN, not an inner join: a material ordered beyond (or outside)
  -- the current plan must still surface with planned = 0 rather than vanish.
  SELECT
    COALESCE(p.mat_id, x.mat_id)  AS material_id,
    COALESCE(p.qty, 0)            AS planned,
    COALESCE(x.ordered_qty, 0)    AS ordered,
    COALESCE(x.requested_qty, 0)  AS requested
  FROM planned_rows p
  FULL OUTER JOIN allocation_rows x ON x.mat_id = p.mat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes(UUID, UUID[])
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (part of done — spec §6, repo convention for DB verification)
--
-- Run this in the Dashboard SQL Editor against a real project and one work
-- group's BoQ ids before calling the migration done. Every row must agree with
-- get_workgroup_envelope called per material:
--     planned              = wge.total_planned
--     ordered + requested  = wge.total_ordered
--
-- EXPECTED RESULT: ZERO ROWS. Any row returned is a real divergence — fix it,
-- never explain it away (CLAUDE.md §1.1).
--
-- ⚠ PRECONDITION — run this FIRST, before trusting a 0-row result below. An
--   empty p_boq_item_ids scope makes the divergence query return 0 rows
--   VACUOUSLY, indistinguishable from a genuine pass: a mistyped chapter
--   matches nothing, and so does a chapter that legitimately has no rows —
--   including the pre-064 trap where a project's boq_items rows predate
--   064_boq_items_subchapter.sql and still carry chapter = NULL, so the
--   equality filter below matches zero rows and ids.boq_ids comes back '{}'.
--   REQUIRE count > 0 before treating "0 rows" from the divergence query as
--   green:
--
--   WITH ids AS (
--     SELECT ARRAY(
--       SELECT id FROM boq_items
--       WHERE project_id = '<PROJECT_UUID>'::uuid
--         AND superseded_at IS NULL
--         AND chapter = '<CHAPTER OF ONE WORK GROUP>'
--     ) AS boq_ids
--   )
--   SELECT count(*) FROM ids,
--        LATERAL get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, ids.boq_ids) m;
--   -- REQUIRE > 0. If this is 0, fix the project id / chapter (or, on a
--   -- pre-064 project, pick a project_id filter that doesn't rely on chapter
--   -- at all) before running the divergence query below — a 0-row divergence
--   -- result under an empty scope proves nothing.
--
-- Known permitted differences from get_workgroup_envelope (039 → 041 → 061's
-- live plpgsql body, 061:229-299) — neither is a bug:
--   1. Latest-master subquery: get_workgroup_envelope (061:261-266, carried
--      forward from 039:50-55 / 041:38-43) orders by created_at DESC with NO
--      id tiebreaker; this function adds `id DESC` per 054. They can only
--      disagree when a project has two project_material_master headers
--      sharing a created_at timestamp — in which case THIS function is the
--      correct one and 061 is the row to fix.
--   2. Join shape: get_workgroup_envelope's planned CTE (061:252-260) INNER
--      JOINs boq_items (bi ON bi.id = pmml.boq_item_id) to compute installed
--      progress; this function's planned_rows CTE has no reason to read
--      boq_items and does not join it. Practically unreachable given the
--      boq_item_id FK (a pmml row can't reference a missing boq_items row),
--      but the two queries are not walking an identical join set — calling
--      the id-tiebreaker the ONLY difference would be inaccurate.
--
--   WITH ids AS (
--     SELECT ARRAY(
--       SELECT id FROM boq_items
--       WHERE project_id = '<PROJECT_UUID>'::uuid
--         AND superseded_at IS NULL
--         AND chapter = '<CHAPTER OF ONE WORK GROUP>'
--     ) AS boq_ids
--   ),
--   many AS (
--     SELECT m.*
--     FROM ids,
--          LATERAL get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, ids.boq_ids) m
--   ),
--   one AS (
--     SELECT many.material_id, w.total_planned, w.total_ordered
--     FROM many, ids,
--          LATERAL get_workgroup_envelope('<PROJECT_UUID>'::uuid, many.material_id, ids.boq_ids) w
--   )
--   SELECT
--     many.material_id,
--     many.planned                       AS many_planned,
--     one.total_planned                  AS one_planned,
--     many.ordered + many.requested      AS many_burn,
--     one.total_ordered                  AS one_burn
--   FROM many
--   JOIN one ON one.material_id = many.material_id
--   WHERE ROUND(many.planned, 6)
--           IS DISTINCT FROM ROUND(one.total_planned, 6)
--      OR ROUND(many.ordered + many.requested, 6)
--           IS DISTINCT FROM ROUND(one.total_ordered, 6);
-- ═══════════════════════════════════════════════════════════════════════════
