-- SANO — Phase 3: Labor Trade Tracking & Mandor Opname
-- Tracks weekly progress claims per mandor with approval workflow.
-- Supports multiple mandors per project with trade-specific scoping.
-- Produces payment waterfall: gross → retention → prior paid → kasbon → net this week.
--
-- Run AFTER 004_boq_parser_extensions.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ADD TRADE CATEGORY TO AHS LINES
-- ═══════════════════════════════════════════════════════════════════════

-- trade_category is auto-detected by laborTrade.ts post-baseline-publish,
-- then reviewed/corrected by estimator in MandorSetupScreen.
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS trade_category TEXT
  CHECK (trade_category IN (
    'beton_bekisting',  -- tukang beton + bekisting (one mandor)
    'besi',             -- tukang besi / pembesian (separate mandor)
    'pasangan',         -- pasangan bata/batu
    'plesteran',        -- plesteran + acian
    'finishing',        -- cat, keramik, granit, gypsum
    'kayu',             -- kusen, pintu, jendela, rangka atap
    'mep',              -- instalasi listrik, air, AC
    'tanah',            -- galian, urugan, pemadatan
    'lainnya'           -- catch-all
  ));

-- trade_confirmed: estimator has reviewed and confirmed auto-detection
ALTER TABLE ahs_lines ADD COLUMN IF NOT EXISTS trade_confirmed BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MANDOR CONTRACTS (one per mandor per project)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mandor_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mandor_name TEXT NOT NULL,
  -- trade_categories this mandor is responsible for (JSON array of category strings)
  -- e.g., ["beton_bekisting"] or ["besi"] or ["pasangan","plesteran"]
  trade_categories JSONB NOT NULL DEFAULT '[]',
  retention_pct NUMERIC NOT NULL DEFAULT 10,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, mandor_name)
);

CREATE INDEX IF NOT EXISTS idx_mandor_contracts_project ON mandor_contracts(project_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MANDOR CONTRACT RATES (per BoQ item — negotiated vs BoQ rate)
-- ═══════════════════════════════════════════════════════════════════════

-- Stores the agreed borongan rate for each BoQ item per mandor.
-- boq_labor_rate is frozen from AHS at setup time for variance comparison.
CREATE TABLE IF NOT EXISTS mandor_contract_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  contracted_rate NUMERIC NOT NULL DEFAULT 0,  -- agreed borongan (Rp per unit)
  boq_labor_rate NUMERIC NOT NULL DEFAULT 0,   -- frozen AHS labor total (Rp per unit)
  unit TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, boq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_rates_contract ON mandor_contract_rates(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_rates_boq ON mandor_contract_rates(boq_item_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. OPNAME HEADERS (one per week per mandor)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES mandor_contracts(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  opname_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'PAID')),

  -- Submission
  submitted_by UUID REFERENCES profiles(id),
  submitted_at TIMESTAMPTZ,

  -- Estimator verification
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  verifier_notes TEXT,

  -- Admin approval
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,

  -- Payment summary (all Rp)
  gross_total NUMERIC NOT NULL DEFAULT 0,      -- sum of all line cumulative amounts
  retention_pct NUMERIC NOT NULL DEFAULT 10,
  retention_amount NUMERIC NOT NULL DEFAULT 0, -- gross × retention_pct/100
  net_to_date NUMERIC NOT NULL DEFAULT 0,       -- gross - retention
  prior_paid NUMERIC NOT NULL DEFAULT 0,        -- sum of all prior approved opnames net_to_date
  kasbon NUMERIC NOT NULL DEFAULT 0,            -- cash advance this week (admin-entered)
  net_this_week NUMERIC NOT NULL DEFAULT 0,     -- net_to_date - prior_paid - kasbon

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_opname_headers_project ON opname_headers(project_id);
CREATE INDEX IF NOT EXISTS idx_opname_headers_contract ON opname_headers(contract_id);
CREATE INDEX IF NOT EXISTS idx_opname_headers_status ON opname_headers(contract_id, status);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. OPNAME LINES (one per BoQ item per opname)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,

  -- Snapshot of contract at time of opname
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  budget_volume NUMERIC NOT NULL DEFAULT 0,
  contracted_rate NUMERIC NOT NULL DEFAULT 0,  -- snapshot from mandor_contract_rates
  boq_labor_rate NUMERIC NOT NULL DEFAULT 0,   -- snapshot for variance display

  -- Progress (cumulative %, 0-100)
  cumulative_pct NUMERIC NOT NULL DEFAULT 0,      -- submitted by supervisor/mandor
  verified_pct NUMERIC,                            -- adjusted by estimator if different
  prev_cumulative_pct NUMERIC NOT NULL DEFAULT 0,  -- auto from prior opname line

  -- Derived amounts (Rp) — recomputed on save
  this_week_pct NUMERIC GENERATED ALWAYS AS (
    COALESCE(verified_pct, cumulative_pct) - prev_cumulative_pct
  ) STORED,
  cumulative_amount NUMERIC NOT NULL DEFAULT 0,   -- volume × rate × COALESCE(verified,cumul)%
  this_week_amount NUMERIC NOT NULL DEFAULT 0,    -- volume × rate × this_week_pct

  -- Rejection (TDK ACC)
  is_tdk_acc BOOLEAN NOT NULL DEFAULT false,
  tdk_acc_reason TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (header_id, boq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_opname_lines_header ON opname_lines(header_id);
CREATE INDEX IF NOT EXISTS idx_opname_lines_boq ON opname_lines(boq_item_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. VIEW: v_labor_boq_rates
--    Labor cost per BoQ item broken down by trade category.
--    Used to derive boq_labor_rate when setting up mandor contract rates.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_labor_boq_rates AS
SELECT
  al.boq_item_id,
  bi.code AS boq_code,
  bi.label AS boq_label,
  bi.unit,
  bi.planned AS budget_volume,
  al.trade_category,
  -- Total labor cost per unit for this trade on this BoQ item
  SUM(al.coefficient * al.unit_price) AS labor_rate_per_unit,
  -- HOK breakdown
  SUM(al.coefficient) AS total_hok,
  COUNT(*) AS labor_line_count
FROM ahs_lines al
JOIN boq_items bi ON bi.id = al.boq_item_id
WHERE al.line_type = 'labor'
  AND al.trade_category IS NOT NULL
GROUP BY al.boq_item_id, bi.code, bi.label, bi.unit, bi.planned, al.trade_category;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. VIEW: v_opname_progress_summary
--    Weekly progress dashboard for admin/estimator.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_opname_progress_summary AS
SELECT
  oh.id AS opname_id,
  oh.project_id,
  oh.week_number,
  oh.opname_date,
  oh.status,
  mc.mandor_name,
  mc.trade_categories,
  -- Line counts
  COUNT(ol.id) AS line_count,
  COUNT(ol.id) FILTER (WHERE ol.is_tdk_acc) AS tdk_acc_count,
  -- Progress
  ROUND(AVG(COALESCE(ol.verified_pct, ol.cumulative_pct)), 1) AS avg_progress_pct,
  -- Payment summary
  oh.gross_total,
  oh.retention_amount,
  oh.net_to_date,
  oh.prior_paid,
  oh.kasbon,
  oh.net_this_week,
  -- Variance (contract vs BoQ)
  CASE
    WHEN SUM(ol.budget_volume * ol.boq_labor_rate) > 0
    THEN ROUND(
      ((SUM(ol.budget_volume * ol.contracted_rate) - SUM(ol.budget_volume * ol.boq_labor_rate))
       / SUM(ol.budget_volume * ol.boq_labor_rate)) * 100, 1
    )
    ELSE 0
  END AS overall_variance_pct
FROM opname_headers oh
JOIN mandor_contracts mc ON mc.id = oh.contract_id
LEFT JOIN opname_lines ol ON ol.header_id = oh.id
GROUP BY oh.id, oh.project_id, oh.week_number, oh.opname_date, oh.status,
         mc.mandor_name, mc.trade_categories,
         oh.gross_total, oh.retention_amount, oh.net_to_date,
         oh.prior_paid, oh.kasbon, oh.net_this_week;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RPC: get_prior_paid
--    Sum net_to_date of all prior APPROVED/PAID opnames for a contract.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_prior_paid(
  p_contract_id UUID,
  p_week_number INT
)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(net_to_date), 0)
  FROM opname_headers
  WHERE contract_id = p_contract_id
    AND week_number < p_week_number
    AND status IN ('APPROVED', 'PAID');
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RPS: get_prev_line_pct
--    Get the most recent verified cumulative % for a BoQ item under a contract.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_prev_line_pct(
  p_contract_id UUID,
  p_boq_item_id UUID,
  p_week_number INT
)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    COALESCE(ol.verified_pct, ol.cumulative_pct),
    0
  )
  FROM opname_lines ol
  JOIN opname_headers oh ON oh.id = ol.header_id
  WHERE oh.contract_id = p_contract_id
    AND ol.boq_item_id = p_boq_item_id
    AND oh.week_number < p_week_number
    AND oh.status IN ('VERIFIED', 'APPROVED', 'PAID')
  ORDER BY oh.week_number DESC
  LIMIT 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE mandor_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandor_contract_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE opname_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE opname_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mandor_contracts_select" ON mandor_contracts;
DROP POLICY IF EXISTS "mandor_contracts_write" ON mandor_contracts;
DROP POLICY IF EXISTS "contract_rates_select" ON mandor_contract_rates;
DROP POLICY IF EXISTS "contract_rates_write" ON mandor_contract_rates;
DROP POLICY IF EXISTS "opname_headers_select" ON opname_headers;
DROP POLICY IF EXISTS "opname_headers_write" ON opname_headers;
DROP POLICY IF EXISTS "opname_lines_select" ON opname_lines;
DROP POLICY IF EXISTS "opname_lines_write" ON opname_lines;

-- Mandor contracts: project-assigned users can read; estimator/admin can write
CREATE POLICY "mandor_contracts_select" ON mandor_contracts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = mandor_contracts.project_id AND pa.user_id = auth.uid()
  ));

CREATE POLICY "mandor_contracts_write" ON mandor_contracts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM project_assignments pa JOIN profiles pr ON pr.id = auth.uid()
    WHERE pa.project_id = mandor_contracts.project_id AND pa.user_id = auth.uid()
      AND pr.role IN ('estimator', 'admin', 'principal')
  ));

-- Contract rates: same as mandor_contracts
CREATE POLICY "contract_rates_select" ON mandor_contract_rates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM mandor_contracts mc
    JOIN project_assignments pa ON pa.project_id = mc.project_id
    WHERE mc.id = mandor_contract_rates.contract_id AND pa.user_id = auth.uid()
  ));

CREATE POLICY "contract_rates_write" ON mandor_contract_rates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM mandor_contracts mc
    JOIN project_assignments pa ON pa.project_id = mc.project_id
    JOIN profiles pr ON pr.id = auth.uid()
    WHERE mc.id = mandor_contract_rates.contract_id AND pa.user_id = auth.uid()
      AND pr.role IN ('estimator', 'admin', 'principal')
  ));

-- Opname headers: all assigned users can read; supervisor+ can create/update
CREATE POLICY "opname_headers_select" ON opname_headers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = opname_headers.project_id AND pa.user_id = auth.uid()
  ));

CREATE POLICY "opname_headers_write" ON opname_headers FOR ALL
  USING (EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = opname_headers.project_id AND pa.user_id = auth.uid()
  ));

-- Opname lines: same project access
CREATE POLICY "opname_lines_select" ON opname_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM opname_headers oh
    JOIN project_assignments pa ON pa.project_id = oh.project_id
    WHERE oh.id = opname_lines.header_id AND pa.user_id = auth.uid()
  ));

CREATE POLICY "opname_lines_write" ON opname_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM opname_headers oh
    JOIN project_assignments pa ON pa.project_id = oh.project_id
    WHERE oh.id = opname_lines.header_id AND pa.user_id = auth.uid()
  ));
