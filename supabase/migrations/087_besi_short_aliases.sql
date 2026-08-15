-- 087_besi_short_aliases.sql
-- The normalized-breakdown pipeline names per-diameter rebar components
-- "Besi D13" (tools/boqParserV2/rebarDisaggregator — see CLAUDE.md §2.5), but
-- the live alias set only covers the "Besi beton D13" spelling. On the
-- SBY-001 Citraland Selat Golf K2-7 publish (2026-08-14) every one of the 228
-- material lines failed to link (ahs_lines.material_id NULL, 0
-- project_material_master_lines), so the Permintaan demand lists were empty.
-- Add the short "Besi D{n}" spellings for the whole diameter family.
-- D6/D8 map to polos, D10+ to ulir — same convention as the existing
-- "Besi beton D{n}" aliases. Idempotent; Dashboard-pasteable.

INSERT INTO material_aliases (material_id, alias)
SELECT mc.id, v.alias
FROM (VALUES
  ('REB-PL06', 'Besi D6'),
  ('REB-PL08', 'Besi D8'),
  ('REB-DE10', 'Besi D10'),
  ('REB-DE13', 'Besi D13'),
  ('REB-DE16', 'Besi D16'),
  ('REB-DE19', 'Besi D19'),
  ('REB-DE22', 'Besi D22'),
  ('REB-DE25', 'Besi D25'),
  ('REB-DE29', 'Besi D29'),
  ('REB-DE32', 'Besi D32')
) AS v(code, alias)
JOIN material_catalog mc ON mc.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM material_aliases a
  WHERE a.material_id = mc.id AND lower(a.alias) = lower(v.alias)
);
