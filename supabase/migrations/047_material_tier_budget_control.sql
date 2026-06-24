-- 047 — Material Tier Budget Control (Tier 3 Rupiah envelope, Tier 4 untracked)
-- Idempotent. Apply via Dashboard SQL Editor (remote migration history diverged).

-- 1. AHS price book — the price + tier authority (the "AHS template").
CREATE TABLE IF NOT EXISTS ahs_price_book (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id    UUID REFERENCES material_catalog(id),
  material_name  TEXT NOT NULL,
  unit           TEXT NOT NULL,
  unit_price     NUMERIC NOT NULL,           -- pre-markup base price
  tier           SMALLINT NOT NULL CHECK (tier IN (1,2,3,4)),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ahs_price_book_project_material
  ON ahs_price_book(project_id, material_id);

-- 2. Widen material_catalog.tier CHECK to allow tier 4. Find by shape, not name.
DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  WHERE con.conrelid = 'public.material_catalog'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%tier%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.material_catalog DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.material_catalog
    ADD CONSTRAINT material_catalog_tier_check CHECK (tier IN (1,2,3,4));
END $$;

-- 3. Admin price override on the request line. Grain matches the ordered sum in
--    v_material_envelope_status (which sums material_request_lines.quantity), so
--    committed Rupiah and ordered quantity are summed at the same grain.
ALTER TABLE material_request_lines
  ADD COLUMN IF NOT EXISTS actual_unit_price NUMERIC;  -- null => use benchmark

-- 4. RLS — authenticated read (canonical reference table, catalog-style),
--    authenticated write for office tooling. Without read policy the app loads
--    zero price-book rows and every budget silently reads empty.
ALTER TABLE ahs_price_book ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ahs_price_book_read" ON ahs_price_book;
CREATE POLICY "ahs_price_book_read" ON ahs_price_book
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ahs_price_book_write" ON ahs_price_book;
CREATE POLICY "ahs_price_book_write" ON ahs_price_book
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Budget view — Rupiah envelope, computed live (Approach A).
--    Built on v_material_envelopes (planned qty per material) + the latest
--    price-book row for benchmark price/tier. committed sums ordered qty ×
--    COALESCE(actual_unit_price, benchmark) over non-rejected requests.
CREATE OR REPLACE VIEW v_material_budget_status AS
SELECT
  env.material_id,
  env.project_id,
  env.material_name,
  pb.tier::SMALLINT                                           AS tier,
  env.unit,
  pb.unit_price                                              AS benchmark_unit_price,
  env.total_planned,
  env.total_planned * pb.unit_price                          AS budget_total_rupiah,
  COALESCE(committed.committed_rupiah, 0)                    AS committed_rupiah,
  env.total_planned * pb.unit_price
    - COALESCE(committed.committed_rupiah, 0)                AS remaining_rupiah,
  CASE WHEN env.total_planned * pb.unit_price > 0
       THEN ROUND((COALESCE(committed.committed_rupiah,0)
                   / (env.total_planned * pb.unit_price)) * 100, 1)
       ELSE 0 END                                            AS burn_pct,
  env.boq_item_count
FROM v_material_envelopes env
JOIN LATERAL (
  SELECT pb2.unit_price, pb2.tier
  FROM ahs_price_book pb2
  WHERE pb2.project_id = env.project_id
    AND pb2.material_id = env.material_id
  ORDER BY pb2.effective_from DESC
  LIMIT 1
) pb ON true
LEFT JOIN LATERAL (
  SELECT SUM(mrl.quantity * COALESCE(mrl.actual_unit_price, pb.unit_price)) AS committed_rupiah
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = env.project_id
    AND mrl.material_id = env.material_id
    AND mrh.overall_status NOT IN ('REJECTED')
) committed ON true;

-- 6. RPC for client Gate-1 Tier-3 checks (mirrors get_material_envelope).
CREATE OR REPLACE FUNCTION get_material_budget(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  material_id          UUID,
  material_name        TEXT,
  tier                 SMALLINT,
  unit                 TEXT,
  benchmark_unit_price NUMERIC,
  total_planned        NUMERIC,
  budget_total_rupiah  NUMERIC,
  committed_rupiah     NUMERIC,
  remaining_rupiah     NUMERIC,
  burn_pct             NUMERIC,
  boq_item_count       BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT material_id, material_name, tier, unit, benchmark_unit_price,
         total_planned, budget_total_rupiah, committed_rupiah,
         remaining_rupiah, burn_pct, boq_item_count
  FROM v_material_budget_status
  WHERE project_id = p_project_id AND material_id = p_material_id;
$$;
GRANT EXECUTE ON FUNCTION get_material_budget(UUID, UUID) TO authenticated;
