-- 046 — Fix receipt_photos.receipt_id foreign key (schema drift repair)
--
-- Bug (caught by a smoke test of submit_receipt): in the LIVE database,
--   receipt_photos_receipt_id_fkey  FOREIGN KEY (receipt_id) REFERENCES material_receipts(id)
-- but the app's receipt flow writes to `receipts` (receipt_lines.receipt_id and
-- reports.ts both reference receipts, and migration 002 line 261 DECLARES the FK
-- as REFERENCES receipts(id)). `material_receipts` is the legacy 001 table the
-- app now only reads for backward-compat history.
--
-- Result: inserting a receipt photo with a real receipts.id always failed the FK
-- (receipts.id is not in material_receipts), so no goods receipt WITH photos
-- could ever be saved. It went unnoticed because no receipt-with-photos had been
-- exercised in the (test) data.
--
-- Root cause: migration drift. The committed 002 references receipts(id); an
-- earlier applied version evidently referenced material_receipts(id), and
-- `CREATE TABLE IF NOT EXISTS` never rebuilt the existing table when the file was
-- corrected. (Migration 044 is NOT the cause — it only rebuilds NO-ACTION/RESTRICT
-- FKs in the project-delete subtree; this FK was already ON DELETE CASCADE.)
--
-- Fix: drop whatever receipt_photos.receipt_id FK exists (found by shape, not
-- name) and re-add it pointing at receipts(id) ON DELETE CASCADE — matching 002's
-- intent. Idempotent: a re-run finds the now-correct FK, drops it, re-adds an
-- identical one.

DO $$
DECLARE
  conname_found TEXT;
  orphan_count  INTEGER;
BEGIN
  IF to_regclass('public.receipt_photos') IS NULL THEN
    RAISE NOTICE '046: receipt_photos table absent — nothing to do';
    RETURN;
  END IF;

  -- Clear any orphan photos that point at neither a valid receipts row (they
  -- can't satisfy the corrected FK). These are unreachable legacy/test rows.
  DELETE FROM public.receipt_photos rp
  WHERE NOT EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = rp.receipt_id);
  GET DIAGNOSTICS orphan_count = ROW_COUNT;
  IF orphan_count > 0 THEN
    RAISE NOTICE '046: removed % orphan receipt_photos row(s) not matching any receipts.id', orphan_count;
  END IF;

  -- Drop the existing (mis-pointed) FK on receipt_photos.receipt_id, found by
  -- column shape so we catch it whatever it is currently named / referencing.
  SELECT con.conname INTO conname_found
  FROM pg_constraint con
  WHERE con.conrelid = 'public.receipt_photos'::regclass
    AND con.contype = 'f'
    AND con.conkey = ARRAY[(
      SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = 'public.receipt_photos'::regclass
        AND a.attname = 'receipt_id'
        AND NOT a.attisdropped
    )];

  IF conname_found IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.receipt_photos DROP CONSTRAINT %I', conname_found);
  END IF;

  ALTER TABLE public.receipt_photos
    ADD CONSTRAINT receipt_photos_receipt_id_fkey
    FOREIGN KEY (receipt_id) REFERENCES public.receipts(id) ON DELETE CASCADE;

  RAISE NOTICE '046: receipt_photos.receipt_id now REFERENCES receipts(id) ON DELETE CASCADE';
END $$;
