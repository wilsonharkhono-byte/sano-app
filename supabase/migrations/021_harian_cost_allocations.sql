-- Migration 021: Harian Cost Allocations + AI Suggestion Metadata
--
-- Adds a structured allocation layer for harian opnames so weekly HOK payments
-- can be allocated to BoQ scopes without auto-editing physical progress.
-- AI suggestions are stored as read-only helper fields; human users still set
-- the final allocation percentage manually.

-- ============================================================================
-- 1. TABLE: harian_cost_allocations
-- ============================================================================

CREATE TABLE IF NOT EXISTS harian_cost_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id         UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id       UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  boq_item_id       UUID REFERENCES boq_items(id) ON DELETE SET NULL,
  allocation_scope  TEXT NOT NULL DEFAULT 'boq_item'
    CHECK (allocation_scope IN ('boq_item', 'general_support', 'rework', 'site_overhead')),
  allocation_pct    NUMERIC NOT NULL DEFAULT 0
    CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
  ai_suggested_pct  NUMERIC
    CHECK (ai_suggested_pct IS NULL OR (ai_suggested_pct >= 0 AND ai_suggested_pct <= 100)),
  ai_reason         TEXT,
  supervisor_note   TEXT,
  estimator_note    TEXT,
  created_by        UUID REFERENCES profiles(id),
  updated_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT harian_cost_allocations_scope_check
    CHECK (
      (allocation_scope = 'boq_item' AND boq_item_id IS NOT NULL)
      OR (allocation_scope <> 'boq_item' AND boq_item_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS harian_cost_allocations_header_boq_unique
  ON harian_cost_allocations (header_id, boq_item_id)
  WHERE allocation_scope = 'boq_item';

CREATE UNIQUE INDEX IF NOT EXISTS harian_cost_allocations_header_scope_unique
  ON harian_cost_allocations (header_id, allocation_scope)
  WHERE allocation_scope <> 'boq_item';

CREATE INDEX IF NOT EXISTS harian_cost_allocations_header_idx
  ON harian_cost_allocations (header_id, created_at);

CREATE INDEX IF NOT EXISTS harian_cost_allocations_project_idx
  ON harian_cost_allocations (project_id, contract_id);

COMMENT ON TABLE harian_cost_allocations IS
  'Structured weekly allocation of harian labor cost to BoQ items or support scopes. Final percentages are human-confirmed; AI fields are suggestion-only.';

COMMENT ON COLUMN harian_cost_allocations.allocation_pct IS
  'Final human-confirmed allocation percentage for the weekly harian total.';

COMMENT ON COLUMN harian_cost_allocations.ai_suggested_pct IS
  'Read-only AI suggestion percentage. Never applied automatically to final allocation_pct.';

-- Keep updated_at fresh for audit/debugging.
CREATE OR REPLACE FUNCTION set_harian_cost_allocations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_harian_cost_allocations_updated_at ON harian_cost_allocations;
CREATE TRIGGER trg_harian_cost_allocations_updated_at
  BEFORE UPDATE ON harian_cost_allocations
  FOR EACH ROW
  EXECUTE FUNCTION set_harian_cost_allocations_updated_at();

-- ============================================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE harian_cost_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS harian_cost_allocations_select ON harian_cost_allocations;
CREATE POLICY harian_cost_allocations_select ON harian_cost_allocations
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM project_assignments pa
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = harian_cost_allocations.project_id
    )
  );

DROP POLICY IF EXISTS harian_cost_allocations_insert ON harian_cost_allocations;
CREATE POLICY harian_cost_allocations_insert ON harian_cost_allocations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE oh.id = harian_cost_allocations.header_id
        AND oh.payment_type = 'harian'
        AND oh.status IN ('DRAFT', 'SUBMITTED')
        AND pa.user_id = auth.uid()
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS harian_cost_allocations_update ON harian_cost_allocations;
CREATE POLICY harian_cost_allocations_update ON harian_cost_allocations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE oh.id = harian_cost_allocations.header_id
        AND oh.payment_type = 'harian'
        AND oh.status IN ('DRAFT', 'SUBMITTED')
        AND pa.user_id = auth.uid()
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE oh.id = harian_cost_allocations.header_id
        AND oh.payment_type = 'harian'
        AND oh.status IN ('DRAFT', 'SUBMITTED')
        AND pa.user_id = auth.uid()
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );

DROP POLICY IF EXISTS harian_cost_allocations_delete ON harian_cost_allocations;
CREATE POLICY harian_cost_allocations_delete ON harian_cost_allocations
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM opname_headers oh
      JOIN project_assignments pa ON pa.project_id = oh.project_id
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE oh.id = harian_cost_allocations.header_id
        AND oh.payment_type = 'harian'
        AND oh.status IN ('DRAFT', 'SUBMITTED')
        AND pa.user_id = auth.uid()
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );

-- ============================================================================
-- 3. VALIDATION HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION assert_harian_allocation_ready(
  p_header_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
  v_total_pct NUMERIC := 0;
  v_row_count INT := 0;
BEGIN
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  IF v_header.payment_type <> 'harian' THEN
    RETURN;
  END IF;

  IF COALESCE(v_header.gross_total, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(allocation_pct), 0),
    COUNT(*)
  INTO v_total_pct, v_row_count
  FROM harian_cost_allocations
  WHERE header_id = p_header_id;

  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'Opname harian belum memiliki alokasi biaya ke BoQ/scope kerja';
  END IF;

  IF ABS(v_total_pct - 100) > 0.05 THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'Alokasi biaya harian harus genap 100%% sebelum diverifikasi. Saat ini %s%%.',
      ROUND(v_total_pct, 2)
    );
  END IF;
END;
$$;

-- ============================================================================
-- 4. VERIFY FLOW: harian must be fully allocated before verification
-- ============================================================================

CREATE OR REPLACE FUNCTION verify_opname(
  p_header_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS opname_headers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
BEGIN
  SELECT *
  INTO v_header
  FROM opname_headers
  WHERE id = p_header_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Header opname tidak ditemukan';
  END IF;

  PERFORM assert_project_role(v_header.project_id, ARRAY['estimator', 'admin', 'principal']);

  IF v_header.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Hanya opname SUBMITTED yang bisa diverifikasi';
  END IF;

  IF v_header.payment_type = 'harian' THEN
    PERFORM recompute_opname_header_totals(p_header_id);
    PERFORM assert_harian_allocation_ready(p_header_id);
  END IF;

  UPDATE opname_headers
  SET status = 'VERIFIED',
      verified_by = auth.uid(),
      verified_at = now(),
      verifier_notes = p_notes
  WHERE id = p_header_id
  RETURNING * INTO v_header;

  PERFORM promote_verified_pct(p_header_id);
  PERFORM recompute_opname_header_totals(p_header_id);

  RETURN v_header;
END;
$$;
