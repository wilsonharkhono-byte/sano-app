-- 044_project_fk_cascade.sql
--
-- Bug: deleting a project fails with a foreign-key violation, e.g.
--   "update or delete on table \"projects\" violates foreign key constraint
--    \"report_exports_project_id_fkey\" on table \"report_exports\""
-- and, one layer deeper, once the project_id FKs cascade:
--   "update or delete on table \"boq_items\" violates foreign key constraint
--    \"project_material_master_lines_boq_item_id_fkey\" ..."
--
-- Root cause: deleteProject() (tools/projectManagement.ts) hard-deletes a
-- project and RELIES on every FK in the project's data tree having an
-- ON DELETE action so the delete propagates to all descendants. Most tables
-- were authored that way, but a cluster (material_receipts in 001; receipts,
-- the audit/approval/anomaly/scoring/digest/export tables, and several
-- boq_items children in 002) were created with a bare `REFERENCES <parent>`
-- and NO ON DELETE action. Each such FK is a wall the cascade hits — and they
-- exist at multiple levels (projects -> boq_items -> ...), so fixing one level
-- just surfaces the next. report_exports is merely the first wall Postgres
-- happens to check.
--
-- Fix (once, completely): compute the FULL set of tables a project delete
-- cascades into, then repair EVERY foreign key that points into that set but
-- lacks a delete action, choosing per FK:
--   * ON DELETE CASCADE  when all referencing columns are NOT NULL — the child
--     row cannot exist without its parent, so it is project-owned data and must
--     go with it (matches receipts/opname/envelope tables authored correctly).
--   * ON DELETE SET NULL when the FK is nullable — an optional back-pointer
--     (e.g. defects.boq_item_id, vo_entries.boq_item_id, and the special case
--     mtn_requests.destination_project_id, which points at a DIFFERENT project);
--     the row survives with the pointer cleared (matches site_changes /
--     harian_cost_allocations, authored correctly).
--
-- The deletion subtree only grows through CASCADE edges (SET NULL does NOT
-- delete children), so the closure is computed and re-checked in a loop until
-- no blocker remains — fixing a NOT NULL FK to CASCADE may pull a deeper table
-- into the subtree and reveal the next layer, which the next pass handles.
--
-- Scope safety: only FKs whose REFERENCED table is reachable from projects via
-- cascade are touched. Shared/catalog tables (materials, profiles, …) are not
-- reachable that way, so their FKs are never altered. A NOT NULL FK into the
-- subtree is by definition project-owned, so cascading it is correct.
--
-- IDEMPOTENT: a re-run finds every FK already CASCADE/SET NULL and changes
-- nothing. Each change is reported via RAISE NOTICE so the SQL-editor output is
-- a complete audit log of exactly what was altered.

DO $$
DECLARE
  fk            RECORD;
  changed       INTEGER;
  passes        INTEGER := 0;
  all_notnull   BOOLEAN;
  action        TEXT;
  ref_cols      TEXT;
  refd_cols     TEXT;
BEGIN
  LOOP
    changed := 0;
    passes  := passes + 1;

    FOR fk IN
      WITH RECURSIVE subtree(reloid) AS (
        SELECT 'public.projects'::regclass::oid
        UNION
        SELECT c.conrelid
        FROM pg_constraint c
        JOIN subtree s ON c.confrelid = s.reloid
        WHERE c.contype = 'f'
          AND c.confdeltype = 'c'      -- only CASCADE edges delete children
      )
      SELECT c.oid,
             c.conname,
             c.conrelid,
             c.confrelid,
             c.conkey,
             c.confkey,
             c.conrelid::regclass  AS reltbl,
             c.confrelid::regclass AS reftbl
      FROM pg_constraint c
      JOIN subtree s ON c.confrelid = s.reloid
      WHERE c.contype = 'f'
        AND c.confdeltype IN ('a', 'r')   -- NO ACTION / RESTRICT = a blocker
    LOOP
      -- All referencing columns NOT NULL?  -> CASCADE, else SET NULL.
      SELECT bool_and(a.attnotnull) INTO all_notnull
      FROM pg_attribute a
      WHERE a.attrelid = fk.conrelid
        AND a.attnum = ANY (fk.conkey);

      action := CASE WHEN all_notnull THEN 'CASCADE' ELSE 'SET NULL' END;

      -- Reconstruct the (referencing) and (referenced) column lists in order.
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
        INTO ref_cols
      FROM unnest(fk.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = u.attnum;

      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
        INTO refd_cols
      FROM unnest(fk.confkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = fk.confrelid AND a.attnum = u.attnum;

      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.reltbl, fk.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE %s',
        fk.reltbl, fk.conname, ref_cols, fk.reftbl, refd_cols, action
      );

      RAISE NOTICE 'cascade-closure: %.% -> %  ON DELETE %',
        fk.reltbl, fk.conname, fk.reftbl, action;
      changed := changed + 1;
    END LOOP;

    EXIT WHEN changed = 0;

    IF passes > 50 THEN
      RAISE EXCEPTION 'cascade-closure did not converge after % passes', passes;
    END IF;
  END LOOP;

  RAISE NOTICE 'cascade-closure complete in % pass(es)', passes;
END $$;
