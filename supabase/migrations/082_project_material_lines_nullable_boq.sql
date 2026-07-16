-- 082_project_material_lines_nullable_boq.sql
-- Tier-2/3 "Others" materials are PROJECT-LEVEL envelopes with no BoQ relation
-- (spec 2026-07-14 §5.3, revised: no synthetic anchor). Allow master lines to
-- carry no boq_item_id so these can be stored directly, project-scoped.
--
-- Safe: every material-level reader aggregates per material with SUM() and does
-- NOT inner-join boq_items (v_material_envelopes / v_material_budget_status /
-- get_material_envelope / get_material_budget / compute_tier2_flag /
-- compute_tier3_flag / material_baseline_snapshots seed). BoQ-scoped readers
-- (get_workgroup_envelope, compute_tier1_flag, get_envelope_boq_breakdown,
-- get_boq_material_status) filter on boq_item_id and legitimately exclude
-- project-level rows. No view changes required.
--
-- The FK stays ON DELETE CASCADE (nullable rows already carry NULL, so a BoQ
-- delete never touches them). Idempotent: DROP NOT NULL is a no-op if already
-- nullable. Dashboard-pasteable.

ALTER TABLE project_material_master_lines
  ALTER COLUMN boq_item_id DROP NOT NULL;
