-- Replace the partial unique index on material_catalog.code with a proper
-- UNIQUE constraint. PostgREST's ON CONFLICT (code) cannot match a partial
-- index when also specifying the predicate, so baseline publish fails
-- with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Postgres treats NULLs as distinct in regular UNIQUE constraints, so NULL
-- codes remain allowed (same behavior as the old partial index).

DROP INDEX IF EXISTS idx_material_catalog_code_unique;

ALTER TABLE material_catalog
  DROP CONSTRAINT IF EXISTS material_catalog_code_unique;

ALTER TABLE material_catalog
  ADD CONSTRAINT material_catalog_code_unique UNIQUE (code);
