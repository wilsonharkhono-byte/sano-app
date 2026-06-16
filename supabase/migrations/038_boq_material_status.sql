-- Per-(BoQ item, material) planned vs ordered, for the Gate-1 Tier-1 check.
-- planned comes from the published material master (per-material breakdown);
-- ordered is the sum of non-rejected request lines for this BoQ item + material.
CREATE OR REPLACE FUNCTION get_boq_material_status(
  p_project_id UUID,
  p_boq_item_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  planned_quantity NUMERIC,
  ordered_quantity NUMERIC,
  unit TEXT
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(planned.qty, 0)  AS planned_quantity,
    COALESCE(ordered.qty, 0)  AS ordered_quantity,
    planned.unit              AS unit
  FROM (
    SELECT SUM(pmml.planned_quantity) AS qty, MAX(pmml.unit) AS unit
    FROM project_material_master_lines pmml
    JOIN project_material_master pmm ON pmm.id = pmml.master_id
    WHERE pmm.project_id = p_project_id
      AND pmml.boq_item_id = p_boq_item_id
      AND pmml.material_id = p_material_id
  ) planned
  LEFT JOIN LATERAL (
    SELECT SUM(mrl.quantity) AS qty
    FROM material_request_lines mrl
    JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
    WHERE mrh.project_id = p_project_id
      AND mrh.boq_item_id = p_boq_item_id
      AND mrl.material_id = p_material_id
      AND mrh.overall_status NOT IN ('REJECTED')
  ) ordered ON true;
$$;
