-- SANO — Scope v_material_envelopes to the latest project_material_master.
--
-- Bug: publishBaselineV2 (tools/publishBaselineV2.ts:699-704) inserts a NEW
-- project_material_master header on every publish and keeps prior generations
-- around (no delete/supersede). Before this fix, v_material_envelopes summed
-- pmml.planned_quantity across ALL generations for a project, so total_planned
-- kept growing with every re-publish even when the BoQ itself hadn't changed.
-- That inflated denominator under-reports Tier-2 envelope burn_pct (ordered /
-- total_planned) after every re-publish, and — because v_material_budget_status
-- (047_material_tier_budget_control.sql) is built directly on top of
-- v_material_envelopes (`FROM v_material_envelopes env`) — the same inflation
-- transitively under-reports Tier-3 Rupiah budget burn_pct
-- (committed_rupiah / (total_planned * unit_price)).
--
-- Fix: scope the aggregation to only the rows belonging to the project's most
-- recent project_material_master, using the same "latest master" correlated
-- subquery already established by the per-row RPCs:
--   038_boq_material_status.sql:23-28  (get_boq_material_status)
--   039_work_group_envelopes.sql:50-55 (get_workgroup_envelope)
--   041_workgroup_envelope_installed.sql:38-43 (get_workgroup_envelope, installed variant)
-- Those subqueries order by created_at DESC LIMIT 1 without a tiebreaker; this
-- migration adds `id DESC` as a secondary sort key in case a re-publish batch
-- creates more than one project_material_master row within the same wall-clock
-- second (created_at collision), so "latest" is always a single deterministic row.
--
-- CREATE OR REPLACE VIEW keeps the column list byte-identical to the original
-- definition (004_boq_parser_extensions.sql:74-87): material_id, project_id,
-- material_code, material_name, tier, unit, total_planned, boq_item_count.
-- Because the shape doesn't change, dependent views pick up the fix with no
-- changes of their own and do NOT need to be re-created:
--   - v_material_envelope_status (004_boq_parser_extensions.sql:90-124) —
--     selects from v_material_envelopes as `env` and only adds ordered/received
--     lateral joins; its `received` lateral join is Task 3's territory and is
--     untouched here.
--   - v_material_budget_status (047_material_tier_budget_control.sql:56-90) —
--     also selects from v_material_envelopes as `env`.
--
-- Idempotent: CREATE OR REPLACE VIEW is a no-op to re-run.

CREATE OR REPLACE VIEW v_material_envelopes AS
SELECT
  pmml.material_id,
  pmm.project_id,
  mc.code AS material_code,
  mc.name AS material_name,
  mc.tier,
  mc.unit,
  SUM(pmml.planned_quantity) AS total_planned,
  COUNT(DISTINCT pmml.boq_item_id) AS boq_item_count
FROM project_material_master_lines pmml
JOIN project_material_master pmm ON pmm.id = pmml.master_id
JOIN material_catalog mc ON mc.id = pmml.material_id
WHERE pmml.master_id = (
  SELECT id FROM project_material_master
  WHERE project_id = pmm.project_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
GROUP BY pmml.material_id, pmm.project_id, mc.code, mc.name, mc.tier, mc.unit;
