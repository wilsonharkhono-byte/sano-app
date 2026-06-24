# Material Tier Budget Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Tier-3 spend cap with a per-material Rupiah **budget envelope** that depletes as POs are ordered (benchmark-priced from the AHS template, admin price overriding when present), add **Tier 4** for untracked consumables, and surface both quantity- and Rupiah-controlled materials in one material-balance report.

**Architecture:** Prices/tiers live in a new `ahs_price_book` table (the AHS template). A SQL view `v_material_budget_status` computes the Rupiah envelope live (Approach A — no materialized snapshot, so a corrected price reflows everywhere and there is no re-publish double-counting). The tier dispatcher in `tools/envelopes.ts` gains a Rupiah Tier-3 branch and a no-op Tier-4 branch. The material-balance report UNIONs the existing quantity view with the new budget view.

**Tech Stack:** TypeScript, Supabase (Postgres + RLS + RPC), Jest (`~29.7.0`, tsx transform), React Native (Expo) report UI.

## Global Constraints

- **Truth-correctness contract:** never emit a number we can't stand behind. Unmatched materials → Unresolved; Tier-3 material with no benchmark price → blocking gate flag, never a silent pass and never a fabricated budget. (CLAUDE.md §1.1, §12.)
- **Migrations idempotent**, applied via Dashboard SQL Editor — remote migration history is diverged, `supabase db push` is unreliable. Find existing constraints by shape, not hardcoded name.
- **RLS:** any new table the app reads under the authenticated role needs an explicit authenticated read policy, or it silently loads empty (the `material_aliases` failure mode). Verify under the authenticated role, not just service role.
- **Pre-markup prices only** at envelope evaluation. `ahs_price_book.unit_price` is the base price; markup is applied at quote/billing time, not here.
- **Parallel rebuild:** the existing `parseBoqV2` path stays live and untouched. New ingestion ships beside it.
- **Tier values:** `1 | 2 | 3 | 4` everywhere a tier type appears.
- Run a single test file with: `npx jest <path>`.

## Scope

In scope: the control system end to end — schema, budget view, gate logic, report, and **AHS price book ingestion** (its format is fixed: `material | unit | unit_price | tier`).

Deferred to a follow-up plan: the **simplified BoQ parser** that populates `project_material_master_lines` (planned quantities). Its column layout is pending the estimator's template. Until then, the budget view reads whatever `project_material_master_lines` rows exist (populated today by `parseBoqV2`, later by the new parser); nothing in this plan depends on the simplified format.

## File Structure

- `supabase/migrations/047_material_tier_budget_control.sql` — **create.** Price book table, tier widening, `actual_unit_price` column, RLS, `v_material_budget_status` view, `get_material_budget` RPC.
- `tools/types.ts` — **modify.** Widen tier unions; add `MaterialBudgetStatus`.
- `tools/budgetGate.ts` — **create.** Pure evaluators `evaluateTier3Budget` / `evaluateTier4Untracked` (kept in their own file so they're trivially unit-testable, mirroring how `mergeEnvelopeWithBaselinePrice` is tested purely).
- `tools/__tests__/budgetGate.test.ts` — **create.** Pure-function tests.
- `tools/envelopes.ts` — **modify.** Add `getMaterialBudget` + `checkTier3Budget`; widen dispatcher to Tier 4; delete `checkTier3SpendCap` + `TIER3_PER_REQUEST_CAP`.
- `tools/derivation.ts` — **modify.** Add `MaterialBalanceRow` + pure `buildMaterialBalanceRows` + `deriveMaterialBalanceWithControl`.
- `tools/__tests__/materialBalanceControl.test.ts` — **create.** Pure-merge tests.
- `tools/reports.ts` — **modify.** `generateMaterialBalanceReport` uses the control-aware derivation.
- `tools/priceBookIngest.ts` — **create.** Pure `mapPriceBookRows` (sheet rows → price-book records) + `ingestPriceBook` (upsert).
- `tools/__tests__/priceBookIngest.test.ts` — **create.** Pure-mapper tests.
- The material-balance report UI component — **modify** (Task 6) to render the unified table.

---

### Task 1: Migration 047 — schema, budget view, RPC

**Files:**
- Create: `supabase/migrations/047_material_tier_budget_control.sql`

**Interfaces:**
- Produces: table `ahs_price_book(project_id, material_id, material_name, unit, unit_price, tier, effective_from)`; column `material_request_lines.actual_unit_price NUMERIC`; view `v_material_budget_status(material_id, project_id, material_name, tier, unit, benchmark_unit_price, total_planned, budget_total_rupiah, committed_rupiah, remaining_rupiah, burn_pct, boq_item_count)`; RPC `get_material_budget(p_project_id UUID, p_material_id UUID)` returning that view's columns.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Verify the SQL parses and is idempotent (dry run twice)**

Apply the file twice in the Dashboard SQL Editor (or a local `psql`). Expected: both runs succeed with no error (second run hits `IF NOT EXISTS` / `OR REPLACE` / the shape-based constraint drop).

- [ ] **Step 3: Verify the constraint widened**

Run: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'material_catalog_tier_check';`
Expected: `CHECK ((tier = ANY (ARRAY[1, 2, 3, 4])))`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/047_material_tier_budget_control.sql
git commit -m "feat(db): material tier budget control — price book, budget view (047)"
```

---

### Task 2: Types + pure tier evaluators

**Files:**
- Modify: `tools/types.ts`
- Create: `tools/budgetGate.ts`
- Test: `tools/__tests__/budgetGate.test.ts`

**Interfaces:**
- Consumes: `GateResult`, `FlagLevel` from `tools/types.ts`.
- Produces: `MaterialBudgetStatus` interface; `evaluateTier3Budget(budget: MaterialBudgetStatus | null, requestedQty: number, actualUnitPrice?: number): GateResult`; `evaluateTier4Untracked(): GateResult`.

- [ ] **Step 1: Add types to `tools/types.ts`**

Widen the existing tier unions (the `MaterialEnvelopeStatus.tier` field) from `1 | 2 | 3` to `1 | 2 | 3 | 4`, and add below it:

```typescript
export interface MaterialBudgetStatus {
  material_id: string;
  project_id: string;
  material_name: string;
  tier: 1 | 2 | 3 | 4;
  unit: string;
  benchmark_unit_price: number | null;   // null = material has no price-book entry
  total_planned: number;
  budget_total_rupiah: number | null;
  committed_rupiah: number;
  remaining_rupiah: number | null;
  burn_pct: number | null;
  boq_item_count: number;
}
```

- [ ] **Step 2: Write the failing test `tools/__tests__/budgetGate.test.ts`**

```typescript
import { evaluateTier3Budget, evaluateTier4Untracked } from '../budgetGate';
import type { MaterialBudgetStatus } from '../types';

const budget = (m: Partial<MaterialBudgetStatus>): MaterialBudgetStatus => ({
  material_id: 'mat-1',
  project_id: 'proj-1',
  material_name: 'Cat tembok',
  tier: 3,
  unit: 'ltr',
  benchmark_unit_price: 85_000,
  total_planned: 100,
  budget_total_rupiah: 8_500_000,
  committed_rupiah: 0,
  remaining_rupiah: 8_500_000,
  burn_pct: 0,
  boq_item_count: 4,
  ...m,
});

describe('evaluateTier3Budget', () => {
  it('OK when well within budget', () => {
    const r = evaluateTier3Budget(budget({}), 10);            // 10 × 85k = 850k of 8.5M
    expect(r.flag).toBe('OK');
  });

  it('WARNING past 80% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 6_500_000 }), 10); // 6.5M+850k=7.35M = 86%
    expect(r.flag).toBe('WARNING');
  });

  it('HIGH past 100% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 8_000_000 }), 10); // 8.85M = 104%
    expect(r.flag).toBe('HIGH');
  });

  it('CRITICAL past 120% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 10_000_000 }), 10); // 10.85M = 127%
    expect(r.flag).toBe('CRITICAL');
  });

  it('uses actual price override instead of benchmark', () => {
    const r = evaluateTier3Budget(budget({}), 10, 1_000_000); // 10 × 1M = 10M > 8.5M
    expect(r.flag).toBe('CRITICAL');
  });

  it('blocks (WARNING) when no price-book row at all', () => {
    const r = evaluateTier3Budget(null, 10);
    expect(r.flag).toBe('WARNING');
    expect(r.check).toBe('tier3_no_budget');
  });

  it('blocks (WARNING) when benchmark price is missing and no override given', () => {
    const r = evaluateTier3Budget(budget({ benchmark_unit_price: null, budget_total_rupiah: null }), 10);
    expect(r.flag).toBe('WARNING');
    expect(r.check).toBe('tier3_no_benchmark');
  });
});

describe('evaluateTier4Untracked', () => {
  it('always OK', () => {
    expect(evaluateTier4Untracked().flag).toBe('OK');
    expect(evaluateTier4Untracked().check).toBe('tier4_untracked');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tools/__tests__/budgetGate.test.ts`
Expected: FAIL — `Cannot find module '../budgetGate'`.

- [ ] **Step 4: Implement `tools/budgetGate.ts`**

```typescript
// SANO — pure Tier-3 (Rupiah budget) and Tier-4 (untracked) gate evaluators.
// Kept pure (no supabase) so they unit-test without mocking, like
// mergeEnvelopeWithBaselinePrice. The fetch + dispatch wrappers live in envelopes.ts.
import type { GateResult, MaterialBudgetStatus } from './types';

const BUDGET_WARNING_PCT = 80;
const BUDGET_CRITICAL_PCT = 100;

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Tier 3: order × price vs the material's Rupiah budget envelope.
 * Deplete-at-order: committed already reflects placed orders; this adds the
 * prospective order. actualUnitPrice (if the admin entered one) overrides the
 * benchmark for THIS order. No benchmark and no override => blocking, never a pass.
 */
export function evaluateTier3Budget(
  budget: MaterialBudgetStatus | null,
  requestedQty: number,
  actualUnitPrice?: number,
): GateResult {
  if (!budget) {
    return { flag: 'WARNING', check: 'tier3_no_budget', msg: 'No budget envelope — material not in AHS price book. Cannot evaluate Tier 3 spend.' };
  }

  const effectivePrice = actualUnitPrice ?? budget.benchmark_unit_price ?? null;
  if (effectivePrice === null) {
    return { flag: 'WARNING', check: 'tier3_no_benchmark', msg: `No benchmark price for ${budget.material_name}. Cannot evaluate Tier 3 budget — enter an actual price or set the AHS price.` };
  }
  if (!budget.budget_total_rupiah || budget.budget_total_rupiah <= 0) {
    return { flag: 'WARNING', check: 'tier3_no_budget', msg: `No budget total for ${budget.material_name} (planned quantity is 0). Cannot evaluate Tier 3 spend.` };
  }

  const thisOrder = requestedQty * effectivePrice;
  const newCommitted = budget.committed_rupiah + thisOrder;
  const newBurn = (newCommitted / budget.budget_total_rupiah) * 100;
  const detail = `${rp(newCommitted)} / ${rp(budget.budget_total_rupiah)} (${newBurn.toFixed(0)}%)`;

  if (newBurn > BUDGET_CRITICAL_PCT + 20) {
    return { flag: 'CRITICAL', check: 'tier3_budget_exceeded', msg: `Order of ${rp(thisOrder)} pushes ${budget.material_name} to ${detail} — exceeds budget by ${(newBurn - 100).toFixed(0)}%. Requires principal override.` };
  }
  if (newBurn > BUDGET_CRITICAL_PCT) {
    return { flag: 'HIGH', check: 'tier3_budget_over', msg: `Order pushes ${budget.material_name} to ${detail} — over budget.` };
  }
  if (newBurn > BUDGET_WARNING_PCT) {
    return { flag: 'WARNING', check: 'tier3_budget_warning', msg: `${budget.material_name} budget at ${detail} after this order — approaching limit.` };
  }
  if (newBurn > 50) {
    return { flag: 'INFO', check: 'tier3_budget_info', msg: `${budget.material_name}: ${detail} of budget used.` };
  }
  return { flag: 'OK', check: 'tier3_budget_ok', msg: `${budget.material_name}: ${detail} of budget.` };
}

/** Tier 4: consumables — never gated, always passes. */
export function evaluateTier4Untracked(): GateResult {
  return { flag: 'OK', check: 'tier4_untracked', msg: 'Tier 4 consumable — not budget-tracked.' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tools/__tests__/budgetGate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add tools/types.ts tools/budgetGate.ts tools/__tests__/budgetGate.test.ts
git commit -m "feat(gate): pure Tier-3 budget + Tier-4 untracked evaluators"
```

---

### Task 3: Wire the budget gate into the dispatcher

**Files:**
- Modify: `tools/envelopes.ts`

**Interfaces:**
- Consumes: `evaluateTier3Budget`, `evaluateTier4Untracked` from `tools/budgetGate.ts`; `MaterialBudgetStatus` from `tools/types.ts`.
- Produces: `getMaterialBudget(projectId: string, materialId: string): Promise<MaterialBudgetStatus | null>`; `checkTier3Budget(projectId: string, materialId: string | null, requestedQty: number, actualUnitPrice?: number): Promise<GateResult>`; `checkMaterialRequest` now accepts `materialTier: 1 | 2 | 3 | 4`.

- [ ] **Step 1: Add imports near the top of `tools/envelopes.ts`**

```typescript
import type { MaterialBudgetStatus } from './types';
import { evaluateTier3Budget, evaluateTier4Untracked } from './budgetGate';
```

- [ ] **Step 2: Add the budget fetch + check, mirroring `getMaterialEnvelope`**

Add after `getMaterialEnvelope`:

```typescript
/**
 * Tier-3 Rupiah budget status for a material (reads v_material_budget_status
 * via RPC, mirroring getMaterialEnvelope).
 */
export async function getMaterialBudget(
  projectId: string,
  materialId: string,
): Promise<MaterialBudgetStatus | null> {
  const { data, error } = await supabase
    .rpc('get_material_budget', { p_project_id: projectId, p_material_id: materialId })
    .single();
  if (error || !data) return null;
  const r = data as Omit<MaterialBudgetStatus, 'project_id'>;
  return { ...r, project_id: projectId } as MaterialBudgetStatus;
}

/**
 * Gate 1 check for Tier-3 materials: order × price vs Rupiah budget envelope.
 * actualUnitPrice overrides the benchmark for this order when the admin enters one.
 */
export async function checkTier3Budget(
  projectId: string,
  materialId: string | null,
  requestedQty: number,
  actualUnitPrice?: number,
): Promise<GateResult> {
  if (!materialId) {
    return { flag: 'WARNING', check: 'tier3_no_material', msg: 'Tier 3 check requires material_id for budget lookup' };
  }
  const budget = await getMaterialBudget(projectId, materialId);
  return evaluateTier3Budget(budget, requestedQty, actualUnitPrice);
}
```

- [ ] **Step 3: Widen the dispatcher and route Tiers 3 & 4**

In `checkMaterialRequest`, change the signature `materialTier: 1 | 2 | 3` to `materialTier: 1 | 2 | 3 | 4`, and replace the `case 3:` branch and add `case 4:`:

```typescript
    case 3:
      return checkTier3Budget(projectId, materialId, requestedQty, unitPrice);
    case 4:
      return evaluateTier4Untracked();
```

- [ ] **Step 4: Delete the old spend cap**

Remove the entire `checkTier3SpendCap` function and its `TIER3_PER_REQUEST_CAP` constant (now dead). Update the dispatcher JSDoc line `Tier 3 → spend cap check` to `Tier 3 → Rupiah budget envelope; Tier 4 → untracked`.

- [ ] **Step 5: Verify the whole suite still compiles and passes**

Run: `npx jest tools/__tests__/envelopes.batch.test.ts tools/__tests__/budgetGate.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — expected: no errors from `envelopes.ts` (if callers in `workflows/gates/` or `tools/__tests__/serverGateEnforcement.test.ts` pass a `materialTier` typed `1|2|3`, widen those local types to `1|2|3|4` too).

- [ ] **Step 6: Commit**

```bash
git add tools/envelopes.ts workflows/gates tools/__tests__/serverGateEnforcement.test.ts
git commit -m "feat(gate): route Tier 3 to budget envelope, add Tier 4, drop flat cap"
```

---

### Task 4: Control-aware material balance derivation

**Files:**
- Modify: `tools/derivation.ts`
- Modify: `tools/reports.ts`
- Test: `tools/__tests__/materialBalanceControl.test.ts`

**Interfaces:**
- Consumes: `MaterialBalance` (existing), `MaterialBudgetStatus`, `FlagLevel`.
- Produces: `MaterialBalanceRow` interface; `buildMaterialBalanceRows(balances: MaterialBalance[], budgets: MaterialBudgetStatus[]): MaterialBalanceRow[]`; `deriveMaterialBalanceWithControl(projectId: string): Promise<MaterialBalanceRow[]>`.

- [ ] **Step 1: Add types + the pure merge to `tools/derivation.ts`**

Add near the `MaterialBalance` interface:

```typescript
export interface MaterialBalanceRow extends MaterialBalance {
  tier: 1 | 2 | 3 | 4 | null;
  control: 'QTY' | 'RP' | 'NONE';
  benchmark_unit_price: number | null;
  budget_total_rupiah: number | null;
  committed_rupiah: number | null;
  burn_pct: number | null;     // burn on the CONTROL dimension
  flag: FlagLevel;
}

const QTY_WARN = 80, QTY_OVER = 100, RP_WARN = 80, RP_OVER = 100, RP_CRIT = 120;

/**
 * Merge quantity balances with Rupiah budgets into one row per material.
 * control = QTY for tier 1/2, RP for tier 3, NONE for tier 4 / unpriced.
 * flag/burn are driven by the control dimension.
 */
export function buildMaterialBalanceRows(
  balances: MaterialBalance[],
  budgets: MaterialBudgetStatus[],
): MaterialBalanceRow[] {
  const byId = new Map(budgets.filter(b => b.material_id).map(b => [b.material_id, b]));
  return balances.map((b) => {
    const bud = b.material_id ? byId.get(b.material_id) ?? null : null;
    const tier = (bud?.tier ?? null) as MaterialBalanceRow['tier'];
    const control: MaterialBalanceRow['control'] =
      tier === 3 ? 'RP' : tier === 4 ? 'NONE' : tier === 1 || tier === 2 ? 'QTY' : 'QTY';

    let burn: number | null = null;
    let flag: FlagLevel = 'OK';
    if (control === 'RP' && bud?.budget_total_rupiah) {
      burn = bud.burn_pct;
      flag = (burn ?? 0) > RP_CRIT ? 'CRITICAL' : (burn ?? 0) > RP_OVER ? 'HIGH' : (burn ?? 0) > RP_WARN ? 'WARNING' : 'OK';
    } else if (control === 'QTY' && b.planned > 0) {
      burn = Math.round((b.received / b.planned) * 1000) / 10;
      flag = burn > QTY_OVER ? 'HIGH' : burn > QTY_WARN ? 'WARNING' : 'OK';
    } else if (control === 'NONE') {
      burn = null; flag = 'OK';
    }

    return {
      ...b,
      tier,
      control,
      benchmark_unit_price: bud?.benchmark_unit_price ?? null,
      budget_total_rupiah: bud?.budget_total_rupiah ?? null,
      committed_rupiah: bud?.committed_rupiah ?? null,
      burn_pct: burn,
      flag,
    };
  });
}
```

Ensure `FlagLevel` is imported in `derivation.ts` (add to the existing `./types` import if absent).

- [ ] **Step 2: Write the failing test `tools/__tests__/materialBalanceControl.test.ts`**

```typescript
import { buildMaterialBalanceRows } from '../derivation';
import type { MaterialBalance } from '../derivation';
import type { MaterialBudgetStatus } from '../types';

const bal = (m: Partial<MaterialBalance>): MaterialBalance => ({
  material_name: 'X', material_id: 'm1', planned: 100, received: 10, installed: 0, on_site: 10, unit: 'kg', ...m,
});
const bud = (m: Partial<MaterialBudgetStatus>): MaterialBudgetStatus => ({
  material_id: 'm1', project_id: 'p1', material_name: 'X', tier: 3, unit: 'kg',
  benchmark_unit_price: 1000, total_planned: 100, budget_total_rupiah: 100_000,
  committed_rupiah: 0, remaining_rupiah: 100_000, burn_pct: 0, boq_item_count: 1, ...m,
});

describe('buildMaterialBalanceRows', () => {
  it('tier 3 → RP control, flag from Rupiah burn', () => {
    const [row] = buildMaterialBalanceRows([bal({})], [bud({ burn_pct: 105, budget_total_rupiah: 100_000 })]);
    expect(row.control).toBe('RP');
    expect(row.flag).toBe('HIGH');
    expect(row.budget_total_rupiah).toBe(100_000);
  });

  it('tier 1/2 → QTY control, flag from received/planned', () => {
    const [row] = buildMaterialBalanceRows([bal({ received: 96 })], [bud({ tier: 2 })]);
    expect(row.control).toBe('QTY');
    expect(row.burn_pct).toBe(96);
    expect(row.flag).toBe('WARNING');
  });

  it('tier 4 → NONE control, never flagged', () => {
    const [row] = buildMaterialBalanceRows([bal({ received: 9999 })], [bud({ tier: 4 })]);
    expect(row.control).toBe('NONE');
    expect(row.flag).toBe('OK');
    expect(row.burn_pct).toBeNull();
  });

  it('no budget row → QTY control by default', () => {
    const [row] = buildMaterialBalanceRows([bal({})], []);
    expect(row.control).toBe('QTY');
    expect(row.budget_total_rupiah).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tools/__tests__/materialBalanceControl.test.ts`
Expected: FAIL — `buildMaterialBalanceRows is not a function` (if Step 1 not yet saved) or assertion mismatch.

- [ ] **Step 4: Run test to verify it passes**

After Step 1 is in place, run: `npx jest tools/__tests__/materialBalanceControl.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the fetch wrapper to `tools/derivation.ts`**

```typescript
export async function deriveMaterialBalanceWithControl(projectId: string): Promise<MaterialBalanceRow[]> {
  const [balances, { data: budgetRows }] = await Promise.all([
    deriveMaterialBalance(projectId),
    supabase.from('v_material_budget_status').select('*').eq('project_id', projectId),
  ]);
  return buildMaterialBalanceRows(balances, (budgetRows ?? []) as MaterialBudgetStatus[]);
}
```

- [ ] **Step 6: Wire `generateMaterialBalanceReport` in `tools/reports.ts`**

Replace its `const balances = await deriveMaterialBalance(projectId);` with `const balances = await deriveMaterialBalanceWithControl(projectId);` and update the import on line 7 to include `deriveMaterialBalanceWithControl`. The existing `summary` counts (`over_received`, `under_received`) still read `b.received`/`b.planned`, which `MaterialBalanceRow` still carries — no change needed there. Add to `summary`: `over_budget: balances.filter(b => b.control === 'RP' && (b.burn_pct ?? 0) > 100).length`.

- [ ] **Step 7: Run the report-related suite**

Run: `npx jest tools/__tests__/materialBalanceControl.test.ts && npx tsc --noEmit`
Expected: tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add tools/derivation.ts tools/reports.ts tools/__tests__/materialBalanceControl.test.ts
git commit -m "feat(reports): control-aware material balance (qty + Rupiah budget)"
```

---

### Task 5: AHS price book ingestion

**Files:**
- Create: `tools/priceBookIngest.ts`
- Test: `tools/__tests__/priceBookIngest.test.ts`

**Interfaces:**
- Produces: `PriceBookRecord = { material_name: string; unit: string; unit_price: number; tier: 1|2|3|4 }`; `mapPriceBookRows(rows: Record<string, unknown>[]): { records: PriceBookRecord[]; unresolved: { row: number; reason: string }[] }`; `ingestPriceBook(projectId: string, records: PriceBookRecord[]): Promise<number>`.

- [ ] **Step 1: Write the failing test `tools/__tests__/priceBookIngest.test.ts`**

```typescript
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
import { mapPriceBookRows } from '../priceBookIngest';

describe('mapPriceBookRows', () => {
  it('maps clean rows', () => {
    const { records, unresolved } = mapPriceBookRows([
      { material: 'Besi D8', unit: 'kg', unit_price: 9000, tier: 1 },
      { material: 'Cat tembok', unit: 'ltr', unit_price: 85000, tier: 3 },
    ]);
    expect(unresolved).toHaveLength(0);
    expect(records[0]).toEqual({ material_name: 'Besi D8', unit: 'kg', unit_price: 9000, tier: 1 });
  });

  it('routes rows with no price to unresolved, never guesses', () => {
    const { records, unresolved } = mapPriceBookRows([{ material: 'Pasir', unit: 'm3', tier: 2 }]);
    expect(records).toHaveLength(0);
    expect(unresolved[0].reason).toMatch(/price/i);
  });

  it('routes rows with an out-of-range tier to unresolved', () => {
    const { unresolved } = mapPriceBookRows([{ material: 'Lakban', unit: 'roll', unit_price: 15000, tier: 9 }]);
    expect(unresolved[0].reason).toMatch(/tier/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/priceBookIngest.test.ts`
Expected: FAIL — `Cannot find module '../priceBookIngest'`.

- [ ] **Step 3: Implement `tools/priceBookIngest.ts`**

```typescript
// SANO — AHS price book ingestion. The price book is the price + tier authority.
// Format is fixed: columns material | unit | unit_price | tier. Rows missing a
// price or carrying an invalid tier go to `unresolved` — never guessed (CLAUDE.md §1.1).
import { supabase } from './supabase';

export interface PriceBookRecord {
  material_name: string;
  unit: string;
  unit_price: number;
  tier: 1 | 2 | 3 | 4;
}

export function mapPriceBookRows(
  rows: Record<string, unknown>[],
): { records: PriceBookRecord[]; unresolved: { row: number; reason: string }[] } {
  const records: PriceBookRecord[] = [];
  const unresolved: { row: number; reason: string }[] = [];

  rows.forEach((raw, i) => {
    const name = String(raw.material ?? '').trim();
    const unit = String(raw.unit ?? '').trim();
    const price = Number(raw.unit_price);
    const tier = Number(raw.tier);

    if (!name) { unresolved.push({ row: i, reason: 'missing material name' }); return; }
    if (!Number.isFinite(price) || price <= 0) { unresolved.push({ row: i, reason: `missing/invalid price for "${name}"` }); return; }
    if (![1, 2, 3, 4].includes(tier)) { unresolved.push({ row: i, reason: `tier out of range (1-4) for "${name}"` }); return; }

    records.push({ material_name: name, unit, unit_price: price, tier: tier as 1 | 2 | 3 | 4 });
  });

  return { records, unresolved };
}

/**
 * Upsert price-book records for a project. material_id resolution against
 * material_catalog (fuzzy) is intentionally left to the catalog-link step that
 * already exists for AHS lines — here we persist by name + project; material_id
 * is backfilled by that linker. Returns count inserted.
 */
export async function ingestPriceBook(projectId: string, records: PriceBookRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const { error } = await supabase
    .from('ahs_price_book')
    .insert(records.map(r => ({ project_id: projectId, ...r })));
  if (error) throw error;
  return records.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/priceBookIngest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/priceBookIngest.ts tools/__tests__/priceBookIngest.test.ts
git commit -m "feat(parser): AHS price book ingestion with unresolved routing"
```

---

### Task 6: Material balance report UI — unified table

**Files:**
- Modify: the material-balance report renderer (locate the component that renders the `material_balance` `ReportPayload`; grep `material_balance` under `workflows/screens/`).

**Interfaces:**
- Consumes: `MaterialBalanceRow[]` now present on the `material_balance` report payload rows (`tier`, `control`, `benchmark_unit_price`, `budget_total_rupiah`, `committed_rupiah`, `burn_pct`, `flag`).

- [ ] **Step 1: Locate the renderer**

Run: `grep -rn "material_balance" workflows/screens`
Open the component that maps the report rows into the table.

- [ ] **Step 2: Add the columns**

Render one row per material with columns: `material | tier | control | qty plan/ord/recv | Rp budget/committed | burn% | flag`. For `control === 'QTY'` rows leave the Rupiah cells as `—`; for `control === 'RP'` rows leave the per-unit qty ordered visible but budget cells populated; for `control === 'NONE'` (tier 4) render `—` across burn/flag. Drive the `burn%`/`flag` cell off `row.burn_pct` / `row.flag` (already control-correct from Task 4). Match the existing report table styling in the file — do not introduce a new table component.

- [ ] **Step 3: Verify in the running app**

Run the app (`npm run` dev target for Expo web per project conventions), open a project's Material Balance report, confirm: a Tier-3 material shows Rupiah budget/committed and a Rupiah-based burn; a Tier-1/2 material shows quantity burn; a Tier-4 material shows `—`. Screenshot for the review.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens
git commit -m "feat(ui): unified material balance table (qty + Rupiah control)"
```

---

## Self-Review

**Spec coverage:**
- §2 tier model → Tasks 2, 3 (Tier 3 budget, Tier 4 untracked, old cap deleted). ✓
- §3 parser input (price book) → Task 5; simplified BoQ explicitly deferred (Scope). ✓
- §4 schema (price book, tier widen, actual_unit_price, RLS) → Task 1. ✓
- §5 budget view, Approach A → Task 1 (view), Task 3 (consumes via RPC). ✓
- §6 gates → Tasks 2, 3, incl. blocking-on-no-benchmark (`tier3_no_benchmark`/`tier3_no_budget`). ✓
- §7 unified report → Tasks 4 (data), 6 (UI). ✓
- §8 out of scope → not built (no vendor price list, no re-baselining). ✓
- §9 open items: (1) simplified BoQ layout → deferred; (2) allocation grain → resolved to `material_request_lines` (the grain `v_material_envelope_status` already sums), `actual_unit_price` added there; (3) constraint name → discovered by shape in Task 1. ✓

**Placeholder scan:** No TBD/TODO in tasks. The simplified-BoQ deferral is a scoped exclusion, not an in-task placeholder. ✓

**Type consistency:** `MaterialBudgetStatus` fields are identical across Task 1 (view columns), Task 2 (interface + evaluators), Task 3 (RPC consumer), Task 4 (report merge). `evaluateTier3Budget` / `evaluateTier4Untracked` signatures match between definition (Task 2) and call sites (Task 3). `buildMaterialBalanceRows` / `deriveMaterialBalanceWithControl` consistent between Task 4 definition and Task 6 consumer. Tier union `1|2|3|4` widened consistently in types, dispatcher, and report. ✓
