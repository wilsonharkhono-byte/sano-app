-- 058 — Restrict ahs_price_book writes to office roles (Task 0.2, HIGH)
--
-- Problem: ahs_price_book policy (047_material_tier_budget_control.sql:48-50) is
--   FOR ALL TO authenticated USING (true) WITH CHECK (true) — any tenant's any user
--   can move the Tier-3 benchmark prices that the server budget gate (048) checks
--   against. This is a privilege escalation: supervisors/site staff can artificially
--   inflate or deflate the price benchmarks to bypass Tier-3 budget constraints,
--   leading to corrupted demand forecasts and overspend.
--
-- Fix: Split the write policy into read-all-authenticated + write-office (mirror the
--   material_catalog policy shape). Only admin/principal/estimator can INSERT/UPDATE/DELETE
--   ahs_price_book rows. All authenticated users retain SELECT access (for per-material
--   cost reads in the app). The sole writer in prod is tools/priceBookIngest.ts
--   (office tooling, called during price book upload).
--
-- Idempotent / re-paste-safe: DROP POLICY IF EXISTS before CREATE POLICY.
--   Safe to paste into the Supabase Dashboard SQL editor more than once.

DROP POLICY IF EXISTS "ahs_price_book_write" ON ahs_price_book;
CREATE POLICY "ahs_price_book_write" ON ahs_price_book
  FOR ALL TO authenticated
  USING (is_office_role()) WITH CHECK (is_office_role());
