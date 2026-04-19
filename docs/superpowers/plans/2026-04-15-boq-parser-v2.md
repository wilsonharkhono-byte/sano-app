# BoQ Parser v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel v2 BoQ parser (`tools/boqParserV2/`) and publish pipeline (`tools/publishBaselineV2.ts`) that trust Excel's cached `.v` values and correctly follow nested AHS price chains, rebar F/G/H cost splits, and hardcoded literals — without touching the existing v1 parser.

**Architecture:** Two-pass parser. Pass 1 harvests every cell's `.f` and `.v` into a flat array + lookup map. Pass 2 classifies AHS blocks, components, and BoQ rows via a regex table on formula text, trusting cached values directly. Publish flattens nested AHS edges depth-first into the existing `ahs_lines` shape. v1 code is never modified. A per-session `parser_version` column picks which path runs. All schema changes are additive and nullable.

**Tech Stack:** TypeScript, React Native (Expo), Supabase (Postgres + RLS), `exceljs` v4.4.0, Jest + ts-jest.

**Spec reference:** `docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md`

---

## File Structure

### Files to create
| Path | Responsibility |
|---|---|
| `supabase/migrations/029_boq_parser_v2.sql` | Additive schema migration |
| `tools/boqParserV2/types.ts` | v2-only types (HarvestedCell, CostBasis, RefCells, CostSplit, StagingRowV2) |
| `tools/boqParserV2/harvest.ts` | Pass 1 — read exceljs Workbook → flat cell array + lookup map |
| `tools/boqParserV2/extractCatalog.ts` | Pass 2a — Material/Upah sheet → material staging rows |
| `tools/boqParserV2/detectBlocks.ts` | Pass 2b — AHS block boundary detection in Analisa |
| `tools/boqParserV2/classifyComponent.ts` | Pass 2c — parse formula text into CostBasis + RefCells |
| `tools/boqParserV2/extractTakeoffs.ts` | Pass 2d — RAB sheet → BoQ rows + BoQ→AHS links |
| `tools/boqParserV2/validate.ts` | Pass 2e — block balance check + validation_report builder |
| `tools/boqParserV2/index.ts` | `parseBoqV2()` orchestrator (top-level entry point) |
| `tools/boqParserV2/__tests__/fixtures.ts` | Programmatically builds tiny test workbooks via exceljs |
| `tools/boqParserV2/__tests__/harvest.test.ts` | Tests for Pass 1 |
| `tools/boqParserV2/__tests__/classifyComponent.test.ts` | Tests for Pass 2c (each of 5 patterns) |
| `tools/boqParserV2/__tests__/detectBlocks.test.ts` | Tests for Pass 2b |
| `tools/boqParserV2/__tests__/validate.test.ts` | Tests for Pass 2e |
| `tools/boqParserV2/__tests__/parseBoqV2.test.ts` | End-to-end orchestrator test |
| `tools/publishBaselineV2.ts` | v2 publish with depth-first flattening |
| `tools/__tests__/publishBaselineV2.test.ts` | Flattener tests |
| `tools/materialMatch.ts` | Pure fuzzy scorer — normalized Levenshtein + token-set |
| `tools/__tests__/materialMatch.test.ts` | Scorer tests |

### Files to modify
| Path | Change |
|---|---|
| `tools/types.ts` | Add v2 type exports so other files can import them |
| `tools/auditPivot.ts` | Extend `AuditAhsRow`, add `validationStatus` to `AhsBlockView`, add v2 fuzzy branch in `pivotByMaterial` |
| `tools/baseline.ts` | Dispatcher: in `parseAndStageWorkbook` + `publishBaseline`, branch on `import_sessions.parser_version` |
| `workflows/screens/AuditTraceScreen.tsx` | v2-only: trace chip, inline edit panel anchored under tapped card, fuzzy material picker, validation badges, undo button |
| `workflows/screens/BaselineScreen.tsx` | Parser version toggle (principal/admin only) |

### Files to leave untouched
- `tools/baseline.ts` v1 parser path (`convertToStagingRows`, `applyBoqGrouping`, etc.)
- `tools/excelParser.ts`
- Any existing test file

---

## Testing Strategy

- **Unit tests:** Jest + ts-jest (`npm test`). Co-located under `__tests__/` per existing convention in `tools/__tests__/`.
- **Test fixtures:** Programmatically generate tiny XLSX buffers inside tests via `exceljs` — no binary fixtures checked in. Each fixture embeds exactly the formula pattern being tested.
- **Integration verification:** After Phase 2 implementation, add a hidden dev-only dry-run route (Task 29) that runs `parseBoqV2()` against a user-picked real workbook and dumps the staging array as JSON. This is the manual smoke test against the Pakuwon Indah AAL-5 file before any UI work.
- **UI tests:** Pure state logic extracted into hooks with unit tests where possible; actual rendering manually verified in `npm start` dev server.

---

## Phase 0: Database Migration

### Task 1: Create and verify migration 029

**Files:**
- Create: `supabase/migrations/029_boq_parser_v2.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 029_boq_parser_v2.sql
-- Additive schema for BoQ Parser v2. All columns nullable or safely defaulted
-- so the existing v1 path is unaffected. See spec:
-- docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md

-- 1. import_sessions: parser version + validation report + edit lock
ALTER TABLE import_sessions
  ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS validation_report jsonb NULL,
  ADD COLUMN IF NOT EXISTS locked_by uuid NULL REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz NULL;

-- 2. import_staging_rows: v2 classification columns
ALTER TABLE import_staging_rows
  ADD COLUMN IF NOT EXISTS cost_basis text NULL,
  ADD COLUMN IF NOT EXISTS parent_ahs_staging_id uuid NULL
    REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ref_cells jsonb NULL,
  ADD COLUMN IF NOT EXISTS cost_split jsonb NULL;

-- 3. Extend row_type check constraint to accept 'ahs_block'
ALTER TABLE import_staging_rows
  DROP CONSTRAINT IF EXISTS import_staging_rows_row_type_check;
ALTER TABLE import_staging_rows
  ADD CONSTRAINT import_staging_rows_row_type_check
    CHECK (row_type IN ('boq', 'ahs', 'ahs_block', 'material', 'spec', 'price'));

-- 4. Edit history table
CREATE TABLE IF NOT EXISTS import_staging_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_row_id uuid REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  import_session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  edited_by uuid REFERENCES profiles(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  field_path text NOT NULL,
  old_value jsonb,
  new_value jsonb
);
CREATE INDEX IF NOT EXISTS idx_staging_edits_session
  ON import_staging_edits(import_session_id);

ALTER TABLE import_staging_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staging_edits_assigned" ON import_staging_edits;
CREATE POLICY "staging_edits_assigned" ON import_staging_edits
  FOR ALL USING (
    import_session_id IN (
      SELECT id FROM import_sessions
      WHERE project_id IN (
        SELECT project_id FROM project_assignments
        WHERE user_id = auth.uid()
      )
    )
  );

-- 5. ahs_lines: breadcrumb for nested-unfold origin
ALTER TABLE ahs_lines
  ADD COLUMN IF NOT EXISTS origin_parent_ahs_id uuid NULL;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push` (or whichever CLI the project uses — check `package.json` scripts)
Expected: Migration 029 runs without errors.

- [ ] **Step 3: Verify columns exist**

Run (via Supabase SQL editor or psql):
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'import_staging_rows'
  AND column_name IN ('cost_basis', 'parent_ahs_staging_id', 'ref_cells', 'cost_split');
```
Expected: 4 rows returned, all `is_nullable = YES`.

- [ ] **Step 4: Verify new table exists**

```sql
SELECT to_regclass('public.import_staging_edits');
```
Expected: `import_staging_edits` (not NULL).

- [ ] **Step 5: Smoke-test v1 still works**

Run: `npm test -- --testPathPattern=baseline` (or whatever the existing baseline-adjacent tests are)
Expected: All existing tests still pass. No behavior change for v1.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/029_boq_parser_v2.sql
git commit -m "feat(boq-v2): migration 029 — additive schema for parser v2"
```

---

## Phase 1: Types & Scaffolding

### Task 2: Add v2 TypeScript types

**Files:**
- Create: `tools/boqParserV2/types.ts`
- Modify: `tools/types.ts`

- [ ] **Step 1: Create `tools/boqParserV2/types.ts`**

```ts
// v2-only types for the new BoQ parser. All interfaces additive — no
// existing v1 types are changed. See spec Section 1.

export type CostBasis =
  | 'catalog'
  | 'nested_ahs'
  | 'literal'
  | 'takeoff_ref'
  | 'cross_ref';

export interface CellRef {
  sheet: string;
  cell: string;         // e.g. "I199"
  cached_value: number | string | null;
}

export interface RefCells {
  unit_price?: CellRef;
  material_cost?: CellRef;
  labor_cost?: CellRef;
  equipment_cost?: CellRef;
  quantity?: CellRef[];
}

export interface CostSplit {
  material: number;
  labor: number;
  equipment: number;
}

export interface HarvestedCell {
  sheet: string;
  address: string;      // "I199"
  row: number;
  col: number;
  value: unknown;       // exceljs computed result
  formula: string | null;
}

export type HarvestLookup = Map<string, HarvestedCell>;
// key format: `${sheet}!${address}` e.g. "Analisa!I199"

export interface ValidationReport {
  blocks: Array<{
    block_title: string;
    status: 'ok' | 'imbalanced';
    expected: number;
    actual: number;
    delta: number;
  }>;
  generated_at: string;
}

export interface StagingRowV2 {
  row_type: 'boq' | 'ahs' | 'ahs_block' | 'material';
  row_number: number;
  raw_data: Record<string, unknown>;
  parsed_data: Record<string, unknown>;
  needs_review: boolean;
  confidence: number;
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  cost_basis: CostBasis | null;
  parent_ahs_staging_id: string | null;
  ref_cells: RefCells | null;
  cost_split: CostSplit | null;
}
```

- [ ] **Step 2: Re-export from `tools/types.ts`**

Open `tools/types.ts` and append:
```ts
export type {
  CostBasis,
  CellRef,
  RefCells,
  CostSplit,
  HarvestedCell,
  HarvestLookup,
  ValidationReport,
  StagingRowV2,
} from './boqParserV2/types';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add tools/boqParserV2/types.ts tools/types.ts
git commit -m "feat(boq-v2): scaffold v2 type definitions"
```

---

## Phase 2: Pure Utilities First (Material Match)

### Task 3: Implement `normalizeMaterialName`

**Files:**
- Create: `tools/materialMatch.ts`
- Create: `tools/__tests__/materialMatch.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/__tests__/materialMatch.test.ts
import { normalizeMaterialName } from '../materialMatch';

describe('normalizeMaterialName', () => {
  it('lowercases and trims', () => {
    expect(normalizeMaterialName('  Semen PC  ')).toBe('semen pc');
  });
  it('collapses whitespace', () => {
    expect(normalizeMaterialName('Semen   Portland    40kg')).toBe('semen portland 40kg');
  });
  it('strips punctuation except digits and units', () => {
    expect(normalizeMaterialName('Pasir, halus (Ex. Lumajang)')).toBe('pasir halus ex lumajang');
  });
  it('returns empty string for null/undefined', () => {
    expect(normalizeMaterialName(null)).toBe('');
    expect(normalizeMaterialName(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// tools/materialMatch.ts
export function normalizeMaterialName(input: string | null | undefined): string {
  if (input == null) return '';
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // strip punctuation (keep letters/digits/space)
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/materialMatch.ts tools/__tests__/materialMatch.test.ts
git commit -m "feat(boq-v2): normalizeMaterialName helper"
```

---

### Task 4: Implement `levenshteinRatio`

**Files:**
- Modify: `tools/materialMatch.ts`
- Modify: `tools/__tests__/materialMatch.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { levenshteinRatio } from '../materialMatch';

describe('levenshteinRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinRatio('semen pc', 'semen pc')).toBe(1);
  });
  it('returns 0 for completely different strings of same length', () => {
    expect(levenshteinRatio('abcd', 'wxyz')).toBe(0);
  });
  it('returns high score for near-matches', () => {
    const score = levenshteinRatio('semen pc 40kg', 'semen pc 40 kg');
    expect(score).toBeGreaterThan(0.9);
  });
  it('handles empty strings', () => {
    expect(levenshteinRatio('', '')).toBe(1);
    expect(levenshteinRatio('abc', '')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: FAIL — `levenshteinRatio` not exported.

- [ ] **Step 3: Implement**

Append to `tools/materialMatch.ts`:
```ts
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/materialMatch.ts tools/__tests__/materialMatch.test.ts
git commit -m "feat(boq-v2): levenshteinRatio helper"
```

---

### Task 5: Implement `tokenSetRatio` and `fuzzyMatchMaterial`

**Files:**
- Modify: `tools/materialMatch.ts`
- Modify: `tools/__tests__/materialMatch.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { tokenSetRatio, fuzzyMatchMaterial } from '../materialMatch';

describe('tokenSetRatio', () => {
  it('ignores word order', () => {
    expect(tokenSetRatio('semen pc 40kg', '40kg pc semen')).toBe(1);
  });
  it('penalizes missing tokens', () => {
    const score = tokenSetRatio('semen pc 40kg', 'semen pc');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});

describe('fuzzyMatchMaterial', () => {
  const catalog = [
    { id: '1', name: 'Semen Portland 40 kg' },
    { id: '2', name: 'Pasir halus Lumajang' },
    { id: '3', name: 'Kerikil beton 1-2 cm' },
  ];

  it('returns best match for a clean query', () => {
    const result = fuzzyMatchMaterial('Semen Portland 40kg', catalog);
    expect(result[0].id).toBe('1');
    expect(result[0].score).toBeGreaterThan(0.9);
  });

  it('returns empty array when no candidate scores >= 0.7', () => {
    const result = fuzzyMatchMaterial('cat food', catalog);
    expect(result).toEqual([]);
  });

  it('sorts candidates by score descending', () => {
    const result = fuzzyMatchMaterial('semen', catalog);
    if (result.length > 1) {
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    }
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `tools/materialMatch.ts`:
```ts
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(normalizeMaterialName(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeMaterialName(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

export interface FuzzyMatchCandidate {
  id: string;
  name: string;
  score: number;
}

export interface CatalogMatchRow {
  id: string;
  name: string;
}

export function fuzzyMatchMaterial(
  query: string,
  catalog: CatalogMatchRow[],
  threshold = 0.7,
): FuzzyMatchCandidate[] {
  const qNorm = normalizeMaterialName(query);
  const scored = catalog
    .map(row => {
      const rNorm = normalizeMaterialName(row.name);
      const lev = levenshteinRatio(qNorm, rNorm);
      const tok = tokenSetRatio(qNorm, rNorm);
      return { id: row.id, name: row.name, score: Math.max(lev, tok) };
    })
    .filter(c => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return scored;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/__tests__/materialMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/materialMatch.ts tools/__tests__/materialMatch.test.ts
git commit -m "feat(boq-v2): tokenSetRatio + fuzzyMatchMaterial"
```

---

## Phase 2: Test Fixture Builder

### Task 6: Create XLSX test fixture builder

**Files:**
- Create: `tools/boqParserV2/__tests__/fixtures.ts`

- [ ] **Step 1: Write the builder**

```ts
// tools/boqParserV2/__tests__/fixtures.ts
// Programmatically builds tiny test XLSX buffers via exceljs so we can
// unit-test the parser without committing binary fixtures.

import ExcelJS from 'exceljs';

export interface FixtureCell {
  address: string;           // "B142"
  value?: unknown;
  formula?: string;
  result?: unknown;          // for formula cells, the cached value
}

export interface FixtureSheet {
  name: string;
  cells: FixtureCell[];
}

export async function buildFixtureWorkbook(
  sheets: FixtureSheet[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const c of s.cells) {
      const cell = ws.getCell(c.address);
      if (c.formula !== undefined) {
        cell.value = { formula: c.formula, result: c.result };
      } else {
        cell.value = c.value as ExcelJS.CellValue;
      }
    }
  }
  return wb;
}

export async function buildFixtureBuffer(sheets: FixtureSheet[]): Promise<Buffer> {
  const wb = await buildFixtureWorkbook(sheets);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add tools/boqParserV2/__tests__/fixtures.ts
git commit -m "test(boq-v2): fixture builder for XLSX tests"
```

---

## Phase 2: Pass 1 — Harvest

### Task 7: Implement `harvestWorkbook`

**Files:**
- Create: `tools/boqParserV2/harvest.ts`
- Create: `tools/boqParserV2/__tests__/harvest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/harvest.test.ts
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('harvestWorkbook', () => {
  it('reads literal cells from every sheet', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Analisa',
        cells: [
          { address: 'B2', value: 'Semen' },
          { address: 'E2', value: 150000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    expect(cells.length).toBe(2);
    expect(lookup.get('Analisa!B2')?.value).toBe('Semen');
    expect(lookup.get('Analisa!E2')?.value).toBe(150000);
  });

  it('distinguishes formula cells and stores both .f and .v', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Analisa',
        cells: [
          { address: 'F150', formula: 'SUM(F142:F149)', result: 785220 },
        ],
      },
    ]);
    const { lookup } = await harvestWorkbook(wb);
    const cell = lookup.get('Analisa!F150');
    expect(cell?.formula).toBe('SUM(F142:F149)');
    expect(cell?.value).toBe(785220);
  });

  it('returns empty harvest for empty workbook', async () => {
    const wb = await buildFixtureWorkbook([{ name: 'Empty', cells: [] }]);
    const { cells } = await harvestWorkbook(wb);
    expect(cells).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/harvest.test.ts`
Expected: FAIL — `harvestWorkbook` not found.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/harvest.ts
import type ExcelJS from 'exceljs';
import type { HarvestedCell, HarvestLookup } from './types';

export interface HarvestResult {
  cells: HarvestedCell[];
  lookup: HarvestLookup;
}

export async function harvestWorkbook(
  workbook: ExcelJS.Workbook,
): Promise<HarvestResult> {
  const cells: HarvestedCell[] = [];
  const lookup: HarvestLookup = new Map();

  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const raw = cell.value;
        let formula: string | null = null;
        let value: unknown = raw;

        if (raw && typeof raw === 'object' && 'formula' in raw) {
          const fc = raw as { formula: string; result?: unknown };
          formula = fc.formula;
          value = fc.result ?? null;
        }

        const harvested: HarvestedCell = {
          sheet: sheet.name,
          address: cell.address,
          row: rowNumber,
          col: colNumber,
          value,
          formula,
        };
        cells.push(harvested);
        lookup.set(`${sheet.name}!${cell.address}`, harvested);
      });
    });
  });

  return { cells, lookup };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/harvest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/harvest.ts tools/boqParserV2/__tests__/harvest.test.ts
git commit -m "feat(boq-v2): Pass 1 harvest — read every cell with .f and .v"
```

---

## Phase 2: Pass 2c — Classify Component (Reference Patterns)

We implement classification BEFORE block detection because `detectBlocks` will depend on knowing what a component row looks like. The classifier is also the piece with the most bug risk, so we want it rock-solid first.

### Task 8: Implement `parseFormulaRef` — extract structural hints from formula text

**Files:**
- Create: `tools/boqParserV2/classifyComponent.ts`
- Create: `tools/boqParserV2/__tests__/classifyComponent.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tools/boqParserV2/__tests__/classifyComponent.test.ts
import { parseFormulaRef } from '../classifyComponent';

describe('parseFormulaRef', () => {
  it('returns null for a literal (no formula)', () => {
    expect(parseFormulaRef(null, 'Analisa')).toEqual({ kind: 'literal' });
  });

  it('recognizes cross-sheet absolute reference', () => {
    expect(parseFormulaRef('=Material!$F$12', 'Analisa')).toEqual({
      kind: 'cross_sheet_abs',
      sheet: 'Material',
      address: 'F12',
    });
  });

  it('recognizes quoted cross-sheet reference', () => {
    expect(parseFormulaRef("='REKAP Balok'!$K$526", 'RAB (A)')).toEqual({
      kind: 'cross_sheet_abs',
      sheet: 'REKAP Balok',
      address: 'K526',
    });
  });

  it('recognizes intra-sheet absolute reference', () => {
    expect(parseFormulaRef('=$I$199', 'Analisa')).toEqual({
      kind: 'intra_sheet_abs',
      sheet: 'Analisa',
      address: 'I199',
    });
  });

  it('recognizes SUMIFS aggregation', () => {
    const r = parseFormulaRef("=SUMIFS('Besi Balok'!$AA$23:$AA$9622, ...)", 'REKAP Balok');
    expect(r.kind).toBe('aggregation');
  });

  it('recognizes SUM aggregation', () => {
    expect(parseFormulaRef('=SUM(F142:F149)', 'Analisa').kind).toBe('aggregation');
  });

  it('recognizes cross-cell multiply (rebar pattern)', () => {
    const r = parseFormulaRef('=$F$240*B155', 'Analisa');
    expect(r.kind).toBe('cross_multiply');
  });

  it('recognizes simple B*E multiply as default path', () => {
    expect(parseFormulaRef('=B155*E155', 'Analisa').kind).toBe('simple_multiply');
  });

  it('falls back to unknown for unrecognized formulas', () => {
    expect(parseFormulaRef('=IF(A1>0,B1,C1)', 'Analisa').kind).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/classifyComponent.ts

export type FormulaRef =
  | { kind: 'literal' }
  | { kind: 'cross_sheet_abs'; sheet: string; address: string }
  | { kind: 'intra_sheet_abs'; sheet: string; address: string }
  | { kind: 'aggregation' }
  | { kind: 'cross_multiply' }
  | { kind: 'simple_multiply' }
  | { kind: 'unknown' };

const CROSS_SHEET_ABS = /^=\s*(?:'([^']+)'|([A-Za-z0-9_\- ]+))!\$?([A-Z]+)\$?(\d+)\s*$/;
const INTRA_SHEET_ABS = /^=\s*\$([A-Z]+)\$(\d+)\s*$/;
const AGGREGATION = /^=\s*(SUMIFS|SUM|VLOOKUP)\s*\(/i;
const SIMPLE_MULTIPLY = /^=\s*[A-Z]+\d+\s*\*\s*[A-Z]+\d+\s*$/;
const CROSS_MULTIPLY = /^=\s*\$[A-Z]+\$\d+\s*\*\s*[A-Z]+\d+\s*$/;

export function parseFormulaRef(formula: string | null, currentSheet: string): FormulaRef {
  if (!formula) return { kind: 'literal' };
  const f = formula.trim();

  const cross = CROSS_SHEET_ABS.exec(f);
  if (cross) {
    const sheet = cross[1] ?? cross[2];
    const address = `${cross[3]}${cross[4]}`;
    return { kind: 'cross_sheet_abs', sheet, address };
  }

  const intra = INTRA_SHEET_ABS.exec(f);
  if (intra) {
    const address = `${intra[1]}${intra[2]}`;
    return { kind: 'intra_sheet_abs', sheet: currentSheet, address };
  }

  if (AGGREGATION.test(f)) return { kind: 'aggregation' };
  if (CROSS_MULTIPLY.test(f)) return { kind: 'cross_multiply' };
  if (SIMPLE_MULTIPLY.test(f)) return { kind: 'simple_multiply' };

  return { kind: 'unknown' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/classifyComponent.ts tools/boqParserV2/__tests__/classifyComponent.test.ts
git commit -m "feat(boq-v2): parseFormulaRef regex dispatch"
```

---

### Task 9: Implement sheet-type classification helper

**Files:**
- Modify: `tools/boqParserV2/classifyComponent.ts`
- Modify: `tools/boqParserV2/__tests__/classifyComponent.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { isCatalogSheet } from '../classifyComponent';

describe('isCatalogSheet', () => {
  it('treats Material and Upah as catalog', () => {
    expect(isCatalogSheet('Material')).toBe(true);
    expect(isCatalogSheet('Upah')).toBe(true);
  });
  it('rejects REKAP-style sheets', () => {
    expect(isCatalogSheet('REKAP Balok')).toBe(false);
    expect(isCatalogSheet('Data-Kolom')).toBe(false);
    expect(isCatalogSheet('Hasil-PC')).toBe(false);
    expect(isCatalogSheet('Besi Balok')).toBe(false);
  });
  it('defaults unknown sheets to catalog=true (conservative)', () => {
    expect(isCatalogSheet('Pipa')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: FAIL — `isCatalogSheet` not exported.

- [ ] **Step 3: Implement**

Append to `tools/boqParserV2/classifyComponent.ts`:
```ts
const AGGREGATOR_SHEET_PATTERN =
  /^(REKAP|Data[-\s]|Hasil[-\s]|Besi |Detail |Plat|Tangga|COVER|Proses|TABEL)/i;

export function isCatalogSheet(sheetName: string): boolean {
  return !AGGREGATOR_SHEET_PATTERN.test(sheetName);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/classifyComponent.ts tools/boqParserV2/__tests__/classifyComponent.test.ts
git commit -m "feat(boq-v2): isCatalogSheet disambiguator for catalog vs takeoff_ref"
```

---

### Task 10: Implement top-level `classifyComponent`

**Files:**
- Modify: `tools/boqParserV2/classifyComponent.ts`
- Modify: `tools/boqParserV2/__tests__/classifyComponent.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { classifyComponent } from '../classifyComponent';
import type { HarvestedCell, HarvestLookup } from '../types';

function mockCell(
  sheet: string,
  address: string,
  value: unknown,
  formula: string | null = null,
): HarvestedCell {
  return { sheet, address, row: 0, col: 0, value, formula };
}

function buildLookup(cells: HarvestedCell[]): HarvestLookup {
  return new Map(cells.map(c => [`${c.sheet}!${c.address}`, c]));
}

describe('classifyComponent', () => {
  it('classifies catalog-based component', () => {
    const eCell = mockCell('Analisa', 'E143', 1500000, '=Material!$F$12');
    const fCell = mockCell('Analisa', 'F143', 75000);
    const srcCell = mockCell('Material', 'F12', 1500000);
    const lookup = buildLookup([eCell, fCell, srcCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('catalog');
    expect(result.ref_cells?.unit_price?.sheet).toBe('Material');
  });

  it('classifies literal component', () => {
    const eCell = mockCell('Analisa', 'E52', 150000);
    const fCell = mockCell('Analisa', 'F52', 150000);
    const lookup = buildLookup([eCell, fCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('literal');
  });

  it('classifies nested_ahs component', () => {
    const eCell = mockCell('Analisa', 'E175', 886530, '=$I$140');
    const fCell = mockCell('Analisa', 'F175', 250000);
    const jumlahCell = mockCell('Analisa', 'I140', 886530);
    const lookup = buildLookup([eCell, fCell, jumlahCell]);
    const result = classifyComponent(eCell, fCell, null, null, lookup);
    expect(result.cost_basis).toBe('nested_ahs');
    expect(result.ref_cells?.unit_price?.cell).toBe('I140');
  });

  it('classifies cross_ref (rebar split) and populates cost_split from F/G/H', () => {
    const eCell = mockCell('Analisa', 'E155', 11218, '=$I$132+1300');
    const fCell = mockCell('Analisa', 'F155', 1662746, '=$F$240*B155');
    const gCell = mockCell('Analisa', 'G155', 0);
    const hCell = mockCell('Analisa', 'H155', 73744, '=1300*B155');
    const lookup = buildLookup([eCell, fCell, gCell, hCell]);
    const result = classifyComponent(eCell, fCell, gCell, hCell, lookup);
    expect(result.cost_basis).toBe('cross_ref');
    expect(result.cost_split).toEqual({
      material: 1662746,
      labor: 0,
      equipment: 73744,
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `tools/boqParserV2/classifyComponent.ts`:
```ts
import type { HarvestedCell, HarvestLookup, CostBasis, RefCells, CostSplit } from './types';

export interface ComponentClassification {
  cost_basis: CostBasis;
  ref_cells: RefCells | null;
  cost_split: CostSplit | null;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function classifyComponent(
  eCell: HarvestedCell,
  fCell: HarvestedCell | null,
  gCell: HarvestedCell | null,
  hCell: HarvestedCell | null,
  lookup: HarvestLookup,
): ComponentClassification {
  const eRef = parseFormulaRef(eCell.formula, eCell.sheet);
  const fRef = parseFormulaRef(fCell?.formula ?? null, fCell?.sheet ?? eCell.sheet);

  // Rebar split: F column uses a cross-cell multiply to another block's material cell
  if (fRef.kind === 'cross_multiply') {
    return {
      cost_basis: 'cross_ref',
      ref_cells: {
        unit_price: {
          sheet: eCell.sheet,
          cell: eCell.address,
          cached_value: toNumber(eCell.value),
        },
      },
      cost_split: {
        material: toNumber(fCell?.value),
        labor: toNumber(gCell?.value),
        equipment: toNumber(hCell?.value),
      },
    };
  }

  // E column intra-sheet absolute → nested_ahs
  if (eRef.kind === 'intra_sheet_abs') {
    const target = lookup.get(`${eRef.sheet}!${eRef.address}`);
    return {
      cost_basis: 'nested_ahs',
      ref_cells: {
        unit_price: {
          sheet: eRef.sheet,
          cell: eRef.address,
          cached_value: target ? toNumber(target.value) : null,
        },
      },
      cost_split: null,
    };
  }

  // E column cross-sheet absolute → catalog or takeoff_ref
  if (eRef.kind === 'cross_sheet_abs') {
    const basis: CostBasis = isCatalogSheet(eRef.sheet) ? 'catalog' : 'takeoff_ref';
    const target = lookup.get(`${eRef.sheet}!${eRef.address}`);
    return {
      cost_basis: basis,
      ref_cells: {
        unit_price: {
          sheet: eRef.sheet,
          cell: eRef.address,
          cached_value: target ? toNumber(target.value) : null,
        },
      },
      cost_split: null,
    };
  }

  // E column aggregation → takeoff_ref
  if (eRef.kind === 'aggregation') {
    return {
      cost_basis: 'takeoff_ref',
      ref_cells: {
        unit_price: {
          sheet: eCell.sheet,
          cell: eCell.address,
          cached_value: toNumber(eCell.value),
        },
      },
      cost_split: null,
    };
  }

  // Literal — E column is a typed number, no formula
  return {
    cost_basis: 'literal',
    ref_cells: {
      unit_price: {
        sheet: eCell.sheet,
        cell: eCell.address,
        cached_value: toNumber(eCell.value),
      },
    },
    cost_split: null,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/classifyComponent.test.ts`
Expected: PASS (all classifyComponent tests green).

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/classifyComponent.ts tools/boqParserV2/__tests__/classifyComponent.test.ts
git commit -m "feat(boq-v2): classifyComponent top-level dispatch"
```

---

## Phase 2: Pass 2b — Block Detection

### Task 11: Implement `detectAhsBlocks`

**Files:**
- Create: `tools/boqParserV2/detectBlocks.ts`
- Create: `tools/boqParserV2/__tests__/detectBlocks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/detectBlocks.test.ts
import { detectAhsBlocks, isTitleRow, isHeaderRow } from '../detectBlocks';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('isTitleRow', () => {
  it('matches "1 m3 Beton site mix"', () => {
    expect(isTitleRow('1 m3 Beton site mix')).toBe(true);
  });
  it('matches "1 m² Plesteran"', () => {
    expect(isTitleRow('1 m² Plesteran')).toBe(true);
  });
  it('matches "10 m3 Galian tanah"', () => {
    expect(isTitleRow('10 m3 Galian tanah')).toBe(true);
  });
  it('rejects non-titles', () => {
    expect(isTitleRow('Uraian')).toBe(false);
    expect(isTitleRow('Semen PC')).toBe(false);
    expect(isTitleRow('')).toBe(false);
  });
});

describe('isHeaderRow', () => {
  it('matches Uraian/Koefisien/Harga labels', () => {
    expect(isHeaderRow('Uraian')).toBe(true);
    expect(isHeaderRow('Koefisien')).toBe(true);
    expect(isHeaderRow('Harga')).toBe(true);
  });
  it('rejects component names', () => {
    expect(isHeaderRow('Semen PC')).toBe(false);
  });
});

describe('detectAhsBlocks', () => {
  it('detects one block with title, components, and Jumlah', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B143', value: 'Uraian' },           // header, skipped
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', value: 1500000 },
          { address: 'F144', value: 75000 },
          { address: 'B145', value: 'Pasir' },
          { address: 'E145', value: 200000 },
          { address: 'F145', value: 10000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 85000 },
          { address: 'I150', formula: 'F150', result: 85000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const blocks = detectAhsBlocks(cells, 'Analisa');
    expect(blocks.length).toBe(1);
    expect(blocks[0].title).toBe('1 m3 Lantai Kerja');
    expect(blocks[0].titleRow).toBe(142);
    expect(blocks[0].jumlahRow).toBe(150);
    expect(blocks[0].components.length).toBe(2); // header row skipped
    expect(blocks[0].jumlahCachedValue).toBe(85000);
  });

  it('returns empty when no title rows present', async () => {
    const wb = await buildFixtureWorkbook([
      { name: 'Analisa', cells: [{ address: 'B1', value: 'random' }] },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(detectAhsBlocks(cells, 'Analisa')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/detectBlocks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/detectBlocks.ts
import type { HarvestedCell } from './types';

export interface AhsBlock {
  title: string;
  titleRow: number;
  jumlahRow: number;
  jumlahCachedValue: number;
  grandTotalAddress: string | null;  // e.g. "I150"
  components: HarvestedCell[];        // the E-column cells of component rows
  componentRows: number[];            // row numbers
}

const TITLE_RE = /^\s*\d+\s*m\s*[²³23]?\s+\S/i;
const HEADER_LABELS = new Set([
  'uraian', 'satuan', 'koefisien', 'harga', 'jumlah harga', 'no', 'kode', 'bahan',
]);

export function isTitleRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return TITLE_RE.test(text);
}

export function isHeaderRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return HEADER_LABELS.has(text.trim().toLowerCase());
}

function isJumlahRow(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.trim().toLowerCase() === 'jumlah';
}

function cellText(cell: HarvestedCell | undefined): string | null {
  if (!cell) return null;
  if (typeof cell.value === 'string') return cell.value;
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function detectAhsBlocks(cells: HarvestedCell[], sheetName: string): AhsBlock[] {
  const byRow = new Map<number, HarvestedCell[]>();
  for (const c of cells) {
    if (c.sheet !== sheetName) continue;
    const arr = byRow.get(c.row) ?? [];
    arr.push(c);
    byRow.set(c.row, arr);
  }

  const cellAt = (row: number, colLetter: string): HarvestedCell | undefined =>
    (byRow.get(row) ?? []).find(c => c.address.replace(/\d+/g, '') === colLetter);

  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);
  const blocks: AhsBlock[] = [];

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    const b = cellText(cellAt(row, 'B'));
    const c = cellText(cellAt(row, 'C'));
    const titleText = isTitleRow(b) ? b : isTitleRow(c) ? c : null;
    if (!titleText) continue;

    // Scan forward for Jumlah row
    let jumlahRow = -1;
    for (let j = i + 1; j < sortedRows.length; j++) {
      const r = sortedRows[j];
      const aText = cellText(cellAt(r, 'A'));
      const bText = cellText(cellAt(r, 'B'));
      const cText = cellText(cellAt(r, 'C'));
      if (isJumlahRow(aText) || isJumlahRow(bText) || isJumlahRow(cText)) {
        jumlahRow = r;
        break;
      }
      // Safety: stop if we encounter another title row
      if (isTitleRow(bText) || isTitleRow(cText)) break;
    }
    if (jumlahRow === -1) continue;

    // Collect components between title and jumlah, skipping header rows
    const components: HarvestedCell[] = [];
    const componentRows: number[] = [];
    for (const r of sortedRows) {
      if (r <= row || r >= jumlahRow) continue;
      const bText = cellText(cellAt(r, 'B'));
      const cText = cellText(cellAt(r, 'C'));
      if (isHeaderRow(bText) || isHeaderRow(cText)) continue;
      const eCell = cellAt(r, 'E');
      if (!eCell) continue;
      components.push(eCell);
      componentRows.push(r);
    }

    const jumlahF = cellAt(jumlahRow, 'F');
    const jumlahI = cellAt(jumlahRow, 'I');
    blocks.push({
      title: titleText.trim(),
      titleRow: row,
      jumlahRow,
      jumlahCachedValue: toNumber(jumlahF?.value),
      grandTotalAddress: jumlahI?.address ?? null,
      components,
      componentRows,
    });
  }

  return blocks;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/detectBlocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/detectBlocks.ts tools/boqParserV2/__tests__/detectBlocks.test.ts
git commit -m "feat(boq-v2): Pass 2b AHS block detection"
```

---

## Phase 2: Pass 2a — Catalog Extraction

### Task 12: Implement `extractCatalogRows`

**Files:**
- Create: `tools/boqParserV2/extractCatalog.ts`
- Create: `tools/boqParserV2/__tests__/extractCatalog.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/extractCatalog.test.ts
import { extractCatalogRows } from '../extractCatalog';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('extractCatalogRows', () => {
  it('pulls rows with code, name, unit, price from Material sheet', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Material',
        cells: [
          // Header row
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          // Data rows
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC 40 kg' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
          { address: 'A3', value: 'M002' },
          { address: 'B3', value: 'Pasir halus' },
          { address: 'C3', value: 'm3' },
          { address: 'D3', value: 200000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      code: 'M001',
      name: 'Semen PC 40 kg',
      unit: 'sak',
      reference_unit_price: 75000,
    });
  });

  it('skips rows without a code', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'B2', value: 'Orphan material' },
          { address: 'D2', value: 100 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(extractCatalogRows(cells, ['Material'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/extractCatalog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/extractCatalog.ts
import type { HarvestedCell } from './types';

export interface CatalogRow {
  code: string;
  name: string;
  unit: string;
  reference_unit_price: number;
  sourceRow: number;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  const n = typeof c.value === 'number' ? c.value : Number(c.value);
  return Number.isFinite(n) ? n : 0;
}

export function extractCatalogRows(
  cells: HarvestedCell[],
  sheetNames: string[],
): CatalogRow[] {
  const out: CatalogRow[] = [];
  for (const sheet of sheetNames) {
    const byRow = new Map<number, Map<string, HarvestedCell>>();
    for (const c of cells) {
      if (c.sheet !== sheet) continue;
      const colLetter = c.address.replace(/\d+/g, '');
      const map = byRow.get(c.row) ?? new Map();
      map.set(colLetter, c);
      byRow.set(c.row, map);
    }
    for (const [row, map] of byRow) {
      if (row === 1) continue; // skip header
      const code = cellText(map.get('A'));
      const name = cellText(map.get('B'));
      const unit = cellText(map.get('C'));
      const price = cellNumber(map.get('D'));
      if (!code) continue;
      out.push({ code, name, unit, reference_unit_price: price, sourceRow: row });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/extractCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/extractCatalog.ts tools/boqParserV2/__tests__/extractCatalog.test.ts
git commit -m "feat(boq-v2): Pass 2a catalog extraction"
```

---

## Phase 2: Pass 2e — Validation

### Task 13: Implement `validateBlockBalance`

**Files:**
- Create: `tools/boqParserV2/validate.ts`
- Create: `tools/boqParserV2/__tests__/validate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/validate.test.ts
import { validateBlocks } from '../validate';
import type { AhsBlock } from '../detectBlocks';

function mockBlock(
  title: string,
  jumlah: number,
  componentFValues: number[],
): AhsBlock {
  return {
    title,
    titleRow: 1,
    jumlahRow: 10,
    jumlahCachedValue: jumlah,
    grandTotalAddress: null,
    components: componentFValues.map((v, i) => ({
      sheet: 'Analisa',
      address: `F${i + 2}`,
      row: i + 2,
      col: 6,
      value: v,
      formula: null,
    })),
    componentRows: componentFValues.map((_, i) => i + 2),
  };
}

describe('validateBlocks', () => {
  it('flags balanced block as ok', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [40, 30, 30])]);
    expect(r.blocks[0].status).toBe('ok');
  });

  it('flags imbalanced block with delta', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [40, 30, 20])]);
    expect(r.blocks[0].status).toBe('imbalanced');
    expect(r.blocks[0].delta).toBe(-10);
  });

  it('tolerates ±1 rounding', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [33, 33, 33])]);
    expect(r.blocks[0].status).toBe('ok'); // 99 vs 100, within ±1
  });
});
```

Note: the fixture above uses F-column cells as the component source. The real `detectAhsBlocks` stores E-column cells as `components`, so in the orchestrator we'll look up F-column values separately via the lookup map. For this test we mock the block shape directly.

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/validate.ts
import type { AhsBlock } from './detectBlocks';
import type { ValidationReport } from './types';

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function validateBlocks(blocks: AhsBlock[]): ValidationReport {
  const report: ValidationReport = {
    blocks: [],
    generated_at: new Date().toISOString(),
  };
  for (const b of blocks) {
    const actual = b.components.reduce((sum, c) => sum + toNumber(c.value), 0);
    const delta = actual - b.jumlahCachedValue;
    const status: 'ok' | 'imbalanced' = Math.abs(delta) <= 1 ? 'ok' : 'imbalanced';
    report.blocks.push({
      block_title: b.title,
      status,
      expected: b.jumlahCachedValue,
      actual,
      delta,
    });
  }
  return report;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/validate.ts tools/boqParserV2/__tests__/validate.test.ts
git commit -m "feat(boq-v2): Pass 2e validation sweep"
```

---

## Phase 2: Pass 2d — Takeoff Extraction

### Task 14: Implement `extractBoqRows`

**Files:**
- Create: `tools/boqParserV2/extractTakeoffs.ts`
- Create: `tools/boqParserV2/__tests__/extractTakeoffs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/extractTakeoffs.test.ts
import { extractBoqRows } from '../extractTakeoffs';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('extractBoqRows', () => {
  it('extracts BoQ rows with literal quantities', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B11', value: 'A.1' },
          { address: 'C11', value: 'Pekerjaan Galian' },
          { address: 'D11', value: 100, formula: 'H11', result: 100 },
          { address: 'E11', value: 50000, formula: 'N11', result: 50000 },
          { address: 'F11', value: 5000000, formula: 'D11*E11', result: 5000000 },
          { address: 'G11', value: 'm3' },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      code: 'A.1',
      label: 'Pekerjaan Galian',
      unit: 'm3',
      planned: 100,
    });
  });

  it('attaches takeoff_ref provenance when quantity is SUMIFS', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B20', value: 'B.1' },
          { address: 'C20', value: 'Besi tulangan' },
          {
            address: 'D20',
            value: 5000,
            formula: "SUM('REKAP Balok'!K526, 'REKAP-PC'!G21)",
            result: 5000,
          },
          { address: 'E20', value: 12000 },
          { address: 'F20', value: 60000000 },
          { address: 'G20', value: 'kg' },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows[0].cost_basis).toBe('takeoff_ref');
    expect(rows[0].ref_cells?.quantity?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/extractTakeoffs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/extractTakeoffs.ts
import type { HarvestedCell, HarvestLookup, CostBasis, RefCells } from './types';
import { parseFormulaRef } from './classifyComponent';

export interface BoqRowV2 {
  code: string;
  label: string;
  unit: string;
  planned: number;
  sourceRow: number;
  cost_basis: CostBasis | null;
  ref_cells: RefCells | null;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  const n = typeof c.value === 'number' ? c.value : Number(c.value);
  return Number.isFinite(n) ? n : 0;
}

const SUM_ARG_RE = /'([^']+)'!(\$?[A-Z]+\$?\d+)/g;

function extractSumIfsRefs(formula: string | null): RefCells['quantity'] {
  if (!formula) return undefined;
  const out: NonNullable<RefCells['quantity']> = [];
  let m: RegExpExecArray | null;
  while ((m = SUM_ARG_RE.exec(formula)) !== null) {
    const sheet = m[1];
    const cell = m[2].replace(/\$/g, '');
    out.push({ sheet, cell, cached_value: null });
  }
  return out.length > 0 ? out : undefined;
}

export function extractBoqRows(
  cells: HarvestedCell[],
  lookup: HarvestLookup,
  boqSheetName: string,
): BoqRowV2[] {
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheetName) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }

  const out: BoqRowV2[] = [];
  for (const [row, map] of byRow) {
    const code = cellText(map.get('B'));
    const label = cellText(map.get('C'));
    if (!code || !label) continue;
    const planned = cellNumber(map.get('D'));
    const unit = cellText(map.get('G'));

    const dCell = map.get('D');
    const ref = parseFormulaRef(dCell?.formula ?? null, boqSheetName);
    let cost_basis: CostBasis | null = null;
    let ref_cells: RefCells | null = null;
    if (ref.kind === 'aggregation') {
      cost_basis = 'takeoff_ref';
      const refs = extractSumIfsRefs(dCell?.formula ?? null);
      if (refs) ref_cells = { quantity: refs };
    }

    out.push({ code, label, unit, planned, sourceRow: row, cost_basis, ref_cells });
  }
  return out.sort((a, b) => a.sourceRow - b.sourceRow);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/extractTakeoffs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/extractTakeoffs.ts tools/boqParserV2/__tests__/extractTakeoffs.test.ts
git commit -m "feat(boq-v2): Pass 2d BoQ row extraction + takeoff_ref provenance"
```

---

## Phase 2: Orchestrator

### Task 15: Implement `parseBoqV2` top-level

**Files:**
- Create: `tools/boqParserV2/index.ts`
- Create: `tools/boqParserV2/__tests__/parseBoqV2.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/boqParserV2/__tests__/parseBoqV2.test.ts
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2', () => {
  it('parses a minimal Analisa + Material + RAB workbook end-to-end', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', formula: 'Material!$D$2', result: 75000 },
          { address: 'F144', value: 75000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 75000 },
          { address: 'I150', formula: 'F150', result: 75000 },
        ],
      },
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B11', value: 'A.1' },
          { address: 'C11', value: 'Lantai Kerja' },
          { address: 'D11', value: 100 },
          { address: 'G11', value: 'm3' },
        ],
      },
    ]);

    const result = await parseBoqV2(buffer, { boqSheet: 'RAB (A)' });

    expect(result.materialRows.length).toBe(1);
    expect(result.ahsBlocks.length).toBe(1);
    expect(result.boqRows.length).toBe(1);
    expect(result.validationReport.blocks[0].status).toBe('ok');

    const component = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(component?.cost_basis).toBe('catalog');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/parseBoqV2.test.ts`
Expected: FAIL — `parseBoqV2` not exported.

- [ ] **Step 3: Implement**

```ts
// tools/boqParserV2/index.ts
import ExcelJS from 'exceljs';
import { harvestWorkbook } from './harvest';
import { detectAhsBlocks } from './detectBlocks';
import { classifyComponent } from './classifyComponent';
import { extractCatalogRows, type CatalogRow } from './extractCatalog';
import { extractBoqRows, type BoqRowV2 } from './extractTakeoffs';
import { validateBlocks } from './validate';
import type {
  HarvestedCell,
  HarvestLookup,
  ValidationReport,
  StagingRowV2,
} from './types';
import type { AhsBlock } from './detectBlocks';

export interface ParseBoqV2Options {
  analisaSheet?: string;
  boqSheet?: string;
  catalogSheets?: string[];
}

export interface ParseBoqV2Result {
  cells: HarvestedCell[];
  lookup: HarvestLookup;
  materialRows: CatalogRow[];
  ahsBlocks: AhsBlock[];
  boqRows: BoqRowV2[];
  validationReport: ValidationReport;
  stagingRows: StagingRowV2[];
}

export async function parseBoqV2(
  fileBuffer: Buffer | ArrayBuffer,
  options: ParseBoqV2Options = {},
): Promise<ParseBoqV2Result> {
  const analisaSheet = options.analisaSheet ?? 'Analisa';
  const boqSheet = options.boqSheet ?? 'RAB (A)';
  const catalogSheets = options.catalogSheets ?? ['Material', 'Upah'];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as ArrayBuffer);

  const { cells, lookup } = await harvestWorkbook(workbook);
  const materialRows = extractCatalogRows(cells, catalogSheets);
  const ahsBlocks = detectAhsBlocks(cells, analisaSheet);
  const boqRows = extractBoqRows(cells, lookup, boqSheet);
  const validationReport = validateBlocks(ahsBlocks);

  const stagingRows: StagingRowV2[] = [];
  let rowNumber = 0;

  // Material staging rows
  for (const m of materialRows) {
    stagingRows.push({
      row_type: 'material',
      row_number: ++rowNumber,
      raw_data: { sourceRow: m.sourceRow },
      parsed_data: {
        code: m.code,
        name: m.name,
        unit: m.unit,
        reference_unit_price: m.reference_unit_price,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: null,
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });
  }

  // AHS block titles + components
  for (const block of ahsBlocks) {
    const blockRowNumber = ++rowNumber;
    stagingRows.push({
      row_type: 'ahs_block',
      row_number: blockRowNumber,
      raw_data: {
        titleRow: block.titleRow,
        jumlahRow: block.jumlahRow,
        grandTotalAddress: block.grandTotalAddress,
      },
      parsed_data: {
        title: block.title,
        jumlah_cached_value: block.jumlahCachedValue,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: null,
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });

    for (let idx = 0; idx < block.components.length; idx++) {
      const eCell = block.components[idx];
      const compRow = block.componentRows[idx];
      const fCell = lookup.get(`${eCell.sheet}!F${compRow}`) ?? null;
      const gCell = lookup.get(`${eCell.sheet}!G${compRow}`) ?? null;
      const hCell = lookup.get(`${eCell.sheet}!H${compRow}`) ?? null;
      const classification = classifyComponent(eCell, fCell, gCell, hCell, lookup);
      const bCell = lookup.get(`${eCell.sheet}!B${compRow}`);
      const materialName =
        bCell && typeof bCell.value === 'string' ? bCell.value : '';

      stagingRows.push({
        row_type: 'ahs',
        row_number: ++rowNumber,
        raw_data: { sourceRow: compRow, blockTitle: block.title },
        parsed_data: {
          material_name: materialName,
          unit_price:
            typeof eCell.value === 'number' ? eCell.value : Number(eCell.value) || 0,
        },
        needs_review: classification.cost_basis === 'literal',
        confidence: classification.cost_basis === 'literal' ? 0.5 : 1,
        review_status: 'PENDING',
        cost_basis: classification.cost_basis,
        parent_ahs_staging_id: null, // resolved in a second pass below
        ref_cells: classification.ref_cells,
        cost_split: classification.cost_split,
      });
    }
  }

  // BoQ staging rows
  for (const b of boqRows) {
    stagingRows.push({
      row_type: 'boq',
      row_number: ++rowNumber,
      raw_data: { sourceRow: b.sourceRow },
      parsed_data: {
        code: b.code,
        label: b.label,
        unit: b.unit,
        planned: b.planned,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: b.cost_basis,
      parent_ahs_staging_id: null,
      ref_cells: b.ref_cells,
      cost_split: null,
    });
  }

  return { cells, lookup, materialRows, ahsBlocks, boqRows, validationReport, stagingRows };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/parseBoqV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Run entire boqParserV2 test suite**

Run: `npm test -- tools/boqParserV2`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/index.ts tools/boqParserV2/__tests__/parseBoqV2.test.ts
git commit -m "feat(boq-v2): parseBoqV2 orchestrator wiring all passes"
```

---

### Task 16: Resolve `parent_ahs_staging_id` for nested_ahs rows

The orchestrator above leaves `parent_ahs_staging_id` as null. Nested references need a second pass to link child → parent via the E-column ref_cells.unit_price address.

**Files:**
- Modify: `tools/boqParserV2/index.ts`
- Modify: `tools/boqParserV2/__tests__/parseBoqV2.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('parseBoqV2 nested AHS resolution', () => {
  it('links nested_ahs component to its parent block title row', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          // Parent block at row 140
          { address: 'B140', value: '1 m3 Beton K250' },
          { address: 'B144', value: 'Semen' },
          { address: 'E144', value: 75000 },
          { address: 'F144', value: 37500 },
          { address: 'B148', value: 'Jumlah' },
          { address: 'F148', formula: 'SUM(F140:F147)', result: 37500 },
          { address: 'I148', formula: 'F148', result: 37500 },
          // Child block at row 175 referencing I148
          { address: 'B175', value: '1 m3 Beton site mix' },
          { address: 'B177', value: 'Beton ready-mix' },
          { address: 'E177', formula: '$I$148', result: 37500 },
          { address: 'F177', value: 37500 },
          { address: 'B180', value: 'Jumlah' },
          { address: 'F180', formula: 'SUM(F175:F179)', result: 37500 },
          { address: 'I180', formula: 'F180', result: 37500 },
        ],
      },
    ]);
    const result = await parseBoqV2(buffer);
    const nested = result.stagingRows.find(
      r => r.cost_basis === 'nested_ahs',
    );
    expect(nested).toBeDefined();
    expect(nested?.parent_ahs_staging_id).not.toBeNull();
    // Parent must point at the ahs_block row for "1 m3 Beton K250"
    const parentBlock = result.stagingRows.find(
      r =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === '1 m3 Beton K250',
    );
    expect(nested?.parent_ahs_staging_id).toBe(
      `block:${parentBlock?.row_number}`,
    );
  });
});
```

(Note: `parent_ahs_staging_id` will hold a synthetic pre-insert key like `block:<row_number>` at parse time. The DB insert step will translate these into real UUIDs after rows are inserted.)

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/boqParserV2/__tests__/parseBoqV2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement resolution pass**

Add to `tools/boqParserV2/index.ts` right before the final `return`:
```ts
  // Resolve parent_ahs_staging_id for nested_ahs components.
  // parent key format: "block:<blockRowNumber>" — the DB insert phase
  // translates these to real UUIDs after inserts complete.
  const blockByGrandTotalAddress = new Map<string, number>();
  for (const r of stagingRows) {
    if (r.row_type !== 'ahs_block') continue;
    const raw = r.raw_data as { grandTotalAddress?: string | null };
    if (raw.grandTotalAddress) {
      blockByGrandTotalAddress.set(`Analisa!${raw.grandTotalAddress}`, r.row_number);
    }
  }
  for (const r of stagingRows) {
    if (r.cost_basis !== 'nested_ahs') continue;
    const up = r.ref_cells?.unit_price;
    if (!up) continue;
    const key = `${up.sheet}!${up.cell}`;
    const blockRowNumber = blockByGrandTotalAddress.get(key);
    if (blockRowNumber != null) {
      r.parent_ahs_staging_id = `block:${blockRowNumber}`;
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/parseBoqV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/index.ts tools/boqParserV2/__tests__/parseBoqV2.test.ts
git commit -m "feat(boq-v2): resolve nested_ahs parent links post-classification"
```

---

## Phase 2: Publish v2

### Task 17: Implement topological sort for nested block ordering

**Files:**
- Create: `tools/publishBaselineV2.ts`
- Create: `tools/__tests__/publishBaselineV2.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tools/__tests__/publishBaselineV2.test.ts
import { topoSortBlocks } from '../publishBaselineV2';

describe('topoSortBlocks', () => {
  it('orders children after parents (deepest-first via reverse)', () => {
    // Block A references B (A is child of B)
    const stagingRows = [
      { row_number: 1, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'A' } },
      { row_number: 2, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'B' } },
      // Component in block A with nested_ahs → block B (via synthetic parent key)
      { row_number: 3, row_type: 'ahs' as const, parent_ahs_staging_id: 'block:2', parsed_data: {} },
    ];
    const ordered = topoSortBlocks(stagingRows as never);
    const titles = ordered.map(b => (b.parsed_data as { title: string }).title);
    // Parent B must be processed before child A
    expect(titles.indexOf('B')).toBeLessThan(titles.indexOf('A'));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/__tests__/publishBaselineV2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// tools/publishBaselineV2.ts
import type { StagingRowV2 } from './boqParserV2/types';

export function topoSortBlocks(stagingRows: StagingRowV2[]): StagingRowV2[] {
  const blocks = stagingRows.filter(r => r.row_type === 'ahs_block');
  const byRowNumber = new Map<number, StagingRowV2>();
  for (const b of blocks) byRowNumber.set(b.row_number, b);

  // Build adjacency: each block depends on whatever its components reference
  const deps = new Map<number, Set<number>>();
  for (const b of blocks) deps.set(b.row_number, new Set());

  // Which block does each component belong to? Track via order:
  // components immediately after an ahs_block belong to that block until
  // the next ahs_block.
  let currentBlockRow: number | null = null;
  for (const r of stagingRows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null && r.parent_ahs_staging_id) {
      const match = /^block:(\d+)$/.exec(r.parent_ahs_staging_id);
      if (match) {
        const parentRow = Number(match[1]);
        deps.get(currentBlockRow)?.add(parentRow);
      }
    }
  }

  // Kahn's algorithm — produce a parents-first order
  const result: StagingRowV2[] = [];
  const inDegree = new Map<number, number>();
  for (const [row, ds] of deps) inDegree.set(row, ds.size);

  // Reverse the edge direction to get parents-first: we want blocks with
  // zero incoming deps processed first.
  const reverseAdjacency = new Map<number, Set<number>>();
  for (const b of blocks) reverseAdjacency.set(b.row_number, new Set());
  for (const [child, parents] of deps) {
    for (const parent of parents) {
      reverseAdjacency.get(parent)?.add(child);
    }
  }

  const queue: number[] = [];
  for (const [row, count] of inDegree) {
    if (count === 0) queue.push(row);
  }

  while (queue.length > 0) {
    const row = queue.shift()!;
    const block = byRowNumber.get(row);
    if (block) result.push(block);
    for (const child of reverseAdjacency.get(row) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/__tests__/publishBaselineV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/publishBaselineV2.ts tools/__tests__/publishBaselineV2.test.ts
git commit -m "feat(boq-v2): topological sort for nested AHS unfold order"
```

---

### Task 18: Implement `flattenBlock` per-cost_basis dispatch

**Files:**
- Modify: `tools/publishBaselineV2.ts`
- Modify: `tools/__tests__/publishBaselineV2.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { flattenBlock, type FlattenedLine } from '../publishBaselineV2';

describe('flattenBlock', () => {
  it('emits a single ahs_line for a catalog component', () => {
    const components = [
      {
        row_number: 10,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Semen', unit_price: 75000 },
        cost_basis: 'catalog' as const,
        ref_cells: {
          unit_price: { sheet: 'Material', cell: 'D2', cached_value: 75000 },
        },
        cost_split: null,
        parent_ahs_staging_id: null,
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, new Map());
    expect(lines.length).toBe(1);
    expect(lines[0].unit_price).toBe(75000);
    expect(lines[0].line_type).toBe('material');
  });

  it('emits 3 ahs_lines from a cross_ref cost_split', () => {
    const components = [
      {
        row_number: 20,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Rebar' },
        cost_basis: 'cross_ref' as const,
        ref_cells: null,
        cost_split: { material: 1000, labor: 500, equipment: 200 },
        parent_ahs_staging_id: null,
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, new Map());
    expect(lines.length).toBe(3);
    const byType = Object.fromEntries(
      lines.map(l => [l.line_type, l.unit_price]),
    );
    expect(byType.material).toBe(1000);
    expect(byType.labor).toBe(500);
    expect(byType.equipment).toBe(200);
  });

  it('inlines parent block lines when nested_ahs component resolves', () => {
    const parentCache = new Map<number, FlattenedLine[]>();
    parentCache.set(99, [
      {
        line_type: 'material',
        material_name: 'Semen',
        unit_price: 75000,
        coefficient: 1,
        origin_parent_ahs_id: null,
      },
    ]);
    const components = [
      {
        row_number: 30,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Beton ready-mix' },
        cost_basis: 'nested_ahs' as const,
        ref_cells: null,
        cost_split: null,
        parent_ahs_staging_id: 'block:99',
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, parentCache);
    expect(lines.length).toBe(1);
    expect(lines[0].material_name).toBe('Semen');
    expect(lines[0].origin_parent_ahs_id).toBe('block:99');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tools/__tests__/publishBaselineV2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `tools/publishBaselineV2.ts`:
```ts
import type { CostSplit } from './boqParserV2/types';

export interface FlattenedLine {
  line_type: 'material' | 'labor' | 'equipment' | 'subkon';
  material_name: string;
  unit_price: number;
  coefficient: number;
  origin_parent_ahs_id: string | null;
}

function pd<T = unknown>(row: StagingRowV2, key: string, fallback: T): T {
  const v = (row.parsed_data as Record<string, unknown>)[key];
  return (v ?? fallback) as T;
}

export function flattenBlock(
  components: StagingRowV2[],
  parentCache: Map<number, FlattenedLine[]>,
): FlattenedLine[] {
  const out: FlattenedLine[] = [];
  for (const c of components) {
    const materialName = pd(c, 'material_name', '');
    const coefficient = pd(c, 'coefficient', 1) as number;
    const unitPriceRaw = pd(c, 'unit_price', 0) as number;

    switch (c.cost_basis) {
      case 'catalog':
      case 'takeoff_ref':
      case 'literal':
      case null: {
        const unitPrice =
          c.ref_cells?.unit_price?.cached_value != null
            ? Number(c.ref_cells.unit_price.cached_value)
            : unitPriceRaw;
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit_price: unitPrice,
          coefficient,
          origin_parent_ahs_id: null,
        });
        break;
      }
      case 'cross_ref': {
        const split: CostSplit = c.cost_split ?? {
          material: 0,
          labor: 0,
          equipment: 0,
        };
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit_price: split.material,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'labor',
          material_name: materialName,
          unit_price: split.labor,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'equipment',
          material_name: materialName,
          unit_price: split.equipment,
          coefficient,
          origin_parent_ahs_id: null,
        });
        break;
      }
      case 'nested_ahs': {
        const parentKey = c.parent_ahs_staging_id;
        const match = parentKey ? /^block:(\d+)$/.exec(parentKey) : null;
        const parentRowNumber = match ? Number(match[1]) : null;
        const parentLines =
          parentRowNumber != null ? parentCache.get(parentRowNumber) : null;
        if (parentLines) {
          for (const pl of parentLines) {
            out.push({
              ...pl,
              coefficient: pl.coefficient * coefficient,
              origin_parent_ahs_id: parentKey,
            });
          }
        }
        break;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tools/__tests__/publishBaselineV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/publishBaselineV2.ts tools/__tests__/publishBaselineV2.test.ts
git commit -m "feat(boq-v2): flattenBlock dispatcher per cost_basis"
```

---

### Task 19: Implement `publishBaselineV2` top-level

**Files:**
- Modify: `tools/publishBaselineV2.ts`

- [ ] **Step 1: Sketch the function signature**

Append to `tools/publishBaselineV2.ts`:
```ts
import { supabase } from './supabase';

export async function publishBaselineV2(
  sessionId: string,
  projectId: string,
): Promise<{
  success: boolean;
  error?: string;
  boqCount?: number;
  ahsCount?: number;
  materialCount?: number;
}> {
  const { data: stagingRowsDB, error: fetchErr } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .neq('review_status', 'REJECTED')
    .order('row_number', { ascending: true });

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!stagingRowsDB) return { success: false, error: 'No staging rows' };

  const rows = stagingRowsDB as unknown as StagingRowV2[];

  // Translate DB uuids into row_number keys for topological sort
  const blockRowNumberByUuid = new Map<string, number>();
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      blockRowNumberByUuid.set(
        (r as unknown as { id: string }).id,
        r.row_number,
      );
    }
  }
  // Rewrite parent_ahs_staging_id from uuid form (DB) back to block:<row_number>
  // so topoSort + flatten can work on it.
  for (const r of rows) {
    if (r.cost_basis === 'nested_ahs' && r.parent_ahs_staging_id) {
      const parentUuid = r.parent_ahs_staging_id;
      const parentRow = blockRowNumberByUuid.get(parentUuid);
      if (parentRow != null) {
        r.parent_ahs_staging_id = `block:${parentRow}`;
      }
    }
  }

  const sortedBlocks = topoSortBlocks(rows);

  // Group components by their owning block (determined by staging row order)
  const componentsByBlock = new Map<number, StagingRowV2[]>();
  let currentBlockRow: number | null = null;
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      componentsByBlock.set(currentBlockRow, []);
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null) {
      componentsByBlock.get(currentBlockRow)?.push(r);
    }
  }

  // Flatten parents first — parent cache keyed by block row_number
  const parentCache = new Map<number, FlattenedLine[]>();
  for (const block of sortedBlocks) {
    const components = componentsByBlock.get(block.row_number) ?? [];
    parentCache.set(block.row_number, flattenBlock(components, parentCache));
  }

  // TODO: Write flattened lines into ahs_versions + ahs_lines + boq_items
  // using the same shape as v1 publishBaseline. This step is deferred to
  // Task 20 because it touches real DB tables.

  return {
    success: true,
    boqCount: rows.filter(r => r.row_type === 'boq').length,
    ahsCount: Array.from(parentCache.values()).reduce((n, arr) => n + arr.length, 0),
    materialCount: rows.filter(r => r.row_type === 'material').length,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 3: Commit (stub)**

```bash
git add tools/publishBaselineV2.ts
git commit -m "feat(boq-v2): publishBaselineV2 skeleton — flatten without DB write yet"
```

---

### Task 20: Wire publishBaselineV2 to ahs_versions / ahs_lines / boq_items

**Files:**
- Modify: `tools/publishBaselineV2.ts`

This task reuses the existing v1 insert pattern. Inspect [tools/baseline.ts](tools/baseline.ts) around the `publishBaseline` function to see the exact shape of the v1 inserts, then mirror them here.

- [ ] **Step 1: Read the v1 insert pattern**

```bash
grep -n "ahs_lines\|ahs_versions\|boq_items" tools/baseline.ts | head -30
```

- [ ] **Step 2: Replace the TODO block with real inserts**

Inside `publishBaselineV2`, replace the `// TODO: Write flattened lines...` comment with:

```ts
  // Create new ahs_version for this session
  const { data: versionRow, error: versionErr } = await supabase
    .from('ahs_versions')
    .insert({ project_id: projectId, import_session_id: sessionId, is_current: true })
    .select('id')
    .single();
  if (versionErr || !versionRow) {
    return { success: false, error: versionErr?.message ?? 'version insert failed' };
  }
  const ahsVersionId = versionRow.id as string;

  // Build boq_items map (code → id) by inserting BoQ rows first
  const boqInserts = rows
    .filter(r => r.row_type === 'boq')
    .map(r => {
      const pd = r.parsed_data as { code: string; label: string; unit: string; planned: number };
      return {
        project_id: projectId,
        code: pd.code,
        label: pd.label,
        unit: pd.unit,
        planned: pd.planned,
      };
    });
  const { data: boqData, error: boqErr } = await supabase
    .from('boq_items')
    .upsert(boqInserts, { onConflict: 'project_id,code' })
    .select('id, code');
  if (boqErr) return { success: false, error: boqErr.message };
  const boqIdByCode = new Map<string, string>(
    (boqData ?? []).map(b => [b.code as string, b.id as string]),
  );

  // Now write ahs_lines — one batch per block
  const ahsLineInserts: Record<string, unknown>[] = [];
  for (const block of sortedBlocks) {
    const blockParsed = block.parsed_data as { title: string };
    const lines = parentCache.get(block.row_number) ?? [];
    // Look up which BoQ item this block is linked to.
    // For the first pass we rely on raw_data.linkedBoqCode populated by parser
    // (a future enhancement — skipped here, block may be orphan).
    for (const line of lines) {
      ahsLineInserts.push({
        ahs_version_id: ahsVersionId,
        boq_item_id: null,  // wired in a follow-up
        material_spec: line.material_name,
        coefficient: line.coefficient,
        unit_price: line.unit_price,
        line_type: line.line_type,
        description: line.material_name,
        ahs_block_title: blockParsed.title,
        origin_parent_ahs_id: line.origin_parent_ahs_id ?? null,
      });
    }
  }
  if (ahsLineInserts.length > 0) {
    const { error: lineErr } = await supabase.from('ahs_lines').insert(ahsLineInserts);
    if (lineErr) return { success: false, error: lineErr.message };
  }
```

And update the return:
```ts
  return {
    success: true,
    boqCount: boqInserts.length,
    ahsCount: ahsLineInserts.length,
    materialCount: rows.filter(r => r.row_type === 'material').length,
  };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add tools/publishBaselineV2.ts
git commit -m "feat(boq-v2): wire publishBaselineV2 to ahs_versions + ahs_lines + boq_items"
```

Note: `boq_item_id` wiring is deferred. In the current v1 flow the link is established via `boq_code` on AHS lines; for v2 we establish it in a follow-up task after verifying the basic flow. See Task 21.

---

### Task 21: Link ahs_lines to boq_items via the linked BoQ code stored on each block

**Files:**
- Modify: `tools/boqParserV2/index.ts` (store linked BoQ code on each block)
- Modify: `tools/publishBaselineV2.ts`

- [ ] **Step 1: Parser — populate `linked_boq_code` on ahs_block**

In `tools/boqParserV2/index.ts`, when iterating `boqRows`, detect if any column in the BoQ row points at a block's grand-total address (e.g. `=Analisa!$F$150`) and record the mapping. Add this after the materialRows staging loop but before the block staging loop:

```ts
  // Build a map from Analisa cell address → BoQ code via BoQ row formulas
  const boqCodeByAnalisaAddress = new Map<string, string>();
  for (const b of boqRows) {
    // Look at columns I/J of the BoQ row for linkage formulas
    const iCell = lookup.get(`${boqSheet}!I${b.sourceRow}`);
    const jCell = lookup.get(`${boqSheet}!J${b.sourceRow}`);
    for (const c of [iCell, jCell]) {
      if (!c?.formula) continue;
      const m = /^=?\s*(?:'([^']+)'|([A-Za-z0-9_\- ]+))!\$?([A-Z]+)\$?(\d+)/.exec(c.formula);
      if (m) {
        const sheet = m[1] ?? m[2];
        const addr = `${m[3]}${m[4]}`;
        boqCodeByAnalisaAddress.set(`${sheet}!${addr}`, b.code);
      }
    }
  }
```

Then when emitting the `ahs_block` staging row, extend its `parsed_data` with the linked BoQ code:
```ts
    stagingRows.push({
      row_type: 'ahs_block',
      row_number: blockRowNumber,
      raw_data: {
        titleRow: block.titleRow,
        jumlahRow: block.jumlahRow,
        grandTotalAddress: block.grandTotalAddress,
      },
      parsed_data: {
        title: block.title,
        jumlah_cached_value: block.jumlahCachedValue,
        linked_boq_code: block.grandTotalAddress
          ? boqCodeByAnalisaAddress.get(`${analisaSheet}!${block.grandTotalAddress}`) ?? null
          : null,
      },
      // ...rest unchanged
    });
```

- [ ] **Step 2: publishBaselineV2 — use linked_boq_code to set boq_item_id**

In `publishBaselineV2.ts`, inside the `for (const block of sortedBlocks)` loop, pick up the linked BoQ code:
```ts
    const linkedBoqCode = (block.parsed_data as { linked_boq_code?: string | null })
      .linked_boq_code;
    const linkedBoqId = linkedBoqCode ? boqIdByCode.get(linkedBoqCode) ?? null : null;
```

And replace `boq_item_id: null,` in the insert with `boq_item_id: linkedBoqId,`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Add parseBoqV2 test for BoQ→AHS linkage**

Append to `tools/boqParserV2/__tests__/parseBoqV2.test.ts`:
```ts
it('links ahs_block.linked_boq_code when BoQ row references the block', async () => {
  const buffer = await buildFixtureBuffer([
    {
      name: 'Analisa',
      cells: [
        { address: 'B142', value: '1 m3 Lantai Kerja' },
        { address: 'B144', value: 'Semen' },
        { address: 'E144', value: 75000 },
        { address: 'F144', value: 75000 },
        { address: 'B150', value: 'Jumlah' },
        { address: 'F150', formula: 'SUM(F142:F149)', result: 75000 },
        { address: 'I150', formula: 'F150', result: 75000 },
      ],
    },
    {
      name: 'RAB (A)',
      cells: [
        { address: 'B33', value: 'A.1' },
        { address: 'C33', value: 'Lantai kerja poer' },
        { address: 'D33', value: 100 },
        { address: 'G33', value: 'm3' },
        { address: 'I33', formula: 'Analisa!$F$150', result: 75000 },
      ],
    },
  ]);
  const result = await parseBoqV2(buffer);
  const block = result.stagingRows.find(r => r.row_type === 'ahs_block');
  expect((block?.parsed_data as { linked_boq_code: string }).linked_boq_code).toBe('A.1');
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tools/boqParserV2/__tests__/parseBoqV2.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2 tools/publishBaselineV2.ts
git commit -m "feat(boq-v2): wire ahs_lines to boq_items via parsed linked_boq_code"
```

---

## Phase 2: Dispatcher

### Task 22: Wire v2 into `parseAndStageWorkbook` and `publishBaseline`

**Files:**
- Modify: `tools/baseline.ts`

- [ ] **Step 1: Add dispatcher in `parseAndStageWorkbook`**

Near the top of `parseAndStageWorkbook` (after session lookup), add:
```ts
  // v2 dispatch — if the session is tagged parser_version='v2', use the
  // new parser. v1 path is untouched.
  const { data: sessionRow } = await supabase
    .from('import_sessions')
    .select('parser_version')
    .eq('id', sessionId)
    .single();
  if (sessionRow?.parser_version === 'v2') {
    const { parseBoqV2 } = await import('./boqParserV2');
    const v2Result = await parseBoqV2(
      typeof fileInput === 'string' ? new Uint8Array() : fileInput as ArrayBuffer,
    );
    // Insert v2 staging rows with the new fields populated.
    const inserts = v2Result.stagingRows.map(r => ({
      session_id: sessionId,
      row_number: r.row_number,
      row_type: r.row_type,
      raw_data: r.raw_data,
      parsed_data: r.parsed_data,
      needs_review: r.needs_review,
      confidence: r.confidence,
      review_status: r.review_status,
      cost_basis: r.cost_basis,
      parent_ahs_staging_id: null, // post-fixed below after rows have UUIDs
      ref_cells: r.ref_cells,
      cost_split: r.cost_split,
    }));
    const { data: inserted, error: insErr } = await supabase
      .from('import_staging_rows')
      .insert(inserts)
      .select('id, row_number');
    if (insErr) return { success: false, error: insErr.message };

    // Post-fix: translate `block:<row_number>` synthetic parent keys to
    // real UUIDs now that rows have IDs.
    const uuidByRowNumber = new Map<number, string>();
    for (const ins of inserted ?? []) {
      uuidByRowNumber.set(ins.row_number as number, ins.id as string);
    }
    const parentUpdates: Array<{ id: string; parent_uuid: string }> = [];
    for (let i = 0; i < v2Result.stagingRows.length; i++) {
      const sr = v2Result.stagingRows[i];
      if (sr.cost_basis !== 'nested_ahs' || !sr.parent_ahs_staging_id) continue;
      const m = /^block:(\d+)$/.exec(sr.parent_ahs_staging_id);
      if (!m) continue;
      const parentRow = Number(m[1]);
      const parentUuid = uuidByRowNumber.get(parentRow);
      const childUuid = uuidByRowNumber.get(sr.row_number);
      if (parentUuid && childUuid) {
        parentUpdates.push({ id: childUuid, parent_uuid: parentUuid });
      }
    }
    for (const u of parentUpdates) {
      await supabase
        .from('import_staging_rows')
        .update({ parent_ahs_staging_id: u.parent_uuid })
        .eq('id', u.id);
    }

    // Store validation report
    await supabase
      .from('import_sessions')
      .update({ validation_report: v2Result.validationReport, status: 'REVIEW' })
      .eq('id', sessionId);

    return { success: true };
  }
```

- [ ] **Step 2: Add dispatcher in `publishBaseline`**

Near the top of `publishBaseline` (after session lookup):
```ts
  const { data: session } = await supabase
    .from('import_sessions')
    .select('parser_version')
    .eq('id', sessionId)
    .single();
  if (session?.parser_version === 'v2') {
    const { publishBaselineV2 } = await import('./publishBaselineV2');
    return publishBaselineV2(sessionId, projectId);
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass; v2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/baseline.ts
git commit -m "feat(boq-v2): dispatch v2 parser + publish from baseline.ts based on parser_version"
```

---

## Phase 2: Dry-Run Dev Route

### Task 23: Hidden dev-only dry-run route (smoke test v2 against real workbooks)

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` (add a dev-only button)

- [ ] **Step 1: Add dry-run button**

At the top of `BaselineScreen.tsx`, find the component function body. Add a handler:

```ts
  const handleDryRunV2 = async () => {
    if (!__DEV__) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const response = await fetch(picked.assets[0].uri);
      const buffer = await response.arrayBuffer();
      const { parseBoqV2 } = await import('../../tools/boqParserV2');
      const result = await parseBoqV2(buffer);
      console.log('[parseBoqV2 dry-run]', {
        materials: result.materialRows.length,
        blocks: result.ahsBlocks.length,
        boqRows: result.boqRows.length,
        validation: result.validationReport,
        staging: result.stagingRows.slice(0, 5), // sample
      });
      Alert.alert(
        'Dry run complete',
        `Materials: ${result.materialRows.length}\nBlocks: ${result.ahsBlocks.length}\nBoQ rows: ${result.boqRows.length}`,
      );
    } catch (e) {
      Alert.alert('Dry run failed', e instanceof Error ? e.message : String(e));
    }
  };
```

Then in the JSX, inside a `{__DEV__ && (...)}` block, render:
```tsx
{__DEV__ && (
  <TouchableOpacity onPress={handleDryRunV2} style={{ padding: 12, backgroundColor: '#333' }}>
    <Text style={{ color: '#fff' }}>DEV: Dry-run parseBoqV2</Text>
  </TouchableOpacity>
)}
```

- [ ] **Step 2: Manual verification**

Start the dev server: `npm start`
Open the app, navigate to BaselineScreen, tap "DEV: Dry-run parseBoqV2", pick the Pakuwon Indah AAL-5 file, verify the console log shows sensible non-zero counts and the validation report lists the AHS blocks from Analisa.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git commit -m "chore(boq-v2): add dev-only dry-run button for parseBoqV2"
```

---

## Phase 3: Audit Pivot Extensions

### Task 24: Extend `AuditAhsRow` with v2 fields

**Files:**
- Modify: `tools/auditPivot.ts`

- [ ] **Step 1: Add v2 fields to AuditAhsRow**

Open `tools/auditPivot.ts` and extend the `AuditAhsRow` interface (around line 32–53):
```ts
export interface AuditAhsRow {
  // ...existing fields unchanged...
  // v2-only — present on rows parsed by boqParserV2, null for v1 rows
  costBasis: CostBasis | null;
  parentAhsStagingId: string | null;
  refCells: RefCells | null;
  costSplit: CostSplit | null;
  parserVersion: 'v1' | 'v2';
}
```

Add the import at the top:
```ts
import type {
  CostBasis,
  RefCells,
  CostSplit,
} from './boqParserV2/types';
```

- [ ] **Step 2: Populate the new fields in `extractAhsRows`**

In the `.map(r => { ... })` call inside `extractAhsRows`, add at the end of the returned object:
```ts
        costBasis: (r as unknown as { cost_basis: CostBasis | null }).cost_basis ?? null,
        parentAhsStagingId: (r as unknown as { parent_ahs_staging_id: string | null }).parent_ahs_staging_id ?? null,
        refCells: (r as unknown as { ref_cells: RefCells | null }).ref_cells ?? null,
        costSplit: (r as unknown as { cost_split: CostSplit | null }).cost_split ?? null,
        parserVersion: ((r as unknown as { parser_version?: string }).parser_version ?? 'v1') as 'v1' | 'v2',
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Run existing pivot tests**

Run: `npm test -- tools/auditPivot 2>/dev/null || echo 'no existing tests'`
Expected: All green (or no tests found — acceptable).

- [ ] **Step 5: Commit**

```bash
git add tools/auditPivot.ts
git commit -m "feat(boq-v2): extend AuditAhsRow with v2 classification fields"
```

---

### Task 25: Add `validationStatus` to `AhsBlockView` and populate from `parsed_data`

**Files:**
- Modify: `tools/auditPivot.ts`

- [ ] **Step 1: Extend `AhsBlockView` type**

Near the existing `AhsBlockView` interface (around line 354):
```ts
export interface AhsBlockView {
  // ...existing fields...
  validationStatus: 'ok' | 'imbalanced' | 'has_nested' | null;
  validationDelta: number;
}
```

- [ ] **Step 2: Populate in `pivotByAhsBlock`**

Inside the reduce/sort at the end of `pivotByAhsBlock`, set:
```ts
  // Determine validation status from component costBasis
  const hasNested = bucket.components.some(c => c.ahs.costBasis === 'nested_ahs');
  const expected = ... // from block.jumlahCachedValue
  const actual = bucket.totals.grand;
  const delta = actual - expected;
  bucket.validationStatus =
    hasNested ? 'has_nested' : Math.abs(delta) <= 1 ? 'ok' : 'imbalanced';
  bucket.validationDelta = delta;
```

Note: the existing `pivotByAhsBlock` already has a loop building buckets. Add the status/delta after the bucket is finalized. If `block.jumlahCachedValue` isn't available on the current AuditAhsRow, skip this step and fall back to `validationStatus: null` for now — validation badges will use the `import_sessions.validation_report` JSON directly in the UI task (Task 27).

- [ ] **Step 3: Typecheck + test**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add tools/auditPivot.ts
git commit -m "feat(boq-v2): add validationStatus + validationDelta to AhsBlockView"
```

---

## Phase 3: Audit Screen — Trace Chip

### Task 26: Render trace chip next to AHS component unit price (v2 rows only)

**Files:**
- Modify: `workflows/screens/AuditTraceScreen.tsx`

- [ ] **Step 1: Add chip component**

Near the top of `AuditTraceScreen.tsx`, add:
```tsx
import type { CostBasis } from '../../tools/boqParserV2/types';

const CHIP_STYLES: Record<
  CostBasis,
  { bg: string; fg: string; label: (row: any) => string }
> = {
  catalog: {
    bg: '#e6f4ff',
    fg: '#0958d9',
    label: row => `Katalog: ${row.refCells?.unit_price?.sheet ?? '?'}!${row.refCells?.unit_price?.cell ?? '?'}`,
  },
  nested_ahs: {
    bg: '#e0f2e9',
    fg: '#237804',
    label: row => `Turunan: ${row.refCells?.unit_price?.sheet ?? '?'}!${row.refCells?.unit_price?.cell ?? '?'}`,
  },
  literal: {
    bg: '#fff7e6',
    fg: '#d48806',
    label: () => 'Literal (hardcoded)',
  },
  takeoff_ref: {
    bg: '#e6f4ff',
    fg: '#0958d9',
    label: row => `Takeoff: ${row.refCells?.quantity?.[0]?.sheet ?? '?'}!${row.refCells?.quantity?.[0]?.cell ?? '?'}`,
  },
  cross_ref: {
    bg: '#fff1f0',
    fg: '#cf1322',
    label: () => 'Split F/G/H',
  },
};

function TraceChip({ row }: { row: AuditAhsRow }) {
  if (row.parserVersion !== 'v2' || !row.costBasis) return null;
  const cfg = CHIP_STYLES[row.costBasis];
  return (
    <View style={{
      backgroundColor: cfg.bg,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginLeft: 8,
    }}>
      <Text style={{ color: cfg.fg, fontSize: 11 }}>{cfg.label(row)}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Render in the AHS component row**

Find where AHS component rows render their unit price in `AuditTraceScreen.tsx`. Add `<TraceChip row={row} />` adjacent to the unit price text.

- [ ] **Step 3: Manual verification**

Run: `npm start`, open a v2 session in the audit screen, verify chips show up on AHS components with correct labels.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/AuditTraceScreen.tsx
git commit -m "feat(boq-v2): trace chip next to v2 AHS component unit price"
```

---

### Task 27: Render validation badges on AHS block headers

**Files:**
- Modify: `workflows/screens/AuditTraceScreen.tsx`

- [ ] **Step 1: Fetch validation_report on screen mount**

In `AuditTraceScreen.tsx`, add state and effect:
```tsx
const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);

useEffect(() => {
  (async () => {
    const { data } = await supabase
      .from('import_sessions')
      .select('validation_report')
      .eq('id', sessionId)
      .single();
    setValidationReport((data?.validation_report as ValidationReport | null) ?? null);
  })();
}, [sessionId]);
```

- [ ] **Step 2: Render badge on each block header**

For each block rendered in the AHS tab, look up its status:
```tsx
function ValidationBadge({ title }: { title: string }) {
  const entry = validationReport?.blocks.find(b => b.block_title === title);
  if (!entry) return null;
  if (entry.status === 'ok') {
    return <Text style={{ color: '#237804', fontSize: 12 }}>✓ balanced</Text>;
  }
  return (
    <Text style={{ color: '#d48806', fontSize: 12 }}>
      ⚠ Tidak balans: Rp {entry.delta.toLocaleString('id-ID')}
    </Text>
  );
}
```

Render `<ValidationBadge title={block.title} />` next to each AHS block title.

- [ ] **Step 3: Manual verification**

Run: `npm start`, open a v2 audit session with a known-imbalanced block, verify the orange badge shows with the correct delta.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/AuditTraceScreen.tsx
git commit -m "feat(boq-v2): validation badges on AHS block headers"
```

---

## Phase 3: Inline Edit Panel (Hard UI Constraint)

### Task 28: Inline edit panel anchored under tapped card

**Files:**
- Modify: `workflows/screens/AuditTraceScreen.tsx`

**UI rule:** The edit form must expand as a direct child of the tapped card, pushing subsequent cards down. Never a modal. Only one editor open at a time.

- [ ] **Step 1: Add state for the single currently-expanded row**

In the screen component:
```tsx
const [expandedEditKey, setExpandedEditKey] = useState<string | null>(null);
// Key format: `${rowType}:${stagingId}` e.g. "ahs:uuid"
```

- [ ] **Step 2: Wrap each editable card with a "Edit" button**

For every card that displays a v2 row (material, boq, ahs), add:
```tsx
<TouchableOpacity
  onPress={() => setExpandedEditKey(prev =>
    prev === `ahs:${row.stagingId}` ? null : `ahs:${row.stagingId}`,
  )}
>
  <Text style={{ color: '#1677ff' }}>Edit</Text>
</TouchableOpacity>
```

Below the card body, conditionally render the edit form:
```tsx
{expandedEditKey === `ahs:${row.stagingId}` && (
  <View style={{
    padding: 12,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 4,
    marginTop: 4,
  }}>
    <EditAhsComponentForm
      row={row}
      onSave={(patch) => {
        updateStagingRowAudit(row.stagingId, patch);
        setExpandedEditKey(null);
      }}
      onCancel={() => setExpandedEditKey(null)}
    />
  </View>
)}
```

- [ ] **Step 3: Implement `EditAhsComponentForm`**

Inside `AuditTraceScreen.tsx` (or a new helper file if it grows too large):
```tsx
function EditAhsComponentForm({
  row,
  onSave,
  onCancel,
}: {
  row: AuditAhsRow;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [coefficient, setCoefficient] = useState(String(row.coefficient ?? ''));
  const [unitPrice, setUnitPrice] = useState(String(row.unitPrice ?? ''));
  const [materialName, setMaterialName] = useState(row.materialName ?? '');
  return (
    <View>
      <Text>Koefisien</Text>
      <TextInput
        value={coefficient}
        onChangeText={setCoefficient}
        keyboardType="numeric"
        style={{ borderWidth: 1, borderColor: '#d9d9d9', padding: 6 }}
      />
      <Text>Harga Satuan</Text>
      <TextInput
        value={unitPrice}
        onChangeText={setUnitPrice}
        keyboardType="numeric"
        style={{ borderWidth: 1, borderColor: '#d9d9d9', padding: 6 }}
      />
      <Text>Nama Material</Text>
      <TextInput
        value={materialName}
        onChangeText={setMaterialName}
        style={{ borderWidth: 1, borderColor: '#d9d9d9', padding: 6 }}
      />
      <View style={{ flexDirection: 'row', marginTop: 8 }}>
        <TouchableOpacity onPress={onCancel} style={{ padding: 8 }}>
          <Text>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            onSave({
              coefficient: Number(coefficient),
              unit_price: Number(unitPrice),
              material_name: materialName,
            })
          }
          style={{ padding: 8 }}
        >
          <Text style={{ color: '#1677ff' }}>Simpan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Manual verification**

Run: `npm start`, open the v2 audit session, tap "Edit" on an AHS component card — verify the form appears directly below that card, not as a modal, not floating. Tap another card's Edit — verify the first editor collapses and the new one appears anchored to the new card.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/AuditTraceScreen.tsx
git commit -m "feat(boq-v2): inline edit panel anchored under tapped card"
```

---

### Task 29: Wire edits into `import_staging_edits` for undo history

**Files:**
- Modify: `workflows/screens/AuditTraceScreen.tsx`

- [ ] **Step 1: Log edits before applying them**

Wrap every `updateStagingRowAudit` call with a helper that writes to `import_staging_edits`:
```tsx
async function logAndUpdateStagingRow(
  sessionId: string,
  stagingId: string,
  patch: Record<string, unknown>,
  oldValues: Record<string, unknown>,
  userId: string,
) {
  for (const [field, newValue] of Object.entries(patch)) {
    await supabase.from('import_staging_edits').insert({
      staging_row_id: stagingId,
      import_session_id: sessionId,
      edited_by: userId,
      field_path: `parsed_data.${field}`,
      old_value: oldValues[field] ?? null,
      new_value: newValue,
    });
  }
  return updateStagingRowAudit(stagingId, patch);
}
```

Replace direct `updateStagingRowAudit(...)` calls inside the edit form's `onSave` with `logAndUpdateStagingRow(...)`.

- [ ] **Step 2: Add Undo button in header**

```tsx
const handleUndo = async () => {
  const { data: lastEdit } = await supabase
    .from('import_staging_edits')
    .select('*')
    .eq('import_session_id', sessionId)
    .order('edited_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastEdit) return;
  // Revert the field — reconstruct the patch from field_path
  const field = (lastEdit.field_path as string).replace(/^parsed_data\./, '');
  await updateStagingRowAudit(lastEdit.staging_row_id as string, {
    [field]: lastEdit.old_value,
  });
  // Delete the edit record so we don't undo the same thing twice
  await supabase.from('import_staging_edits').delete().eq('id', lastEdit.id);
  // Refresh the pivot
  await loadStagingRows();
};
```

Render `<TouchableOpacity onPress={handleUndo}><Text>Undo</Text></TouchableOpacity>` in the header.

- [ ] **Step 3: Manual verification**

Run: `npm start`, edit a field, tap Undo, verify the field reverts.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/AuditTraceScreen.tsx
git commit -m "feat(boq-v2): edit history + undo button via import_staging_edits"
```

---

## Phase 3: Fuzzy Material Picker

### Task 30: Fuzzy material ambiguity picker in Material tab

**Files:**
- Modify: `workflows/screens/AuditTraceScreen.tsx`

- [ ] **Step 1: Load catalog on mount**

```tsx
const [catalog, setCatalog] = useState<Array<{ id: string; name: string }>>([]);

useEffect(() => {
  (async () => {
    const { data } = await supabase.from('material_catalog').select('id, name');
    setCatalog(data ?? []);
  })();
}, []);
```

- [ ] **Step 2: Compute ambiguous rows per material**

For each material pivot row without an exact catalog match, run:
```tsx
import { fuzzyMatchMaterial } from '../../tools/materialMatch';
const candidates = fuzzyMatchMaterial(row.materialName, catalog);
const topScore = candidates[0]?.score ?? 0;
const badge =
  topScore >= 0.9 ? 'check' : candidates.length > 0 ? 'ambigu' : 'none';
```

- [ ] **Step 3: Render "Ambigu" badge + inline picker**

```tsx
{badge === 'ambigu' && (
  <TouchableOpacity onPress={() => setExpandedEditKey(`material:${row.stagingId}`)}>
    <Text style={{ color: '#cf1322' }}>Ambigu — pilih</Text>
  </TouchableOpacity>
)}
{expandedEditKey === `material:${row.stagingId}` && (
  <View style={{ backgroundColor: '#fafafa', padding: 8 }}>
    {candidates.slice(0, 5).map(c => (
      <TouchableOpacity
        key={c.id}
        onPress={() => {
          updateStagingRowAudit(row.stagingId, { material_id: c.id });
          setExpandedEditKey(null);
        }}
      >
        <Text>{c.name} — {(c.score * 100).toFixed(0)}%</Text>
      </TouchableOpacity>
    ))}
    <TouchableOpacity onPress={() => { /* create new catalog entry */ }}>
      <Text>+ Buat entry katalog baru</Text>
    </TouchableOpacity>
  </View>
)}
```

- [ ] **Step 4: Manual verification**

Run: `npm start`, open a v2 session, verify Ambigu badges appear on non-exact-match materials and the picker expands inline.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/AuditTraceScreen.tsx
git commit -m "feat(boq-v2): fuzzy material ambiguity picker in audit screen"
```

---

## Phase 4: Parser Version Toggle in Import Screen

### Task 31: Add parser version toggle (principal/admin only)

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx`

- [ ] **Step 1: Add toggle state**

```tsx
const [parserVersion, setParserVersion] = useState<'v1' | 'v2'>('v1');
const canSeeToggle = profile?.role === 'principal' || profile?.role === 'admin';
```

- [ ] **Step 2: Render the toggle**

Inside the existing form, above the "Parse" button:
```tsx
{canSeeToggle && (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
    <Text style={{ marginRight: 8 }}>Parser:</Text>
    <TouchableOpacity
      onPress={() => setParserVersion('v1')}
      style={{
        padding: 8,
        backgroundColor: parserVersion === 'v1' ? '#1677ff' : '#f0f0f0',
        borderRadius: 4,
        marginRight: 4,
      }}
    >
      <Text style={{ color: parserVersion === 'v1' ? '#fff' : '#000' }}>v1 (stable)</Text>
    </TouchableOpacity>
    <TouchableOpacity
      onPress={() => setParserVersion('v2')}
      style={{
        padding: 8,
        backgroundColor: parserVersion === 'v2' ? '#1677ff' : '#f0f0f0',
        borderRadius: 4,
      }}
    >
      <Text style={{ color: parserVersion === 'v2' ? '#fff' : '#000' }}>v2 (beta)</Text>
    </TouchableOpacity>
  </View>
)}
```

- [ ] **Step 3: Pass `parser_version` on session create**

Find the existing `createImportSession(...)` call and update the session row created by baseline.ts to set `parser_version: parserVersion`. If `createImportSession` doesn't accept it as a param, extend it:

Modify `tools/baseline.ts`:
```ts
export async function createImportSession(
  projectId: string,
  userId: string,
  filePath: string,
  fileName: string,
  parserVersion: 'v1' | 'v2' = 'v1',
): Promise<{ session: ImportSession | null; error: string | null }> {
  const { data, error } = await supabase
    .from('import_sessions')
    .insert({
      project_id: projectId,
      uploaded_by: userId,
      file_path: filePath,
      file_name: fileName,
      parser_version: parserVersion,
      status: 'DRAFT',
    })
    .select()
    .single();
  // ...existing return
}
```

And pass `parserVersion` from `BaselineScreen.tsx` when calling it.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 5: Manual verification**

Run: `npm start`, log in as principal, verify toggle appears. Upload a workbook with v2 selected, verify the session in the DB has `parser_version = 'v2'`, and audit screen renders v2 affordances.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx tools/baseline.ts
git commit -m "feat(boq-v2): parser version toggle in import screen (principal/admin only)"
```

---

## Phase 4: End-to-End Smoke Test

### Task 32: Full E2E manual smoke — import real workbook with v2

**Files:** none

- [ ] **Step 1: Start dev server**

Run: `npm start`

- [ ] **Step 2: Log in as principal**

- [ ] **Step 3: Create a fresh test project**

- [ ] **Step 4: Import Pakuwon Indah AAL-5 workbook with parser toggle set to v2**

- [ ] **Step 5: Verify audit screen renders**

- Every AHS component has a trace chip
- At least one `nested_ahs` trace chip visible
- At least one `cross_ref` trace chip (rebar rows) visible
- `literal` trace chip visible on E52/E62 hardcoded rows
- Validation badges appear on block headers
- Total block count in the AHS tab matches what a spot-check of the workbook shows (~30–60 blocks expected)

- [ ] **Step 6: Confirm all literals + ambiguous materials**

Use the edit form and "Konfirmasi semua literal" bulk button to clear blocking rules.

- [ ] **Step 7: Publish**

Verify:
- `ahs_versions` has a new row for this session
- `ahs_lines` has non-zero rows
- `boq_items` has rows matching the RAB (A) sheet
- No `unit_price = 0` on any ahs_line (the original v1 bug)
- At least some `ahs_lines` have `origin_parent_ahs_id` set (proving nested unfolding worked)

- [ ] **Step 8: Compare against v1 import of same file**

Create a second test project, import the same file with v1, spot-check:
- BoQ total line count matches ±10% between v1 and v2 (some blocks may produce more lines under v2 due to cost_split unfolding)
- Total estimated project value matches within 1% between v1 and v2

If totals diverge significantly, investigate — the v2 numbers should be closer to what the estimator expects because v1 was missing nested chains and rebar splits.

- [ ] **Step 9: Document findings**

Append a short note to the spec at `docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md` under a new `## Trial Run Notes` section with the block count, the line count delta, and any discrepancies found. Commit:
```bash
git add docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md
git commit -m "docs(boq-v2): trial run findings from Pakuwon Indah AAL-5"
```

---

## Phases 5–7: Operational (not coded)

**Phase 5 — Real-world trial** (1–2 weeks calendar, minimal dev work): Import the next 2–3 real projects twice, once with v1 (official) and once with v2 (comparison). Compare published `ahs_lines` and `boq_items` totals. Fix any discrepancies found in v2. No code tasks pre-planned; each discrepancy becomes its own ad-hoc fix task.

**Phase 6 — Default v2** (15 min): Change the default of `parserVersion` in `BaselineScreen.tsx` from `'v1'` to `'v2'`. v1 still available via the toggle. Commit + deploy.

**Phase 7 — Sunset v1** (only after ≥4 weeks of clean v2 production): Delete `tools/baseline.ts` v1 parser paths, `tools/excelParser.ts`, v1 branches in audit screen. Keep `parsed_data` / `raw_data` columns and `parser_version` column forever for historical sessions. Out of scope for this plan — create a new plan when Phase 6 has been stable for a month.

---

## Plan Self-Review Notes

1. **Spec coverage:** Every section of the spec maps to at least one task.
   - §1 Data Model → Task 1, Task 2
   - §2 Parser Passes → Tasks 7, 11, 12, 13, 14, 15, 16
   - §3 Audit Integration → Tasks 24, 25, 26, 27, 28, 29, 30
   - §4 Validation & Publish → Tasks 13, 17, 18, 19, 20, 21
   - §5 Migration Plan → Tasks 1 (Phase 0), 22 (Phase 4 dispatcher), 31 (Phase 4 toggle), 32 (Phase 5 smoke), Phases 5–7 noted as operational

2. **Type consistency:** `StagingRowV2`, `HarvestedCell`, `CostBasis`, `RefCells`, `CostSplit`, `ValidationReport`, `AhsBlock`, `FlattenedLine`, `BoqRowV2`, `CatalogRow`, `FuzzyMatchCandidate` all defined once and referenced consistently across tasks.

3. **Known deferrals** (explicit in plan, not placeholder):
   - `flattenBlock` uses `material_name` as its primary field; material catalog ID resolution during publish is deferred to a future iteration (noted in Task 20).
   - `pivotByAhsBlock` may set `validationStatus: null` for v1 rows — badges in the UI rely on the `validation_report` JSON directly (Task 27).
   - Full rebar takeoff chain unfolding (Besi Balok → REKAP Balok → RAB) uses cached values only; no re-computation of SUMIFS.
---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-15-boq-parser-v2.md`.
