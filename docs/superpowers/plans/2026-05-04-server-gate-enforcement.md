# Server-Side Gate 1 Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Supabase server the source of truth for `material_request_lines.line_flag` and `material_request_headers.overall_flag`, closing direct-API and old-app-version bypass paths for Gate 1.

**Architecture:** A single migration adds three PostgreSQL triggers — two on `material_request_lines` (BEFORE INSERT/UPDATE for line flag, AFTER INSERT/UPDATE/DELETE for header aggregation) and one on `material_request_line_allocations` (AFTER INSERT/UPDATE/DELETE for Tier 1 recomputation once allocations land). Four helper functions (`compute_tier1_flag`, `compute_tier2_flag`, `compute_tier3_flag`, `dispatch_line_flag`) mirror the client-side `gate1.ts` logic. CRITICAL/HIGH flags auto-promote `overall_status` to `AUTO_HOLD` only when status is `PENDING` or `AUTO_HOLD`; manual reviewer decisions (`APPROVED`, `REJECTED`, `UNDER_REVIEW`) are preserved.

**Tech Stack:** PostgreSQL 15 (PL/pgSQL), Supabase, Jest with ts-jest, `@supabase/supabase-js` service-role client. No app code changes.

**Spec:** [docs/superpowers/specs/2026-05-04-server-gate-enforcement-design.md](../specs/2026-05-04-server-gate-enforcement-design.md)

**Branch:** `feat/server-gate-enforcement` (already created from `origin/main`)

---

## File Structure

**Create:**
- `supabase/migrations/033_server_gate_enforcement.sql` — all functions + triggers in one idempotent migration (~200 LOC)
- `tools/__tests__/serverGateEnforcement.test.ts` — integration tests against a real Supabase project (~280 LOC)
- `tools/__tests__/_serverGateHarness.ts` — fixture builders shared across tests (~150 LOC)

**No changes to:**
- `workflows/gates/gate1.ts` (kept verbatim for client-side UI feedback)
- `workflows/screens/PermintaanScreen.tsx`
- `office/screens/ApprovalsScreen.tsx`
- `tools/envelopes.ts`

**Single migration, edited across tasks:** Tasks 2-6 each extend the same `033_server_gate_enforcement.sql` file. The migration uses `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS … CREATE TRIGGER` patterns so it is fully idempotent and can be re-applied to the local DB after each edit.

**Re-apply pattern between tasks** (run on local DB after editing the migration):
```bash
psql "$DATABASE_URL" -f supabase/migrations/033_server_gate_enforcement.sql
```

Or via Supabase CLI if linked: `npx supabase db push --include-all`.

---

## Prerequisites (one-time setup)

- [ ] **P1: Verify `.env` has `SUPABASE_SERVICE_KEY`**

Run: `grep -c '^SUPABASE_SERVICE_KEY=' .env`
Expected: `1` (one line).

If missing, ask the user to provide it (read-only on the wrong project would corrupt other people's data — confirm test target).

- [ ] **P2: Confirm test target Supabase project**

Read `EXPO_PUBLIC_SUPABASE_URL` from `.env`. **STOP and confirm with user** that this is the correct test target project before running any test that writes data. Tests insert and delete real rows; running against production is destructive.

- [ ] **P3: Apply migrations 001-032 to test project (skip if already applied)**

Confirm by querying:
```bash
psql "$DATABASE_URL" -c "SELECT MAX(version) FROM ahs_versions;" 2>/dev/null
```
Expected: command succeeds (table exists). If not, apply existing migrations first via Supabase CLI or dashboard.

---

## Task 1: Integration test harness scaffolding

**Files:**
- Create: `tools/__tests__/_serverGateHarness.ts`
- Create: `tools/__tests__/serverGateEnforcement.test.ts`

This task sets up the integration test infrastructure. No production code yet. The harness loads `.env`, builds a service-role Supabase client, and exposes fixture builders. The test file gets a single smoke test to verify the harness works end-to-end before we write any real assertions.

- [ ] **Step 1: Write the test harness file**

Create `tools/__tests__/_serverGateHarness.ts` with the full content below.

Schema notes (verified from migrations 001-032):
- `projects`: requires `code` (NOT NULL UNIQUE), `name`, `status` (default `'ACTIVE'`).
- `profiles.id` references `auth.users(id)` — must use `supabase.auth.admin.createUser` so the `handle_new_user` trigger (migration 027) populates `profiles`. The trigger reads `raw_user_meta_data->>'role'` (default `'supervisor'`).
- `boq_items`: requires `code`, `label` (NOT `title`), `unit`, optional `planned`, `installed`.
- `material_catalog`: requires `name`, `tier`, `unit`. `code` and `supplier_unit` optional (defaults `''`).
- `ahs_versions`: `id`, `project_id`, `version`, `published_at`. After migration 032 also has `is_current` and `import_session_id`. There is NO `ahs` or `ahs_blocks` table — `ahs_lines.ahs_version_id` and `ahs_lines.boq_item_id` link directly.
- `ahs_lines` (NOT NULL): `ahs_version_id`, `boq_item_id`, `tier`, `usage_rate`, `unit`. Optional `material_id`, `unit_price`, `coefficient`, `line_type`.
- `project_material_master_lines`: powers `v_material_envelopes` view. Required: `master_id`, `boq_item_id`, `unit`. Optional `material_id`, `planned_quantity` (default 0).

```typescript
/**
 * Integration test harness for server-side Gate 1 enforcement.
 * Loads .env, builds a service-role Supabase client, exposes fixture builders.
 *
 * IMPORTANT: This client BYPASSES RLS. Run only against test/staging projects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '../../.env'));

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY for integration tests. ' +
    'Add both to .env before running serverGateEnforcement tests.',
  );
}

export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PREFIX = '__SGE_TEST__';

/** Generates a uniquely-prefixed name so cleanup can find all rows we created. */
export function testName(label: string): string {
  return `${TEST_PREFIX}${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface TestProject {
  id: string;
  name: string;
  ownerProfileId: string;
}

/**
 * Creates a project + an auth user (the trigger from migration 027 populates
 * the profiles row automatically). Returns the project id and profile id.
 */
export async function createTestProject(): Promise<TestProject> {
  // Auth user → profile (via handle_new_user trigger in migration 027).
  const email = `${testName('user').toLowerCase()}@example.test`;
  const { data: authResult, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password: `Test_${Math.random().toString(36).slice(2)}_!1`,
    email_confirm: true,
    user_metadata: { full_name: testName('owner'), role: 'principal' },
  });
  if (authErr || !authResult.user) throw authErr ?? new Error('auth user create failed');
  const ownerProfileId = authResult.user.id;

  const projectName = testName('project');
  const { data: project, error: projErr } = await adminClient
    .from('projects')
    .insert({ code: testName('PRJ'), name: projectName, status: 'ACTIVE' })
    .select('id')
    .single();
  if (projErr || !project) throw projErr ?? new Error('project insert failed');

  return { id: project.id, name: projectName, ownerProfileId };
}

export interface TestBoqItem {
  id: string;
  projectId: string;
  planned: number;
  installed: number;
}

/** Creates a BoQ item with given planned + installed quantities. */
export async function createTestBoqItem(
  projectId: string,
  opts: { planned: number; installed: number; unit?: string },
): Promise<TestBoqItem> {
  const { data, error } = await adminClient
    .from('boq_items')
    .insert({
      project_id: projectId,
      code: testName('boq'),
      label: testName('boq-label'),
      unit: opts.unit ?? 'kg',
      planned: opts.planned,
      installed: opts.installed,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('boq item insert failed');
  return { id: data.id, projectId, planned: opts.planned, installed: opts.installed };
}

export interface TestMaterial {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  unit: string;
}

/** Creates a material_catalog row. */
export async function createTestMaterial(opts: {
  tier: 1 | 2 | 3;
  unit?: string;
}): Promise<TestMaterial> {
  const name = testName('mat');
  const { data, error } = await adminClient
    .from('material_catalog')
    .insert({
      code: testName('mc'),
      name,
      tier: opts.tier,
      unit: opts.unit ?? 'kg',
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('material insert failed');
  return { id: data.id, name, tier: opts.tier, unit: opts.unit ?? 'kg' };
}

/**
 * Publishes an AHS version with one ahs_line per provided material so the
 * Tier 3 spend-cap check has a unit_price to median over. ahs_lines link
 * directly to ahs_version_id and boq_item_id — no intermediate tables.
 *
 * The provided boqItemId becomes the link for every ahs_line.
 */
export async function publishTestAhsVersion(opts: {
  projectId: string;
  boqItemId: string;
  prices: Array<{ materialId: string; unitPrice: number; tier: 1 | 2 | 3; unit?: string }>;
}): Promise<{ ahsVersionId: string }> {
  // Demote any existing current version (matches publishBaselineV2 pattern).
  await adminClient
    .from('ahs_versions')
    .update({ is_current: false })
    .eq('project_id', opts.projectId)
    .eq('is_current', true);

  const { data: version, error: vErr } = await adminClient
    .from('ahs_versions')
    .insert({
      project_id: opts.projectId,
      version: 1,
      is_current: true,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (vErr || !version) throw vErr ?? new Error('ahs_versions insert failed');

  for (const { materialId, unitPrice, tier, unit } of opts.prices) {
    const { error: lineErr } = await adminClient.from('ahs_lines').insert({
      ahs_version_id: version.id,
      boq_item_id: opts.boqItemId,
      material_id: materialId,
      tier,
      usage_rate: 1,
      unit: unit ?? 'kg',
      unit_price: unitPrice,
      coefficient: 1,
      line_type: 'material',
    });
    if (lineErr) throw lineErr;
  }

  return { ahsVersionId: version.id };
}

/**
 * Builds a Tier 2 envelope using project_material_master_lines (the actual
 * source the v_material_envelopes view aggregates from). Creates a master
 * row tied to a fresh ahs_version, then a master_line that contributes
 * `totalPlanned` to the envelope for `materialId`.
 *
 * Returns ids for cleanup; tests don't normally need them.
 */
export async function buildTier2Envelope(opts: {
  projectId: string;
  materialId: string;
  boqItemId: string;
  totalPlanned: number;
  unit?: string;
}): Promise<{ masterId: string; ahsVersionId: string }> {
  const { ahsVersionId } = await publishTestAhsVersion({
    projectId: opts.projectId,
    boqItemId: opts.boqItemId,
    prices: [{ materialId: opts.materialId, unitPrice: 100, tier: 2, unit: opts.unit }],
  });

  const { data: master, error: mErr } = await adminClient
    .from('project_material_master')
    .insert({ project_id: opts.projectId, ahs_version_id: ahsVersionId })
    .select('id')
    .single();
  if (mErr || !master) throw mErr ?? new Error('master insert failed');

  const { error: lErr } = await adminClient.from('project_material_master_lines').insert({
    master_id: master.id,
    material_id: opts.materialId,
    boq_item_id: opts.boqItemId,
    planned_quantity: opts.totalPlanned,
    unit: opts.unit ?? 'kg',
  });
  if (lErr) throw lErr;

  return { masterId: master.id, ahsVersionId };
}

/**
 * Inserts a request header + lines + allocations in the order the app uses.
 * Returns the header id so tests can assert on stored values.
 */
export async function submitRequest(opts: {
  projectId: string;
  requesterProfileId: string;
  primaryBoqItemId: string;
  lines: Array<{
    tier: 1 | 2 | 3;
    materialId: string | null;
    customName?: string;
    quantity: number;
    unit: string;
    clientFlag?: string;
    allocations: Array<{
      boqItemId: string | null;
      allocatedQuantity: number;
      basis: 'DIRECT' | 'TIER2_ENVELOPE' | 'GENERAL_STOCK';
    }>;
  }>;
  clientOverallFlag?: string;
}): Promise<{ headerId: string; lineIds: string[] }> {
  const { data: header, error: hErr } = await adminClient
    .from('material_request_headers')
    .insert({
      project_id: opts.projectId,
      boq_item_id: opts.primaryBoqItemId,
      requested_by: opts.requesterProfileId,
      target_date: new Date().toISOString().slice(0, 10),
      urgency: 'NORMAL',
      overall_flag: opts.clientOverallFlag ?? 'OK',
    })
    .select('id')
    .single();
  if (hErr || !header) throw hErr ?? new Error('header insert failed');

  const lineIds: string[] = [];
  for (const line of opts.lines) {
    const { data: createdLine, error: lErr } = await adminClient
      .from('material_request_lines')
      .insert({
        request_header_id: header.id,
        material_id: line.materialId,
        custom_material_name: line.customName ?? null,
        tier: line.tier,
        quantity: line.quantity,
        unit: line.unit,
        line_flag: line.clientFlag ?? 'OK',
      })
      .select('id')
      .single();
    if (lErr || !createdLine) throw lErr ?? new Error('line insert failed');
    lineIds.push(createdLine.id);

    if (line.allocations.length > 0) {
      const rows = line.allocations.map(a => ({
        request_line_id: createdLine.id,
        boq_item_id: a.boqItemId,
        allocated_quantity: a.allocatedQuantity,
        proportion_pct: 100,
        allocation_basis: a.basis,
      }));
      const { error: aErr } = await adminClient
        .from('material_request_line_allocations')
        .insert(rows);
      if (aErr) throw aErr;
    }
  }

  return { headerId: header.id, lineIds };
}

/** Reads stored line_flag, overall_flag, overall_status for assertions. */
export async function readState(headerId: string, lineId?: string): Promise<{
  overallFlag: string;
  overallStatus: string;
  lineFlag: string | null;
}> {
  const { data: h, error: hErr } = await adminClient
    .from('material_request_headers')
    .select('overall_flag, overall_status')
    .eq('id', headerId)
    .single();
  if (hErr || !h) throw hErr ?? new Error('header read failed');

  let lineFlag: string | null = null;
  if (lineId) {
    const { data: l, error: lErr } = await adminClient
      .from('material_request_lines')
      .select('line_flag')
      .eq('id', lineId)
      .single();
    if (lErr || !l) throw lErr ?? new Error('line read failed');
    lineFlag = l.line_flag as string;
  }

  return { overallFlag: h.overall_flag as string, overallStatus: h.overall_status as string, lineFlag };
}

/**
 * Deletes every row created with TEST_PREFIX. Call from afterAll.
 * CASCADE on FKs handles allocations + lines + headers via project CASCADE.
 *
 * Auth users must be deleted via the admin API; deleting them cascades to
 * profiles via the FK on profiles.id.
 */
export async function cleanupTestData(): Promise<void> {
  await adminClient.from('projects').delete().like('name', `${TEST_PREFIX}%`);
  await adminClient.from('material_catalog').delete().like('name', `${TEST_PREFIX}%`);

  const { data: users } = await adminClient.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith(TEST_PREFIX.toLowerCase()) || u.user_metadata?.full_name?.startsWith?.(TEST_PREFIX)) {
      await adminClient.auth.admin.deleteUser(u.id);
    }
  }
}
```

- [ ] **Step 2: Write the smoke test**

Create `tools/__tests__/serverGateEnforcement.test.ts` with this initial smoke test only.

```typescript
import {
  adminClient,
  cleanupTestData,
  createTestProject,
} from './_serverGateHarness';

describe('server gate enforcement — harness smoke', () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  it('connects to Supabase with service role and creates a project', async () => {
    const project = await createTestProject();
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);

    const { data, error } = await adminClient
      .from('projects')
      .select('id, name')
      .eq('id', project.id)
      .single();
    expect(error).toBeNull();
    expect(data?.name).toBe(project.name);
  });
});
```

- [ ] **Step 3: Run the smoke test**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "harness smoke" -v`
Expected: PASS. If it fails with auth errors, check `SUPABASE_SERVICE_KEY` value. If it fails with FK violation on `profiles.id`, the test project may have a unique constraint we missed — read the error and adjust the harness accordingly.

- [ ] **Step 4: Commit**

```bash
git add tools/__tests__/_serverGateHarness.ts tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
test(server-gate): add integration test harness for Gate 1 enforcement

Service-role Supabase client + fixture builders + cleanup hook. Smoke
test verifies harness end-to-end before we add gate-specific cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration scaffold + Tier 2 enforcement

**Files:**
- Create: `supabase/migrations/033_server_gate_enforcement.sql`
- Modify: `tools/__tests__/serverGateEnforcement.test.ts` (append Tier 2 tests)

This task lays down the migration skeleton and implements Tier 2 (envelope burn) enforcement plus the header-aggregation trigger. Tier 1 and Tier 3 dispatch branches are stubbed to return `'OK'` for now — they'll be filled in in Tasks 3-4.

- [ ] **Step 1: Write the failing Tier 2 tests**

First, update the imports at the top of `tools/__tests__/serverGateEnforcement.test.ts` to include all the helpers the new tests need:

```typescript
import {
  adminClient,
  cleanupTestData,
  createTestProject,
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  submitRequest,
  readState,
} from './_serverGateHarness';
```

Then append the Tier 2 describe block at the end of the file:

```typescript
describe('server gate enforcement — Tier 2', () => {
  it('client lies about flag → server overwrites with CRITICAL when over envelope', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    // Submit a Tier 2 request for 200 kg → 200% burn → CRITICAL (>120%).
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      clientOverallFlag: 'OK', // client lies
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        clientFlag: 'OK', // client lies
        allocations: [{
          boqItemId: boqItem.id,
          allocatedQuantity: 200,
          basis: 'TIER2_ENVELOPE',
        }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 2 within envelope → OK flag, status stays PENDING', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30, // 30% burn → OK (≤50%)
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 2" -v`
Expected: FAIL — both tests will report stored flag is `'OK'` (the value the client sent), not `'CRITICAL'` or computed value. This is the bypass the migration will close.

- [ ] **Step 3: Create the migration with Tier 2 logic**

Create `supabase/migrations/033_server_gate_enforcement.sql`:

```sql
-- 033_server_gate_enforcement.sql
--
-- Server-side Gate 1 enforcement. Three triggers ensure
-- material_request_lines.line_flag and material_request_headers.overall_flag
-- are always server-computed, regardless of what the client sends.
--
-- See: docs/superpowers/specs/2026-05-04-server-gate-enforcement-design.md
--
-- Tier 1 / Tier 3 dispatch branches are stubbed in this migration; later
-- migrations or edits to this file fill them in.

-- =========================================================================
-- Helper functions: tier-specific flag computers
-- =========================================================================

-- Tier 2: envelope burn check. Mirrors gate1.ts:66-100.
CREATE OR REPLACE FUNCTION compute_tier2_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_planned NUMERIC;
  v_total_ordered NUMERIC;
  v_burn_pct NUMERIC;
BEGIN
  IF p_material_id IS NULL THEN
    RETURN 'OK';
  END IF;

  SELECT total_planned, total_ordered
    INTO v_total_planned, v_total_ordered
  FROM v_material_envelope_status
  WHERE project_id = p_project_id AND material_id = p_material_id;

  -- No envelope built yet (no boq link via ahs).
  IF v_total_planned IS NULL OR v_total_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  v_burn_pct := ((COALESCE(v_total_ordered, 0) + p_requested_qty) / v_total_planned) * 100;

  IF v_burn_pct > 120 THEN RETURN 'CRITICAL'; END IF;
  IF v_burn_pct > 100 THEN RETURN 'HIGH'; END IF;
  IF v_burn_pct > 80  THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50  THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;

-- Tier 1 / Tier 3 stubs — filled in by later tasks in this plan.
CREATE OR REPLACE FUNCTION compute_tier1_flag(
  p_boq_item_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Stub: real implementation in Task 4.
  RETURN 'OK';
END $$;

CREATE OR REPLACE FUNCTION compute_tier3_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Stub: real implementation in Task 3.
  RETURN 'OK';
END $$;

-- =========================================================================
-- Dispatcher: routes a line to the correct tier function.
-- =========================================================================
CREATE OR REPLACE FUNCTION dispatch_line_flag(
  line_row material_request_lines
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id UUID;
BEGIN
  -- Look up parent header's project_id.
  SELECT project_id INTO v_project_id
  FROM material_request_headers
  WHERE id = line_row.request_header_id;

  IF line_row.tier = 2 THEN
    RETURN compute_tier2_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 3 THEN
    RETURN compute_tier3_flag(line_row.material_id, v_project_id, line_row.quantity);
  ELSIF line_row.tier = 1 THEN
    -- Tier 1 dispatch filled in in Task 4.
    RETURN 'WARNING';
  END IF;
  RETURN 'OK';
END;
$$;

-- =========================================================================
-- Trigger 1: BEFORE INSERT/UPDATE on material_request_lines
-- Overwrites NEW.line_flag with server-computed value.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_line_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.line_flag := dispatch_line_flag(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_request_lines_set_flag_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_set_flag_trg
  BEFORE INSERT OR UPDATE OF tier, quantity, material_id
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag();

-- =========================================================================
-- Trigger 2: AFTER INSERT/UPDATE/DELETE on material_request_lines
-- Re-aggregates header.overall_flag and auto-promotes overall_status.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_header_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_header_id UUID;
  v_worst_flag TEXT;
  v_current_status TEXT;
  v_should_promote BOOLEAN;
BEGIN
  v_header_id := COALESCE(NEW.request_header_id, OLD.request_header_id);

  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE line_flag = 'CRITICAL') > 0 THEN 'CRITICAL'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'HIGH')     > 0 THEN 'HIGH'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'WARNING')  > 0 THEN 'WARNING'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'INFO')     > 0 THEN 'INFO'
      ELSE 'OK'
    END INTO v_worst_flag
  FROM material_request_lines
  WHERE request_header_id = v_header_id;

  SELECT overall_status INTO v_current_status
  FROM material_request_headers
  WHERE id = v_header_id;

  -- Header may already be deleted (cascade from project) — nothing to update.
  IF v_current_status IS NULL THEN
    RETURN NULL;
  END IF;

  v_should_promote :=
    v_worst_flag IN ('CRITICAL', 'HIGH')
    AND v_current_status IN ('PENDING', 'AUTO_HOLD');

  UPDATE material_request_headers
  SET
    overall_flag = v_worst_flag,
    overall_status = CASE
      WHEN v_should_promote THEN 'AUTO_HOLD'
      ELSE overall_status
    END
  WHERE id = v_header_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS material_request_lines_aggregate_header_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_aggregate_header_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_header_flag();

-- Trigger 3 added in Task 4.
```

- [ ] **Step 4: Apply migration to test DB**

Run: `psql "$DATABASE_URL" -f supabase/migrations/033_server_gate_enforcement.sql`
Expected: `CREATE FUNCTION` × 6, `CREATE TRIGGER` × 2, no errors.

If `psql` not configured, use Supabase dashboard SQL editor: paste the migration, run, check for errors. The same `CREATE OR REPLACE` semantics apply.

- [ ] **Step 5: Run Tier 2 tests to verify they pass**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 2" -v`
Expected: both tests PASS. Server overwrites `'OK'` with `'CRITICAL'` for the over-envelope case; status auto-promotes to `'AUTO_HOLD'`. Within-envelope case keeps `'OK'` and `'PENDING'`.

If the over-envelope test reports `'OK'` instead of `'CRITICAL'`, run this SQL to confirm `v_material_envelope_status` returns a row for the test material+project:

```sql
SELECT * FROM v_material_envelope_status
WHERE project_id = '<test-project-uuid>' AND material_id = '<test-material-uuid>';
```

If no row, the `project_material_master_lines` insert in `buildTier2Envelope` likely didn't link to the right project. Check that `project_material_master.project_id` matches. If the row exists but `total_planned` is 0, the `planned_quantity` was 0 — fix the test fixture.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/033_server_gate_enforcement.sql tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
feat(gate1): server-side enforcement skeleton + Tier 2 envelope

Adds migration with compute_tier2_flag, dispatch_line_flag (Tier 1/3
stubbed), and triggers 1+2 on material_request_lines. CRITICAL/HIGH
auto-promote overall_status to AUTO_HOLD when status is PENDING.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Tier 3 spend cap enforcement

**Files:**
- Modify: `supabase/migrations/033_server_gate_enforcement.sql` (replace `compute_tier3_flag` body)
- Modify: `tools/__tests__/serverGateEnforcement.test.ts` (append Tier 3 tests)

Tier 3 logic mirrors `tools/envelopes.ts:308-334` — uses median of `ahs_lines.unit_price` for the material from the current AHS version, multiplied by requested quantity, against a Rp 5 jt cap.

- [ ] **Step 1: Write failing Tier 3 tests**

First, extend the imports at the top of `tools/__tests__/serverGateEnforcement.test.ts` to include `publishTestAhsVersion`:

```typescript
import {
  adminClient,
  cleanupTestData,
  createTestProject,
  createTestBoqItem,
  createTestMaterial,
  buildTier2Envelope,
  publishTestAhsVersion,
  submitRequest,
  readState,
} from './_serverGateHarness';
```

Then append the Tier 3 describe block:

```typescript
describe('server gate enforcement — Tier 3', () => {
  it('Tier 3 spend > Rp 5jt → WARNING, no auto-hold', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    // Unit price 1000 × qty 6000 = 6,000,000 → over Rp 5jt cap.
    await publishTestAhsVersion({
      projectId: project.id,
      boqItemId: boqItem.id,
      prices: [{ materialId: material.id, unitPrice: 1000, tier: 3, unit: 'pcs' }],
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 6000,
        unit: 'pcs',
        clientFlag: 'OK',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 6000, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING');
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // Tier 3 WARNING does NOT auto-hold
  });

  it('Tier 3 spend ≤ Rp 5jt → OK', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 3, unit: 'pcs' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await publishTestAhsVersion({
      projectId: project.id,
      boqItemId: boqItem.id,
      prices: [{ materialId: material.id, unitPrice: 1000, tier: 3, unit: 'pcs' }],
    });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 3,
        materialId: material.id,
        quantity: 1000, // 1000 × 1000 = 1jt → under cap
        unit: 'pcs',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 1000, basis: 'GENERAL_STOCK' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 3" -v`
Expected: the over-cap test FAILs (`compute_tier3_flag` is stubbed to `'OK'`); the under-cap test passes by accident. Both will pass after Step 3.

- [ ] **Step 3: Replace compute_tier3_flag stub with real logic**

Edit `supabase/migrations/033_server_gate_enforcement.sql`. Replace the existing `compute_tier3_flag` body:

```sql
CREATE OR REPLACE FUNCTION compute_tier3_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_unit_price NUMERIC;
  v_estimated_spend NUMERIC;
  TIER3_CAP CONSTANT NUMERIC := 5000000;  -- Rp 5 juta
BEGIN
  IF p_material_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'OK';
  END IF;

  -- Median unit_price across ahs_lines for this material in the current
  -- AHS version. Mirrors summarizeAhsBaselinePrices in tools/gate2.ts.
  -- ahs_lines links directly to ahs_versions (no ahs / ahs_blocks tables).
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY al.unit_price)
    INTO v_unit_price
  FROM ahs_lines al
  JOIN ahs_versions av ON av.id = al.ahs_version_id
  WHERE al.material_id = p_material_id
    AND av.project_id = p_project_id
    AND av.is_current = true
    AND al.unit_price IS NOT NULL
    AND al.unit_price > 0;

  IF v_unit_price IS NULL THEN
    RETURN 'OK';  -- no price reference → can't enforce cap
  END IF;

  v_estimated_spend := p_requested_qty * v_unit_price;
  IF v_estimated_spend > TIER3_CAP THEN
    RETURN 'WARNING';
  END IF;
  RETURN 'OK';
END;
$$;
```

- [ ] **Step 4: Re-apply migration**

Run: `psql "$DATABASE_URL" -f supabase/migrations/033_server_gate_enforcement.sql`
Expected: `CREATE FUNCTION` × 6 (idempotent re-runs of all functions), `CREATE TRIGGER` × 2.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 3" -v`
Expected: both Tier 3 tests PASS. Run the whole file to confirm no regressions: `npx jest tools/__tests__/serverGateEnforcement.test.ts -v` — all Tier 2 + Tier 3 + smoke tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/033_server_gate_enforcement.sql tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
feat(gate1): Tier 3 spend cap server-side enforcement

compute_tier3_flag uses median ahs_lines.unit_price (mirrors
summarizeAhsBaselinePrices) × quantity against Rp 5jt cap. WARNING
on overrun; status stays PENDING (no auto-hold for Tier 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Tier 1 BoQ direct check + allocation trigger

**Files:**
- Modify: `supabase/migrations/033_server_gate_enforcement.sql` (replace `compute_tier1_flag` body, extend `dispatch_line_flag` Tier 1 branch, add Trigger 3)
- Modify: `tools/__tests__/serverGateEnforcement.test.ts` (append Tier 1 tests)

Tier 1 is the most complex case because the BoQ context is in the `material_request_line_allocations` table, not on the line itself. This task adds Trigger 3 (on allocations) which fires after the app inserts allocation rows and recomputes the parent line's flag.

- [ ] **Step 1: Write failing Tier 1 tests**

Append to `tools/__tests__/serverGateEnforcement.test.ts`:

```typescript
describe('server gate enforcement — Tier 1', () => {
  it('Tier 1 within BoQ remaining → OK after allocation insert', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });
    // remaining = 900. Request 200 → 200/900 = 0.22 → < 0.5 → OK.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'DIRECT' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });

  it('Tier 1 over BoQ by 35% → CRITICAL + AUTO_HOLD after allocation insert', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });
    // remaining = 900. Request 1215 → 1215/900 = 1.35 → > 1.3 → CRITICAL.

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 1215,
        unit: 'kg',
        clientFlag: 'OK', // client lies
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 1215, basis: 'DIRECT' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 1 line WITHOUT allocation insert → flag stays at WARNING placeholder', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

    // Submit a line but skip allocations.
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        allocations: [], // intentionally none
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('WARNING');
    expect(state.overallFlag).toBe('WARNING');
    expect(state.overallStatus).toBe('PENDING'); // WARNING does NOT auto-hold
  });

  it('Tier 1 placeholder→real flag transition: insert line then over-budget allocation', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

    // Step 1: insert header + line WITHOUT allocations.
    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 1215, // would be CRITICAL once allocation fixes the boq link
        unit: 'kg',
        allocations: [],
      }],
    });
    const beforeAlloc = await readState(headerId, lineIds[0]);
    expect(beforeAlloc.lineFlag).toBe('WARNING'); // placeholder
    expect(beforeAlloc.overallFlag).toBe('WARNING');
    expect(beforeAlloc.overallStatus).toBe('PENDING');

    // Step 2: insert DIRECT allocation pointing at over-budget BoQ.
    const { error } = await adminClient.from('material_request_line_allocations').insert({
      request_line_id: lineIds[0],
      boq_item_id: boqItem.id,
      allocated_quantity: 1215,
      proportion_pct: 100,
      allocation_basis: 'DIRECT',
    });
    expect(error).toBeNull();

    const afterAlloc = await readState(headerId, lineIds[0]);
    expect(afterAlloc.lineFlag).toBe('CRITICAL'); // recomputed by Trigger 3
    expect(afterAlloc.overallFlag).toBe('CRITICAL');
    expect(afterAlloc.overallStatus).toBe('AUTO_HOLD');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 1" -v`
Expected: most tests FAIL. The placeholder test may pass by coincidence because Tier 1 dispatch returns `'WARNING'`. The over-budget tests FAIL because there's no real Tier 1 logic and no allocation trigger.

- [ ] **Step 3: Replace compute_tier1_flag stub and add Trigger 3**

Edit `supabase/migrations/033_server_gate_enforcement.sql`. Replace `compute_tier1_flag` body and the Tier 1 branch in `dispatch_line_flag`, then append Trigger 3.

Replace `compute_tier1_flag`:

```sql
CREATE OR REPLACE FUNCTION compute_tier1_flag(
  p_boq_item_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_planned NUMERIC;
  v_installed NUMERIC;
  v_already_ordered NUMERIC;
  v_remaining NUMERIC;
  v_ratio NUMERIC;
BEGIN
  IF p_boq_item_id IS NULL THEN
    RETURN 'WARNING';
  END IF;

  SELECT planned, installed INTO v_planned, v_installed
  FROM boq_items
  WHERE id = p_boq_item_id;

  IF v_planned IS NULL THEN
    RETURN 'WARNING';
  END IF;

  -- Already-ordered = approved/pending DIRECT allocations against this BoQ.
  SELECT COALESCE(SUM(a.allocated_quantity), 0)
    INTO v_already_ordered
  FROM material_request_line_allocations a
  JOIN material_request_lines l    ON l.id = a.request_line_id
  JOIN material_request_headers h  ON h.id = l.request_header_id
  WHERE a.boq_item_id = p_boq_item_id
    AND a.allocation_basis = 'DIRECT'
    AND h.overall_status NOT IN ('REJECTED');

  v_remaining := v_planned - COALESCE(v_installed, 0) - v_already_ordered;

  -- Guard against div-by-zero / negative remaining.
  IF v_remaining <= 0 THEN
    -- All remaining used up; any new request is over-budget.
    RETURN 'CRITICAL';
  END IF;

  v_ratio := p_requested_qty / v_remaining;
  IF v_ratio > 1.3  THEN RETURN 'CRITICAL'; END IF;
  IF v_ratio > 1.15 THEN RETURN 'HIGH';     END IF;
  IF v_ratio > 1.05 THEN RETURN 'WARNING';  END IF;
  IF v_ratio > 0.5  THEN RETURN 'INFO';     END IF;
  RETURN 'OK';
END;
$$;
```

Replace the Tier 1 branch in `dispatch_line_flag`. Find the existing `IF line_row.tier = 1 THEN` block and replace it with:

```sql
  ELSIF line_row.tier = 1 THEN
    DECLARE
      v_alloc_boq UUID;
      v_alloc_qty NUMERIC;
    BEGIN
      SELECT boq_item_id, allocated_quantity
        INTO v_alloc_boq, v_alloc_qty
      FROM material_request_line_allocations
      WHERE request_line_id = line_row.id
        AND allocation_basis = 'DIRECT'
      ORDER BY id
      LIMIT 1;

      IF v_alloc_boq IS NULL THEN
        RETURN 'WARNING';  -- placeholder until allocation arrives
      END IF;

      RETURN compute_tier1_flag(v_alloc_boq, v_alloc_qty);
    END;
```

Append at end of migration:

```sql
-- =========================================================================
-- Trigger 3: AFTER INSERT/UPDATE/DELETE on material_request_line_allocations
-- Recomputes parent line's flag (Tier 1 needs the allocation to know
-- which BoQ to check against). UPDATE on line then fires Trigger 2.
-- =========================================================================
CREATE OR REPLACE FUNCTION recompute_line_flag_from_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line_id UUID;
  v_line material_request_lines%ROWTYPE;
  v_new_flag TEXT;
BEGIN
  v_line_id := COALESCE(NEW.request_line_id, OLD.request_line_id);

  SELECT * INTO v_line FROM material_request_lines WHERE id = v_line_id;
  IF v_line.id IS NULL THEN
    -- Line already deleted (cascade) — nothing to do.
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_flag := dispatch_line_flag(v_line);
  IF v_line.line_flag IS DISTINCT FROM v_new_flag THEN
    UPDATE material_request_lines
    SET line_flag = v_new_flag
    WHERE id = v_line.id;
    -- That UPDATE fires Trigger 2 (header re-aggregate). It does NOT fire
    -- Trigger 1 because line_flag is excluded from Trigger 1's column filter.
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS material_request_line_allocations_recompute_line_trg
  ON material_request_line_allocations;
CREATE TRIGGER material_request_line_allocations_recompute_line_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_line_allocations
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag_from_allocation();
```

- [ ] **Step 4: Re-apply migration**

Run: `psql "$DATABASE_URL" -f supabase/migrations/033_server_gate_enforcement.sql`
Expected: 7 `CREATE FUNCTION` + 3 `CREATE TRIGGER`, no errors.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "Tier 1" -v`
Expected: all four Tier 1 tests PASS. Then run all tests to confirm no regressions: `npx jest tools/__tests__/serverGateEnforcement.test.ts -v`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/033_server_gate_enforcement.sql tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
feat(gate1): Tier 1 BoQ check + allocation trigger

compute_tier1_flag mirrors gate1.ts BoQ-direct logic. dispatch_line_flag
reads the line's first DIRECT allocation. Trigger 3 fires on allocation
INSERT/UPDATE/DELETE and recomputes the parent line, cascading via
Trigger 2 to the header. Tier 1 lines without allocations get a
'WARNING' placeholder until allocations arrive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Reviewer status preservation

**Files:**
- Modify: `tools/__tests__/serverGateEnforcement.test.ts` (append status preservation tests)

`recompute_header_flag` already implements the `v_should_promote` guard from Task 2. This task verifies the behavior with explicit tests against the database. No migration changes — the logic is already there; we're closing the loop by proving it works.

- [ ] **Step 1: Write the failing/passing status preservation tests**

Append to `tools/__tests__/serverGateEnforcement.test.ts`:

```typescript
describe('server gate enforcement — reviewer status preservation', () => {
  it('header in APPROVED status survives line UPDATE (flag updates, status stays)', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30, // OK initially
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    // Reviewer manually approves.
    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'APPROVED' })
      .eq('id', headerId);

    // Estimator updates the line quantity to over-envelope.
    await adminClient
      .from('material_request_lines')
      .update({ quantity: 200 })
      .eq('id', lineIds[0]);

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL'); // flag updates to current truth
    expect(state.overallFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('APPROVED'); // reviewer decision preserved
  });

  it('header in REJECTED status survives line UPDATE', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    await adminClient
      .from('material_request_headers')
      .update({ overall_status: 'REJECTED' })
      .eq('id', headerId);

    await adminClient
      .from('material_request_lines')
      .update({ quantity: 200 })
      .eq('id', lineIds[0]);

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('CRITICAL');
    expect(state.overallStatus).toBe('REJECTED');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -t "reviewer status preservation" -v`
Expected: both tests PASS (logic was already in place from Task 2).

If they FAIL, the `v_should_promote` guard in `recompute_header_flag` may have a bug. Check the SQL — `v_should_promote` should be `false` when `v_current_status` is `'APPROVED'` or `'REJECTED'`. Fix the migration, re-apply, re-run tests.

- [ ] **Step 3: Commit**

```bash
git add tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
test(gate1): verify reviewer status (APPROVED/REJECTED) survives line edits

Confirms recompute_header_flag's v_should_promote guard. Flag still
updates to current truth, but overall_status is preserved when reviewer
already made a decision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Updates, deletes, null-handling edge cases

**Files:**
- Modify: `tools/__tests__/serverGateEnforcement.test.ts` (append edge-case tests)
- Possibly modify: `supabase/migrations/033_server_gate_enforcement.sql` (only if a test reveals a real bug)

This task closes out the remaining test cases from the spec. Most should pass without migration changes; if any fail, the failure points to a real bug.

- [ ] **Step 1: Write the edge-case tests**

Append to `tools/__tests__/serverGateEnforcement.test.ts`:

```typescript
describe('server gate enforcement — edge cases', () => {
  it('UPDATE line quantity recomputes flag and re-aggregates header', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 30, // OK
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 30, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    expect((await readState(headerId, lineIds[0])).lineFlag).toBe('OK');

    // Estimator edits line up to over-envelope.
    await adminClient.from('material_request_lines').update({ quantity: 200 }).eq('id', lineIds[0]);

    const after = await readState(headerId, lineIds[0]);
    expect(after.lineFlag).toBe('CRITICAL');
    expect(after.overallStatus).toBe('AUTO_HOLD');
  });

  it('DELETE allocation regresses Tier 1 line to WARNING placeholder', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 1, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 1000, installed: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 1,
        materialId: material.id,
        quantity: 200,
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'DIRECT' }],
      }],
    });

    expect((await readState(headerId, lineIds[0])).lineFlag).toBe('OK');

    // Delete the only allocation.
    const { error } = await adminClient
      .from('material_request_line_allocations')
      .delete()
      .eq('request_line_id', lineIds[0]);
    expect(error).toBeNull();

    const after = await readState(headerId, lineIds[0]);
    expect(after.lineFlag).toBe('WARNING');
    expect(after.overallFlag).toBe('WARNING');
  });

  it('DELETE last line aggregates header flag to OK', async () => {
    const project = await createTestProject();
    const material = await createTestMaterial({ tier: 2, unit: 'kg' });
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });
    await buildTier2Envelope({ projectId: project.id, materialId: material.id, boqItemId: boqItem.id, totalPlanned: 100 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: material.id,
        quantity: 200, // CRITICAL
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 200, basis: 'TIER2_ENVELOPE' }],
      }],
    });
    expect((await readState(headerId)).overallFlag).toBe('CRITICAL');

    await adminClient.from('material_request_lines').delete().eq('id', lineIds[0]);

    const after = await readState(headerId);
    expect(after.overallFlag).toBe('OK'); // no lines = no risk
    // Note: status was AUTO_HOLD, stays AUTO_HOLD per "preserve previous state" rule.
    expect(after.overallStatus).toBe('AUTO_HOLD');
  });

  it('Tier 2 with material_id=null → flag = OK (graceful degradation)', async () => {
    const project = await createTestProject();
    const boqItem = await createTestBoqItem(project.id, { planned: 100, installed: 0 });

    const { headerId, lineIds } = await submitRequest({
      projectId: project.id,
      requesterProfileId: project.ownerProfileId,
      primaryBoqItemId: boqItem.id,
      lines: [{
        tier: 2,
        materialId: null,
        customName: 'custom-tier2',
        quantity: 9999, // would be CRITICAL if we had material context
        unit: 'kg',
        allocations: [{ boqItemId: boqItem.id, allocatedQuantity: 9999, basis: 'TIER2_ENVELOPE' }],
      }],
    });

    const state = await readState(headerId, lineIds[0]);
    expect(state.lineFlag).toBe('OK');
    expect(state.overallStatus).toBe('PENDING');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -v`
Expected: every test PASSES (14 cases total — 1 smoke + 2 Tier 2 + 2 Tier 3 + 4 Tier 1 + 2 status preservation + 4 edge cases. Note: spec lists 14 ✓ items — `harness smoke` is the 15th, intentional.).

If any test fails, the failure indicates a real bug in the migration. Diagnose and fix in the SQL file. Re-apply migration. Re-run tests.

- [ ] **Step 3: Commit**

```bash
git add tools/__tests__/serverGateEnforcement.test.ts
git commit -m "$(cat <<'EOF'
test(gate1): edge cases — UPDATE/DELETE line, DELETE allocation, null material

Closes the spec's edge-case checklist: estimator edits, allocation
revisions, last-line removal, custom (material_id=null) Tier 2 lines.
Status preservation across DELETE confirmed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Smoke test against staging + deployment notes

**Files:**
- Modify: `supabase/migrations/033_server_gate_enforcement.sql` (add header comment with deployment notes)

Verify the migration on the live test/staging Supabase project, document the deployment, and prepare for the merge-to-main step.

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: ALL tests across the project PASS, no regressions in `boqParserV2`, `envelopes.batch`, `materialMatch`, `defectLifecycle`, etc.

If any non-Gate-1 test fails, investigate — your migration shouldn't have side effects on other tests, but if a shared fixture leaked, fix it.

- [ ] **Step 2: Manual smoke test via curl**

Pick a test project with a known BoQ item, then submit a known-CRITICAL request directly via the REST API with `line_flag: 'OK'` (the bypass we're closing).

```bash
# Get values from your test project. Replace placeholders.
TEST_PROJECT_ID="<uuid>"
TEST_BOQ_ITEM_ID="<uuid-with-known-low-remaining>"
TEST_PROFILE_ID="<uuid>"
TEST_MATERIAL_ID="<uuid-tier-1>"

# 1. Insert header
HEADER_ID=$(curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/material_request_headers" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"project_id\":\"$TEST_PROJECT_ID\",\"boq_item_id\":\"$TEST_BOQ_ITEM_ID\",\"requested_by\":\"$TEST_PROFILE_ID\",\"target_date\":\"2026-12-31\",\"urgency\":\"NORMAL\",\"overall_flag\":\"OK\"}" \
  | jq -r '.[0].id')
echo "Header: $HEADER_ID"

# 2. Insert over-budget Tier 1 line claiming flag='OK'
LINE_ID=$(curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/material_request_lines" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"request_header_id\":\"$HEADER_ID\",\"material_id\":\"$TEST_MATERIAL_ID\",\"tier\":1,\"quantity\":99999,\"unit\":\"kg\",\"line_flag\":\"OK\"}" \
  | jq -r '.[0].id')
echo "Line: $LINE_ID"

# 3. Insert DIRECT allocation
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/material_request_line_allocations" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"request_line_id\":\"$LINE_ID\",\"boq_item_id\":\"$TEST_BOQ_ITEM_ID\",\"allocated_quantity\":99999,\"proportion_pct\":100,\"allocation_basis\":\"DIRECT\"}" > /dev/null

# 4. Read what server stored
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/material_request_headers?id=eq.$HEADER_ID&select=overall_flag,overall_status" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

Expected output: `[{"overall_flag":"CRITICAL","overall_status":"AUTO_HOLD"}]`. This proves the bypass is closed even when the client lies via direct REST.

Cleanup:
```bash
curl -s -X DELETE "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/material_request_headers?id=eq.$HEADER_ID" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

- [ ] **Step 3: Add deployment header comment to migration**

Edit the top of `supabase/migrations/033_server_gate_enforcement.sql`. Replace the existing leading comment with:

```sql
-- 033_server_gate_enforcement.sql
--
-- Server-side Gate 1 enforcement. Three triggers guarantee that
-- material_request_lines.line_flag and material_request_headers.overall_flag
-- are always server-truth, regardless of what clients send. Bypasses
-- closed: direct REST inserts, old-app versions, logic divergence between
-- builds.
--
-- Hybrid promotion: CRITICAL/HIGH flag auto-promotes overall_status to
-- AUTO_HOLD ONLY when status ∈ {PENDING, AUTO_HOLD}. Reviewer decisions
-- (APPROVED, REJECTED, UNDER_REVIEW) are sticky.
--
-- Deployment:
--   1. Apply this migration to production via Supabase SQL editor (matches
--      the PR #5 deployment pattern). Migration is idempotent — safe to
--      re-apply.
--   2. No app rebuild required. App writes/reads continue unchanged; the
--      stored values are now server-computed.
--   3. Verification post-apply: the integration test suite at
--      tools/__tests__/serverGateEnforcement.test.ts must pass against
--      the deployment target. A manual curl-based smoke (see plan task 7)
--      is also recommended.
--
-- Spec: docs/superpowers/specs/2026-05-04-server-gate-enforcement-design.md
-- Plan: docs/superpowers/plans/2026-05-04-server-gate-enforcement.md
--
-- Stay in sync with workflows/gates/gate1.ts (Tier 1/2 thresholds) and
-- tools/envelopes.ts (Tier 3 cap). Future rule changes update both.
```

- [ ] **Step 4: Re-apply migration to confirm idempotence**

Run: `psql "$DATABASE_URL" -f supabase/migrations/033_server_gate_enforcement.sql`
Expected: zero errors. All `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS … CREATE TRIGGER` work cleanly on a second apply.

- [ ] **Step 5: Run full test suite once more**

Run: `npx jest tools/__tests__/serverGateEnforcement.test.ts -v`
Expected: every test still passes after the comment-only migration update.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/033_server_gate_enforcement.sql
git commit -m "$(cat <<'EOF'
docs(gate1): add deployment notes header to migration 033

Documents idempotence guarantee, Supabase dashboard apply pattern,
and the gate1.ts/envelopes.ts sync requirement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Hand off to finishing-a-development-branch**

After all tasks complete and all tests pass, invoke `superpowers:finishing-a-development-branch` to merge or open a PR. Branch is already `feat/server-gate-enforcement`. Base branch is `main`.
