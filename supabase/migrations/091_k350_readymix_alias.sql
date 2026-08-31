-- 091_k350_readymix_alias.sql
-- Map the concrete grade both live projects actually pour — K-350 — onto the
-- curated catalogue's "Ready mix fc' 30 MPa" (code CON-RM30).
--
-- WHY THIS ROW, AND WHO DECIDED. The user decided on 2026-08-25 that K-350
-- resolves to fc' 30 MPa. Two independent supports:
--   * the SNI cube->cylinder conversion (K-350 ~ fc' 29 MPa, the nearest stocked
--     grade being fc' 30), and
--   * the source RAB's OWN pairing: its Material sheet writes the grade as
--     "K-350 (fc'30)" (Material!I12), i.e. the estimator already treats the two
--     spellings as one product. (The same sheet pairs K-300 with fc'25 at I11
--     and K-400 with fc'32,5 at I13.)
-- The grade itself is stated by the source RAB at REKAP RAB!B63 — "Mutu beton
-- struktur menggunakan K-350". Both cells verified 2026-08-25 in
-- assets/BOQ/SANO 2 SPH 4 Sonny Citraland Selat Golf.xlsx. We are recording a
-- stated fact, not inferring a grade from element type or project default
-- (which betonGrade.ts refuses to do on purpose — see CLAUDE.md 1.1).
--
-- WHY IT IS NEEDED. tools/simplifiedInput/betonGrade.ts emits the K-grade ALIAS
-- spelling for a stated K grade: "Mutu Beton = K-350" -> component name
-- "Readymix K-350". Verified against the live catalogue on 2026-08-25, that name
-- resolves to NOTHING through publish's exact->alias->fuzzy cascade (it does not
-- even fuzzy-hit a neighbouring grade), so without this alias the re-publish
-- would leave every concrete line material_id NULL — exactly the ungated hole
-- that 083/087 closed for the other materials. The alias must exist BEFORE the
-- publish runs: loadCatalogAndAliases reads material_aliases at publish time.
--
-- NOTE ON THE SHARED TARGET. CON-RM30 already carries the K-300 aliases
-- ("Readymix K-300", "Ready Mix K-300", "Beton Ready Mix K300", "Ready mix kelas
-- 30", seeded in 003). After this migration that one catalogue row serves BOTH
-- Indonesian grades. That is the user's decision and it is deliberate: the
-- curated strict-50 catalogue stocks only fc' 25 and fc' 30. If K-350 ever needs
-- its own price/envelope, add a CON-RM35 row and re-point these four aliases —
-- do not silently re-grade CON-RM30.
--
-- Aliases are normalised at load (lowercase, punctuation -> space; see
-- normalizeAlias in tools/publishBaselineV2.ts), so they are stored VERBATIM
-- here — the four spellings below all collapse to "readymix k 350" /
-- "ready mix k 350" / "beton ready mix k350" / "beton readymix k 350".
--
-- The catalogue row is resolved by CODE, falling back to NAME, so a re-seeded
-- catalogue that reissues ids still lands on the right material. For reference,
-- the live id on 2026-08-25 is 07955d13-e563-4c73-b5a9-d490c57f2468.
--
-- APPLICATION. `supabase db push` is broken against this project (remote
-- migration history diverged — see docs/deploy/). Apply this DML with
-- tmp/apply-k350-aliases.mjs, or paste it into the Dashboard SQL editor.
-- Idempotent: safe to run more than once, and safe to run after either.

INSERT INTO material_aliases (material_id, alias)
SELECT t.id, v.alias
FROM (
  SELECT mc.id
  FROM material_catalog mc
  WHERE mc.code = 'CON-RM30' OR mc.name = 'Ready mix fc'' 30 MPa'
  -- Prefer the code match when both a code and a name match exist.
  ORDER BY (mc.code = 'CON-RM30') DESC, mc.id
  LIMIT 1
) AS t
CROSS JOIN (VALUES
  ('Readymix K-350'),        -- what betonGrade.betonMaterialName() emits for K-350
  ('Ready Mix K-350'),
  ('Beton Ready Mix K350'),
  ('Beton readymix K-350')   -- the Analisa-sheet spelling in the full RAB workbooks
) AS v(alias)
WHERE NOT EXISTS (
  SELECT 1 FROM material_aliases a
  WHERE a.material_id = t.id AND lower(a.alias) = lower(v.alias)
);
