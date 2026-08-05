# Permintaan BoQ-First Flow + Mode Besi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `PermintaanScreen` a three-tile landing whose two new paths — group-first BoQ requests and a bulk rebar matrix — expand client-side into the existing header + lines + allocations model and submit through the untouched `submit_material_request` RPC.

**Architecture:** Both new flows are **input-UX layers over the existing write path**. New pure modules (`tools/workGroupDemand.ts`, `tools/rebarMatrix.ts`) turn one new read-only RPC's result into demand rows / a rebar matrix; the screen stays a thin renderer that materializes standard `RequestLine` objects into the *same* `lines` state the current form uses. From there `linesWithResults`, `computeWorkGroupGate1Flag`, `buildWorkGroupAllocations`, the overage-reason capture and `buildSubmitMaterialRequestPayload` run byte-for-byte unchanged. The only backend addition is one `SECURITY INVOKER`, read-only RPC that generalizes `get_workgroup_envelope` from one material to all materials in a work group.

**Tech Stack:** TypeScript (strict), React Native / Expo 54, Supabase (Postgres, migrations pasted via the Dashboard SQL editor), Jest 29 + ts-jest, `@testing-library/react-native`.

## Global Constraints

- **Truth-correctness (CLAUDE.md §1.1 / §12):** never emit a confident-looking wrong number. No baseline → say so ("tanpa baseline" / "Tidak ada alokasi pembanding"), never a fabricated split or a silent OK.
- **Zero changes to the write path:** `submit_material_request` (073), `compute_tier*_flag` (069/073), the 033 triggers, RLS, `office/screens/ApprovalsScreen.tsx`, `Gate2Screen`, `TerimaScreen`, and `tools/submitMaterialRequest.ts` are NOT edited by any task in this plan.
- **`request_basis` stays `'MATERIAL'`; header `boq_item_id` stays NULL.** Group identity travels per line as `work_group_label` + `WORKGROUP_ENVELOPE` allocations, exactly as today.
- **Request-time gates stay soft** (WARNING-capped). The only submit blocker remains a missing overage reason on a line projected over 100%, plus the pre-existing per-line validity toasts.
- **Units:** every envelope/gate/allocation number is BASE units (kg for rebar). Supplier units (batang) exist only at the input/display boundary, converted via `tools/materialUnitConversion.ts` (`supplierToBase`, `baseToSupplierOrder`, `displayQty`) and nowhere else.
- **User-facing copy is Bahasa Indonesia**, matching existing strings in `PermintaanScreen.tsx`.
- **No hardcoded colours / sizes / spacing.** Use `COLORS`, `FONTS`, `TYPE`, `SPACE`, `RADIUS`, `RADIUS_SM` from `workflows/theme.ts`.
- **Migrations are idempotent and Dashboard-pasteable** (remote migration history diverged; `supabase db push` is broken in this project). Next free number is **086**.
- **Work groups stay client-derived** (`tools/boqWorkGroups.ts` `buildWorkGroups`) — no DB entity, no persistence beyond `work_group_label`.
- **Rebar identity comes from `material_catalog.code LIKE 'REB-%'` only** — never from a hardcoded diameter list in the screen.
- **Commit message format:** `type(scope): summary`, blank line, then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Design authority:** `docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md`. Read it before Task 6.

## Dependency graph (for parallel execution)

```
Task 1 (rebar catalog reconcile) ── independent
Task 2 (migration 086) ─> Task 3 (client wrapper) ─┬─> Task 7 (Path 1 UI)
                                                    └─> Task 8 (Mode Besi UI)
Task 4 (workGroupDemand.ts) ───────────────────────────> Task 7
Task 5 (rebarMatrix.ts) ───────────────────────────────> Task 8
Task 6 (landing + SelectSheet + Path 3 banner) ─> Task 7 ─> Task 8 ─> Task 9
```

Independent starting points that may run as parallel subagents: **Task 1**, **Task 2**, **Task 4**, **Task 5**, **Task 6**. Task 3 needs 2. Task 7 needs 3 + 4 + 6. Task 8 needs 3 + 5 + 7. Task 9 needs everything.

## Design notes the implementer must know

1. **Both new paths write into the existing `lines` state.** They do NOT introduce a parallel submit. A demand row with a quantity becomes a `RequestLine` built from `makeLine({ ...applyCatalogMaterialToLine(material), id, workGroupKey, quantity })`. Line ids are **deterministic** (`demand:<groupKey>:<materialId>`, `besi:<materialId>:<groupKey>`) so re-deriving lines does not churn React keys or drop in-flight input.
2. **Tier-1 line with no group baseline.** `handleSubmit` already refuses a Tier-1 line whose `allocationPreview` is empty (`PermintaanScreen.tsx` — "belum punya baseline material — tidak bisa dialokasikan"). The spec wants such a material to be *fillable* and to show the natural INFO flag. Both hold; Task 7 additionally renders the blocking condition **inline** so it is never a surprise at submit time. The write path and the guard itself stay untouched.
3. **Baseline for "sisa".** `sisa = max(0, planned − ordered − requested)` in base units. It is floored at zero — an over-ordered group has no remaining need, never a negative one.
4. **Ordered vs requested at group grain.** `get_workgroup_envelope` (039/041) lumps every non-rejected allocation into `total_ordered`. The new RPC splits that same sum into `ordered` (allocations whose request line is linked to a non-CANCELLED PO — the "fulfilled line" definition from 069's header as amended by 073 Part B) and `requested` (the rest). `ordered + requested` therefore equals the old `total_ordered` exactly — that identity is the verification query in Task 2.

---

### Task 1: Reconcile `tools/rebarBatang.ts` with the material catalogue

The strict-50 catalogue rebuild (`docs/superpowers/specs/2026-07-14-material-catalogue-strict50-rebuild.md` §3/§5) kept **10** rebar rows and deleted every code outside the curated 50 — `REB-PL10` and `REB-PL12` among them. `tools/rebarBatang.ts` still maps 12 codes. Mode Besi builds its diameter list from `material_catalog` only, so this drift would silently promise two bars that no longer exist. Catalogue is the authority; the TS map follows it, and a new test locks the two together.

**Files:**
- Modify: `tools/rebarBatang.ts:34-48` (`DIAMETER_BY_CODE`), `tools/rebarBatang.ts:74-79` (doc comment on `REBAR_CATALOG_FACTORS`)
- Test: `tools/__tests__/rebarBatang.test.ts` (existing file — update + extend)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `REBAR_CATALOG_FACTORS: Array<{ code: string; kgPerBatang: number }>` now holding exactly the 10 catalogue codes; `rebarFactorByCode('REB-PL10')` returns `null`. Task 5 relies on the catalogue (not this map) for the diameter list, so nothing downstream changes shape.

- [ ] **Step 1: Update the existing test to the catalogue's 10 rows (this makes it fail)**

Replace the whole `it('exposes exactly the 12 rebar catalog rows', …)` block in `tools/__tests__/rebarBatang.test.ts` (lines 40-48) with:

```ts
  it('exposes exactly the 10 rebar catalog rows', () => {
    expect(REBAR_CATALOG_FACTORS).toHaveLength(10);
    expect(REBAR_CATALOG_FACTORS.map((f) => f.code).sort()).toEqual([
      'REB-DE10', 'REB-DE13', 'REB-DE16', 'REB-DE19', 'REB-DE22',
      'REB-DE25', 'REB-DE29', 'REB-DE32', 'REB-PL06', 'REB-PL08',
    ]);
    expect(rebarFactorByCode('REB-DE29')).toBe(62.22); // ulir 29 mm — SNI 0.006165·29²·12
    // Deleted by the strict-50 catalogue rebuild — resolving them by code would
    // promise a bar the catalogue no longer carries.
    expect(rebarFactorByCode('REB-PL10')).toBeNull();
    expect(rebarFactorByCode('REB-PL12')).toBeNull();
  });
```

- [ ] **Step 2: Add the drift guard that reads the catalogue CSV**

Append these two blocks to `tools/__tests__/rebarBatang.test.ts` — the imports go at the very top of the file (above the existing `import { … } from '../rebarBatang';`), the `describe` goes at the end of the file:

```ts
import fs from 'node:fs';
import path from 'node:path';
```

```ts
describe('rebarBatang ↔ material catalogue', () => {
  // Guards the drift this task fixed: material_master.csv is the catalogue's
  // source of truth (strict-50 rebuild), tools/rebarBatang.ts must mirror it
  // exactly or Mode Besi's diameter list and the kg↔batang factors diverge.
  const CSV = fs.readFileSync(
    path.join(__dirname, '../../assets/mock/material_master.csv'),
    'utf8',
  );

  function catalogRebarRows(): Array<{ code: string; kgPerBatang: number }> {
    return CSV.split(/\r?\n/)
      .slice(1) // header row
      .map((line) => line.split(','))
      .filter((cells) => (cells[0] ?? '').startsWith('REB-'))
      .map((cells) => ({ code: cells[0], kgPerBatang: Number(cells[6]) }));
  }

  it('REBAR_CATALOG_FACTORS matches every REB- row in material_master.csv', () => {
    const byCode = (rows: Array<{ code: string; kgPerBatang: number }>) =>
      Object.fromEntries(rows.map((r) => [r.code, r.kgPerBatang]));
    expect(byCode(REBAR_CATALOG_FACTORS)).toEqual(byCode(catalogRebarRows()));
  });

  it('every catalogue rebar row carries a kg-per-batang factor', () => {
    for (const row of catalogRebarRows()) {
      expect(Number.isFinite(row.kgPerBatang)).toBe(true);
      expect(row.kgPerBatang).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tools/__tests__/rebarBatang.test.ts`
Expected: FAIL — `exposes exactly the 10 rebar catalog rows` reports `Expected length: 10, Received length: 12`, and the drift guard reports the two extra keys `REB-PL10` / `REB-PL12`.

- [ ] **Step 4: Drop the two deleted codes from the map**

In `tools/rebarBatang.ts`, replace the `DIAMETER_BY_CODE` block (lines 34-48) with:

```ts
/**
 * Catalog code → diameter for the 10 rebar rows in material_master.csv
 * (kg-estimated, batang-ordered). This map MUST mirror the catalogue: the
 * strict-50 rebuild deleted REB-PL10 / REB-PL12, so they are absent here too.
 * `tools/__tests__/rebarBatang.test.ts` fails if the two ever drift apart.
 */
const DIAMETER_BY_CODE: Record<string, number> = {
  'REB-PL06': 6,
  'REB-PL08': 8,
  'REB-DE10': 10,
  'REB-DE13': 13,
  'REB-DE16': 16,
  'REB-DE19': 19,
  'REB-DE22': 22,
  'REB-DE25': 25,
  'REB-DE29': 29,
  'REB-DE32': 32,
};
```

Then replace the comment above `REBAR_CATALOG_FACTORS` (line 74) so the count is honest:

```ts
/** The 10 (code, factor) pairs — the single source the data tasks seed from. */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/rebarBatang.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 6: Confirm nothing else referenced the dropped codes**

Run: `grep -rn --include="*.ts" --include="*.tsx" -e "REB-PL10" -e "REB-PL12" tools workflows office`
Expected: no output. (`supabase/migrations/003_seed.sql` and `052_rebar_batang_unit.sql` still name them — those are historical applied migrations and must NOT be edited; `assets/mock/ahs_template.csv` is sample input, also left alone.)

- [ ] **Step 7: Commit**

```bash
git add tools/rebarBatang.ts tools/__tests__/rebarBatang.test.ts
git commit -m "$(cat <<'EOF'
fix(rebar): drop REB-PL10/PL12 to match the strict-50 catalogue

Adds a CSV-driven drift guard so tools/rebarBatang.ts and
assets/mock/material_master.csv can never disagree again.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 086 — `get_workgroup_material_envelopes`

One read-only RPC returning planned / ordered / requested for **every** material planned against a set of BoQ rows. Generalizes `get_workgroup_envelope` (039 → 041, latest-master rule from 054, PO/request split from 068/069/073) so the BoQ-first list needs one round trip instead of one per material.

**Files:**
- Create: `supabase/migrations/086_workgroup_material_envelopes.sql`
- Test: `tools/__tests__/migration086.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. Depends on already-applied migrations 054 (`v_material_envelopes` latest-master), 061 (`assert_project_access`), 073 (CANCELLED-PO fulfilled-line rule).
- Produces: `get_workgroup_material_envelopes(p_project_id UUID, p_boq_item_ids UUID[]) RETURNS TABLE (material_id UUID, planned NUMERIC, ordered NUMERIC, requested NUMERIC)`, granted to `authenticated`. Task 3 wraps it.

- [ ] **Step 1: Write the failing contract test**

Create `tools/__tests__/migration086.test.ts`:

```ts
/**
 * Static guard for migration 086 (get_workgroup_material_envelopes).
 *
 * Does NOT touch a database — it asserts the frozen contract the client wrapper
 * (tools/envelopes.ts getWorkGroupMaterialEnvelopes) and the BoQ-first screens
 * depend on: the signature, the four OUT columns, SECURITY INVOKER + the
 * project-access guard, the latest-master scoping rule, the non-rejected /
 * non-cancelled burn predicates, the GRANT, and the documented verification
 * query. If someone edits 086 and drops one of these, the TS wiring would
 * silently diverge — this fails first.
 */
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/086_workgroup_material_envelopes.sql'),
  'utf8',
);

describe('migration 086 — frozen contract surface', () => {
  it('is re-paste-safe (drops the function before creating it)', () => {
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS get_workgroup_material_envelopes\(UUID, UUID\[\]\)/);
  });

  it('declares the exact signature and OUT columns', () => {
    expect(SQL).toMatch(/CREATE FUNCTION get_workgroup_material_envelopes\(\s*\n\s*p_project_id UUID,\s*\n\s*p_boq_item_ids UUID\[\]/);
    expect(SQL).toMatch(/RETURNS TABLE \(\s*\n\s*material_id UUID,\s*\n\s*planned NUMERIC,\s*\n\s*ordered NUMERIC,\s*\n\s*requested NUMERIC\s*\n\s*\)/);
  });

  it('is read-only and RLS-composed, with the project-access guard', () => {
    expect(SQL).toMatch(/\bSTABLE\b/);
    expect(SQL).toMatch(/\bSECURITY INVOKER\b/);
    expect(SQL).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
    expect(SQL).not.toMatch(/\bSECURITY DEFINER\b/);
  });

  it('scopes planned to the latest project_material_master, deterministically', () => {
    expect(SQL).toMatch(/FROM project_material_master\s*\n\s*WHERE project_id = p_project_id\s*\n\s*ORDER BY created_at DESC, id DESC\s*\n\s*LIMIT 1/);
  });

  it('burns on non-rejected requests and treats only live POs as fulfilled', () => {
    expect(SQL).toMatch(/h\.overall_status NOT IN \('REJECTED'\)/);
    expect(SQL).toMatch(/po\.status <> 'CANCELLED'/);
    expect(SQL).toMatch(/pol\.request_line_id = l\.id/);
  });

  it('grants execute to authenticated', () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes\(UUID, UUID\[\]\)\s*\n?\s*TO authenticated/);
  });

  it('documents the get_workgroup_envelope consistency check', () => {
    expect(SQL).toMatch(/VERIFICATION/);
    expect(SQL).toMatch(/get_workgroup_envelope/);
    expect(SQL).toMatch(/many\.ordered \+ many\.requested/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tools/__tests__/migration086.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../supabase/migrations/086_workgroup_material_envelopes.sql'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/086_workgroup_material_envelopes.sql`:

```sql
-- 086 — get_workgroup_material_envelopes: one work group, every material, one call
--       (BoQ-first Permintaan + Mode Besi; design authority
--        docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §6)
--
-- Paste order: AFTER 085 (latest applied migration). Apply via the Dashboard SQL
--   Editor (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe: DROP FUNCTION IF EXISTS + CREATE, GRANT re-issued.
--
-- WHY: get_workgroup_envelope (039 → 041) answers "planned vs already-requested
--   for ONE material across this work-group's BoQ rows". The BoQ-first request
--   flow needs those numbers for EVERY material in the group at once (one round
--   trip instead of N), and Mode Besi needs them per work group across up to ten
--   rebar diameters. This function is that generalization — read-only, adding no
--   semantics of its own.
--
-- BURN DEFINITIONS (copied from the lineage, not invented):
--   planned   — SUM(project_material_master_lines.planned_quantity) over the
--               passed BoQ rows, scoped to the project's LATEST
--               project_material_master header only (039:50-55 / 041:38-43),
--               with the `id DESC` tiebreaker 054:55-60 added so "latest" is a
--               single deterministic row even when two headers share a
--               created_at second. Summing across generations is the 038/054
--               double-count bug class.
--   ordered   — the group's demand that has become a SANO purchase order:
--               allocations on those rows whose request line is linked to a
--               non-CANCELLED PO (purchase_order_lines.request_line_id — the
--               "fulfilled line" definition from 069's header as amended by
--               073 Part B; CLOSED_SHORT stays fulfilled, only CANCELLED
--               un-fulfills). request_line_id is populated from Task 2.8 onward,
--               so this leg reads 0 for older data and self-improves as admins
--               link POs — the same self-improving property 069 documents.
--   requested — the rest: non-rejected allocations NOT linked to a live PO
--               ("other open requests", 069 header).
--
--   ordered + requested is therefore EXACTLY get_workgroup_envelope's
--   total_ordered (039:59-68 / 041:47-56 sum every non-rejected allocation with
--   no PO split). The VERIFICATION query at the bottom asserts that identity.
--
-- UNITS: base units throughout (kg for rebar), like every other envelope
--   surface. Supplier-unit display (batang) happens client-side via
--   tools/materialUnitConversion.ts displayQty.
--
-- SECURITY INVOKER (spec §6): RLS composes on every table read, matching
--   get_workgroup_envelope (039/041 are LANGUAGE sql, i.e. INVOKER by default).
--   assert_project_access (061) runs first so a caller outside the project fails
--   loudly instead of silently receiving an empty set.

DROP FUNCTION IF EXISTS get_workgroup_material_envelopes(UUID, UUID[]);

CREATE FUNCTION get_workgroup_material_envelopes(
  p_project_id UUID,
  p_boq_item_ids UUID[]
)
RETURNS TABLE (
  material_id UUID,
  planned NUMERIC,
  ordered NUMERIC,
  requested NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  WITH planned_rows AS (
    SELECT
      pmml.material_id            AS mat_id,
      SUM(pmml.planned_quantity)  AS qty
    FROM project_material_master_lines pmml
    WHERE pmml.master_id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
      AND pmml.boq_item_id = ANY(p_boq_item_ids)
      AND pmml.material_id IS NOT NULL
    GROUP BY pmml.material_id
  ),
  allocation_rows AS (
    -- Every non-rejected allocation on the group's rows, split by whether its
    -- request line is already fulfilled by a live PO. The two FILTERed sums add
    -- back up to get_workgroup_envelope's total_ordered.
    SELECT
      l.material_id AS mat_id,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NOT NULL), 0) AS ordered_qty,
      COALESCE(SUM(a.allocated_quantity)
        FILTER (WHERE po_link.request_line_id IS NULL), 0)     AS requested_qty
    FROM material_request_line_allocations a
    JOIN material_request_lines   l ON l.id = a.request_line_id
    JOIN material_request_headers h ON h.id = l.request_header_id
    LEFT JOIN LATERAL (
      SELECT pol.request_line_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE pol.request_line_id = l.id
        AND po.status <> 'CANCELLED'
      LIMIT 1
    ) po_link ON true
    WHERE h.project_id = p_project_id
      AND l.material_id IS NOT NULL
      AND a.boq_item_id = ANY(p_boq_item_ids)
      AND h.overall_status NOT IN ('REJECTED')
    GROUP BY l.material_id
  )
  -- FULL OUTER JOIN, not an inner join: a material ordered beyond (or outside)
  -- the current plan must still surface with planned = 0 rather than vanish.
  SELECT
    COALESCE(p.mat_id, x.mat_id)  AS material_id,
    COALESCE(p.qty, 0)            AS planned,
    COALESCE(x.ordered_qty, 0)    AS ordered,
    COALESCE(x.requested_qty, 0)  AS requested
  FROM planned_rows p
  FULL OUTER JOIN allocation_rows x ON x.mat_id = p.mat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes(UUID, UUID[])
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (part of done — spec §6, repo convention for DB verification)
--
-- Run this in the Dashboard SQL Editor against a real project and one work
-- group's BoQ ids before calling the migration done. Every row must agree with
-- get_workgroup_envelope called per material:
--     planned              = wge.total_planned
--     ordered + requested  = wge.total_ordered
--
-- EXPECTED RESULT: ZERO ROWS. Any row returned is a real divergence — fix it,
-- never explain it away (CLAUDE.md §1.1).
--
-- Known permitted difference: get_workgroup_envelope's latest-master subquery
-- (039:50-55 / 041:38-43) orders by created_at DESC with NO id tiebreaker, this
-- function adds `id DESC` per 054. They can only disagree when a project has two
-- project_material_master headers sharing a created_at timestamp — in which case
-- THIS function is the correct one and 039/041 is the row to fix.
--
--   WITH ids AS (
--     SELECT ARRAY(
--       SELECT id FROM boq_items
--       WHERE project_id = '<PROJECT_UUID>'::uuid
--         AND superseded_at IS NULL
--         AND chapter = '<CHAPTER OF ONE WORK GROUP>'
--     ) AS boq_ids
--   ),
--   many AS (
--     SELECT m.*
--     FROM ids,
--          LATERAL get_workgroup_material_envelopes('<PROJECT_UUID>'::uuid, ids.boq_ids) m
--   ),
--   one AS (
--     SELECT many.material_id, w.total_planned, w.total_ordered
--     FROM many, ids,
--          LATERAL get_workgroup_envelope('<PROJECT_UUID>'::uuid, many.material_id, ids.boq_ids) w
--   )
--   SELECT
--     many.material_id,
--     many.planned                       AS many_planned,
--     one.total_planned                  AS one_planned,
--     many.ordered + many.requested      AS many_burn,
--     one.total_ordered                  AS one_burn
--   FROM many
--   JOIN one ON one.material_id = many.material_id
--   WHERE ROUND(many.planned, 6)
--           IS DISTINCT FROM ROUND(one.total_planned, 6)
--      OR ROUND(many.ordered + many.requested, 6)
--           IS DISTINCT FROM ROUND(one.total_ordered, 6);
-- ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tools/__tests__/migration086.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Apply the migration and run the verification query**

Paste `supabase/migrations/086_workgroup_material_envelopes.sql` into the Supabase Dashboard SQL Editor and run it.
Expected: `DROP FUNCTION` / `CREATE FUNCTION` / `GRANT` succeed with no error.

Then uncomment the VERIFICATION query at the bottom of the file (do not commit it uncommented), substitute a real `<PROJECT_UUID>` and a real `<CHAPTER OF ONE WORK GROUP>` from that project's `boq_items`, and run it.
Expected: **0 rows**. If any row comes back, stop and fix the function before continuing — do not proceed to Task 3.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/086_workgroup_material_envelopes.sql tools/__tests__/migration086.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add get_workgroup_material_envelopes RPC (migration 086)

Generalizes get_workgroup_envelope to every material in a work group in
one read-only, RLS-composed call. ordered/requested split follows the
069/073 fulfilled-line rule so ordered + requested equals the existing
per-material total_ordered — asserted by the migration's verification query.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Client wrapper `getWorkGroupMaterialEnvelopes`

**Files:**
- Modify: `tools/envelopes.ts` (append after `getWorkGroupEnvelope`, which ends at line 179)
- Test: `tools/__tests__/workGroupMaterialEnvelopes.test.ts`

**Interfaces:**
- Consumes: `get_workgroup_material_envelopes` from Task 2.
- Produces:
  - `export interface WorkGroupMaterialEnvelope { material_id: string; planned: number; ordered: number; requested: number }`
  - `export async function getWorkGroupMaterialEnvelopes(projectId: string, boqItemIds: string[]): Promise<{ rows: WorkGroupMaterialEnvelope[]; error: string | null }>`

  Tasks 4, 5, 7, 8 all consume this exact shape. It returns `{ rows, error }` rather than throwing, because spec §7 requires an offline/failed RPC to surface as a non-blocking INFO with a retry — never a crashed screen.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/workGroupMaterialEnvelopes.test.ts`:

```ts
const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import { getWorkGroupMaterialEnvelopes } from '../envelopes';

describe('getWorkGroupMaterialEnvelopes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the RPC with the project and BoQ ids', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1', 'boq-2']);

    expect(mockRpc).toHaveBeenCalledWith('get_workgroup_material_envelopes', {
      p_project_id: 'proj-1',
      p_boq_item_ids: ['boq-1', 'boq-2'],
    });
  });

  it('coerces PostgREST NUMERIC strings to numbers', async () => {
    // Postgres NUMERIC arrives over PostgREST as a string — untouched, every
    // downstream sum would silently concatenate instead of add.
    mockRpc.mockResolvedValue({
      data: [{ material_id: 'mat-1', planned: '1250.5', ordered: '200', requested: '50.25' }],
      error: null,
    });

    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(error).toBeNull();
    expect(rows).toEqual([
      { material_id: 'mat-1', planned: 1250.5, ordered: 200, requested: 50.25 },
    ]);
  });

  it('defaults missing legs to 0', async () => {
    mockRpc.mockResolvedValue({
      data: [{ material_id: 'mat-1', planned: '10', ordered: null, requested: null }],
      error: null,
    });

    const { rows } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(rows[0]).toEqual({ material_id: 'mat-1', planned: 10, ordered: 0, requested: 0 });
  });

  it('short-circuits on an empty BoQ id list without calling the RPC', async () => {
    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', []);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(error).toBeNull();
  });

  it('surfaces an RPC failure as a message instead of throwing', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const { rows, error } = await getWorkGroupMaterialEnvelopes('proj-1', ['boq-1']);

    expect(rows).toEqual([]);
    expect(error).toBe('network down');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tools/__tests__/workGroupMaterialEnvelopes.test.ts`
Expected: FAIL — `TS2305: Module '"../envelopes"' has no exported member 'getWorkGroupMaterialEnvelopes'`.

- [ ] **Step 3: Implement the wrapper**

In `tools/envelopes.ts`, insert this immediately after the closing brace of `getWorkGroupEnvelope` (line 179), before the `getMaterialDrift` doc comment:

```ts
/** One row of get_workgroup_material_envelopes (migration 086). BASE units. */
export interface WorkGroupMaterialEnvelope {
  material_id: string;
  /** Planned demand for this material across the group's BoQ rows (latest master). */
  planned: number;
  /** Group demand already turned into a non-cancelled SANO PO. */
  ordered: number;
  /** Group demand still open (non-rejected requests not yet linked to a live PO). */
  requested: number;
}

/**
 * ALL-materials work-group envelope (migration 086): planned / ordered /
 * requested for every material planned against the given BoQ rows, in ONE round
 * trip. Generalizes getWorkGroupEnvelope above (one material per call) for the
 * BoQ-first request flow and Mode Besi.
 *
 * `ordered + requested` equals getWorkGroupEnvelope's total_ordered by
 * construction — see the verification query in the migration.
 *
 * Returns `{ rows, error }` instead of throwing: a failed envelope fetch is a
 * non-blocking INFO with a retry in the UI (design spec §7), never a dead
 * screen. Numeric coercion is mandatory — PostgREST hands NUMERIC back as a
 * string.
 */
export async function getWorkGroupMaterialEnvelopes(
  projectId: string,
  boqItemIds: string[],
): Promise<{ rows: WorkGroupMaterialEnvelope[]; error: string | null }> {
  if (boqItemIds.length === 0) return { rows: [], error: null };

  const { data, error } = await supabase.rpc('get_workgroup_material_envelopes', {
    p_project_id: projectId,
    p_boq_item_ids: boqItemIds,
  });

  if (error) return { rows: [], error: error.message };

  const raw = (data ?? []) as Array<Record<string, unknown>>;
  return {
    rows: raw.map(row => ({
      material_id: String(row.material_id),
      planned: Number(row.planned ?? 0),
      ordered: Number(row.ordered ?? 0),
      requested: Number(row.requested ?? 0),
    })),
    error: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tools/__tests__/workGroupMaterialEnvelopes.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add tools/envelopes.ts tools/__tests__/workGroupMaterialEnvelopes.test.ts
git commit -m "$(cat <<'EOF'
feat(envelopes): client wrapper for get_workgroup_material_envelopes

Non-throwing {rows, error} shape so a failed fetch stays a soft INFO in
the UI, with explicit NUMERIC-string coercion.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `tools/workGroupDemand.ts` — RPC result → demand rows

Pure module: partitions one work group's envelope rows into the Tier-1 primary list and the "Material terkait (Tier 2+)" section, computes `sisa`, and renders it in supplier units. Screens stay thin over it (repo convention, like `tools/submitMaterialRequest.ts`).

**Files:**
- Create: `tools/workGroupDemand.ts`
- Test: `tools/__tests__/workGroupDemand.test.ts`

**Interfaces:**
- Consumes: `WorkGroupMaterialEnvelope` shape from Task 3 (re-declared locally as `WorkGroupEnvelopeRow` so this module has no Supabase import), `displayQty` from `tools/materialUnitConversion.ts`.
- Produces:
  - `DemandCatalogMaterial` — structurally satisfied by `PermintaanScreen`'s `MaterialOption`.
  - `DemandRow`, `WorkGroupDemand { tier1: DemandRow[]; tier2plus: DemandRow[] }`
  - `computeSisa(planned, ordered, requested): number`
  - `buildWorkGroupDemand(rows, catalog): WorkGroupDemand`
  - `formatSisaLabel(row: DemandRow): string`

  Task 7 consumes all of these.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/workGroupDemand.test.ts`:

```ts
import {
  computeSisa,
  buildWorkGroupDemand,
  formatSisaLabel,
  type DemandCatalogMaterial,
  type WorkGroupEnvelopeRow,
} from '../workGroupDemand';

const D13: DemandCatalogMaterial = {
  id: 'mat-d13', name: 'Besi beton ulir 13 mm', unit: 'kg',
  supplier_unit: 'batang', base_qty_per_supplier_unit: 12.5, tier: 1, code: 'REB-DE13',
};
const BETON: DemandCatalogMaterial = {
  id: 'mat-beton', name: "Ready mix fc' 30 MPa", unit: 'm3',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 1, code: 'CON-RM30',
};
const SEMEN: DemandCatalogMaterial = {
  id: 'mat-semen', name: 'Semen PCC 40 kg', unit: 'zak',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 2, code: 'CEM-PCC40',
};
const PAKU: DemandCatalogMaterial = {
  id: 'mat-paku', name: 'Paku beton', unit: 'kg',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 4, code: 'FST-NL01',
};
const CATALOG = [D13, BETON, SEMEN, PAKU];

const row = (m: Partial<WorkGroupEnvelopeRow> & { material_id: string }): WorkGroupEnvelopeRow => ({
  planned: 0, ordered: 0, requested: 0, ...m,
});

describe('computeSisa', () => {
  it('is planned minus both burn legs', () => {
    expect(computeSisa(1000, 200, 125)).toBe(675);
  });

  it('floors at zero — an over-ordered group has no remaining need', () => {
    expect(computeSisa(100, 90, 50)).toBe(0);
  });
});

describe('buildWorkGroupDemand', () => {
  it('splits Tier 1 from Tier 2+ and keeps each list name-sorted', () => {
    const demand = buildWorkGroupDemand(
      [
        row({ material_id: 'mat-semen', planned: 400 }),
        row({ material_id: 'mat-d13', planned: 1000 }),
        row({ material_id: 'mat-beton', planned: 20 }),
        row({ material_id: 'mat-paku', planned: 5 }),
      ],
      CATALOG,
    );

    expect(demand.tier1.map(r => r.materialId)).toEqual(['mat-d13', 'mat-beton']);
    expect(demand.tier2plus.map(r => r.materialId)).toEqual(['mat-paku', 'mat-semen']);
  });

  it('drops a Tier-1 material the group does not plan (belongs in "Tambah material lain")', () => {
    const demand = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 0, requested: 40 })],
      CATALOG,
    );
    expect(demand.tier1).toEqual([]);
  });

  it('keeps a Tier 2+ row even without planned demand (project-level tracking)', () => {
    const demand = buildWorkGroupDemand(
      [row({ material_id: 'mat-semen', planned: 0, ordered: 12 })],
      CATALOG,
    );
    expect(demand.tier2plus.map(r => r.materialId)).toEqual(['mat-semen']);
    expect(demand.tier2plus[0].sisaBase).toBe(0);
  });

  it('drops an envelope row with no catalog match rather than naming it "—"', () => {
    const demand = buildWorkGroupDemand([row({ material_id: 'ghost', planned: 99 })], CATALOG);
    expect(demand.tier1).toEqual([]);
    expect(demand.tier2plus).toEqual([]);
  });

  it('carries base numbers through and converts sisa to supplier units', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 3000, ordered: 200, requested: 125 })],
      CATALOG,
    ).tier1;

    expect(r.plannedBase).toBe(3000);
    expect(r.orderedBase).toBe(200);
    expect(r.requestedBase).toBe(125);
    expect(r.sisaBase).toBe(2675);
    expect(r.sisaDisplay).toEqual({
      qty: 214, unit: 'batang', baseQty: 2675, baseUnit: 'kg', converted: true,
    });
  });
});

describe('formatSisaLabel', () => {
  it('shows supplier units with the base quantity alongside for rebar', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 2675 })],
      CATALOG,
    ).tier1;
    expect(formatSisaLabel(r)).toBe('214 batang (≈ 2.675 kg)');
  });

  it('passes a non-converting material straight through', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-beton', planned: 20.5 })],
      CATALOG,
    ).tier1;
    expect(formatSisaLabel(r)).toBe('20,5 m3');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tools/__tests__/workGroupDemand.test.ts`
Expected: FAIL — `Cannot find module '../workGroupDemand' from 'tools/__tests__/workGroupDemand.test.ts'`.

- [ ] **Step 3: Implement the module**

Create `tools/workGroupDemand.ts`:

```ts
// SANO — BoQ-first Permintaan: one work group's envelope result → the demand
// rows the group-first screen renders.
// Design authority: docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §2
//
// Pure: no supabase, no react-native — the screen stays a thin renderer over
// this (repo convention, like tools/submitMaterialRequest.ts).
//
// UNITS: get_workgroup_material_envelopes (086) answers in BASE units (kg for
// rebar). Display goes through displayQty so a supervisor reads batang, exactly
// like every other surface (tools/materialUnitConversion.ts is THE boundary).

import { displayQty, type MaterialUnitInfo } from './materialUnitConversion';

/**
 * The catalog fields a demand row needs. Structurally satisfied by
 * PermintaanScreen's MaterialOption, so the screen passes materialOptions
 * straight in — no adapter, no second catalog fetch.
 */
export interface DemandCatalogMaterial extends MaterialUnitInfo {
  id: string;
  name: string;
  /** Base unit ('kg' for rebar) — what gates and storage use. */
  unit: string;
  /** Supplier unit ('batang' for rebar). null/absent = same as unit. */
  supplier_unit?: string | null;
  /** Base units per ONE supplier unit. null = 1:1. */
  base_qty_per_supplier_unit?: number | null;
  tier: 1 | 2 | 3 | 4;
  code?: string | null;
}

/** One row of get_workgroup_material_envelopes (base units). */
export interface WorkGroupEnvelopeRow {
  material_id: string;
  planned: number;
  ordered: number;
  requested: number;
}

export interface DemandRow {
  materialId: string;
  material: DemandCatalogMaterial;
  tier: 1 | 2 | 3 | 4;
  plannedBase: number;
  orderedBase: number;
  requestedBase: number;
  /** max(0, planned − ordered − requested), BASE units. */
  sisaBase: number;
  /** Supplier-unit view of sisaBase (batang for rebar). */
  sisaDisplay: ReturnType<typeof displayQty>;
}

export interface WorkGroupDemand {
  /** Primary list: Tier-1 materials this group actually plans (spec §2). */
  tier1: DemandRow[];
  /** "Material terkait (Tier 2+)" — every non-Tier-1 material in the result. */
  tier2plus: DemandRow[];
}

/**
 * Remaining need = planned − already-ordered − still-open. Floored at zero: a
 * group that has been over-ordered has NO remaining need, not a negative one
 * (a negative sisa would read as a credit the supervisor could spend).
 */
export function computeSisa(planned: number, ordered: number, requested: number): number {
  return Math.max(0, planned - ordered - requested);
}

function byName(a: DemandRow, b: DemandRow): number {
  return a.material.name.localeCompare(b.material.name, 'id', { sensitivity: 'base' });
}

/**
 * Turn a work group's envelope rows into the two rendered lists.
 *
 * Rows with no catalog match are DROPPED, deliberately: the screen's catalog is
 * the only source of a name, unit, tier and conversion factor, and it already
 * excludes company-owned equipment (is_asset). Rendering a bare uuid, or
 * guessing a name, would violate the truth-correctness contract — and such a
 * material cannot be requested anyway.
 *
 * A Tier-1 row with planned = 0 is dropped too: the primary list is "what this
 * work needs" (spec §2), and an unplanned Tier-1 material is reachable through
 * "Tambah material lain", where it correctly shows the no-baseline INFO flag.
 * Tier 2+ rows are kept regardless of planned demand — they are tracked at
 * project level, so their presence in the group is informational either way.
 */
export function buildWorkGroupDemand(
  rows: WorkGroupEnvelopeRow[],
  catalog: DemandCatalogMaterial[],
): WorkGroupDemand {
  const byId = new Map(catalog.map(m => [m.id, m]));
  const tier1: DemandRow[] = [];
  const tier2plus: DemandRow[] = [];

  for (const row of rows) {
    const material = byId.get(row.material_id);
    if (!material) continue;

    const sisaBase = computeSisa(row.planned, row.ordered, row.requested);
    const demandRow: DemandRow = {
      materialId: row.material_id,
      material,
      tier: material.tier,
      plannedBase: row.planned,
      orderedBase: row.ordered,
      requestedBase: row.requested,
      sisaBase,
      sisaDisplay: displayQty(sisaBase, material),
    };

    if (material.tier === 1) {
      if (row.planned > 0) tier1.push(demandRow);
    } else {
      tier2plus.push(demandRow);
    }
  }

  return { tier1: tier1.sort(byName), tier2plus: tier2plus.sort(byName) };
}

/**
 * Sisa as the row renders it: "214 batang (≈ 2.675 kg)" when a conversion
 * factor exists, "20,5 m3" when it does not. id-ID formatting throughout,
 * matching tools/requestOverage.ts.
 */
export function formatSisaLabel(row: DemandRow): string {
  const { qty, unit, baseQty, baseUnit, converted } = row.sisaDisplay;
  const shown = qty.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  if (!converted) return `${shown} ${unit}`;
  return `${shown} ${unit} (≈ ${Math.round(baseQty).toLocaleString('id-ID')} ${baseUnit})`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tools/__tests__/workGroupDemand.test.ts`
Expected: PASS — 9 tests, 0 failures.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add tools/workGroupDemand.ts tools/__tests__/workGroupDemand.test.ts
git commit -m "$(cat <<'EOF'
feat(permintaan): add workGroupDemand — envelope rows to demand list

Tier partition, sisa floored at zero, supplier-unit display via displayQty.
Unmatched catalog rows are dropped rather than rendered nameless.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `tools/rebarMatrix.ts` — scope, matrix, split math, expansion

Pure module holding every number Mode Besi shows or produces: which groups have rebar demand, the per-diameter aggregate, the largest-remainder integer split, and the expansion to request drafts.

**Files:**
- Create: `tools/rebarMatrix.ts`
- Test: `tools/__tests__/rebarMatrix.test.ts`

**Interfaces:**
- Consumes: `WorkGroupEnvelopeRow` from Task 4, `baseToSupplierOrder` from `tools/materialUnitConversion.ts`.
- Produces:
  - `REBAR_CODE_PREFIX`, `isRebarCode(code): boolean`
  - `RebarMaterial`, `RebarGroupEnvelope`, `RebarCell`, `RebarMatrixRow`, `RebarSplitBasis`, `RebarSplitEntry`, `RebarRequestDraft`
  - `sortRebarMaterials(materials): RebarMaterial[]`
  - `buildRebarCells(materials, groupEnvelopes): RebarCell[]`
  - `groupsWithRebarDemand(cells): string[]`
  - `groupRebarSisaBatang(materials, cells, groupKey): number`
  - `buildMatrixRows(materials, cells, selectedGroupKeys): RebarMatrixRow[]`
  - `splitBasisFor(cells, materialId, selectedGroupKeys): RebarSplitBasis[]`
  - `largestRemainderSplit(total, weights): number[] | null`
  - `defaultSplit(totalBatang, basis): RebarSplitEntry[] | null`
  - `expandRebarMatrix(entries): RebarRequestDraft[]`

  Task 8 consumes all of these.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/rebarMatrix.test.ts`:

```ts
import {
  isRebarCode,
  sortRebarMaterials,
  buildRebarCells,
  groupsWithRebarDemand,
  groupRebarSisaBatang,
  buildMatrixRows,
  splitBasisFor,
  largestRemainderSplit,
  defaultSplit,
  expandRebarMatrix,
  type RebarMaterial,
  type RebarGroupEnvelope,
} from '../rebarMatrix';

const bar = (id: string, code: string, kgPerBatang: number, name = code): RebarMaterial => ({
  id, code, name, unit: 'kg', supplierUnit: 'batang', kgPerBatang,
});

const D13 = bar('m-d13', 'REB-DE13', 12.5, 'Besi beton ulir 13 mm');
const D16 = bar('m-d16', 'REB-DE16', 18.94, 'Besi beton ulir 16 mm');
const P08 = bar('m-p08', 'REB-PL08', 4.74, 'Besi beton polos 8 mm');
const BARS = [P08, D16, D13];

const env = (groupKey: string, rows: RebarGroupEnvelope['rows']): RebarGroupEnvelope => ({
  groupKey, groupLabel: groupKey, rows,
});

describe('isRebarCode', () => {
  it('accepts REB- codes only', () => {
    expect(isRebarCode('REB-DE13')).toBe(true);
    expect(isRebarCode('CEM-PCC40')).toBe(false);
    expect(isRebarCode(null)).toBe(false);
  });
});

describe('sortRebarMaterials', () => {
  it('orders ulir before polos, then diameter ascending', () => {
    expect(sortRebarMaterials(BARS).map(m => m.code))
      .toEqual(['REB-DE13', 'REB-DE16', 'REB-PL08']);
  });

  it('parks an unrecognized REB- shape last', () => {
    const odd = bar('m-odd', 'REB-WRM01', 1);
    expect(sortRebarMaterials([odd, D13]).map(m => m.code))
      .toEqual(['REB-DE13', 'REB-WRM01']);
  });
});

describe('buildRebarCells', () => {
  const groups = [
    env('pondasi', [
      { material_id: 'm-d13', planned: 1000, ordered: 200, requested: 100 },
      { material_id: 'm-semen', planned: 500, ordered: 0, requested: 0 },
    ]),
    env('kolom-1', [
      { material_id: 'm-d13', planned: 500, ordered: 600, requested: 0 },
      { material_id: 'm-d16', planned: 0, ordered: 0, requested: 0 },
    ]),
  ];

  it('keeps only rebar materials and floors remaining at zero', () => {
    const cells = buildRebarCells(BARS, groups);
    expect(cells).toEqual([
      { materialId: 'm-d13', groupKey: 'pondasi', plannedBase: 1000, remainingBase: 700 },
      { materialId: 'm-d13', groupKey: 'kolom-1', plannedBase: 500, remainingBase: 0 },
      { materialId: 'm-d16', groupKey: 'kolom-1', plannedBase: 0, remainingBase: 0 },
    ]);
  });

  it('lists only groups with planned rebar demand as the default scope', () => {
    expect(groupsWithRebarDemand(buildRebarCells(BARS, groups))).toEqual(['pondasi', 'kolom-1']);
  });

  it('reports a group total sisa in whole batang, rounded up per diameter', () => {
    // pondasi: D13 700 kg / 12.5 = 56 batang exactly; nothing else has sisa.
    expect(groupRebarSisaBatang(BARS, buildRebarCells(BARS, groups), 'pondasi')).toBe(56);
    expect(groupRebarSisaBatang(BARS, buildRebarCells(BARS, groups), 'kolom-1')).toBe(0);
  });
});

describe('buildMatrixRows', () => {
  const cells = buildRebarCells(BARS, [
    env('pondasi', [{ material_id: 'm-d13', planned: 1000, ordered: 0, requested: 0 }]),
    env('kolom-1', [{ material_id: 'm-d13', planned: 500, ordered: 0, requested: 0 }]),
    env('kolom-1', [{ material_id: 'm-p08', planned: 100, ordered: 95, requested: 0 }]),
  ]);

  it('aggregates only the selected groups, sorted ulir → polos', () => {
    const rows = buildMatrixRows(BARS, cells, ['pondasi']);
    expect(rows.map(r => r.material.code)).toEqual(['REB-DE13', 'REB-DE16', 'REB-PL08']);
    expect(rows[0].plannedBase).toBe(1000);
    expect(rows[0].remainingBase).toBe(1000);
  });

  it('rounds remaining UP to whole batang — you cannot buy 0.4 lonjor', () => {
    const [d13] = buildMatrixRows(BARS, cells, ['pondasi', 'kolom-1']);
    expect(d13.remainingBase).toBe(1500);
    expect(d13.remainingBatang).toBe(120); // 1500 / 12.5 = 120 exactly
    const p08 = buildMatrixRows(BARS, cells, ['kolom-1']).find(r => r.material.code === 'REB-PL08')!;
    expect(p08.remainingBase).toBe(5);
    expect(p08.remainingBatang).toBe(2); // 5 / 4.74 = 1.05 → 2
  });

  it('flags a diameter with no planned demand in scope as baseline-less', () => {
    const d16 = buildMatrixRows(BARS, cells, ['pondasi']).find(r => r.material.code === 'REB-DE16')!;
    expect(d16.hasBaseline).toBe(false);
    expect(d16.plannedBase).toBe(0);
  });
});

describe('largestRemainderSplit', () => {
  it('sums exactly to the total', () => {
    expect(largestRemainderSplit(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderSplit(7, [500, 300, 200])).toEqual([4, 2, 1]);
  });

  it('always sums exactly, for every total in a sweep', () => {
    for (let total = 0; total <= 60; total += 1) {
      const parts = largestRemainderSplit(total, [7, 11, 3, 29])!;
      expect(parts.reduce((s, n) => s + n, 0)).toBe(total);
      expect(parts.every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    }
  });

  it('returns null when there is no weight to divide by — never an even guess', () => {
    expect(largestRemainderSplit(10, [0, 0, 0])).toBeNull();
    expect(largestRemainderSplit(10, [])).toBeNull();
  });

  it('rejects a non-integer or negative total (batang are whole)', () => {
    expect(largestRemainderSplit(10.5, [1, 1])).toBeNull();
    expect(largestRemainderSplit(-1, [1, 1])).toBeNull();
  });
});

describe('defaultSplit', () => {
  const basis = [
    { groupKey: 'pondasi', plannedBase: 1000, remainingBase: 300 },
    { groupKey: 'kolom-1', plannedBase: 1000, remainingBase: 100 },
  ];

  it('divides in proportion to remaining demand', () => {
    expect(defaultSplit(40, basis)).toEqual([
      { groupKey: 'pondasi', batang: 30 },
      { groupKey: 'kolom-1', batang: 10 },
    ]);
  });

  it('falls back to planned when nothing remains anywhere', () => {
    const spent = [
      { groupKey: 'pondasi', plannedBase: 1500, remainingBase: 0 },
      { groupKey: 'kolom-1', plannedBase: 500, remainingBase: 0 },
    ];
    expect(defaultSplit(40, spent)).toEqual([
      { groupKey: 'pondasi', batang: 30 },
      { groupKey: 'kolom-1', batang: 10 },
    ]);
  });

  it('returns null with no baseline at all — the user assigns manually', () => {
    expect(defaultSplit(40, [
      { groupKey: 'pondasi', plannedBase: 0, remainingBase: 0 },
      { groupKey: 'kolom-1', plannedBase: 0, remainingBase: 0 },
    ])).toBeNull();
  });
});

describe('splitBasisFor', () => {
  it('returns one basis entry per selected group, in scope order', () => {
    const cells = buildRebarCells(BARS, [
      env('pondasi', [{ material_id: 'm-d13', planned: 1000, ordered: 100, requested: 0 }]),
      env('kolom-1', [{ material_id: 'm-d13', planned: 400, ordered: 0, requested: 0 }]),
    ]);
    expect(splitBasisFor(cells, 'm-d13', ['kolom-1', 'pondasi'])).toEqual([
      { groupKey: 'kolom-1', plannedBase: 400, remainingBase: 400 },
      { groupKey: 'pondasi', plannedBase: 1000, remainingBase: 900 },
    ]);
  });
});

describe('expandRebarMatrix', () => {
  it('emits one draft per (diameter × group) with a positive amount', () => {
    expect(expandRebarMatrix([
      { materialId: 'm-d13', splits: [
        { groupKey: 'pondasi', batang: 30 },
        { groupKey: 'kolom-1', batang: 0 },
      ] },
      { materialId: 'm-d16', splits: [{ groupKey: 'pondasi', batang: 12 }] },
    ])).toEqual([
      { materialId: 'm-d13', workGroupKey: 'pondasi', quantityBatang: 30 },
      { materialId: 'm-d16', workGroupKey: 'pondasi', quantityBatang: 12 },
    ]);
  });

  it('drops a group edited to zero or below', () => {
    expect(expandRebarMatrix([
      { materialId: 'm-d13', splits: [{ groupKey: 'pondasi', batang: -5 }] },
    ])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tools/__tests__/rebarMatrix.test.ts`
Expected: FAIL — `Cannot find module '../rebarMatrix' from 'tools/__tests__/rebarMatrix.test.ts'`.

- [ ] **Step 3: Implement the module**

Create `tools/rebarMatrix.ts`:

```ts
// SANO — Mode Besi (bulk rebar) matrix logic.
// Design authority: docs/superpowers/specs/2026-08-05-permintaan-boq-first-mode-besi-design.md §3
//
// Pure: no supabase, no react-native. Every number Mode Besi shows or submits
// is computed here so the screen holds no arithmetic.
//
// REBAR IDENTITY comes from the CATALOG ONLY (material_catalog.code LIKE
// 'REB-%'). tools/rebarBatang.ts owns the kg↔batang FACTORS; the catalogue owns
// WHICH bars exist. Never hardcode a diameter list in a screen.
//
// UNITS: envelope numbers are BASE (kg); the matrix is entered and split in
// WHOLE BATANG (you cannot buy 0.4 lonjor). Conversion happens here via
// tools/materialUnitConversion.ts and nowhere else.

import { baseToSupplierOrder } from './materialUnitConversion';
import type { WorkGroupEnvelopeRow } from './workGroupDemand';

export const REBAR_CODE_PREFIX = 'REB-';

/** A rebar bar as the matrix needs it (projected from the catalog row). */
export interface RebarMaterial {
  id: string;
  /** Catalog code, e.g. 'REB-DE13'. Drives ordering. */
  code: string;
  name: string;
  /** Base unit — 'kg'. */
  unit: string;
  /** Supplier unit — 'batang'. */
  supplierUnit: string;
  /** kg per batang; null when the catalog row carries no factor (1:1). */
  kgPerBatang: number | null;
}

/** One work group's envelope result (Task 3's rows), tagged with its group. */
export interface RebarGroupEnvelope {
  groupKey: string;
  groupLabel: string;
  rows: WorkGroupEnvelopeRow[];
}

/** Per (material × group) demand, BASE units. */
export interface RebarCell {
  materialId: string;
  groupKey: string;
  plannedBase: number;
  /** max(0, planned − ordered − requested). */
  remainingBase: number;
}

export interface RebarMatrixRow {
  material: RebarMaterial;
  plannedBase: number;
  remainingBase: number;
  /** Whole batang, rounded UP. */
  remainingBatang: number;
  /** false → renders under "Diameter lain" with a "tanpa baseline" chip. */
  hasBaseline: boolean;
}

export interface RebarSplitBasis {
  groupKey: string;
  plannedBase: number;
  remainingBase: number;
}

export interface RebarSplitEntry {
  groupKey: string;
  batang: number;
}

export interface RebarRequestDraft {
  materialId: string;
  workGroupKey: string;
  /** Whole batang — SUPPLIER units, exactly what RequestLine.quantity holds. */
  quantityBatang: number;
}

export function isRebarCode(code: string | null | undefined): boolean {
  return (code ?? '').startsWith(REBAR_CODE_PREFIX);
}

/**
 * Sort key: ulir (REB-DE…) before polos (REB-PL…), then diameter ascending.
 * A REB- code with an unrecognized shape sorts last, by code — visible and
 * ordered, never silently dropped.
 */
function rebarSortKey(code: string): [number, number, string] {
  const m = /^REB-(DE|PL)(\d+)$/.exec(code);
  if (!m) return [2, 0, code];
  return [m[1] === 'DE' ? 0 : 1, Number(m[2]), code];
}

export function sortRebarMaterials(materials: RebarMaterial[]): RebarMaterial[] {
  return [...materials].sort((a, b) => {
    const ka = rebarSortKey(a.code);
    const kb = rebarSortKey(b.code);
    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || ka[2].localeCompare(kb[2]);
  });
}

/** Flatten per-group envelope results into (material × group) cells. */
export function buildRebarCells(
  materials: RebarMaterial[],
  groupEnvelopes: RebarGroupEnvelope[],
): RebarCell[] {
  const rebarIds = new Set(materials.map(m => m.id));
  const cells: RebarCell[] = [];
  for (const group of groupEnvelopes) {
    for (const row of group.rows) {
      if (!rebarIds.has(row.material_id)) continue;
      cells.push({
        materialId: row.material_id,
        groupKey: group.groupKey,
        plannedBase: row.planned,
        remainingBase: Math.max(0, row.planned - row.ordered - row.requested),
      });
    }
  }
  return cells;
}

/** Work groups with any planned rebar demand — the default (all-selected) scope. */
export function groupsWithRebarDemand(cells: RebarCell[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell.plannedBase <= 0 || seen.has(cell.groupKey)) continue;
    seen.add(cell.groupKey);
    keys.push(cell.groupKey);
  }
  return keys;
}

/** Whole batang for a base quantity; a factorless material passes through. */
function toBatang(base: number, kgPerBatang: number | null): number {
  return Math.round(baseToSupplierOrder(base, kgPerBatang));
}

/**
 * Total rebar sisa for one group, in whole batang. Rounded UP per diameter and
 * then summed — batang are not fungible across diameters, so rounding the sum
 * would understate the order.
 */
export function groupRebarSisaBatang(
  materials: RebarMaterial[],
  cells: RebarCell[],
  groupKey: string,
): number {
  let total = 0;
  for (const material of materials) {
    let remaining = 0;
    for (const cell of cells) {
      if (cell.materialId !== material.id || cell.groupKey !== groupKey) continue;
      remaining += cell.remainingBase;
    }
    total += toBatang(remaining, material.kgPerBatang);
  }
  return total;
}

/** One row per bar, aggregated across the selected groups only. */
export function buildMatrixRows(
  materials: RebarMaterial[],
  cells: RebarCell[],
  selectedGroupKeys: string[],
): RebarMatrixRow[] {
  const scope = new Set(selectedGroupKeys);
  return sortRebarMaterials(materials).map(material => {
    let plannedBase = 0;
    let remainingBase = 0;
    for (const cell of cells) {
      if (cell.materialId !== material.id || !scope.has(cell.groupKey)) continue;
      plannedBase += cell.plannedBase;
      remainingBase += cell.remainingBase;
    }
    return {
      material,
      plannedBase,
      remainingBase,
      remainingBatang: toBatang(remainingBase, material.kgPerBatang),
      hasBaseline: plannedBase > 0,
    };
  });
}

/** Per-group planned/remaining for ONE bar, in the scope's order. */
export function splitBasisFor(
  cells: RebarCell[],
  materialId: string,
  selectedGroupKeys: string[],
): RebarSplitBasis[] {
  return selectedGroupKeys.map(groupKey => {
    let plannedBase = 0;
    let remainingBase = 0;
    for (const cell of cells) {
      if (cell.materialId !== materialId || cell.groupKey !== groupKey) continue;
      plannedBase += cell.plannedBase;
      remainingBase += cell.remainingBase;
    }
    return { groupKey, plannedBase, remainingBase };
  });
}

/**
 * Split a whole-batang total across weighted buckets so every part is an
 * integer and the parts sum EXACTLY to `total` (largest-remainder / Hare
 * quota). Ties resolve to the lower index, so the result is deterministic.
 *
 * Returns null when there is nothing to divide by (no buckets, every weight 0,
 * or a non-integer/negative total). An even split would be a fabricated
 * proportion — the caller falls back or asks the user instead.
 */
export function largestRemainderSplit(total: number, weights: number[]): number[] | null {
  if (weights.length === 0) return null;
  if (!Number.isInteger(total) || total < 0) return null;

  const safe = weights.map(w => Math.max(0, w));
  const totalWeight = safe.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return null;

  const exact = safe.map(w => (w / totalWeight) * total);
  const out = exact.map(Math.floor);
  let assigned = out.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));

  let i = 0;
  while (assigned < total) {
    out[order[i % order.length].index] += 1;
    assigned += 1;
    i += 1;
  }
  return out;
}

/**
 * Default per-group split for one diameter (spec §3 step 3): proportional to
 * each selected group's REMAINING demand; if remaining is 0 everywhere, fall
 * back to PLANNED; if planned is 0 everywhere the diameter has no baseline in
 * scope — return null so the UI starts the inputs empty and the user assigns
 * them. Never a fabricated proportion.
 */
export function defaultSplit(
  totalBatang: number,
  basis: RebarSplitBasis[],
): RebarSplitEntry[] | null {
  const parts =
    largestRemainderSplit(totalBatang, basis.map(b => b.remainingBase))
    ?? largestRemainderSplit(totalBatang, basis.map(b => b.plannedBase));
  if (!parts) return null;
  return basis.map((b, index) => ({ groupKey: b.groupKey, batang: parts[index] }));
}

/**
 * Matrix → request drafts: one per (diameter × group) with a positive batang
 * amount. A group edited to 0 drops its line (spec §3 step 3). The screen turns
 * each draft into a standard RequestLine (tier 1, workGroupKey, quantity in
 * batang) and the existing pipeline does the rest — no new write path.
 */
export function expandRebarMatrix(
  entries: Array<{ materialId: string; splits: RebarSplitEntry[] }>,
): RebarRequestDraft[] {
  const out: RebarRequestDraft[] = [];
  for (const entry of entries) {
    for (const split of entry.splits) {
      if (!(split.batang > 0)) continue;
      out.push({
        materialId: entry.materialId,
        workGroupKey: split.groupKey,
        quantityBatang: split.batang,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tools/__tests__/rebarMatrix.test.ts`
Expected: PASS — 19 tests, 0 failures.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add tools/rebarMatrix.ts tools/__tests__/rebarMatrix.test.ts
git commit -m "$(cat <<'EOF'
feat(permintaan): add rebarMatrix — scope, aggregate, split, expansion

Largest-remainder integer split that sums exactly; remaining→planned→manual
fallback chain returns null rather than inventing an even split.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Landing tiles, mode state, SelectSheet swap, Path 3 banner

Everything that touches `PermintaanScreen`'s existing surface *without* adding a new flow yet: the three-tile landing, back-with-discard, the `Picker` → `SelectSheet` swap, and the non-blocking Tier-1 banner in Material Umum.

**Files:**
- Modify: `workflows/screens/PermintaanScreen.tsx`
- Read for reference: `workflows/components/SelectSheet.tsx` (props contract), `workflows/theme.ts`

**Interfaces:**
- Consumes: `SelectSheet` + `SelectOption` from `workflows/components/SelectSheet.tsx`; `WorkGroup` from `tools/types`.
- Produces (inside the screen, used by Tasks 7 and 8):
  - `type PermintaanMode = 'landing' | 'pekerjaan' | 'besi' | 'umum'`
  - `const [mode, setMode] = useState<PermintaanMode>('landing')`
  - `enterMode(next: PermintaanMode): void` — resets `lines` for the target mode
  - `leaveMode(): void` — confirm-discard, then back to `'landing'`
  - `workGroupOptions: SelectOption[]`

- [ ] **Step 1: Swap the import block**

In `workflows/screens/PermintaanScreen.tsx`, delete line 6:

```tsx
import { Picker } from '@react-native-picker/picker';
```

and add, after the `MaterialNamingAssist` import (line 12):

```tsx
import SelectSheet, { type SelectOption } from '../components/SelectSheet';
```

- [ ] **Step 2: Add the mode type and its state**

Immediately after `const ACTIVE_REQUEST_BASIS: RequestBasis = 'MATERIAL';` (line 45), add:

```tsx
/** The three entry paths plus their landing (design spec §1). */
type PermintaanMode = 'landing' | 'pekerjaan' | 'besi' | 'umum';

const MODE_TILES: Array<{
  key: Exclude<PermintaanMode, 'landing'>;
  /** Ionicons glyph name — typed off the component so a typo fails to compile. */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
}> = [
  {
    key: 'pekerjaan',
    icon: 'construct-outline',
    title: 'Permintaan Pekerjaan (BoQ)',
    desc: 'Pilih grup pekerjaan dulu, lalu isi jumlah dari daftar kebutuhan materialnya.',
  },
  {
    key: 'besi',
    icon: 'git-commit-outline',
    title: 'Pesan Besi Beton',
    desc: 'Pesan besi per diameter dalam batang untuk beberapa grup pekerjaan sekaligus.',
  },
  {
    key: 'umum',
    icon: 'cube-outline',
    title: 'Material Umum / Lainnya',
    desc: 'Cari material bebas dari katalog atau tulis manual.',
  },
];
```

Then inside the component, right after `const [submitting, setSubmitting] = useState(false);` (line 274), add:

```tsx
  const [mode, setMode] = useState<PermintaanMode>('landing');
```

- [ ] **Step 3: Add the mode transitions and the work-group options**

Insert after the `workGroupMap` memo (line 292):

```tsx
  const workGroupOptions = useMemo<SelectOption[]>(() => workGroups.map(group => ({
    value: group.key,
    label: group.label,
    meta: `${group.itemCount} item`,
  })), [workGroups]);
```

Insert after `removeLine` (line 443):

```tsx
  /** Enter a path. Material Umum keeps its one blank starter line; the two
   *  BoQ-first paths start empty and materialize lines as quantities arrive. */
  const enterMode = (next: PermintaanMode) => {
    setLines(next === 'umum' ? [makeLine()] : []);
    setMode(next);
  };

  /** Back to the landing. Unsubmitted input is confirmed away, never dropped
   *  silently (design spec §1). */
  const leaveMode = () => {
    const hasInput = lines.some(line => isPositiveNumber(line.quantity));
    if (!hasInput) {
      setLines([]);
      setMode('landing');
      return;
    }
    Alert.alert(
      'Batalkan permintaan ini?',
      'Jumlah yang sudah diisi akan dihapus.',
      [
        { text: 'Lanjut Isi', style: 'cancel' },
        {
          text: 'Hapus & Kembali',
          style: 'destructive',
          onPress: () => { setLines([]); setMode('landing'); },
        },
      ],
    );
  };
```

- [ ] **Step 4: Replace the raw Picker with SelectSheet**

In the Tier-1 block of the line card (lines 923-948), replace the `<View style={styles.pickerWrap}>…</View>` element with:

```tsx
                      <SelectSheet
                        value={line.workGroupKey ?? ''}
                        options={workGroupOptions}
                        onChange={value => updateLine(line.id, { workGroupKey: value || null })}
                        placeholder="— Pilih grup pekerjaan —"
                        title="Grup Pekerjaan Tujuan"
                        emptyText="Belum ada grup pekerjaan — BoQ proyek ini belum dipublish."
                        accessibilityLabel={`Pilih grup pekerjaan untuk line ${idx + 1}`}
                      />
```

Then delete the now-unused `pickerWrap` style (lines 1431-1436 in the StyleSheet).

- [ ] **Step 5: Render the landing and gate the existing form behind `mode === 'umum'`**

Replace the two header elements at the top of the `ScrollView` (lines 778-781) with:

```tsx
        {mode === 'landing' ? (
          <>
            <Text style={styles.sectionHead}>Gate 1 — Permintaan Material</Text>
            <Text style={styles.fieldHint}>
              Pilih cara pengajuan. Untuk material presisi, mulai dari pekerjaannya agar sisa kebutuhan terlihat.
            </Text>
            {MODE_TILES.map(tile => (
              <TouchableOpacity
                key={tile.key}
                style={styles.modeTile}
                onPress={() => enterMode(tile.key)}
                accessibilityRole="button"
                accessibilityLabel={tile.title}
              >
                <View style={styles.modeTileIcon}>
                  <Ionicons name={tile.icon} size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTileTitle}>{tile.title}</Text>
                  <Text style={styles.modeTileDesc}>{tile.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <TouchableOpacity
            style={styles.backRow}
            onPress={leaveMode}
            accessibilityRole="button"
            accessibilityLabel="Kembali ke pilihan jenis permintaan"
          >
            <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
            <Text style={styles.backText}>
              {MODE_TILES.find(t => t.key === mode)?.title ?? 'Permintaan'}
            </Text>
          </TouchableOpacity>
        )}
```

Then change the line-list guard (line 613) from:

```tsx
  const shouldShowLines = lines.length > 0;
```

to:

```tsx
  // The multi-line catalog form belongs to Material Umum only; the BoQ-first
  // paths render their own inputs and materialize into the same `lines` state.
  const shouldShowLines = mode === 'umum' && lines.length > 0;
```

- [ ] **Step 6: Add the Path 3 Tier-1 banner**

Inside the line card, immediately after the closing `</>`/`)}` of the material selector block and *before* the `{line.tier === 1 && (` block (line 923), insert:

```tsx
                  {mode === 'umum' && !line.isCustom && line.materialId && line.tier === 1 && (
                    <View style={styles.suggestBox}>
                      <Ionicons name="bulb-outline" size={14} color={COLORS.info} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestText}>
                          Material presisi lebih mudah lewat Permintaan Pekerjaan (BoQ) — sisa kebutuhan per grup langsung terlihat.
                        </Text>
                        <TouchableOpacity onPress={() => { leaveMode(); }} accessibilityRole="button">
                          <Text style={styles.suggestLink}>Buka Permintaan Pekerjaan</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
```

- [ ] **Step 7: Reset to the landing after a successful submit**

In `handleSubmit`, replace the reset block (lines 763-765) with:

```tsx
      setLines([]);
      setCommonNote('');
      setUrgency('NORMAL');
      setMode('landing');
```

- [ ] **Step 8: Add the new styles**

Append to the `StyleSheet.create({…})` object (before the closing `});` at line 1776):

```tsx
  modeTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    minHeight: 72,
  },
  modeTileIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS_SM,
    backgroundColor: COLORS.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTileTitle: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  modeTileDesc: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 2,
    lineHeight: 17,
  },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingVertical: SPACE.sm,
    marginTop: SPACE.sm,
  },
  backText: {
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
  },

  suggestBox: {
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'flex-start',
    backgroundColor: COLORS.infoBg,
    borderRadius: RADIUS_SM,
    padding: SPACE.sm,
    marginTop: SPACE.sm,
  },
  suggestText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    lineHeight: 17,
  },
  suggestLink: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.info,
    marginTop: SPACE.xs,
  },
```

- [ ] **Step 9: Type-check and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0. (If it reports `'Picker' is declared but its value is never read` or an unused `pickerWrap`, you missed Step 1 or Step 4.)

Run: `npx jest`
Expected: **0 failing suites**. (Pre-plan baseline: `5 skipped, 123 passed, 128 total`; this task adds no suite of its own, and each already-merged helper task adds one.)

- [ ] **Step 10: Manual check in the app**

Run the app (`npm start`, open the field app, go to Permintaan).
Expected: three tiles; tapping **Material Umum / Lainnya** shows today's form unchanged; picking a Tier-1 catalog material (e.g. `Besi beton ulir 13 mm`) shows the blue suggestion banner AND the work-group field now opens the SelectSheet modal (searchable, two-line labels) instead of the native picker; the back row returns to the landing and asks for confirmation once a quantity has been typed.

- [ ] **Step 11: Commit**

```bash
git add workflows/screens/PermintaanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(permintaan): three-path landing, SelectSheet, Tier-1 suggestion banner

Adds the mode state the BoQ-first paths build on, retires the raw
@react-native-picker Picker in this screen, and suggests Path 1 when a
Tier-1 material is picked in Material Umum (non-blocking).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Path 1 — Permintaan Pekerjaan (group-first)

Pick a grup pekerjaan, then fill quantities against that group's material demand list. Lines materialize into the existing `lines` state, so gates, allocations, reason capture and submit are untouched.

**Files:**
- Create: `workflows/components/OverageReasonPicker.tsx`
- Test: `workflows/screens/components/__tests__/OverageReasonPicker.test.tsx`
- Modify: `workflows/screens/PermintaanScreen.tsx`

**Interfaces:**
- Consumes: `getWorkGroupMaterialEnvelopes`, `WorkGroupMaterialEnvelope` (Task 3); `buildWorkGroupDemand`, `formatSisaLabel`, `DemandRow` (Task 4); `mode` / `enterMode` / `leaveMode` / `workGroupOptions` (Task 6).
- Produces (inside the screen, used by Task 8):
  - `groupEnvCache: Map<string, WorkGroupMaterialEnvelope[]>`, `groupEnvError: string | null`, `groupEnvLoading: boolean`
  - `loadGroupEnvelopes(keys: string[]): Promise<void>`
  - `isUnallocatableTier1(line: RequestLine): boolean`
  - `<OverageReasonPicker reason note onChange title? hint? />` (also used by Mode Besi for its one-picker-per-diameter)

- [ ] **Step 1: Write the failing test for the extracted reason picker**

The reason-capture block is ~65 lines of JSX that Path 1 and Mode Besi both need. Extract it verbatim first, then reuse it. Create `workflows/screens/components/__tests__/OverageReasonPicker.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import OverageReasonPicker from '../../../components/OverageReasonPicker';
import { OVERAGE_REASON_LABELS } from '../../../../tools/requestOverage';

describe('OverageReasonPicker', () => {
  it('reports the tapped reason', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <OverageReasonPicker reason={null} note="" onChange={onChange} />,
    );

    fireEvent.press(getByLabelText(OVERAGE_REASON_LABELS.WASTE));

    expect(onChange).toHaveBeenCalledWith({ overageReason: 'WASTE' });
  });

  it('deselects the active reason on a second tap', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <OverageReasonPicker reason="WASTE" note="" onChange={onChange} />,
    );

    fireEvent.press(getByLabelText(OVERAGE_REASON_LABELS.WASTE));

    expect(onChange).toHaveBeenCalledWith({ overageReason: null });
  });

  it('shows the note field only after a reason is picked, and demands text for Lainnya', () => {
    const { queryByPlaceholderText, rerender, getByText } = render(
      <OverageReasonPicker reason={null} note="" onChange={jest.fn()} />,
    );
    expect(queryByPlaceholderText(/Catatan tambahan/)).toBeNull();

    rerender(<OverageReasonPicker reason="OTHER" note="" onChange={jest.fn()} />);
    expect(getByText("Alasan 'Lainnya' butuh keterangan")).toBeTruthy();
  });

  it('accepts custom heading copy (Mode Besi applies one picker per diameter)', () => {
    const { getByText } = render(
      <OverageReasonPicker
        reason={null}
        note=""
        onChange={jest.fn()}
        title="Alasan kelebihan — Besi ulir 13 mm"
        hint="Berlaku untuk semua grup diameter ini yang melebihi alokasi."
      />,
    );
    expect(getByText('Alasan kelebihan — Besi ulir 13 mm')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest workflows/screens/components/__tests__/OverageReasonPicker.test.tsx`
Expected: FAIL — `Cannot find module '../../../components/OverageReasonPicker'`.

- [ ] **Step 3: Create the component**

Create `workflows/components/OverageReasonPicker.tsx`:

```tsx
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import {
  OVERAGE_REASONS, OVERAGE_REASON_LABELS, requiresOverageNote,
} from '../../tools/requestOverage';
import type { OverageReason } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

interface Props {
  reason: OverageReason | null;
  note: string;
  /** Patch shape matches PermintaanScreen's updateLine, so callers just forward it. */
  onChange: (patch: { overageReason?: OverageReason | null; overageNote?: string }) => void;
  /** Heading — Mode Besi names the diameter its one picker covers. */
  title?: string;
  hint?: string;
}

/**
 * Signal-1 overage reason capture (spec 2026-07-10 §3). Extracted verbatim from
 * PermintaanScreen so the BoQ-first demand list and the Mode Besi matrix reuse
 * the exact same control instead of re-implementing it — the reason is required
 * before submit, so two drifting copies would be a submit-blocking bug class.
 */
export default function OverageReasonPicker({
  reason, note, onChange,
  title = 'Alasan kelebihan alokasi',
  hint = 'Permintaan ini membuat total melebihi rencana. Pilih alasan agar estimator bisa menindaklanjuti.',
}: Props): React.ReactElement {
  const otherNoteMissing = requiresOverageNote(reason, note);

  return (
    <View style={[styles.reasonBox, !reason && styles.reasonBoxMissing]}>
      <Text style={styles.reasonLabel}>
        {title} <Text style={styles.req}>*</Text>
      </Text>
      <Text style={styles.reasonHint}>{hint}</Text>
      <View style={styles.reasonChips}>
        {OVERAGE_REASONS.map(option => {
          const selected = reason === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.reasonChip, selected && styles.reasonChipActive]}
              onPress={() => onChange({ overageReason: selected ? null : option })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={OVERAGE_REASON_LABELS[option]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>
                {OVERAGE_REASON_LABELS[option]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {reason && (
        <>
          {reason === 'OTHER' && (
            <Text style={styles.reasonLabel}>
              Keterangan <Text style={styles.req}>*</Text>
            </Text>
          )}
          <TextInput
            style={[styles.input, styles.reasonNote, otherNoteMissing && styles.reasonNoteMissing]}
            value={note}
            onChangeText={text => onChange({ overageNote: text })}
            placeholder={
              reason === 'OTHER' ? "Jelaskan alasan 'Lainnya'…" : 'Catatan tambahan (opsional)…'
            }
            placeholderTextColor={COLORS.textMuted}
            multiline
          />
          {otherNoteMissing && (
            <Text style={styles.reasonNoteError}>
              Alasan &apos;Lainnya&apos; butuh keterangan
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  req: { color: COLORS.critical },
  reasonBox: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  reasonBoxMissing: { borderColor: COLORS.critical, backgroundColor: COLORS.criticalBg },
  reasonLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text },
  reasonHint: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec,
    marginTop: 2, marginBottom: SPACE.sm, lineHeight: 17,
  },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  reasonChip: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 999,
    paddingHorizontal: SPACE.md - 2, paddingVertical: SPACE.sm - 1,
    backgroundColor: COLORS.surface,
  },
  reasonChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}15` },
  reasonChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  reasonChipTextActive: { color: COLORS.primary },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  reasonNote: { marginTop: SPACE.sm, minHeight: 44, textAlignVertical: 'top' },
  reasonNoteMissing: { borderColor: COLORS.critical },
  reasonNoteError: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical, marginTop: 4,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest workflows/screens/components/__tests__/OverageReasonPicker.test.tsx`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Use the component in the existing Material Umum card**

In `workflows/screens/PermintaanScreen.tsx`, add the import after the `SelectSheet` import:

```tsx
import OverageReasonPicker from '../components/OverageReasonPicker';
```

Then replace the whole `{requiresOverageReason(line.lineResult) && ( … )}` block (lines 1068-1133) with:

```tsx
                  {requiresOverageReason(line.lineResult) && (
                    <OverageReasonPicker
                      reason={line.overageReason}
                      note={line.overageNote}
                      onChange={patch => updateLine(line.id, patch)}
                    />
                  )}
```

Delete the styles that moved into the component: `reasonBox`, `reasonBoxMissing`, `reasonLabel`, `reasonHint`, `reasonChips`, `reasonChip`, `reasonChipActive`, `reasonChipText`, `reasonChipTextActive`, `reasonNote`, `reasonNoteMissing`, `reasonNoteError` (lines 1339-1400). Keep `req` — the screen still uses it on its own field labels.

Also remove the now-unused imports `OVERAGE_REASONS` and `OVERAGE_REASON_LABELS` from the `../../tools/requestOverage` import (keep `requiresOverageReason` and `requiresOverageNote`).

- [ ] **Step 6: Add the group-envelope cache and loader**

Add these imports:

```tsx
import {
  getWorkGroupEnvelope, getMaterialBudget, getMaterialDrift,
  getWorkGroupMaterialEnvelopes, type WorkGroupMaterialEnvelope,
} from '../../tools/envelopes';
import {
  buildWorkGroupDemand, formatSisaLabel,
  type DemandRow, type DemandCatalogMaterial,
} from '../../tools/workGroupDemand';
```

(replacing the existing `getWorkGroupEnvelope, getMaterialBudget, getMaterialDrift` import on line 21).

`MaterialOption` (the screen's own catalog type) is structurally assignable to `DemandCatalogMaterial`, so `materialOptions` passes straight into `buildWorkGroupDemand` — no adapter and no cast anywhere.

Add state after `driftCache` (line 288):

```tsx
  // Path 1 / Mode Besi: all-materials envelope per work group (migration 086).
  const [groupEnvCache, setGroupEnvCache] = useState<Map<string, WorkGroupMaterialEnvelope[]>>(new Map());
  const [groupEnvLoading, setGroupEnvLoading] = useState(false);
  const [groupEnvError, setGroupEnvError] = useState<string | null>(null);
  const [pekerjaanGroupKey, setPekerjaanGroupKey] = useState<string | null>(null);
  const [showTier2Section, setShowTier2Section] = useState(false);
```

Add the loader after `cacheMaterialBudget` (line 402):

```tsx
  /**
   * Warm the all-materials envelope for one or more work groups. A failure is
   * NON-blocking (spec §7): the rows stay unloaded, an INFO banner offers a
   * retry, and the rest of the screen keeps working.
   */
  const loadGroupEnvelopes = useCallback(async (groupKeys: string[]) => {
    if (!project) return;
    const missing = groupKeys.filter(key => !groupEnvCache.has(key) && workGroupMap.has(key));
    if (missing.length === 0) return;

    setGroupEnvLoading(true);
    const results = await Promise.all(missing.map(async key => {
      const group = workGroupMap.get(key)!;
      const { rows, error } = await getWorkGroupMaterialEnvelopes(project.id, group.itemIds);
      return { key, rows, error };
    }));

    setGroupEnvCache(prev => {
      const next = new Map(prev);
      for (const result of results) {
        if (!result.error) next.set(result.key, result.rows);
      }
      return next;
    });
    setGroupEnvError(results.find(r => r.error)?.error ?? null);
    setGroupEnvLoading(false);
  }, [project, workGroupMap, groupEnvCache]);

  // Path 1: load the chosen group's demand as soon as it is picked.
  useEffect(() => {
    if (mode !== 'pekerjaan' || !pekerjaanGroupKey) return;
    void loadGroupEnvelopes([pekerjaanGroupKey]);
  }, [mode, pekerjaanGroupKey, loadGroupEnvelopes]);
```

- [ ] **Step 7: Derive the demand lists, the quantity writer, and the manual-line list**

Add after the `loadGroupEnvelopes` effect:

```tsx
  const pekerjaanDemand = useMemo(() => {
    if (!pekerjaanGroupKey) return null;
    const rows = groupEnvCache.get(pekerjaanGroupKey);
    if (!rows) return null;
    return buildWorkGroupDemand(rows, materialOptions);
  }, [pekerjaanGroupKey, groupEnvCache, materialOptions]);

  /** Deterministic line id per (group, material) so re-renders never churn keys. */
  const demandLineId = (groupKey: string, materialId: string) => `demand:${groupKey}:${materialId}`;

  /**
   * Typing a quantity on a demand row materializes a STANDARD RequestLine —
   * same fields the catalog picker sets (applyCatalogMaterialToLine), with the
   * chosen group preset for Tier 1. Clearing the field removes the line, so an
   * emptied row leaves no trace in the payload. Tier 2+ rows keep workGroupKey
   * null: they burn against the project envelope, not the group.
   */
  const setDemandQuantity = (material: DemandCatalogMaterial, groupKey: string, value: string) => {
    const id = demandLineId(groupKey, material.id);
    setLines(prev => {
      if (!value.trim()) return prev.filter(line => line.id !== id);
      if (prev.some(line => line.id === id)) {
        return prev.map(line => (line.id === id ? { ...line, quantity: value } : line));
      }
      return [...prev, makeLine({
        ...applyCatalogMaterialToLine(material),
        id,
        workGroupKey: material.tier === 1 ? groupKey : null,
        quantity: value,
      })];
    });
  };

  /**
   * A Tier-1 line with a quantity but no allocation cannot be posted: handleSubmit
   * refuses it ("belum punya baseline material"). Surfacing it inline turns a
   * submit-time surprise into a visible state — the guard itself is untouched.
   */
  const isUnallocatableTier1 = (line: RequestLine) =>
    line.tier === 1 && isPositiveNumber(line.quantity) && line.allocationPreview.length === 0;

  /**
   * Lines the multi-line CARD list owns. Demand rows and Mode Besi cells render
   * their own compact controls, so the card list must skip them or Path 1 would
   * show every material twice. Path 1 still needs the card list for "Tambah
   * material lain" / "Tambah Manual" (spec §2), which is why it is not gated on
   * Material Umum alone.
   */
  const manualLines = useMemo(
    () => linesWithResults.filter(
      line => !line.id.startsWith('demand:') && !line.id.startsWith('besi:'),
    ),
    [linesWithResults],
  );
```

Then change the line-list guard added in Task 6 Step 5 from:

```tsx
  const shouldShowLines = mode === 'umum' && lines.length > 0;
```

to:

```tsx
  const shouldShowLines = (mode === 'umum' || mode === 'pekerjaan') && manualLines.length > 0;
```

and change the card map's source (line 789) from `linesWithResults.map((line, idx) => {` to:

```tsx
            {manualLines.map((line, idx) => {
```

Finally wrap the existing "Tambah Material Katalog / Tambah Manual" `addActionRow` block (lines 1138-1156) so it only renders in Material Umum — Path 1 has its own pair at the end of the demand list:

```tsx
            {mode === 'umum' && (
              <View style={styles.addActionRow}>
                {/* …existing two buttons, unchanged… */}
              </View>
            )}
```

- [ ] **Step 8: Preset the chosen group on Tier-1 materials added inside Path 1**

Spec §2 requires a Tier-1 material picked through "Tambah material lain" (or switched to Tier 1 in the manual entry) to inherit the chosen grup pekerjaan. `applyCatalogMaterialToLine` deliberately returns `workGroupKey: null`, so the screen supplies it.

Add this helper next to `setDemandQuantity`:

```tsx
  /** In Path 1 a Tier-1 line belongs to the group the supervisor already chose. */
  const presetGroupFor = (tier: 1 | 2 | 3 | 4): { workGroupKey?: string } =>
    mode === 'pekerjaan' && pekerjaanGroupKey && tier === 1
      ? { workGroupKey: pekerjaanGroupKey }
      : {};
```

Then apply it at the three places a material/tier is chosen:

In `applyMaterialSelection` (line 454):

```tsx
    updateLine(materialPickerLineId, {
      ...applyCatalogMaterialToLine(material),
      ...presetGroupFor(material.tier),
    });
```

In `MaterialNamingAssist`'s `onSelectCatalogMaterial` (line 874):

```tsx
                        onSelectCatalogMaterial={async (material) => {
                          updateLine(line.id, {
                            ...applyCatalogMaterialToLine(material),
                            ...presetGroupFor(material.tier ?? 3),
                          });

                          if (material.tier === 2) {
                            await cacheTier2Context([material.id]);
                          }
                        }}
```

In the manual tier chips (line 902):

```tsx
                              onPress={() => updateLine(line.id, {
                                tier,
                                boqItemId: tier === 1 ? line.boqItemId : null,
                                ...presetGroupFor(tier),
                              })}
```

- [ ] **Step 9: Render Path 1**

Insert this block in the `ScrollView`, immediately after the landing/back-row block from Task 6 Step 5 and before `{shouldShowLines && (`:

```tsx
        {mode === 'pekerjaan' && (
          <>
            <Text style={styles.sectionHead}>1. Grup Pekerjaan</Text>
            <SelectSheet
              value={pekerjaanGroupKey ?? ''}
              options={workGroupOptions}
              onChange={value => { setPekerjaanGroupKey(value || null); setLines([]); }}
              placeholder="— Pilih grup pekerjaan —"
              title="Grup Pekerjaan"
              emptyText="Belum ada grup pekerjaan — BoQ proyek ini belum dipublish."
              accessibilityLabel="Pilih grup pekerjaan"
            />

            {groupEnvError && (
              <View style={styles.softErrorBox}>
                <Ionicons name="cloud-offline-outline" size={14} color={COLORS.info} />
                <Text style={styles.softErrorText}>
                  Data kebutuhan material gagal dimuat ({groupEnvError}).
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setGroupEnvError(null);
                    if (pekerjaanGroupKey) void loadGroupEnvelopes([pekerjaanGroupKey]);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestLink}>Coba lagi</Text>
                </TouchableOpacity>
              </View>
            )}

            {pekerjaanGroupKey && groupEnvLoading && !pekerjaanDemand && (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACE.base }} />
            )}

            {pekerjaanDemand && (
              <>
                <Text style={styles.sectionHead}>
                  2. Kebutuhan Material — {workGroupMap.get(pekerjaanGroupKey!)?.label ?? ''}
                </Text>

                {pekerjaanDemand.tier1.length === 0 && pekerjaanDemand.tier2plus.length === 0 ? (
                  <Card>
                    <Text style={styles.emptyTitle}>Grup ini belum punya rencana material</Text>
                    <Text style={styles.fieldHint}>
                      BoQ grup ini belum terhubung ke material mana pun, jadi tidak ada sisa kebutuhan yang bisa ditampilkan.
                      Material tetap bisa diminta lewat katalog.
                    </Text>
                    <TouchableOpacity
                      style={styles.addSecondaryBtn}
                      onPress={addCatalogLine}
                      accessibilityRole="button"
                    >
                      <Text style={styles.addSecondaryText}>Tambah material lain</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => enterMode('umum')} accessibilityRole="button">
                      <Text style={styles.linkText}>Buka Material Umum / Lainnya</Text>
                    </TouchableOpacity>
                  </Card>
                ) : (
                  <>
                    {pekerjaanDemand.tier1.map(demandRow => renderDemandRow(demandRow))}

                    {pekerjaanDemand.tier2plus.length > 0 && (
                      <>
                        <TouchableOpacity
                          style={styles.sectionToggle}
                          onPress={() => setShowTier2Section(v => !v)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: showTier2Section }}
                        >
                          <Text style={styles.sectionToggleText}>
                            Material terkait (Tier 2+) — {pekerjaanDemand.tier2plus.length} item
                          </Text>
                          <Ionicons
                            name={showTier2Section ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={COLORS.textSec}
                          />
                        </TouchableOpacity>
                        {showTier2Section && (
                          <>
                            <Text style={styles.fieldHint}>
                              Material ini dipantau level proyek, bukan per grup pekerjaan.
                            </Text>
                            {pekerjaanDemand.tier2plus.map(demandRow => renderDemandRow(demandRow))}
                          </>
                        )}
                      </>
                    )}

                    <View style={styles.addActionRow}>
                      <TouchableOpacity
                        style={styles.addLineBtn}
                        onPress={addCatalogLine}
                        accessibilityRole="button"
                      >
                        <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                        <Text style={styles.addLineText}>Tambah material lain</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.addSecondaryBtn}
                        onPress={addCustomLine}
                        accessibilityRole="button"
                      >
                        <Text style={styles.addSecondaryText}>Tambah Manual</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
          </>
        )}
```

- [ ] **Step 10: Add the `renderDemandRow` helper**

Define it inside the component, just above the `return (` statement (line 774):

```tsx
  /** One demand row: sisa, quantity input, and — once filled — the standard
   *  gate result, allocation preview and reason capture for its line. */
  const renderDemandRow = (demandRow: DemandRow) => {
    const groupKey = pekerjaanGroupKey!;
    const id = demandLineId(groupKey, demandRow.materialId);
    const line = linesWithResults.find(l => l.id === id) ?? null;
    const inputUnit = demandRow.material.supplier_unit || demandRow.material.unit;

    return (
      <Card key={id}>
        <Text style={styles.demandName}>{demandRow.material.name}</Text>
        <Text style={styles.demandMeta}>
          Sisa kebutuhan: {formatSisaLabel(demandRow)}
          {demandRow.tier !== 1 ? ' · dipantau level proyek' : ''}
        </Text>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Jumlah ({inputUnit})</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={line?.quantity ?? ''}
              onChangeText={value => setDemandQuantity(demandRow.material, groupKey, value)}
              placeholder="0"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel={`Jumlah ${demandRow.material.name}`}
            />
          </View>
        </View>

        {line?.lineResult && <FlagPanel result={line.lineResult} gateLabel="Gate 1" />}

        {line && isUnallocatableTier1(line) && (
          <Text style={styles.blockingHint}>
            Belum ada baseline material di grup ini, jadi permintaan tidak bisa dialokasikan.
            Ajukan lewat Material Umum / Lainnya.
          </Text>
        )}

        {line && requiresOverageReason(line.lineResult) && (
          <OverageReasonPicker
            reason={line.overageReason}
            note={line.overageNote}
            onChange={patch => updateLine(line.id, patch)}
          />
        )}
      </Card>
    );
  };
```

- [ ] **Step 11: Clear the Path-1 state after submit**

In `handleSubmit`, extend the reset block added in Task 6 Step 7 to:

```tsx
      setLines([]);
      setCommonNote('');
      setUrgency('NORMAL');
      setPekerjaanGroupKey(null);
      setShowTier2Section(false);
      // Envelopes are stale the moment a request lands (spec §7) — drop them so
      // re-entering a path re-fetches instead of showing yesterday's sisa.
      setGroupEnvCache(new Map());
      setMode('landing');
```

- [ ] **Step 12: Add the new styles**

Append to the StyleSheet:

```tsx
  demandName: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  demandMeta: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec,
    marginTop: 2, lineHeight: 17,
  },
  emptyTitle: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  blockingHint: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical,
    marginTop: SPACE.sm, lineHeight: 17,
  },
  sectionToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.sm, paddingVertical: SPACE.md, marginTop: SPACE.sm,
    borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  sectionToggleText: {
    fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  softErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.infoBg, borderRadius: RADIUS_SM,
    padding: SPACE.sm, marginTop: SPACE.sm,
  },
  softErrorText: {
    flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular,
    color: COLORS.textSec, lineHeight: 17,
  },
```

- [ ] **Step 13: Type-check and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

Run: `npx jest`
Expected: **0 failing suites**. (Pre-plan baseline: `5 skipped, 123 passed, 128 total`. Each completed helper task adds one suite, so the exact totals depend on which tasks are already merged — zero failures is the binding assertion.)

- [ ] **Step 14: Manual check in the app**

Run the app, open Permintaan → **Permintaan Pekerjaan (BoQ)**, pick a structural group on a project with a published baseline.
Expected: the Tier-1 demand list appears with a real "Sisa kebutuhan" per material (rebar shown as batang with the kg equivalent); typing a quantity produces the Gate-1 panel and, if it pushes past 100%, the reason picker; the "Material terkait (Tier 2+)" section expands and is labelled "dipantau level proyek"; the Detail Permintaan card appears once a quantity exists; submitting posts and returns to the landing.

- [ ] **Step 15: Commit**

```bash
git add workflows/components/OverageReasonPicker.tsx \
        workflows/screens/components/__tests__/OverageReasonPicker.test.tsx \
        workflows/screens/PermintaanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(permintaan): group-first BoQ request path

Pick a grup pekerjaan, fill quantities against its real demand list.
Lines materialize into the existing lines state, so gates, allocations and
submit are untouched. Extracts OverageReasonPicker for reuse.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Mode Besi — scope, matrix, per-group split

**Files:**
- Modify: `workflows/screens/PermintaanScreen.tsx`

**Interfaces:**
- Consumes: everything Task 5 exports from `tools/rebarMatrix.ts`; `loadGroupEnvelopes` / `groupEnvCache` / `isUnallocatableTier1` / `OverageReasonPicker` from Task 7; `enterMode` / `leaveMode` from Task 6.
- Produces: nothing other tasks consume.

**Deliberate fold:** the spec describes three steps (scope → matrix → review split). This implements **two screens** (`besiStep: 'scope' | 'matrix'`) with the per-diameter split rendered inline underneath each filled diameter. Same content, same numbers, one fewer navigation hop — the split has to sit next to the total it divides for the "the user owns the numbers" rule to read.

- [ ] **Step 1: Add the imports**

```tsx
import {
  isRebarCode, buildRebarCells, groupsWithRebarDemand, groupRebarSisaBatang,
  buildMatrixRows, splitBasisFor, defaultSplit, expandRebarMatrix,
  type RebarMaterial, type RebarGroupEnvelope, type RebarMatrixRow,
} from '../../tools/rebarMatrix';
```

- [ ] **Step 2: Add Mode Besi state**

After `showTier2Section` (Task 7 Step 6):

```tsx
  const [besiStep, setBesiStep] = useState<'scope' | 'matrix'>('scope');
  const [besiScope, setBesiScope] = useState<Set<string>>(new Set());
  const [besiScopeReady, setBesiScopeReady] = useState(false);
  const [besiShowOther, setBesiShowOther] = useState(false);
  /** materialId → total batang typed by the supervisor. */
  const [besiTotal, setBesiTotal] = useState<Record<string, string>>({});
  /** materialId → groupKey → batang. The single source the lines derive from. */
  const [besiSplit, setBesiSplit] = useState<Record<string, Record<string, string>>>({});
  /** materialId → one reason applied to every over-alokasi line of that diameter. */
  const [besiReason, setBesiReason] = useState<Record<string, { reason: OverageReason | null; note: string }>>({});
```

- [ ] **Step 3: Derive the rebar catalogue, cells and matrix**

Insert after `pekerjaanDemand` (Task 7 Step 7):

```tsx
  const materialById = useMemo(
    () => new Map(materialOptions.map(m => [m.id, m])),
    [materialOptions],
  );

  /** Rebar bars come from the CATALOG (code LIKE 'REB-%'), never a hardcoded list. */
  const rebarMaterials = useMemo<RebarMaterial[]>(() => materialOptions
    .filter(m => isRebarCode(m.code))
    .map(m => ({
      id: m.id,
      code: m.code ?? '',
      name: m.name,
      unit: m.unit,
      supplierUnit: m.supplier_unit || 'batang',
      kgPerBatang: m.base_qty_per_supplier_unit,
    })), [materialOptions]);

  // Mode Besi needs every group's envelope to know which have rebar demand.
  useEffect(() => {
    if (mode !== 'besi') return;
    void loadGroupEnvelopes(workGroups.map(group => group.key));
  }, [mode, workGroups, loadGroupEnvelopes]);

  const rebarGroupEnvelopes = useMemo<RebarGroupEnvelope[]>(() => workGroups
    .filter(group => groupEnvCache.has(group.key))
    .map(group => ({
      groupKey: group.key,
      groupLabel: group.label,
      rows: groupEnvCache.get(group.key)!,
    })), [workGroups, groupEnvCache]);

  const rebarCells = useMemo(
    () => buildRebarCells(rebarMaterials, rebarGroupEnvelopes),
    [rebarMaterials, rebarGroupEnvelopes],
  );

  const rebarDemandGroupKeys = useMemo(() => groupsWithRebarDemand(rebarCells), [rebarCells]);

  // Default scope = every group with rebar demand, selected (spec §3 step 1).
  // Seeded once per entry into Mode Besi so the user's edits are never overwritten.
  useEffect(() => {
    if (mode !== 'besi' || besiScopeReady || rebarDemandGroupKeys.length === 0) return;
    setBesiScope(new Set(rebarDemandGroupKeys));
    setBesiScopeReady(true);
  }, [mode, besiScopeReady, rebarDemandGroupKeys]);

  const besiScopeKeys = useMemo(
    () => rebarDemandGroupKeys.filter(key => besiScope.has(key)),
    [rebarDemandGroupKeys, besiScope],
  );

  const besiMatrixRows = useMemo(
    () => buildMatrixRows(rebarMaterials, rebarCells, besiScopeKeys),
    [rebarMaterials, rebarCells, besiScopeKeys],
  );
```

- [ ] **Step 4: Derive the lines from the split state**

Insert right after the memos above:

```tsx
  /**
   * Mode Besi's lines are DERIVED state: the matrix owns the numbers, this
   * effect projects them onto the same `lines` array every other path uses.
   * Ids are deterministic so React keys, caches and gate results survive a
   * keystroke. The per-diameter reason rides along onto each of its lines,
   * which is how "one picker per diameter, stored per line" is satisfied.
   */
  useEffect(() => {
    if (mode !== 'besi') return;
    const drafts = expandRebarMatrix(
      Object.entries(besiSplit).map(([materialId, byGroup]) => ({
        materialId,
        splits: Object.entries(byGroup).map(([groupKey, raw]) => ({
          groupKey,
          batang: Number.parseInt(raw, 10) || 0,
        })),
      })),
    );

    setLines(drafts.flatMap(draft => {
      const material = materialById.get(draft.materialId);
      if (!material) return [];
      const captured = besiReason[draft.materialId];
      return [makeLine({
        ...applyCatalogMaterialToLine(material),
        id: `besi:${draft.materialId}:${draft.workGroupKey}`,
        workGroupKey: draft.workGroupKey,
        quantity: String(draft.quantityBatang),
        overageReason: captured?.reason ?? null,
        overageNote: captured?.note ?? '',
      })];
    }));
  }, [mode, besiSplit, besiReason, materialById]);

  /** Diameters with at least one line projected over 100% — each gets one picker. */
  const besiOverMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of linesWithResults) {
      if (line.materialId && requiresOverageReason(line.lineResult)) ids.add(line.materialId);
    }
    return ids;
  }, [linesWithResults]);

  /**
   * Changing the scope invalidates every split already seeded from it — a
   * de-scoped group would otherwise keep its batang and still expand into a
   * line. Clearing the matrix inputs on toggle keeps `besiSplit` unable to hold
   * a group that is not in scope, which is what makes the derive effect below
   * safe without a second filter.
   */
  const toggleBesiScope = (groupKey: string) => {
    setBesiScope(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
    setBesiTotal({});
    setBesiSplit({});
    setBesiReason({});
  };

  /** Typing a total seeds the default split; the user can then edit any group. */
  const setBesiTotalFor = (materialId: string, value: string) => {
    setBesiTotal(prev => ({ ...prev, [materialId]: value }));
    const total = Number.parseInt(value, 10);
    if (!Number.isFinite(total) || total <= 0) {
      setBesiSplit(prev => ({ ...prev, [materialId]: {} }));
      return;
    }
    const basis = splitBasisFor(rebarCells, materialId, besiScopeKeys);
    const split = defaultSplit(total, basis);
    setBesiSplit(prev => ({
      ...prev,
      // No baseline anywhere in scope → no honest proportion; start every group
      // empty and let the supervisor assign (spec §3 step 3).
      [materialId]: Object.fromEntries(
        (split ?? basis.map(b => ({ groupKey: b.groupKey, batang: 0 })))
          .map(entry => [entry.groupKey, split ? String(entry.batang) : '']),
      ),
    }));
  };

  const setBesiSplitFor = (materialId: string, groupKey: string, value: string) => {
    setBesiSplit(prev => ({
      ...prev,
      [materialId]: { ...(prev[materialId] ?? {}), [groupKey]: value },
    }));
  };

  const besiSplitTotal = (materialId: string) =>
    Object.values(besiSplit[materialId] ?? {})
      .reduce((sum, raw) => sum + (Number.parseInt(raw, 10) || 0), 0);
```

- [ ] **Step 5: Render Mode Besi**

Insert after the Path 1 block from Task 7 Step 9:

```tsx
        {mode === 'besi' && (
          <>
            {groupEnvError && (
              <View style={styles.softErrorBox}>
                <Ionicons name="cloud-offline-outline" size={14} color={COLORS.info} />
                <Text style={styles.softErrorText}>
                  Data kebutuhan besi gagal dimuat ({groupEnvError}).
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setGroupEnvError(null);
                    void loadGroupEnvelopes(workGroups.map(group => group.key));
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestLink}>Coba lagi</Text>
                </TouchableOpacity>
              </View>
            )}

            {groupEnvLoading && rebarDemandGroupKeys.length === 0 && (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACE.base }} />
            )}

            {!groupEnvLoading && rebarDemandGroupKeys.length === 0 ? (
              <Card>
                <Text style={styles.emptyTitle}>Belum ada rencana besi beton</Text>
                <Text style={styles.fieldHint}>
                  Tidak ada grup pekerjaan dengan rencana besi beton di proyek ini, jadi tidak ada baseline yang bisa dipakai.
                  Besi tetap bisa diminta lewat Material Umum / Lainnya.
                </Text>
                <TouchableOpacity onPress={() => enterMode('umum')} accessibilityRole="button">
                  <Text style={styles.linkText}>Buka Material Umum / Lainnya</Text>
                </TouchableOpacity>
              </Card>
            ) : besiStep === 'scope' ? (
              <>
                <Text style={styles.sectionHead}>1. Lingkup Grup Pekerjaan</Text>
                <Text style={styles.fieldHint}>
                  Semua grup dengan rencana besi dipilih otomatis. Hapus centang grup yang tidak ikut dipesan.
                </Text>
                {rebarDemandGroupKeys.map(groupKey => {
                  const group = workGroupMap.get(groupKey);
                  if (!group) return null;
                  const checked = besiScope.has(groupKey);
                  return (
                    <TouchableOpacity
                      key={groupKey}
                      style={styles.scopeRow}
                      onPress={() => toggleBesiScope(groupKey)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={group.label}
                    >
                      <View style={[styles.scopeBox, checked && styles.scopeBoxOn]}>
                        {checked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                      </View>
                      <Text style={styles.scopeLabel}>{group.label}</Text>
                      <Text style={styles.scopeMeta}>
                        sisa {groupRebarSisaBatang(rebarMaterials, rebarCells, groupKey).toLocaleString('id-ID')} batang
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[styles.submitBtn, besiScopeKeys.length === 0 && styles.submitBtnDisabled]}
                  onPress={() => setBesiStep('matrix')}
                  disabled={besiScopeKeys.length === 0}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: besiScopeKeys.length === 0 }}
                >
                  <Text style={styles.submitBtnText}>
                    Lanjut — {besiScopeKeys.length} grup
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.backRow}
                  onPress={() => setBesiStep('scope')}
                  accessibilityRole="button"
                  accessibilityLabel="Ubah lingkup grup pekerjaan"
                >
                  <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                  <Text style={styles.backText}>Ubah lingkup ({besiScopeKeys.length} grup)</Text>
                </TouchableOpacity>

                <Text style={styles.sectionHead}>2. Jumlah per Diameter</Text>
                {besiMatrixRows.filter(row => row.hasBaseline).map(row => renderBesiRow(row))}

                {besiMatrixRows.some(row => !row.hasBaseline) && (
                  <>
                    <TouchableOpacity
                      style={styles.sectionToggle}
                      onPress={() => setBesiShowOther(v => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: besiShowOther }}
                    >
                      <Text style={styles.sectionToggleText}>
                        Diameter lain — {besiMatrixRows.filter(r => !r.hasBaseline).length} item
                      </Text>
                      <Ionicons
                        name={besiShowOther ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={COLORS.textSec}
                      />
                    </TouchableOpacity>
                    {besiShowOther && besiMatrixRows.filter(row => !row.hasBaseline).map(row => renderBesiRow(row))}
                  </>
                )}
              </>
            )}
          </>
        )}
```

- [ ] **Step 6: Add the `renderBesiRow` helper**

Define it next to `renderDemandRow`, above the `return (`:

```tsx
  /** One diameter: aggregate sisa, the batang total, and its per-group split. */
  const renderBesiRow = (row: RebarMatrixRow) => {
    const materialId = row.material.id;
    const splitByGroup = besiSplit[materialId] ?? {};
    const typedTotal = Number.parseInt(besiTotal[materialId] ?? '', 10) || 0;
    const dividedTotal = besiSplitTotal(materialId);
    const captured = besiReason[materialId] ?? { reason: null, note: '' };

    return (
      <Card key={materialId}>
        <View style={styles.lineHeader}>
          <Text style={styles.demandName}>{row.material.name}</Text>
          {!row.hasBaseline && (
            <View style={styles.noBaselinePill}>
              <Text style={styles.noBaselineText}>tanpa baseline</Text>
            </View>
          )}
        </View>
        <Text style={styles.demandMeta}>
          {row.hasBaseline
            ? `Sisa kebutuhan: ${row.remainingBatang.toLocaleString('id-ID')} batang (≈ ${Math.round(row.remainingBase).toLocaleString('id-ID')} ${row.material.unit})`
            : 'Grup terpilih belum punya rencana untuk diameter ini.'}
        </Text>

        <Text style={styles.fieldLabel}>Jumlah (batang)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={besiTotal[materialId] ?? ''}
          onChangeText={value => setBesiTotalFor(materialId, value)}
          placeholder="0"
          placeholderTextColor={COLORS.textMuted}
          accessibilityLabel={`Jumlah batang ${row.material.name}`}
        />

        {typedTotal > 0 && (
          <>
            <Text style={styles.fieldLabel}>Pembagian per grup (batang)</Text>
            {besiScopeKeys.map(groupKey => {
              const group = workGroupMap.get(groupKey);
              if (!group) return null;
              const line = linesWithResults.find(l => l.id === `besi:${materialId}:${groupKey}`) ?? null;
              return (
                <View key={groupKey} style={styles.splitRow}>
                  <Text style={styles.splitLabel}>{group.label}</Text>
                  <TextInput
                    style={[styles.input, styles.splitInput]}
                    keyboardType="number-pad"
                    value={splitByGroup[groupKey] ?? ''}
                    onChangeText={value => setBesiSplitFor(materialId, groupKey, value)}
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    accessibilityLabel={`Jumlah ${row.material.name} untuk ${group.label}`}
                  />
                  {line?.lineResult && <FlagPanel result={line.lineResult} gateLabel="Gate 1" />}
                  {line && isUnallocatableTier1(line) && (
                    <Text style={styles.blockingHint}>
                      Grup ini belum punya baseline untuk diameter ini — kosongkan atau pesan lewat Material Umum.
                    </Text>
                  )}
                </View>
              );
            })}
            <Text style={[styles.fieldHint, dividedTotal !== typedTotal && styles.fieldHintWarn]}>
              Total dibagi: {dividedTotal.toLocaleString('id-ID')} batang dari {typedTotal.toLocaleString('id-ID')} batang yang diisi.
            </Text>
          </>
        )}

        {besiOverMaterialIds.has(materialId) && (
          <OverageReasonPicker
            reason={captured.reason}
            note={captured.note}
            onChange={patch => setBesiReason(prev => ({
              ...prev,
              [materialId]: {
                reason: patch.overageReason !== undefined ? patch.overageReason : captured.reason,
                note: patch.overageNote !== undefined ? patch.overageNote : captured.note,
              },
            }))}
            title={`Alasan kelebihan — ${row.material.name}`}
            hint="Berlaku untuk semua grup diameter ini yang melebihi alokasi."
          />
        )}
      </Card>
    );
  };
```

- [ ] **Step 7: Reset Mode Besi state on submit and on mode change**

Extend `handleSubmit`'s reset block to:

```tsx
      setLines([]);
      setCommonNote('');
      setUrgency('NORMAL');
      setPekerjaanGroupKey(null);
      setShowTier2Section(false);
      setBesiStep('scope');
      setBesiScope(new Set());
      setBesiScopeReady(false);
      setBesiShowOther(false);
      setBesiTotal({});
      setBesiSplit({});
      setBesiReason({});
      // Envelopes are stale the moment a request lands (spec §7) — drop them so
      // re-entering a path re-fetches instead of showing yesterday's sisa.
      setGroupEnvCache(new Map());
      setMode('landing');
```

And in `enterMode` (Task 6 Step 3), reset the same Mode Besi state so re-entry always re-derives the scope:

```tsx
  const enterMode = (next: PermintaanMode) => {
    setLines(next === 'umum' ? [makeLine()] : []);
    setPekerjaanGroupKey(null);
    setShowTier2Section(false);
    setBesiStep('scope');
    setBesiScope(new Set());
    setBesiScopeReady(false);
    setBesiShowOther(false);
    setBesiTotal({});
    setBesiSplit({});
    setBesiReason({});
    setGroupEnvError(null);
    setMode(next);
  };
```

- [ ] **Step 8: Add the new styles**

Append to the StyleSheet:

```tsx
  scopeRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md,
    marginTop: SPACE.sm, minHeight: 52,
  },
  scopeBox: {
    width: 20, height: 20, borderRadius: RADIUS_SM - 1, borderWidth: 2,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  scopeBoxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scopeLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  scopeMeta: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },

  noBaselinePill: {
    paddingHorizontal: SPACE.sm, paddingVertical: 3,
    borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg,
  },
  noBaselineText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },

  splitRow: { marginTop: SPACE.sm, gap: SPACE.xs },
  splitLabel: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  splitInput: { paddingVertical: SPACE.sm + 1 },
  fieldHintWarn: { color: COLORS.warning },
```

- [ ] **Step 9: Type-check and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

Run: `npx jest`
Expected: **0 failing suites** (see Task 9 Step 3 for the final expected totals).

- [ ] **Step 10: Manual check in the app**

Run the app, Permintaan → **Pesan Besi Beton** on a project with rebar demand in several groups.
Expected: the scope list shows every group with rebar demand pre-checked with its batang sisa; "Lanjut" opens the matrix sorted ulir-then-polos by ascending diameter; typing a total seeds a per-group split whose parts sum exactly to the total; editing one group changes only "Total dibagi"; a group set to 0 drops its line from the count in the Detail Permintaan card; pushing a diameter past 100% shows one reason picker for that diameter and blocks submit until it is filled; the collapsed "Diameter lain" section shows "tanpa baseline".

- [ ] **Step 11: Commit**

```bash
git add workflows/screens/PermintaanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(permintaan): Mode Besi bulk rebar matrix

Multi-select scope defaulting to every group with rebar demand, per-diameter
batang input with an editable largest-remainder split, and expansion to one
standard request line per diameter x group.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Regression pass and QA sign-off

**Files:**
- Modify: none expected. Any file touched here is a fix found by the checks below.

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: a green suite and a completed manual QA pass.

- [ ] **Step 1: Confirm the write path is untouched**

Run: `git diff --stat ca90cd2..HEAD -- tools/submitMaterialRequest.ts tools/requestOverage.ts workflows/gates/gate1.ts office/screens/ApprovalsScreen.tsx supabase/migrations/073_submit_material_request_rpc.sql supabase/migrations/069_soft_request_gate.sql`
Expected: no output. Any file listed here means the write path moved — revert that change; the spec forbids it.

- [ ] **Step 2: Confirm the pre-existing test suites still pass unchanged**

Run: `npx jest tools/__tests__/submitMaterialRequest.test.ts tools/__tests__/requestOverage.test.ts tools/__tests__/budgetGate.test.ts workflows/gates/__tests__`
Expected: PASS, with the same test counts as before this plan started (these files must not have been edited — `git diff ca90cd2..HEAD -- tools/__tests__/submitMaterialRequest.test.ts tools/__tests__/requestOverage.test.ts` should print nothing).

- [ ] **Step 3: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 5 skipped, 128 passed, 133 total` and `Tests: 36 skipped, 1209 passed, 1245 total`.

The arithmetic, so a mismatch is diagnosable rather than hand-waved: baseline `123 passed suites / 1163 passed tests`, plus five new suites (`migration086` +7 tests, `workGroupMaterialEnvelopes` +5, `workGroupDemand` +9, `rebarMatrix` +19, `OverageReasonPicker` +4) and +2 tests inside the existing `rebarBatang` suite = 128 suites / 1209 tests. **Zero failures is the binding assertion** — if the counts differ, find out which suite changed before moving on.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 5: Confirm no hardcoded colours slipped into the screen**

Run: `grep -nE "#[0-9a-fA-F]{3,8}|rgba\(" workflows/screens/PermintaanScreen.tsx workflows/components/OverageReasonPicker.tsx`
Expected: only the pre-existing `modalBackdrop: { backgroundColor: 'rgba(20,18,16,0.38)' }` line in `PermintaanScreen.tsx`. Any other hit is a token violation — replace it with a `COLORS.*` value.

- [ ] **Step 6: Manual QA — spec §7 edge cases**

Work through this checklist in the running app. Every line must be observed, not assumed.

- [ ] **No published baseline.** Open a project with no published BoQ → Permintaan → Permintaan Pekerjaan. The grup picker shows "Belum ada grup pekerjaan — BoQ proyek ini belum dipublish."; Pesan Besi Beton shows "Belum ada rencana besi beton" with a working link to Material Umum. No crash, no spinner that never ends.
- [ ] **Group with no material demand.** Pick a finish-work group (e.g. Pengecatan) whose BoQ rows have no material links → the empty state "Grup ini belum punya rencana material" appears with both escape hatches ("Tambah material lain", "Buka Material Umum / Lainnya"), and "Tambah material lain" really opens the catalog picker.
- [ ] **Simplified "SANO Input" project** (BoQ codes `T1-…`). Both new paths list one group per `T1-NNN` row with its exact label, and quantities submit normally.
- [ ] **Stale caches after submit.** Submit from Path 1, then re-enter the same group → the sisa figure has dropped by the submitted quantity (the cache was cleared and re-fetched), not the pre-submit number.
- [ ] **Offline / failed RPC.** Turn off networking, enter Pesan Besi Beton → the blue "gagal dimuat" banner appears with a working "Coba lagi"; the rest of the screen still responds. Restore networking and retry → data loads.
- [ ] **Rebar catalogue drift.** In the Mode Besi matrix, exactly the catalogue's rebar rows appear (10 as of Task 1) — no `REB-PL10` / `REB-PL12` ghosts.
- [ ] **Split sums exactly.** Enter an awkward total (e.g. 37 batang across 3 groups) → the per-group parts sum to exactly 37 in "Total dibagi".
- [ ] **Manual split with no baseline.** Expand "Diameter lain", type a total → every group input starts empty (no fabricated proportion), and the inline "belum punya baseline" note explains why those groups cannot be submitted.
- [ ] **Overage reason.** Push one diameter past 100% of its group plan → exactly one reason picker for that diameter; submit stays disabled with "Lengkapi Alasan Kelebihan" until it is picked; picking "Lainnya" additionally demands the free-text note.
- [ ] **Submitted request is intact in the office app.** Open ApprovalsScreen for the request just submitted from Mode Besi → one line per (diameter × group) with the correct `work_group_label`, base-unit (kg) quantity, WORKGROUP_ENVELOPE allocations, and the overage reason on every over line.
- [ ] **Material Umum unchanged.** Path 3 behaves exactly as before apart from the new suggestion banner and the SelectSheet grup picker: multi-line add, manual entry with `MaterialNamingAssist`, tier chips, submit.

- [ ] **Step 7: Commit any fixes found**

If Steps 1-6 required changes:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(permintaan): regression pass on the BoQ-first flow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

If nothing needed fixing, skip this step — there is nothing to commit.

---

## Self-review record

**Spec coverage.** §1 entry point → Task 6. §2 Path 1 (group picker, Tier-1 list, Tier 2+ section, "Tambah material lain", custom entry) → Tasks 4 + 7. §3 Mode Besi (scope, matrix, split, expansion, one reason per diameter) → Tasks 5 + 8. §4 Path 3 banner → Task 6. §5 what does not change → Global Constraints + Task 9 Step 1. §6 the RPC + its verification query → Task 2 (+ Task 3's wrapper). §7 error/edge cases → Task 7 Step 9 (empty + soft error), Task 8 Step 5 (empty + soft error), Task 7 Step 11 / Task 8 Step 7 (cache invalidation), Task 1 (catalogue drift), Task 9 Step 6 (all of them verified). §8 testing → Tasks 4, 5 (pure modules), Task 2 (RPC verification), Task 9 Step 2 (existing suites untouched). §9 out of scope → not implemented anywhere.

**Deliberate deviations from the spec, and why.**
1. *Rebar reconciliation direction.* The spec says "reconcile"; Task 1 **removes** `REB-PL10` / `REB-PL12` from `tools/rebarBatang.ts` rather than adding them to the CSV, because the strict-50 rebuild (§5 P2 step 5) deleted those rows from the live catalogue. Adding them back to the CSV would resurrect materials that no longer exist in any project.
2. *Mode Besi steps 2 and 3 are one screen.* The per-diameter split renders inline under the total it divides instead of on a separate review page. Same content and numbers; keeping them adjacent is what makes "the user owns the numbers" legible.
3. *`OverageReasonPicker` extraction.* Not named in the spec, but the reason block is required in three places after this change; three copies of a submit-blocking control is a bug class, so it is extracted verbatim in Task 7.
4. *Inline "cannot be allocated" note.* `handleSubmit` already blocks a Tier-1 line with no allocations. The spec wants such a material fillable with its natural INFO flag; both hold, and the note makes the existing block visible before submit instead of only as a toast. The guard and the write path are untouched.

**Two invariants the reviewer should check explicitly** (both found while reviewing this plan against the real screen, both already encoded in the steps):
- *Derived lines never double-render.* Path 1 and Mode Besi materialize lines with `demand:` / `besi:` id prefixes; the multi-line card list renders `manualLines` (everything without those prefixes). Break that filter and Path 1 shows every material twice (Task 7 Step 7).
- *`besiSplit` can only ever hold in-scope groups.* Toggling the scope clears the matrix inputs (Task 8 Step 4 `toggleBesiScope`). Without that, a de-scoped group keeps its batang and still expands into a submitted line.

**Open risks.**
- **`ordered` is 0 for older data.** The RPC's PO leg depends on `purchase_order_lines.request_line_id`, unpopulated before Task 2.8. Until admins link POs, `ordered + requested` is carried entirely by `requested` — identical totals, so `sisa` is unaffected; only the *split* between the two columns is conservative. Documented in the migration header, inherited from 069.
- **RLS visibility of other users' allocations.** The new RPC is `SECURITY INVOKER`, exactly like `get_workgroup_envelope`. If a supervisor's RLS hides another user's request allocations, both functions under-report identically — the verification query would still pass. Changing that is out of scope and would require a policy review.
- **Latest-master tiebreaker.** The new RPC adds 054's `id DESC`; 039/041 do not have it. The two can only disagree when a project has two `project_material_master` headers with the same `created_at` second. Called out in the migration's verification note.
- **Many small RPC calls on entry to Mode Besi.** One call per work group, parallelized. Fine at the spec's "< 20 groups"; a project with a very large classifier output would want a batched variant. Not built (YAGNI) — revisit only if a real project shows the latency.
