-- 052_rebar_batang_unit.sql
-- Rebar is ordered in batang (12 m lonjor), estimated in kg. This adds the
-- fixed kg-per-batang factor and flips rebar supplier_unit to 'batang'.
-- Factors = SNI kg/m × 12 m (see tools/rebarBatang.ts — change in lockstep).
-- Idempotent: safe to re-run via the Dashboard SQL editor.

ALTER TABLE material_catalog
  ADD COLUMN IF NOT EXISTS base_qty_per_supplier_unit NUMERIC;

COMMENT ON COLUMN material_catalog.base_qty_per_supplier_unit IS
  'Base units (unit) per ONE supplier_unit. NULL = 1:1. Rebar: kg per 12 m batang (SNI kg/m × 12).';

UPDATE material_catalog SET supplier_unit = 'batang', base_qty_per_supplier_unit = v.factor
FROM (VALUES
  ('REB-PL06', 2.66),
  ('REB-PL08', 4.74),
  ('REB-DE10', 7.40),
  ('REB-PL10', 7.40),
  ('REB-PL12', 10.66),
  ('REB-DE13', 12.50),
  ('REB-DE16', 18.94),
  ('REB-DE19', 26.71),
  ('REB-DE22', 35.81),
  ('REB-DE25', 46.24),
  ('REB-DE32', 75.76)
) AS v(code, factor)
WHERE material_catalog.code = v.code;

-- Remove never-used rows (user: "never use these types of rebar"). Guarded:
-- skip (and surface via NOTICE) any row that is still referenced — never
-- force-delete data. material_aliases / material_specs cascade by FK; the
-- transactional tables (ahs_lines, request lines, POs, price book) are
-- NO ACTION and will raise foreign_key_violation, which we catch per row.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, code FROM material_catalog
    WHERE code IN ('REB-CHR06', 'REB-CHR08', 'AUTO-BESI-BETON-BJTP-U24-BJTD-U40-STANDARD-SNI')
  LOOP
    BEGIN
      DELETE FROM material_catalog WHERE id = r.id;
      RAISE NOTICE 'Deleted unused material %', r.code;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'SKIPPED % — still referenced; review manually', r.code;
    END;
  END LOOP;
END $$;
