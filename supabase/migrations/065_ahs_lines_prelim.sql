-- 065 — Widen ahs_lines.line_type CHECK to accept 'prelim' (Task 1.6, MED)
--
-- Problem: recipe components produced by the parser can carry
-- lineType: 'prelim' (tools/boqParserV2/types.ts:82, RecipeComponent.lineType
-- union 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim'; produced by
-- tools/boqParserV2/recipeBuilder.ts:86-106 when a BoQ row's cost has a
-- "preliminary" residue that isn't material/labor/equipment/subkon-shaped).
-- publishBaselineV2 already passes lineType straight through unmodified
-- (tools/publishBaselineV2.ts:715 `const lineType = (c.lineType ?? 'material')
-- as 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim'`, inserted at
-- :745 `line_type: lineType`) — but the CHECK constraint added by
-- 004_boq_parser_extensions.sql:34-35
--   CHECK (line_type IN ('material', 'labor', 'equipment', 'subkon'))
-- rejects 'prelim'. Grepped every later migration touching ahs_lines
-- (008, 010, 011, 028, 030, 033, 036, 052, 053) — none redefines this CHECK,
-- so 004's set is still the CURRENT live constraint, not a stale one.
--
-- Effect of the bug: the per-row ahs_lines insert for a prelim component
-- fails the CHECK, resilientWrite (tools/resilientWrite.ts, used at
-- publishBaselineV2.ts:763) catches the failure and only console.warns —
-- the row is silently quarantined. Prelim cost lines never persist, so the
-- published baseline under-represents true cost for any row with a prelim
-- residue, with no visible error to the publisher.
--
-- No TS change needed for the write path: publishBaselineV2.ts's local
-- union type at :156 (FlattenedLine.line_type) and :715/:745 already
-- includes 'prelim' end-to-end — only the DB CHECK was out of sync. (Read
-- separately: tools/types.ts:116 `export type AhsLineType = 'material' |
-- 'labor' | 'equipment' | 'subkon'` — the older V1 AhsLine type — EXCLUDES
-- 'prelim' and is imported by tools/excelParser.ts:8/105/741, but that V1
-- parser's lineType assignment only ever produces 'material' | 'labor' |
-- 'equipment' (tools/excelParser.ts:741-747), never 'prelim', so it will not
-- break tsc or reject real data. Flagging for visibility only — out of scope
-- for this migration, no TS files touched here.)
--
-- Scope note: ahs_lines.tier is a SEPARATE inline CHECK (tier IN (1,2,3)),
-- added in 002_baseline_tables.sql:80. Not touched here — out of scope per
-- 053_tier4_request_lines.sql's header ("Scope: material_request_lines.tier
-- ONLY — ahs_lines.tier and other tier CHECKs untouched").
--
-- Fix: find the line_type CHECK constraint on ahs_lines by shape (not by
-- name — 004 added it as an inline column CHECK, so Postgres auto-generated
-- the name; relying on a guessed name would silently no-op if wrong), drop
-- it, and re-add with 'prelim' in the allowed set. Pattern mirrors
-- 047_material_tier_budget_control.sql:19-33 (material_catalog.tier widen).
--
-- Idempotent / re-paste-safe: the DO block only finds+drops a constraint if
-- one currently exists matching the shape (con.conrelid = ahs_lines AND
-- definition ILIKE '%line_type%'); after the first run, the re-added
-- constraint is named ahs_lines_line_type_check, which still matches that
-- shape, so a second paste finds it, drops it, and re-adds the identical
-- definition — safe no-op in effect. Apply via Dashboard SQL Editor (remote
-- migration history diverged — see project memory).

DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.ahs_lines'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%line_type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ahs_lines DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.ahs_lines
    ADD CONSTRAINT ahs_lines_line_type_check
    CHECK (line_type IN ('material', 'labor', 'equipment', 'subkon', 'prelim'));
END $$;
