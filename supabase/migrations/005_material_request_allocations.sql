-- SAN Contractor — Gate 1 scope-aware material requests
-- Adds flexible request basis plus per-line BoQ allocations so:
--   - Tier 1 requests can stay locked to a single BoQ item
--   - Tier 2 requests can be allocated proportionally across many BoQ items
--   - Tier 3 requests can remain general stock without a BoQ deduction

ALTER TABLE material_request_headers
  ADD COLUMN IF NOT EXISTS request_basis TEXT NOT NULL DEFAULT 'BOQ';

ALTER TABLE material_request_headers
  DROP CONSTRAINT IF EXISTS material_request_headers_request_basis_check;

ALTER TABLE material_request_headers
  ADD CONSTRAINT material_request_headers_request_basis_check
  CHECK (request_basis IN ('BOQ', 'MATERIAL'));

ALTER TABLE material_request_headers
  ALTER COLUMN boq_item_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS material_request_line_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id UUID NOT NULL REFERENCES material_request_lines(id) ON DELETE CASCADE,
  boq_item_id UUID REFERENCES boq_items(id) ON DELETE CASCADE,
  allocated_quantity NUMERIC NOT NULL DEFAULT 0,
  proportion_pct NUMERIC NOT NULL DEFAULT 0,
  allocation_basis TEXT NOT NULL DEFAULT 'DIRECT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE material_request_line_allocations
  DROP CONSTRAINT IF EXISTS material_request_line_allocations_allocation_basis_check;

ALTER TABLE material_request_line_allocations
  ADD CONSTRAINT material_request_line_allocations_allocation_basis_check
  CHECK (allocation_basis IN ('DIRECT', 'TIER2_ENVELOPE', 'GENERAL_STOCK'));

CREATE INDEX IF NOT EXISTS idx_request_allocations_line
  ON material_request_line_allocations(request_line_id);

CREATE INDEX IF NOT EXISTS idx_request_allocations_boq
  ON material_request_line_allocations(boq_item_id);

-- Backfill legacy requests so older Gate 1 records still have a direct allocation row.
INSERT INTO material_request_line_allocations (
  request_line_id,
  boq_item_id,
  allocated_quantity,
  proportion_pct,
  allocation_basis,
  created_at
)
SELECT
  mrl.id,
  mrh.boq_item_id,
  mrl.quantity,
  100,
  'DIRECT',
  COALESCE(mrl.created_at, now())
FROM material_request_lines mrl
JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
WHERE mrh.boq_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM material_request_line_allocations existing
    WHERE existing.request_line_id = mrl.id
  );

ALTER TABLE material_request_line_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "request_allocations_assigned_select" ON material_request_line_allocations;
DROP POLICY IF EXISTS "request_allocations_assigned_insert" ON material_request_line_allocations;

CREATE POLICY "request_allocations_assigned_select" ON material_request_line_allocations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM material_request_lines l
      JOIN material_request_headers h ON h.id = l.request_header_id
      JOIN project_assignments pa ON pa.project_id = h.project_id
      WHERE l.id = material_request_line_allocations.request_line_id
        AND pa.user_id = auth.uid()
    )
  );

CREATE POLICY "request_allocations_assigned_insert" ON material_request_line_allocations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM material_request_lines l
      JOIN material_request_headers h ON h.id = l.request_header_id
      JOIN project_assignments pa ON pa.project_id = h.project_id
      WHERE l.id = material_request_line_allocations.request_line_id
        AND pa.user_id = auth.uid()
    )
  );
