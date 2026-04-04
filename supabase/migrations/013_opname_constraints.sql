-- SANO — Phase 3c: Opname Data Integrity Constraints
-- Adds CHECK constraints identified in the mandor/opname audit.
-- Run AFTER 012_ai_chat_log.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. KASBON MUST BE NON-NEGATIVE
-- ═══════════════════════════════════════════════════════════════════════
-- Prevents negative kasbon from inflating net_this_week.
ALTER TABLE opname_headers
  ADD CONSTRAINT chk_opname_headers_kasbon_non_negative
  CHECK (kasbon >= 0);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CUMULATIVE PROGRESS MUST BE 0–100
-- ═══════════════════════════════════════════════════════════════════════
-- Client already clamps, but this prevents direct API abuse.
ALTER TABLE opname_lines
  ADD CONSTRAINT chk_opname_lines_cumulative_pct_range
  CHECK (cumulative_pct BETWEEN 0 AND 100);

-- verified_pct is NULL when not yet verified; when set, must be 0–100
ALTER TABLE opname_lines
  ADD CONSTRAINT chk_opname_lines_verified_pct_range
  CHECK (verified_pct IS NULL OR verified_pct BETWEEN 0 AND 100);

-- prev_cumulative_pct should also be bounded
ALTER TABLE opname_lines
  ADD CONSTRAINT chk_opname_lines_prev_cumulative_pct_range
  CHECK (prev_cumulative_pct BETWEEN 0 AND 100);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RETENTION PERCENTAGE MUST BE 0–100
-- ═══════════════════════════════════════════════════════════════════════
-- Both on the contract template and the opname snapshot.
ALTER TABLE mandor_contracts
  ADD CONSTRAINT chk_mandor_contracts_retention_pct_range
  CHECK (retention_pct BETWEEN 0 AND 100);

ALTER TABLE opname_headers
  ADD CONSTRAINT chk_opname_headers_retention_pct_range
  CHECK (retention_pct BETWEEN 0 AND 100);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. CONTRACTED RATE MUST BE NON-NEGATIVE
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE mandor_contract_rates
  ADD CONSTRAINT chk_contract_rates_non_negative
  CHECK (contracted_rate >= 0);
