-- Add installed-material to the work-group envelope so Gate 1 can link material
-- orders to physical progress (pace advisory: ordered% vs progress%).
--
-- total_installed = the planned material already "consumed" by installed work,
-- per row = planned_quantity × (boq.installed / boq.planned), summed over the
-- group's rows (progress capped at 100% per row). This is the material-weighted
-- progress of the group.
--
-- Changing the RETURNS TABLE shape requires dropping the old function first.

DROP FUNCTION IF EXISTS get_workgroup_envelope(UUID, UUID, UUID[]);

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
) LANGUAGE sql STABLE AS $$
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
$$;
