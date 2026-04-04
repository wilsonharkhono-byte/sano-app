# Opname & Labor Architecture Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mandor opname/labor payment system so it is structurally integrated with the BoQ baseline and Gate 4 progress system, with all payment logic in Postgres, role-enforced status transitions, and Gate 5 reconciliation visibility.

**Architecture:** The current `008_labor_opname.sql` creates a standalone payment silo disconnected from Gate 4 `progress_entries` and Gate 5 reporting. This plan replaces it with a BoQ-anchored architecture where: (1) opname lives under the Progres tab as a derivative module, (2) mandor claims are cross-referenced against field-verified progress, (3) all payment waterfall computation and status transitions are Postgres RPCs with role checks, (4) opname results feed Gate 5 reconciliation views. The mandor contract setup remains a one-time estimator task but its rate data derives from the frozen AHS baseline.

**Tech Stack:** PostgreSQL 15 (Supabase), TypeScript, React Native / Expo, XLSX library for Excel export

**Reference Documents:**
- `docs/OPNAME_FEATURE_BRIEF.md` — domain context and business rules
- `SAN_DEVELOPER_BRIEF.md` — system architecture principles
- `SAN_PRODUCT_REQUIREMENTS.md` — product requirements
- `SAN_TASK_BREAKDOWN.md` — phasing and dependencies
- `FINISHING_GUIDELINE_EVALUATION.md` — finishing-phase context

---

## Architectural Decisions

### AD-1: Opname is a Gate 4 derivative, not a standalone module

The SAN brief mandates that `Progres` is the main field operations hub. Mandor opname is a **payment claim against verified progress**, not an independent progress tracker. Therefore:

- Opname screens are accessed from the Progres tab (not separate bottom tabs)
- Opname `cumulative_pct` is cross-referenced against `boq_items.progress` derived from `progress_entries`
- A new view `v_opname_progress_reconciliation` flags divergence between claimed progress and field-verified progress

### AD-2: All payment computation lives in Postgres

The SAN brief says: "Do not rely on frontend-only calculations for critical controls." Therefore:

- `recomputeHeaderTotals` → replaced by trigger `trg_recompute_opname_totals`
- `updateOpnameLine` amount calculation → replaced by RPC `update_opname_line_progress`
- `submitOpname`, `verifyOpname`, `approveOpname`, `markOpnamePaid` → replaced by role-checking RPCs
- `prior_paid` → refreshed at each status transition, not frozen at creation

### AD-3: Status transitions enforce roles at the database level

- `submit_opname` — requires `auth.uid()` to be project-assigned
- `verify_opname` — requires role `estimator`, `admin`, or `principal`
- `approve_opname` — requires role `admin` or `principal`
- `mark_opname_paid` — requires role `admin` or `principal`

### AD-4: Audit trail for line revisions

When an estimator adjusts `verified_pct` (rework rejection), an `opname_line_revisions` record is created automatically by the RPC, capturing who changed what and why.

### AD-5: Gate 5 integration

A `v_labor_payment_summary` view aggregates opname data per project for the Gate 5 reconciliation center, alongside material costs.

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `supabase/migrations/010_opname_rebuild.sql` | New migration: RPCs, triggers, views, audit table, indexes. Does NOT drop 008 tables — extends them in place. |
| `tools/opnameRpc.ts` | Thin TypeScript wrapper calling only Supabase RPCs. Replaces all client-side computation from `tools/opname.ts`. |
| `tools/__tests__/opnameRpc.test.ts` | Unit tests for the TS wrapper (mocked Supabase calls). |
| `supabase/tests/010_opname_rebuild.test.sql` | pgTAP tests for RPCs, triggers, RLS, and views. |

### Existing files to modify

| File | Change |
|------|--------|
| `tools/opname.ts` | Deprecate client-side computation functions. Re-export from `opnameRpc.ts`. Keep `exportOpnameToExcel` and `formatRp` as-is. |
| `tools/laborTrade.ts` | Already updated to batch RPC — verify `apply_detected_trade_categories` RPC exists in migration. |
| `tools/types.ts` | Add `OpnameProgressFlag` interface, extend `Project` with `location` and `client_name`. |
| `office/navigation.tsx` | Remove standalone Mandor/Opname bottom tabs. Add Opname as a sub-route under Progres. |

---

## Task 1: Create the pgTAP test scaffold

**Files:**
- Create: `supabase/tests/010_opname_rebuild.test.sql`

This task creates the test file with failing tests for every RPC and view we will build. We run tests after each subsequent task to track progress.

- [ ] **Step 1: Create the pgTAP test file**

```sql
-- supabase/tests/010_opname_rebuild.test.sql
-- pgTAP tests for the opname architecture rebuild.
-- Run with: supabase test db

BEGIN;
SELECT plan(14);

-- ── RPC existence tests ─────────────────────────────────────────────
SELECT has_function('update_opname_line_progress',
  'RPC update_opname_line_progress should exist');

SELECT has_function('submit_opname',
  'RPC submit_opname should exist');

SELECT has_function('verify_opname',
  'RPC verify_opname should exist');

SELECT has_function('approve_opname',
  'RPC approve_opname should exist');

SELECT has_function('mark_opname_paid',
  'RPC mark_opname_paid should exist');

SELECT has_function('promote_verified_pct',
  'RPC promote_verified_pct should exist');

SELECT has_function('refresh_prior_paid',
  'RPC refresh_prior_paid should exist');

SELECT has_function('apply_detected_trade_categories',
  'RPC apply_detected_trade_categories should exist');

-- ── View existence tests ────────────────────────────────────────────
SELECT has_view('v_opname_progress_reconciliation',
  'View v_opname_progress_reconciliation should exist');

SELECT has_view('v_labor_payment_summary',
  'View v_labor_payment_summary should exist');

-- ── Table existence tests ───────────────────────────────────────────
SELECT has_table('opname_line_revisions',
  'Audit table opname_line_revisions should exist');

-- ── Index tests ─────────────────────────────────────────────────────
SELECT has_index('ahs_lines', 'idx_ahs_lines_trade_category',
  'Index on ahs_lines.trade_category should exist');

SELECT has_index('ahs_lines', 'idx_ahs_lines_line_type_trade',
  'Composite index on ahs_lines(line_type, trade_category) should exist');

-- ── Trigger tests ───────────────────────────────────────────────────
SELECT has_trigger('opname_lines', 'trg_recompute_opname_totals',
  'Trigger trg_recompute_opname_totals should exist on opname_lines');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Verify tests fail (no migration yet)**

Run: `supabase test db 2>&1 | head -40`
Expected: All 14 tests FAIL (functions/views/table not yet created)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/010_opname_rebuild.test.sql
git commit -m "test: add pgTAP scaffold for opname architecture rebuild (all failing)"
```

---

## Task 2: Create migration — audit table, indexes, and helper types

**Files:**
- Create: `supabase/migrations/010_opname_rebuild.sql` (first section)

- [ ] **Step 1: Write the audit table, missing indexes, and batch trade RPC**

```sql
-- supabase/migrations/010_opname_rebuild.sql
-- SANO — Opname Architecture Rebuild
-- Integrates mandor payment with Gate 4 progress and Gate 5 reconciliation.
-- Moves all payment computation into Postgres RPCs with role enforcement.
--
-- Run AFTER 008_labor_opname.sql.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. AUDIT TABLE: opname_line_revisions
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS opname_line_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_line_id UUID NOT NULL REFERENCES opname_lines(id) ON DELETE CASCADE,
  header_id UUID NOT NULL REFERENCES opname_headers(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES profiles(id),
  field_name TEXT NOT NULL,
  old_value NUMERIC,
  new_value NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_line
  ON opname_line_revisions(opname_line_id);
CREATE INDEX IF NOT EXISTS idx_opname_line_revisions_header
  ON opname_line_revisions(header_id);

-- RLS: same access as opname_lines (project-assigned users)
ALTER TABLE opname_line_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opname_line_revisions_select" ON opname_line_revisions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM opname_headers oh
    JOIN project_assignments pa ON pa.project_id = oh.project_id
    WHERE oh.id = opname_line_revisions.header_id AND pa.user_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MISSING INDEXES on ahs_lines
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ahs_lines_trade_category
  ON ahs_lines(trade_category)
  WHERE trade_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ahs_lines_line_type_trade
  ON ahs_lines(line_type, trade_category)
  WHERE line_type = 'labor';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. BATCH TRADE CATEGORY RPC (replaces serial JS loop)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_detected_trade_categories(
  p_updates JSONB  -- array of {"id": "uuid", "trade_category": "text"}
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE ahs_lines
    SET trade_category = item->>'trade_category'
    WHERE id = (item->>'id')::UUID
      AND (trade_confirmed = false OR trade_confirmed IS NULL);
  END LOOP;
END;
$$;
```

- [ ] **Step 2: Apply migration and run pgTAP tests**

Run: `supabase db push && supabase test db 2>&1 | tail -20`
Expected: Tests for `opname_line_revisions`, `idx_ahs_lines_trade_category`, `idx_ahs_lines_line_type_trade`, and `apply_detected_trade_categories` now PASS. Others still FAIL.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_opname_rebuild.sql
git commit -m "feat(db): add opname audit table, ahs indexes, batch trade RPC"
```

---

## Task 3: Create the progress reconciliation view

**Files:**
- Modify: `supabase/migrations/010_opname_rebuild.sql` (append)

This view is the critical bridge between Gate 4 progress and opname claims. It compares what the mandor claims against what the field shows.

- [ ] **Step 1: Append the reconciliation view to the migration**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 4. VIEW: v_opname_progress_reconciliation
--    Cross-references opname claimed % against Gate 4 field progress.
--    Flags lines where mandor claim diverges significantly from
--    field-verified installed progress.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_opname_progress_reconciliation AS
SELECT
  ol.id AS line_id,
  ol.header_id,
  oh.project_id,
  oh.contract_id,
  oh.week_number,
  ol.boq_item_id,
  bi.code AS boq_code,
  bi.label AS boq_label,
  bi.unit,
  bi.planned AS budget_volume,
  -- Mandor's claimed progress
  COALESCE(ol.verified_pct, ol.cumulative_pct) AS claimed_progress_pct,
  -- Field-verified progress from Gate 4 progress_entries
  CASE
    WHEN bi.planned > 0
    THEN ROUND((bi.installed / bi.planned) * 100, 1)
    ELSE 0
  END AS field_progress_pct,
  -- Variance: positive = mandor claims MORE than field shows
  COALESCE(ol.verified_pct, ol.cumulative_pct)
    - CASE
        WHEN bi.planned > 0
        THEN ROUND((bi.installed / bi.planned) * 100, 1)
        ELSE 0
      END AS variance_pct,
  -- Flag
  CASE
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 20 THEN 'HIGH'
    WHEN ABS(
      COALESCE(ol.verified_pct, ol.cumulative_pct)
      - CASE WHEN bi.planned > 0 THEN ROUND((bi.installed / bi.planned) * 100, 1) ELSE 0 END
    ) > 10 THEN 'WARNING'
    ELSE 'OK'
  END AS variance_flag
FROM opname_lines ol
JOIN opname_headers oh ON oh.id = ol.header_id
JOIN boq_items bi ON bi.id = ol.boq_item_id;
```

- [ ] **Step 2: Apply and run pgTAP**

Run: `supabase db push && supabase test db 2>&1 | grep -E "(ok|not ok)"`
Expected: `v_opname_progress_reconciliation` test now PASSES.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_opname_rebuild.sql
git commit -m "feat(db): add v_opname_progress_reconciliation view bridging opname to Gate 4"
```

---

## Task 4: Create the payment waterfall trigger

**Files:**
- Modify: `supabase/migrations/010_opname_rebuild.sql` (append)

This replaces the client-side `recomputeHeaderTotals()` function with a Postgres trigger that fires on every opname_lines INSERT or UPDATE.

- [ ] **Step 1: Append the trigger function and trigger**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 5. TRIGGER: Auto-recompute opname_header totals on line changes
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_recompute_opname_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_header_id UUID;
  v_gross NUMERIC;
  v_ret_pct NUMERIC;
  v_retention NUMERIC;
  v_net_to_date NUMERIC;
  v_prior_paid NUMERIC;
  v_kasbon NUMERIC;
BEGIN
  v_header_id := COALESCE(NEW.header_id, OLD.header_id);

  -- Sum gross from non-rejected lines
  SELECT COALESCE(SUM(cumulative_amount), 0)
  INTO v_gross
  FROM opname_lines
  WHERE header_id = v_header_id
    AND is_tdk_acc = false;

  -- Get header payment params
  SELECT retention_pct, prior_paid, kasbon
  INTO v_ret_pct, v_prior_paid, v_kasbon
  FROM opname_headers
  WHERE id = v_header_id;

  v_retention := v_gross * (v_ret_pct / 100);
  v_net_to_date := v_gross - v_retention;

  UPDATE opname_headers SET
    gross_total = v_gross,
    retention_amount = v_retention,
    net_to_date = v_net_to_date,
    net_this_week = GREATEST(0, v_net_to_date - v_prior_paid - v_kasbon)
  WHERE id = v_header_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_opname_totals ON opname_lines;
CREATE TRIGGER trg_recompute_opname_totals
  AFTER INSERT OR UPDATE OR DELETE ON opname_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_recompute_opname_totals();
```

- [ ] **Step 2: Apply and run pgTAP**

Run: `supabase db push && supabase test db 2>&1 | grep -E "(ok|not ok)"`
Expected: `trg_recompute_opname_totals` trigger test now PASSES.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_opname_rebuild.sql
git commit -m "feat(db): add trigger to auto-recompute opname header totals on line changes"
```

---

## Task 5: Create role-enforced status transition RPCs

**Files:**
- Modify: `supabase/migrations/010_opname_rebuild.sql` (append)

These RPCs replace the client-side `submitOpname`, `verifyOpname`, `approveOpname`, and `markOpnamePaid` functions. Each enforces the required role and valid status transition at the database level.

- [ ] **Step 1: Append the update_opname_line_progress RPC**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 6. RPC: update_opname_line_progress
--    Updates a line's progress %, recomputes amounts, logs revisions.
--    The trigger on opname_lines will auto-recompute header totals.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_opname_line_progress(
  p_line_id UUID,
  p_cumulative_pct NUMERIC DEFAULT NULL,
  p_verified_pct NUMERIC DEFAULT NULL,
  p_is_tdk_acc BOOLEAN DEFAULT NULL,
  p_tdk_acc_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line opname_lines%ROWTYPE;
  v_effective_pct NUMERIC;
  v_prev_pct NUMERIC;
  v_this_week_pct NUMERIC;
  v_header_id UUID;
BEGIN
  SELECT * INTO v_line FROM opname_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname line not found: %', p_line_id;
  END IF;

  v_header_id := v_line.header_id;

  -- Log revision if verified_pct is being changed
  IF p_verified_pct IS NOT NULL AND p_verified_pct IS DISTINCT FROM v_line.verified_pct THEN
    INSERT INTO opname_line_revisions (opname_line_id, header_id, changed_by, field_name, old_value, new_value, reason)
    VALUES (p_line_id, v_header_id, auth.uid(), 'verified_pct',
            v_line.verified_pct, p_verified_pct, p_notes);
  END IF;

  -- Log revision if cumulative_pct is being changed
  IF p_cumulative_pct IS NOT NULL AND p_cumulative_pct IS DISTINCT FROM v_line.cumulative_pct THEN
    INSERT INTO opname_line_revisions (opname_line_id, header_id, changed_by, field_name, old_value, new_value, reason)
    VALUES (p_line_id, v_header_id, auth.uid(), 'cumulative_pct',
            v_line.cumulative_pct, p_cumulative_pct, p_notes);
  END IF;

  -- Compute amounts
  v_effective_pct := COALESCE(p_verified_pct, p_cumulative_pct, v_line.verified_pct, v_line.cumulative_pct, 0) / 100;
  v_prev_pct := v_line.prev_cumulative_pct / 100;
  v_this_week_pct := GREATEST(0, v_effective_pct - v_prev_pct);

  UPDATE opname_lines SET
    cumulative_pct = COALESCE(p_cumulative_pct, cumulative_pct),
    verified_pct = CASE WHEN p_verified_pct IS NOT NULL THEN p_verified_pct ELSE verified_pct END,
    is_tdk_acc = COALESCE(p_is_tdk_acc, is_tdk_acc),
    tdk_acc_reason = CASE WHEN p_tdk_acc_reason IS NOT NULL THEN p_tdk_acc_reason ELSE tdk_acc_reason END,
    notes = CASE WHEN p_notes IS NOT NULL THEN p_notes ELSE notes END,
    cumulative_amount = v_line.budget_volume * v_line.contracted_rate * v_effective_pct,
    this_week_amount = v_line.budget_volume * v_line.contracted_rate * v_this_week_pct
  WHERE id = p_line_id;
  -- Trigger will auto-recompute header totals
END;
$$;
```

- [ ] **Step 2: Append the status transition RPCs with role enforcement**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 7. RPC: submit_opname (any project-assigned user)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_opname(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id
  FROM opname_headers WHERE id = p_header_id AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in DRAFT status';
  END IF;

  -- Verify user is assigned to this project
  IF NOT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = v_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User not assigned to this project';
  END IF;

  UPDATE opname_headers SET
    status = 'SUBMITTED',
    submitted_by = auth.uid(),
    submitted_at = now()
  WHERE id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RPC: verify_opname (estimator, admin, principal only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION verify_opname(p_header_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_project_id UUID;
  v_role TEXT;
BEGIN
  SELECT project_id INTO v_project_id
  FROM opname_headers WHERE id = p_header_id AND status = 'SUBMITTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in SUBMITTED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('estimator', 'admin', 'principal') THEN
    RAISE EXCEPTION 'Only estimator, admin, or principal can verify opname';
  END IF;

  UPDATE opname_headers SET
    status = 'VERIFIED',
    verified_by = auth.uid(),
    verified_at = now(),
    verifier_notes = COALESCE(p_notes, verifier_notes)
  WHERE id = p_header_id;

  -- Promote verified_pct: lock in the verified values for next week
  PERFORM promote_verified_pct(p_header_id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. RPC: approve_opname (admin, principal only)
--    Refreshes prior_paid before computing final net_this_week.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION approve_opname(p_header_id UUID, p_kasbon NUMERIC DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_header opname_headers%ROWTYPE;
  v_role TEXT;
  v_fresh_prior_paid NUMERIC;
BEGIN
  SELECT * INTO v_header
  FROM opname_headers WHERE id = p_header_id AND status = 'VERIFIED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname not found or not in VERIFIED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'principal') THEN
    RAISE EXCEPTION 'Only admin or principal can approve opname';
  END IF;

  -- Refresh prior_paid with latest approved data (not frozen at creation)
  SELECT COALESCE(SUM(net_to_date), 0) INTO v_fresh_prior_paid
  FROM opname_headers
  WHERE contract_id = v_header.contract_id
    AND week_number < v_header.week_number
    AND status IN ('APPROVED', 'PAID');

  UPDATE opname_headers SET
    status = 'APPROVED',
    approved_by = auth.uid(),
    approved_at = now(),
    kasbon = p_kasbon,
    prior_paid = v_fresh_prior_paid,
    net_this_week = GREATEST(0, net_to_date - v_fresh_prior_paid - p_kasbon)
  WHERE id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. RPC: mark_opname_paid (admin, principal only)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION mark_opname_paid(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opname_headers WHERE id = p_header_id AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Opname not found or not in APPROVED status';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'principal') THEN
    RAISE EXCEPTION 'Only admin or principal can mark opname as paid';
  END IF;

  UPDATE opname_headers SET status = 'PAID' WHERE id = p_header_id;
END;
$$;
```

- [ ] **Step 3: Append the promote_verified_pct and refresh_prior_paid RPCs**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 11. RPC: promote_verified_pct
--    After verification, lock in the effective % so next week's
--    initOpnameLines uses the correct prev_cumulative_pct.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_verified_pct(p_header_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- For lines where estimator set verified_pct, that becomes canonical.
  -- For lines without verified_pct, cumulative_pct is already canonical.
  -- This is a no-op in terms of data change but documents the intent:
  -- next week's get_prev_line_pct will pick up COALESCE(verified_pct, cumulative_pct).
  -- No actual UPDATE needed — the get_prev_line_pct function already uses COALESCE.
  -- But we recompute amounts to ensure consistency after any estimator adjustments.
  UPDATE opname_lines SET
    cumulative_amount = budget_volume * contracted_rate
      * (COALESCE(verified_pct, cumulative_pct) / 100),
    this_week_amount = budget_volume * contracted_rate
      * GREATEST(0, (COALESCE(verified_pct, cumulative_pct) - prev_cumulative_pct) / 100)
  WHERE header_id = p_header_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. RPC: refresh_prior_paid
--    Recalculates prior_paid for an opname header from current approved data.
--    Called by approve_opname, but also available standalone.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_prior_paid(p_header_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contract_id UUID;
  v_week INT;
  v_prior NUMERIC;
BEGIN
  SELECT contract_id, week_number INTO v_contract_id, v_week
  FROM opname_headers WHERE id = p_header_id;

  SELECT COALESCE(SUM(net_to_date), 0) INTO v_prior
  FROM opname_headers
  WHERE contract_id = v_contract_id
    AND week_number < v_week
    AND status IN ('APPROVED', 'PAID');

  UPDATE opname_headers SET prior_paid = v_prior WHERE id = p_header_id;
  RETURN v_prior;
END;
$$;
```

- [ ] **Step 4: Apply and run pgTAP**

Run: `supabase db push && supabase test db 2>&1 | grep -E "(ok|not ok)"`
Expected: All RPC tests PASS. Only `v_labor_payment_summary` test still FAILS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/010_opname_rebuild.sql
git commit -m "feat(db): add role-enforced opname RPCs, promote_verified_pct, refresh_prior_paid"
```

---

## Task 6: Create the Gate 5 labor payment summary view

**Files:**
- Modify: `supabase/migrations/010_opname_rebuild.sql` (append)

- [ ] **Step 1: Append the Gate 5 view**

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- 13. VIEW: v_labor_payment_summary
--     Aggregates opname data per project for Gate 5 reconciliation.
--     Shows total labor cost vs BoQ budget per mandor and overall.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_labor_payment_summary AS
SELECT
  oh.project_id,
  mc.id AS contract_id,
  mc.mandor_name,
  mc.trade_categories,
  -- Payment totals across all opnames for this mandor
  COUNT(oh.id) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS approved_opname_count,
  COALESCE(SUM(oh.gross_total) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_gross,
  COALESCE(SUM(oh.retention_amount) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_retention,
  COALESCE(SUM(oh.net_this_week) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_paid,
  COALESCE(SUM(oh.kasbon) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')), 0) AS total_kasbon,
  -- Budget comparison: sum of (budget_volume * boq_labor_rate) across all contract rates
  COALESCE(budget.total_boq_labor_budget, 0) AS total_boq_labor_budget,
  COALESCE(budget.total_contracted_budget, 0) AS total_contracted_budget,
  -- Variance
  CASE
    WHEN COALESCE(budget.total_boq_labor_budget, 0) > 0
    THEN ROUND(
      ((COALESCE(budget.total_contracted_budget, 0) - budget.total_boq_labor_budget)
       / budget.total_boq_labor_budget) * 100, 1
    )
    ELSE 0
  END AS contract_vs_boq_variance_pct,
  -- Latest opname info
  MAX(oh.week_number) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS latest_approved_week,
  MAX(oh.opname_date) FILTER (WHERE oh.status IN ('APPROVED', 'PAID')) AS latest_approved_date
FROM mandor_contracts mc
LEFT JOIN opname_headers oh ON oh.contract_id = mc.id
LEFT JOIN LATERAL (
  SELECT
    SUM(cr.budget_volume_calc * cr.boq_labor_rate) AS total_boq_labor_budget,
    SUM(cr.budget_volume_calc * cr.contracted_rate) AS total_contracted_budget
  FROM (
    SELECT
      mcr.boq_labor_rate,
      mcr.contracted_rate,
      COALESCE(bi.planned, 0) AS budget_volume_calc
    FROM mandor_contract_rates mcr
    JOIN boq_items bi ON bi.id = mcr.boq_item_id
    WHERE mcr.contract_id = mc.id
  ) cr
) budget ON true
WHERE mc.is_active = true
GROUP BY oh.project_id, mc.id, mc.mandor_name, mc.trade_categories,
         budget.total_boq_labor_budget, budget.total_contracted_budget;
```

- [ ] **Step 2: Apply and run pgTAP**

Run: `supabase db push && supabase test db 2>&1 | grep -E "(ok|not ok)"`
Expected: ALL 14 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_opname_rebuild.sql
git commit -m "feat(db): add v_labor_payment_summary view for Gate 5 reconciliation"
```

---

## Task 7: Create the thin TypeScript RPC wrapper

**Files:**
- Create: `tools/opnameRpc.ts`
- Modify: `tools/opname.ts` (deprecate client-side functions)

- [ ] **Step 1: Create `tools/opnameRpc.ts`**

```typescript
/**
 * SANO — Opname RPC Wrapper
 *
 * Thin client that calls Postgres RPCs for all opname operations.
 * No payment computation happens in TypeScript.
 * Replaces client-side logic from tools/opname.ts.
 */

import { supabase } from './supabase';
import type { OpnameHeader, OpnameLine, OpnameProgressFlag } from './opname';

// ─── Line Updates ──────────────────────────────────────────────────────

export async function updateOpnameLineProgress(
  lineId: string,
  updates: {
    cumulative_pct?: number;
    verified_pct?: number | null;
    is_tdk_acc?: boolean;
    tdk_acc_reason?: string | null;
    notes?: string | null;
  },
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('update_opname_line_progress', {
    p_line_id: lineId,
    p_cumulative_pct: updates.cumulative_pct ?? null,
    p_verified_pct: updates.verified_pct ?? null,
    p_is_tdk_acc: updates.is_tdk_acc ?? null,
    p_tdk_acc_reason: updates.tdk_acc_reason ?? null,
    p_notes: updates.notes ?? null,
  });
  return { error: error?.message };
}

// ─── Status Transitions ────────────────────────────────────────────────

export async function submitOpname(headerId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('submit_opname', { p_header_id: headerId });
  return { error: error?.message };
}

export async function verifyOpname(
  headerId: string,
  notes?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('verify_opname', {
    p_header_id: headerId,
    p_notes: notes ?? null,
  });
  return { error: error?.message };
}

export async function approveOpname(
  headerId: string,
  kasbon: number,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('approve_opname', {
    p_header_id: headerId,
    p_kasbon: kasbon,
  });
  return { error: error?.message };
}

export async function markOpnamePaid(headerId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_opname_paid', { p_header_id: headerId });
  return { error: error?.message };
}

// ─── Progress Reconciliation ───────────────────────────────────────────

export async function getOpnameProgressFlags(
  headerId: string,
): Promise<OpnameProgressFlag[]> {
  const { data } = await supabase
    .from('v_opname_progress_reconciliation')
    .select('line_id, boq_item_id, boq_code, boq_label, claimed_progress_pct, field_progress_pct, variance_pct, variance_flag')
    .eq('header_id', headerId)
    .neq('variance_flag', 'OK')
    .order('variance_pct', { ascending: false });

  return (data ?? []) as OpnameProgressFlag[];
}

// ─── Gate 5: Labor Payment Summary ─────────────────────────────────────

export interface LaborPaymentSummary {
  project_id: string;
  contract_id: string;
  mandor_name: string;
  trade_categories: string[];
  approved_opname_count: number;
  total_gross: number;
  total_retention: number;
  total_paid: number;
  total_kasbon: number;
  total_boq_labor_budget: number;
  total_contracted_budget: number;
  contract_vs_boq_variance_pct: number;
  latest_approved_week: number | null;
  latest_approved_date: string | null;
}

export async function getLaborPaymentSummary(
  projectId: string,
): Promise<LaborPaymentSummary[]> {
  const { data } = await supabase
    .from('v_labor_payment_summary')
    .select('*')
    .eq('project_id', projectId)
    .order('mandor_name');

  return (data ?? []) as LaborPaymentSummary[];
}

// ─── Refresh Prior Paid ────────────────────────────────────────────────

export async function refreshPriorPaid(
  headerId: string,
): Promise<{ prior_paid: number; error?: string }> {
  const { data, error } = await supabase.rpc('refresh_prior_paid', {
    p_header_id: headerId,
  });
  return { prior_paid: data ?? 0, error: error?.message };
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/opnameRpc.ts
git commit -m "feat: add thin TypeScript RPC wrapper for opname operations"
```

---

## Task 8: Deprecate client-side computation in opname.ts

**Files:**
- Modify: `tools/opname.ts`

- [ ] **Step 1: Add deprecation notices and re-export from opnameRpc.ts**

At the top of `tools/opname.ts`, after the existing imports, add:

```typescript
// ─── DEPRECATION NOTICE ─────────────────────────────────────────────
// Client-side payment computation functions in this file are DEPRECATED.
// Use tools/opnameRpc.ts instead, which calls Postgres RPCs.
// Kept here only for backward compatibility during migration.
//
// Deprecated functions:
//   - updateOpnameLine → use opnameRpc.updateOpnameLineProgress
//   - submitOpname → use opnameRpc.submitOpname
//   - verifyOpname → use opnameRpc.verifyOpname
//   - approveOpname → use opnameRpc.approveOpname
//   - markOpnamePaid → use opnameRpc.markOpnamePaid
//   - computePaymentSummary → removed (computed in Postgres trigger)
//   - recomputeHeaderTotals → removed (Postgres trigger)
// ─────────────────────────────────────────────────────────────────────

export {
  updateOpnameLineProgress,
  submitOpname as submitOpnameRpc,
  verifyOpname as verifyOpnameRpc,
  approveOpname as approveOpnameRpc,
  markOpnamePaid as markOpnamePaidRpc,
  getOpnameProgressFlags,
  getLaborPaymentSummary,
  refreshPriorPaid,
} from './opnameRpc';
```

- [ ] **Step 2: Commit**

```bash
git add tools/opname.ts
git commit -m "refactor: deprecate client-side opname computation, re-export from opnameRpc"
```

---

## Task 9: Extend Project type and add OpnameProgressFlag

**Files:**
- Modify: `tools/types.ts`

- [ ] **Step 1: Extend the Project interface**

Find the `Project` interface in `tools/types.ts` (line 16-19) and replace with:

```typescript
export interface Project {
  id: string;
  code: string;
  name: string;
  location: string | null;
  client_name: string | null;
  contract_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
}
```

- [ ] **Step 2: Add OpnameProgressFlag after the ProgressPhoto interface (around line 375)**

```typescript
// ─── Opname Progress Reconciliation ─────────────────────────────────

export interface OpnameProgressFlag {
  line_id: string;
  boq_item_id: string;
  boq_code: string;
  boq_label: string;
  claimed_progress_pct: number;
  field_progress_pct: number;
  variance_pct: number;
  variance_flag: 'OK' | 'WARNING' | 'HIGH';
}
```

- [ ] **Step 3: Commit**

```bash
git add tools/types.ts
git commit -m "feat(types): extend Project interface, add OpnameProgressFlag"
```

---

## Task 10: Update navigation — opname under Progres tab

**Files:**
- Modify: `office/navigation.tsx`

- [ ] **Step 1: Read the current navigation file to understand structure**

Run: `cat office/navigation.tsx`

- [ ] **Step 2: Remove standalone Mandor and Opname bottom tabs**

Remove the two separate bottom tab entries for Mandor and Opname screens. Instead, these should be accessed as sub-routes within the Progres/Progress section.

The exact edit depends on current navigation structure, but the principle is:
- Remove `MandorSetupScreen` and `OpnameScreen` as top-level tabs
- Add them as stack screens accessible from the Progres area
- Mandor setup remains an estimator one-time task accessible from an "opname settings" entry
- Opname entry/review/approve is accessed from a "Mandor Payment" card within the Progres tab

- [ ] **Step 3: Commit**

```bash
git add office/navigation.tsx
git commit -m "refactor(nav): move opname under Progres tab, remove standalone mandor/opname tabs"
```

---

## Task 11: Write TypeScript unit tests

**Files:**
- Create: `tools/__tests__/opnameRpc.test.ts`

- [ ] **Step 1: Write tests with mocked Supabase client**

```typescript
// tools/__tests__/opnameRpc.test.ts
import {
  updateOpnameLineProgress,
  submitOpname,
  verifyOpname,
  approveOpname,
  markOpnamePaid,
  getOpnameProgressFlags,
  getLaborPaymentSummary,
  refreshPriorPaid,
} from '../opnameRpc';

// Mock supabase
jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

import { supabase } from '../supabase';

describe('opnameRpc', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('updateOpnameLineProgress', () => {
    it('calls the RPC with correct params', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
      const result = await updateOpnameLineProgress('line-1', { cumulative_pct: 50 });
      expect(supabase.rpc).toHaveBeenCalledWith('update_opname_line_progress', {
        p_line_id: 'line-1',
        p_cumulative_pct: 50,
        p_verified_pct: null,
        p_is_tdk_acc: null,
        p_tdk_acc_reason: null,
        p_notes: null,
      });
      expect(result.error).toBeUndefined();
    });

    it('returns error message on failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: { message: 'Line not found' } });
      const result = await updateOpnameLineProgress('bad-id', {});
      expect(result.error).toBe('Line not found');
    });
  });

  describe('submitOpname', () => {
    it('calls submit_opname RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
      await submitOpname('header-1');
      expect(supabase.rpc).toHaveBeenCalledWith('submit_opname', { p_header_id: 'header-1' });
    });
  });

  describe('verifyOpname', () => {
    it('passes notes to RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
      await verifyOpname('header-1', 'Checked all lines');
      expect(supabase.rpc).toHaveBeenCalledWith('verify_opname', {
        p_header_id: 'header-1',
        p_notes: 'Checked all lines',
      });
    });
  });

  describe('approveOpname', () => {
    it('passes kasbon to RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
      await approveOpname('header-1', 500000);
      expect(supabase.rpc).toHaveBeenCalledWith('approve_opname', {
        p_header_id: 'header-1',
        p_kasbon: 500000,
      });
    });
  });

  describe('markOpnamePaid', () => {
    it('calls mark_opname_paid RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
      await markOpnamePaid('header-1');
      expect(supabase.rpc).toHaveBeenCalledWith('mark_opname_paid', { p_header_id: 'header-1' });
    });
  });

  describe('refreshPriorPaid', () => {
    it('returns refreshed prior_paid value', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 15000000, error: null });
      const result = await refreshPriorPaid('header-1');
      expect(result.prior_paid).toBe(15000000);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tools/__tests__/opnameRpc.test.ts --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tools/__tests__/opnameRpc.test.ts
git commit -m "test: add unit tests for opnameRpc TypeScript wrapper"
```

---

## Task 12: Final verification — run all pgTAP tests and TypeScript check

**Files:** None (verification only)

- [ ] **Step 1: Run full pgTAP suite**

Run: `supabase test db 2>&1`
Expected: All 14 tests PASS.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors related to opname modules. (Pre-existing errors in other files are acceptable.)

- [ ] **Step 3: Run all JS/TS tests**

Run: `npx jest --passWithNoTests 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 4: Verify the migration file is complete and coherent**

Run: `wc -l supabase/migrations/010_opname_rebuild.sql`
Expected: ~300-400 lines. Review that all 13 numbered sections are present.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: opname architecture rebuild — all tests passing"
```

---

## Summary of What Changed and Why

| Before (008) | After (010) | Why |
|---|---|---|
| `cumulative_pct` entered independently of Gate 4 | `v_opname_progress_reconciliation` flags divergence from `boq_items.progress` | Mandor claims must be cross-checked against field truth |
| `recomputeHeaderTotals()` in TypeScript | `trg_recompute_opname_totals` Postgres trigger | Payment waterfall must be server-computed per SAN brief |
| `submitOpname()` — no role check | `submit_opname` RPC — checks project assignment | Role enforcement at DB level per SAN brief |
| `verifyOpname()` — no role check | `verify_opname` RPC — requires estimator/admin/principal | Prevents supervisor from self-verifying |
| `approveOpname()` — no role check, frozen prior_paid | `approve_opname` RPC — requires admin/principal, refreshes prior_paid | Correct payment, role-enforced |
| No audit trail for % changes | `opname_line_revisions` table, auto-populated by RPC | Rework disputes need evidence |
| `promote_verified_pct` — referenced but missing | Defined as Postgres function | Week-over-week rollover now works |
| No Gate 5 integration | `v_labor_payment_summary` view | Labor costs visible in reconciliation center |
| Standalone Mandor/Opname tabs | Opname accessed from Progres tab | Aligns with SAN brief — Progres is the main hub |
| Serial `ahs_lines` update loop | `apply_detected_trade_categories` batch RPC | Performance: 1 round-trip instead of N |
| No index on `trade_category` | Composite index on `(line_type, trade_category)` | View query performance |

---

## Known Scope Boundaries (Not In This Plan)

These items were identified in the analysis but are separate work:

1. **Kasbon running balance ledger** — useful but not blocking. Separate migration.
2. **BoQ version-aware views** — `v_labor_boq_rates` references `bi.planned` directly. When BoQ versioning is fully active, this view needs updating. Tracked separately.
3. **Screen UI implementation** — this plan covers schema, RPCs, and TS wrappers. The actual React Native screen changes (MandorSetupScreen, OpnameScreen as sub-routes of Progres) are a frontend task that depends on this plan completing first.
4. **Excel export update** — `exportOpnameToExcel` stays as-is. It reads from the same tables and will automatically reflect the corrected server-computed totals.
