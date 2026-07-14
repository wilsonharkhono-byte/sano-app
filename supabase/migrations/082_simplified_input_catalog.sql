-- 082_simplified_input_catalog.sql
-- Catalog rows for the simplified "SANO Input" format (spec 2026-07-14).
--
-- The Tier-1 sheet's materials must be TIER 1 (work-group gated) and — for
-- rebar — stored in BATANG, not kg. The existing readymix row is tier 2 and
-- the existing rebar rows are kg-based and referenced by 3 live projects
-- (887 master lines); mutating them would corrupt those projects' envelopes
-- (v_material_envelopes reads mc.unit live). So we INSERT isolated rows the
-- simplified path links to by exact name, and leave every existing row alone.
--
-- Idempotent: guarded by NOT EXISTS on code (no unique-constraint dependency).
-- Dashboard-pasteable (remote migration history is out of sync).

INSERT INTO material_catalog (code, name, category, tier, unit, supplier_unit, base_qty_per_supplier_unit)
SELECT v.code, v.name, 'Struktur', 1, v.unit, v.unit, NULL
FROM (VALUES
  ('BTN-RMX-T1',   'Beton Readymix',                 'm3'),
  ('REB-PL08-BTG', 'Besi beton polos 8 mm (batang)',  'batang'),
  ('REB-DE10-BTG', 'Besi beton ulir 10 mm (batang)',  'batang'),
  ('REB-DE13-BTG', 'Besi beton ulir 13 mm (batang)',  'batang'),
  ('REB-DE16-BTG', 'Besi beton ulir 16 mm (batang)',  'batang'),
  ('REB-DE19-BTG', 'Besi beton ulir 19 mm (batang)',  'batang'),
  ('REB-DE22-BTG', 'Besi beton ulir 22 mm (batang)',  'batang')
) AS v(code, name, unit)
WHERE NOT EXISTS (SELECT 1 FROM material_catalog mc WHERE mc.code = v.code);
