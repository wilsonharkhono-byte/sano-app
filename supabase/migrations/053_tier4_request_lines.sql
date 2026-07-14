-- 053 — Widen material_request_lines.tier CHECK to allow Tier 4.
-- 047 introduced Tier-4 ("untracked consumable") catalog materials and widened
-- material_catalog.tier to (1,2,3,4); 048's dispatch_line_flag already returns
-- 'OK' for tier=4 requests. This table's CHECK was the missing middle: a
-- Tier-4 catalog material selected on a request line could not be inserted
-- because material_request_lines.tier still only allowed (1,2,3).
-- Idempotent. Apply via Dashboard SQL Editor (remote migration history diverged).
-- Scope: material_request_lines.tier ONLY — ahs_lines.tier and other tier
-- CHECKs are out of scope for this change.

DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.material_request_lines'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%tier%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.material_request_lines DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.material_request_lines
    ADD CONSTRAINT material_request_lines_tier_check CHECK (tier IN (1,2,3,4));
END $$;
