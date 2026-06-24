-- 049 — Recompute material_request_lines.line_flag when actual_unit_price changes.
-- The Tier-3 budget gate (migrations 047/048) uses actual_unit_price as the per-line
-- price override, but migration 033's Trigger 1 only fires on tier/quantity/material_id,
-- so an override edit on an existing line left line_flag stale. Add actual_unit_price to
-- the trigger's column list. Idempotent: DROP + CREATE (CREATE OR REPLACE cannot change
-- a trigger's UPDATE OF column list). recompute_line_flag() is unchanged (defined in 033).
-- Apply via Dashboard SQL Editor; depends on 033 (recompute_line_flag) and 047 (actual_unit_price column).

DROP TRIGGER IF EXISTS material_request_lines_set_flag_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_set_flag_trg
  BEFORE INSERT OR UPDATE OF tier, quantity, material_id, actual_unit_price
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag();
