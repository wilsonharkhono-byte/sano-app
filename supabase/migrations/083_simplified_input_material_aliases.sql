-- 083_simplified_input_material_aliases.sql
-- Reconcile the simplified "SANO Input" Others vocabulary to the strict-50
-- curated catalogue, so Tier-2/3 materials resolve to the SAME rows the field
-- team orders against. The 0.8 fuzzy threshold plus the strict-50 rename left
-- several unlinked (e.g. sheet "Bata merah" vs catalogue "Bata merah press").
-- Idempotent; Dashboard-pasteable.

-- 1. Aliases: sheet name -> existing curated catalogue code. The alias is
--    normalised (lowercase, punctuation->space) at load, so store it verbatim.
INSERT INTO material_aliases (material_id, alias)
SELECT mc.id, v.alias
FROM (VALUES
  ('BRK-CL02',  'Bata merah'),
  ('BTK-SM10',  'Batako tebal 10 cm'),
  ('CEM-PCC40', 'Semen PC'),
  ('KWD-BDR01', 'Kawat beton'),
  ('SND-LMJ',   'Pasir Pasang'),
  ('PLY-MR15',  'Multipleks t = 15 mm'),
  ('AGG-SP10',  'Kerikil')
) AS v(code, alias)
JOIN material_catalog mc ON mc.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM material_aliases a
  WHERE a.material_id = mc.id AND lower(a.alias) = lower(v.alias)
);

-- 2. Kawat bendrat is a Tier-2 (bulk quantity envelope) material per field usage.
UPDATE material_catalog SET tier = 2 WHERE code = 'KWD-BDR01' AND tier <> 2;

-- 3. New curated entries for consumables the strict-50 set did not include.
--    Named exactly as the sheet so they resolve by EXACT match (no alias needed).
INSERT INTO material_catalog (code, name, category, tier, unit, supplier_unit)
SELECT v.code, v.name, v.category, v.tier, v.unit, v.unit
FROM (VALUES
  ('FUE-MOL01', 'Bahan bakar molen', 'Konsumabel', 3, 'ltr'),
  ('FRM-OIL01', 'Form oil',          'Konsumabel', 3, 'ltr'),
  ('WMH-AYM01', 'Kawat ayam',        'Konsumabel', 3, 'm2')
) AS v(code, name, category, tier, unit)
WHERE NOT EXISTS (SELECT 1 FROM material_catalog mc WHERE mc.code = v.code);
