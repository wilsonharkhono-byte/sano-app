-- SANO — BoQ work-group material requests (Gate 1 Tier 1 → work-group bulk).
--
-- A field supervisor orders for a whole work-group ("Struktur Pondasi",
-- "Kolom Lantai 1") rather than a single BoQ row. The work-group is computed
-- client-side (tools/boqWorkGroups.ts) and resolves to a set of boq_item ids.
-- This migration adds:
--   1. WORKGROUP_ENVELOPE allocation basis
--   2. work_group_label on material_request_lines (provenance/audit/UI)
--   3. get_workgroup_envelope() — planned vs ordered for a material across a
--      passed set of BoQ rows (mirrors get_material_envelope, row-scoped).

-- ── 1. New allocation basis ───────────────────────────────────────────
ALTER TABLE material_request_line_allocations
  DROP CONSTRAINT IF EXISTS material_request_line_allocations_allocation_basis_check;

ALTER TABLE material_request_line_allocations
  ADD CONSTRAINT material_request_line_allocations_allocation_basis_check
  CHECK (allocation_basis IN ('DIRECT', 'TIER2_ENVELOPE', 'GENERAL_STOCK', 'WORKGROUP_ENVELOPE'));

-- ── 2. Work-group provenance on the request line ──────────────────────
ALTER TABLE material_request_lines
  ADD COLUMN IF NOT EXISTS work_group_label TEXT;

-- ── 3. Work-group envelope RPC ────────────────────────────────────────
-- planned: sum of the material's planned demand across the passed rows, scoped
--          to the project's MOST RECENT master (re-publish inserts a new
--          project_material_master; summing across all would double-count).
-- ordered: sum of non-rejected allocations on those rows for the material.
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
  remaining_to_order NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT
) LANGUAGE sql STABLE AS $$
  WITH planned AS (
    SELECT
      SUM(pmml.planned_quantity)        AS qty,
      MAX(pmml.unit)                    AS unit,
      COUNT(DISTINCT pmml.boq_item_id)  AS cnt
    FROM project_material_master_lines pmml
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
$$;
