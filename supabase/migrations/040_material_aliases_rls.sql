-- Fix: material_aliases was unreadable by authenticated users.
--
-- publishBaselineV2 (running as the logged-in user, NOT service role) loads the
-- alias map via:  material_aliases.select('alias, material_catalog!inner(code)')
-- With no SELECT policy on material_aliases, that query returns 0 rows for
-- authenticated users, so the alias map is empty and resolveCatalogId can only
-- match breakdown names that EXACTLY equal a catalog name. Every alias-dependent
-- material (Besi beton D13, Multipleks, Usuk, Bendrat, Bata, Batako, …) then
-- publishes with material_id = NULL — so the work-group gate finds no baseline
-- and the Material Balance shows breakdown names instead of catalog materials.
--
-- The service-role sync (syncMaterialCatalog) bypasses RLS, which is why the
-- aliases were present in the table yet invisible to the app.
--
-- Mirror the material_catalog policy: any authenticated user may read; only
-- office roles may write. (The sync uses the service key and bypasses RLS.)

ALTER TABLE material_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_aliases_read" ON material_aliases;
DROP POLICY IF EXISTS "material_aliases_office_insert" ON material_aliases;
DROP POLICY IF EXISTS "material_aliases_office_update" ON material_aliases;
DROP POLICY IF EXISTS "material_aliases_office_delete" ON material_aliases;

CREATE POLICY "material_aliases_read" ON material_aliases
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "material_aliases_office_insert" ON material_aliases
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'estimator'))
  );

CREATE POLICY "material_aliases_office_update" ON material_aliases
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'estimator'))
  );

CREATE POLICY "material_aliases_office_delete" ON material_aliases
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'estimator'))
  );
