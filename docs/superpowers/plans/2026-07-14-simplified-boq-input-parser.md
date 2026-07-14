# Simplified BoQ Input Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parser that turns the team's two-sheet "SANO Input" workbook into `boq_items` + material-link balance, reusing the existing staging → review → publish pipeline unchanged.

**Architecture:** "Pre-solved AHS adapter" (Scheme A). A new `tools/simplifiedInput/` module emits the same `StagingRowV2[]` shape as `parseBoqV2` — `boq` rows carrying hand-built recipes where each material's quantity becomes a coefficient. `publishBaselineV2` then builds `boq_items`, `ahs_lines`, and `project_material_master_lines` from those recipes with **zero changes to publish**. A migration adds isolated tier-1 / batang catalog rows the simplified format links to, leaving existing rows untouched.

**Tech Stack:** TypeScript, SheetJS (`xlsx`), Jest + ts-jest, Supabase (Postgres), migrations pasted via Dashboard SQL editor.

## Global Constraints

- **Truth-correctness (CLAUDE.md §1.1 / §12):** never emit a confident-looking wrong number. Structural problems → `needs_review: true`, never a silent guess or drop.
- **Reuse publish unchanged:** no edits to `tools/publishBaselineV2.ts`, the envelope views, the Tier gates, or the work-group classifier.
- **Rebar stays batang end-to-end** — no kg round-trip. Link to the *isolated* batang catalog rows from migration 082; never touch the existing kg rebar rows (887 lines across 3 projects depend on them).
- **Migrations are idempotent and Dashboard-pasteable** (remote history is out of sync; `supabase db push` is broken).
- **File wins on tier/price, but the shared catalog is never silently mutated** — matched-material conflicts are flagged for review, not written over.
- **`chapter` → `raw_data.chapter`, `sub_chapter` → `raw_data.subChapter`** (that is where `buildBoqItemInsert` reads them).
- **Material names must reconcile via the existing exact→alias→fuzzy matcher** (`reconcileMaterials`, exact match at confidence 1.0). Emit exact catalog names for beton + rebar; Others names pass through verbatim (all 13 exact-match the catalog).

## Dependency graph (for parallel execution)

```
Task 1 (rebar.ts) ─┐
Task 2 (staging.ts)─┼─> Task 3 (tier1.ts) ─┐
                    └─> Task 4 (others.ts) ─┼─> Task 5 (index.ts) ─> Task 6 (baseline wiring)
Task 7 (migration 082) — independent                              └─> Task 8 (reconcile helper) ─> Task 9 (integration test)
```

Independent starting points that may run as parallel subagents: **Task 1**, **Task 2**, and **Task 7**. Task 3 needs 1+2; Task 4 needs 2; Task 5 needs 3+4; Task 6 needs 5; Task 8 needs 5; Task 9 needs everything.

---

### Task 1: Rebar batang component builder

**Files:**
- Create: `tools/simplifiedInput/rebar.ts`
- Test: `tools/simplifiedInput/__tests__/rebar.test.ts`

**Interfaces:**
- Consumes: `RecipeComponent` from `tools/boqParserV2/types.ts`.
- Produces:
  - `REBAR_COLUMNS: Array<{ col: string; diameter: number }>` — the Tier-1 sheet's fixed C–H order.
  - `REBAR_BATANG_BY_DIAMETER: Record<number, { code: string; name: string }>`.
  - `buildRebarComponent(diameter: number, lonjor: number, betonM3: number, sourceSheet: string, sourceAddress: string): RecipeComponent`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/rebar.test.ts
import { buildRebarComponent, REBAR_BATANG_BY_DIAMETER, REBAR_COLUMNS } from '../rebar';

describe('rebar batang component builder', () => {
  it('maps the six file diameters to the isolated batang catalog rows', () => {
    expect(REBAR_COLUMNS.map((c) => c.diameter)).toEqual([8, 10, 13, 16, 19, 22]);
    expect(REBAR_BATANG_BY_DIAMETER[10]).toEqual({
      code: 'REB-DE10-BTG',
      name: 'Besi beton ulir 10 mm (batang)',
    });
    expect(REBAR_BATANG_BY_DIAMETER[8].name).toBe('Besi beton polos 8 mm (batang)');
  });

  it('builds a batang component whose coefficient reproduces the lonjor count', () => {
    const betonM3 = 39.02277465724567; // "Lt. Basement ; Kolom" beton volume
    const lonjor = 517; // ø10 count
    const c = buildRebarComponent(10, lonjor, betonM3, 'SANO Input Tier 1', 'D14');
    expect(c.materialName).toBe('Besi beton ulir 10 mm (batang)');
    expect(c.unit).toBe('batang');
    expect(c.lineType).toBe('material');
    expect(c.unitPrice).toBe(0);
    // master_planned = boq.planned (betonM3) × coefficient must equal the lonjor count
    expect(c.quantityPerUnit * betonM3).toBeCloseTo(lonjor, 6);
  });

  it('throws on a diameter with no batang mapping', () => {
    expect(() => buildRebarComponent(25, 10, 5, 'S', 'A1')).toThrow(/diameter 25/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/rebar.test.ts`
Expected: FAIL — cannot find module `../rebar`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/rebar.ts
import type { RecipeComponent } from '../boqParserV2/types';

/**
 * File rebar diameter (mm) → the ISOLATED batang catalog row it links to.
 * Names are the EXACT catalog names inserted by migration 082 so
 * reconcileMaterials' exact-match tier links them to the batang rows, never
 * the near-identical kg rows (see spec §5.4). Only the six diameters the
 * simplified format uses are mapped.
 */
export const REBAR_BATANG_BY_DIAMETER: Record<number, { code: string; name: string }> = {
  8: { code: 'REB-PL08-BTG', name: 'Besi beton polos 8 mm (batang)' },
  10: { code: 'REB-DE10-BTG', name: 'Besi beton ulir 10 mm (batang)' },
  13: { code: 'REB-DE13-BTG', name: 'Besi beton ulir 13 mm (batang)' },
  16: { code: 'REB-DE16-BTG', name: 'Besi beton ulir 16 mm (batang)' },
  19: { code: 'REB-DE19-BTG', name: 'Besi beton ulir 19 mm (batang)' },
  22: { code: 'REB-DE22-BTG', name: 'Besi beton ulir 22 mm (batang)' },
};

/** Tier-1 sheet's fixed rebar columns C–H, in diameter order. */
export const REBAR_COLUMNS: Array<{ col: string; diameter: number }> = [
  { col: 'C', diameter: 8 },
  { col: 'D', diameter: 10 },
  { col: 'E', diameter: 13 },
  { col: 'F', diameter: 16 },
  { col: 'G', diameter: 19 },
  { col: 'H', diameter: 22 },
];

/**
 * One rebar diameter of one work area → a recipe component in batang.
 * coefficient = lonjor per beton-m³, so master_planned = betonM3 × coefficient
 * = the original whole-lonjor count. unitPrice 0 (Tier-1 material cost untracked).
 */
export function buildRebarComponent(
  diameter: number,
  lonjor: number,
  betonM3: number,
  sourceSheet: string,
  sourceAddress: string,
): RecipeComponent {
  const target = REBAR_BATANG_BY_DIAMETER[diameter];
  if (!target) throw new Error(`No batang rebar mapping for diameter ${diameter}`);
  const quantityPerUnit = betonM3 > 0 ? lonjor / betonM3 : 0;
  return {
    sourceCell: { sheet: sourceSheet, address: sourceAddress },
    referencedCell: { sheet: sourceSheet, address: sourceAddress },
    referencedBlockTitle: null,
    referencedBlockRow: null,
    quantityPerUnit,
    unitPrice: 0,
    costContribution: 0,
    lineType: 'material',
    confidence: 1,
    unit: 'batang',
    materialName: target.name,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/rebar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/simplifiedInput/rebar.ts tools/simplifiedInput/__tests__/rebar.test.ts
git commit -m "feat(simplified-input): rebar batang component builder"
```

---

### Task 2: Shared BoQ staging-row helper

**Files:**
- Create: `tools/simplifiedInput/staging.ts`
- Test: `tools/simplifiedInput/__tests__/staging.test.ts`

**Interfaces:**
- Consumes: `StagingRowV2`, `BoqRowRecipe` from `tools/boqParserV2/types.ts`.
- Produces:
  - `splitLabel(label: string): { chapter: string; subChapter: string | null }`.
  - `makeBoqStagingRow(input: BoqStagingInput): StagingRowV2` where
    `BoqStagingInput = { code: string; label: string; chapter: string; subChapter: string | null; unit: string; planned: number; recipe: BoqRowRecipe; sourceSheet: string; sourceRow: number; rowNumber: number; extraRaw?: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/staging.test.ts
import { splitLabel, makeBoqStagingRow } from '../staging';
import type { BoqRowRecipe } from '../../boqParserV2/types';

const emptyRecipe: BoqRowRecipe = {
  perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
  subkonPerUnit: 0,
  components: [],
  markup: null,
  totalCached: 0,
};

describe('splitLabel', () => {
  it('splits "Zone ; Element" into chapter + sub_chapter', () => {
    expect(splitLabel('Lt. Basement ; Kolom')).toEqual({ chapter: 'Lt. Basement', subChapter: 'Kolom' });
  });
  it('treats a label with no semicolon as chapter-only', () => {
    expect(splitLabel('Bunker')).toEqual({ chapter: 'Bunker', subChapter: null });
  });
  it('handles a trailing semicolon as null sub_chapter', () => {
    expect(splitLabel('Foo ;')).toEqual({ chapter: 'Foo', subChapter: null });
  });
});

describe('makeBoqStagingRow', () => {
  const base = {
    code: 'T1-001', label: 'Lt. Basement ; Kolom', chapter: 'Lt. Basement',
    subChapter: 'Kolom', unit: 'm³', planned: 39.02, recipe: emptyRecipe,
    sourceSheet: 'SANO Input Tier 1', sourceRow: 14, rowNumber: 1,
  };
  it('emits a boq row with chapter/subChapter in raw_data (where publish reads them)', () => {
    const row = makeBoqStagingRow(base);
    expect(row.row_type).toBe('boq');
    expect(row.raw_data.chapter).toBe('Lt. Basement');
    expect(row.raw_data.subChapter).toBe('Kolom');
    expect(row.parsed_data.code).toBe('T1-001');
    expect(row.parsed_data.planned).toBe(39.02);
    expect(row.parsed_data.recipe).toBe(emptyRecipe);
    expect(row.needs_review).toBe(false);
  });
  it('flags needs_review when planned is not > 0', () => {
    expect(makeBoqStagingRow({ ...base, planned: 0 }).needs_review).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/staging.test.ts`
Expected: FAIL — cannot find module `../staging`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/staging.ts
import type { StagingRowV2, BoqRowRecipe } from '../boqParserV2/types';

export function splitLabel(label: string): { chapter: string; subChapter: string | null } {
  const idx = label.indexOf(';');
  if (idx === -1) return { chapter: label.trim(), subChapter: null };
  const sub = label.slice(idx + 1).trim();
  return { chapter: label.slice(0, idx).trim(), subChapter: sub.length > 0 ? sub : null };
}

export interface BoqStagingInput {
  code: string;
  label: string;
  chapter: string;
  subChapter: string | null;
  unit: string;
  planned: number;
  recipe: BoqRowRecipe;
  sourceSheet: string;
  sourceRow: number;
  rowNumber: number;
  extraRaw?: Record<string, unknown>;
}

/**
 * Build one `boq` StagingRowV2 in the exact shape publishBaselineV2 consumes:
 * chapter/subChapter live in raw_data (buildBoqItemInsert reads them there);
 * recipe.components drive the material-master lines. needs_review fires on any
 * structural problem so a bad row is surfaced, never silently published.
 */
export function makeBoqStagingRow(input: BoqStagingInput): StagingRowV2 {
  const needsReview = !input.code || !input.label || !input.unit || !(input.planned > 0);
  return {
    row_type: 'boq',
    row_number: input.rowNumber,
    raw_data: {
      source_sheet: input.sourceSheet,
      source_row: input.sourceRow,
      source_cell: `A${input.sourceRow}`,
      chapter: input.chapter,
      subChapter: input.subChapter,
      ...(input.extraRaw ?? {}),
    },
    parsed_data: {
      code: input.code,
      label: input.label,
      unit: input.unit,
      planned: input.planned,
      chapter: input.chapter,
      sub_chapter: input.subChapter,
      unit_price: null,
      subkon_cost_per_unit: 0,
      total_cost: 0,
      recipe: input.recipe,
    },
    needs_review: needsReview,
    confidence: 1,
    review_status: 'PENDING',
    cost_basis: 'inline_split',
    parent_ahs_staging_id: null,
    ref_cells: null,
    cost_split: { material: 0, labor: 0, equipment: 0, prelim: 0 },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/staging.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/simplifiedInput/staging.ts tools/simplifiedInput/__tests__/staging.test.ts
git commit -m "feat(simplified-input): shared boq staging-row helper"
```

---

### Task 3: Tier-1 sheet parser

**Files:**
- Create: `tools/simplifiedInput/tier1.ts`
- Test: `tools/simplifiedInput/__tests__/tier1.test.ts`

**Interfaces:**
- Consumes: `REBAR_COLUMNS`, `buildRebarComponent` (Task 1); `splitLabel`, `makeBoqStagingRow` (Task 2); `xlsx`.
- Produces: `parseTier1Sheet(ws: XLSX.WorkSheet, startRowNumber?: number): StagingRowV2[]` and the constants `TIER1_SHEET_NAME`, `BETON_MATERIAL_NAME`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/tier1.test.ts
import * as XLSX from 'xlsx';
import { parseTier1Sheet, BETON_MATERIAL_NAME } from '../tier1';

function tier1Sheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
    [null, null, 8, 10, 13, 16, 19, 22],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

describe('parseTier1Sheet', () => {
  const ws = tier1Sheet([
    ['Lt. Basement ; Kolom', 39.02277465724567, 0, 517, 57, 174, 91, 60],
    [], // blank spacer between zones
    ['Bunker; Tangga', 2.76, 7, 9, 19, 0, 0, 0],
  ]);
  const rows = parseTier1Sheet(ws);

  it('emits one boq row per non-blank work area with sequential codes', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.parsed_data.code)).toEqual(['T1-001', 'T1-002']);
  });

  it('splits the label into chapter/sub_chapter and sets planned = beton m³', () => {
    const r = rows[0];
    expect(r.raw_data.chapter).toBe('Lt. Basement');
    expect(r.raw_data.subChapter).toBe('Kolom');
    expect(r.parsed_data.unit).toBe('m³');
    expect(r.parsed_data.planned).toBeCloseTo(39.02277465724567, 9);
  });

  it('builds a beton component with coefficient 1.0 plus one rebar component per nonzero diameter', () => {
    const comps = (rows[0].parsed_data.recipe as any).components;
    const beton = comps.find((c: any) => c.materialName === BETON_MATERIAL_NAME);
    expect(beton.quantityPerUnit).toBe(1.0);
    expect(beton.unit).toBe('m³');
    // ø8 was 0 → skipped; ø10/13/16/19/22 present → 5 rebar + 1 beton = 6
    expect(comps).toHaveLength(6);
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm (batang)');
    expect(d10.quantityPerUnit * rows[0].parsed_data.planned).toBeCloseTo(517, 6);
  });

  it('skips fully blank rows and stops at the end of data', () => {
    const comps2 = (rows[1].parsed_data.recipe as any).components;
    // Bunker; Tangga: ø8=7, ø10=9, ø13=19 → 3 rebar + 1 beton
    expect(comps2).toHaveLength(4);
    expect(rows[1].raw_data.chapter).toBe('Bunker');
    expect(rows[1].raw_data.subChapter).toBe('Tangga');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/tier1.test.ts`
Expected: FAIL — cannot find module `../tier1`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/tier1.ts
import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { REBAR_COLUMNS, buildRebarComponent } from './rebar';
import { splitLabel, makeBoqStagingRow } from './staging';

export const TIER1_SHEET_NAME = 'SANO Input Tier 1';
export const BETON_MATERIAL_NAME = 'Beton Readymix';
const DATA_START_ROW = 4; // 1-indexed: rows 1–2 header, row 3 blank

function numAt(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c && c.v != null ? String(c.v).trim() : '';
}

/**
 * Parse "SANO Input Tier 1" into one `boq` staging row per work area.
 * Each row's recipe = a beton component (coefficient 1.0) plus one batang
 * rebar component per nonzero diameter cell (C–H). Blank rows are skipped.
 */
export function parseTier1Sheet(ws: XLSX.WorkSheet, startRowNumber = 1): StagingRowV2[] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out: StagingRowV2[] = [];
  let seq = 0;
  let rowNumber = startRowNumber;

  for (let r = DATA_START_ROW; r <= range.e.r + 1; r++) {
    const label = strAt(ws, `A${r}`);
    if (!label) continue; // blank spacer between zones

    const betonM3 = numAt(ws, `B${r}`);
    seq += 1;
    const code = `T1-${String(seq).padStart(3, '0')}`;
    const { chapter, subChapter } = splitLabel(label);

    const components: RecipeComponent[] = [
      {
        sourceCell: { sheet: TIER1_SHEET_NAME, address: `B${r}` },
        referencedCell: { sheet: TIER1_SHEET_NAME, address: `B${r}` },
        referencedBlockTitle: null,
        referencedBlockRow: null,
        quantityPerUnit: 1.0,
        unitPrice: 0,
        costContribution: 0,
        lineType: 'material',
        confidence: 1,
        unit: 'm³',
        materialName: BETON_MATERIAL_NAME,
      },
    ];
    for (const { col, diameter } of REBAR_COLUMNS) {
      const lonjor = numAt(ws, `${col}${r}`);
      if (lonjor > 0) {
        components.push(buildRebarComponent(diameter, lonjor, betonM3, TIER1_SHEET_NAME, `${col}${r}`));
      }
    }

    const recipe: BoqRowRecipe = {
      perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
      subkonPerUnit: 0,
      components,
      markup: null,
      totalCached: 0,
    };

    out.push(
      makeBoqStagingRow({
        code, label, chapter, subChapter, unit: 'm³', planned: betonM3,
        recipe, sourceSheet: TIER1_SHEET_NAME, sourceRow: r, rowNumber: rowNumber++,
      }),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/tier1.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/simplifiedInput/tier1.ts tools/simplifiedInput/__tests__/tier1.test.ts
git commit -m "feat(simplified-input): Tier-1 sheet parser"
```

---

### Task 4: Others sheet parser (synthetic anchor)

**Files:**
- Create: `tools/simplifiedInput/others.ts`
- Test: `tools/simplifiedInput/__tests__/others.test.ts`

**Interfaces:**
- Consumes: `makeBoqStagingRow` (Task 2); `xlsx`.
- Produces: `parseOthersSheet(ws: XLSX.WorkSheet, rowNumber?: number): StagingRowV2 | null` and constants `OTHERS_SHEET_NAME`, `ANCHOR_CODE = 'MATERIAL-UMUM'`. The anchor row also carries `raw_data.others_materials: Array<{ name: string; tier: number | null; unit: string; volume: number; unitPrice: number }>` for the reconcile helper (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/others.test.ts
import * as XLSX from 'xlsx';
import { parseOthersSheet, ANCHOR_CODE } from '../others';

function othersSheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

describe('parseOthersSheet', () => {
  const ws = othersSheet([
    ['Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
    ['Pasir Pasang', 3, 'm3', 347.45, 350000, 121607500],
  ]);
  const anchor = parseOthersSheet(ws)!;

  it('produces a single MATERIAL-UMUM anchor boq row with planned 1', () => {
    expect(anchor.parsed_data.code).toBe(ANCHOR_CODE);
    expect(anchor.parsed_data.unit).toBe('ls');
    expect(anchor.parsed_data.planned).toBe(1);
    expect(anchor.raw_data.chapter).toBe('Material Umum');
  });

  it('makes each Others row a component whose master_planned equals its Volume', () => {
    const comps = (anchor.parsed_data.recipe as any).components;
    expect(comps).toHaveLength(2);
    const semen = comps.find((c: any) => c.materialName === 'Semen PC');
    // master_planned = anchor.planned (1) × coefficient
    expect(anchor.parsed_data.planned * semen.quantityPerUnit).toBeCloseTo(5456, 6);
    expect(semen.unit).toBe('sak 40 kg');
    expect(semen.unitPrice).toBe(60000);
  });

  it('captures file tier/price per material for the reconcile helper', () => {
    const mats = (anchor.raw_data as any).others_materials;
    expect(mats).toEqual([
      { name: 'Semen PC', tier: 2, unit: 'sak 40 kg', volume: 5456, unitPrice: 60000 },
      { name: 'Pasir Pasang', tier: 3, unit: 'm3', volume: 347.45, unitPrice: 350000 },
    ]);
  });

  it('returns null when there are no Others data rows', () => {
    expect(parseOthersSheet(othersSheet([]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/others.test.ts`
Expected: FAIL — cannot find module `../others`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/others.ts
import * as XLSX from 'xlsx';
import type { StagingRowV2, RecipeComponent, BoqRowRecipe } from '../boqParserV2/types';
import { makeBoqStagingRow } from './staging';

export const OTHERS_SHEET_NAME = 'SANO Input Others';
export const ANCHOR_CODE = 'MATERIAL-UMUM';
const DATA_START_ROW = 3; // 1-indexed: row 1 header, row 2 blank

interface OthersMaterial {
  name: string;
  tier: number | null;
  unit: string;
  volume: number;
  unitPrice: number;
}

function numAt(ws: XLSX.WorkSheet, addr: string): number {
  const c = ws[addr];
  return c && typeof c.v === 'number' ? c.v : 0;
}
function strAt(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  return c && c.v != null ? String(c.v).trim() : '';
}

/**
 * Parse "SANO Input Others" into ONE synthetic "Material Umum" anchor boq row
 * (planned = 1) whose components are the project-level Tier-2/3 materials.
 * master_planned = 1 × Volume = the project total, in the sheet's unit. The
 * file's declared tier/price are captured in raw_data.others_materials for the
 * reconcile helper. Returns null when the sheet has no data rows.
 */
export function parseOthersSheet(ws: XLSX.WorkSheet, rowNumber = 1): StagingRowV2 | null {
  if (!ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const components: RecipeComponent[] = [];
  const materials: OthersMaterial[] = [];

  for (let r = DATA_START_ROW; r <= range.e.r + 1; r++) {
    const name = strAt(ws, `A${r}`);
    if (!name) continue;
    const tierRaw = numAt(ws, `B${r}`);
    const unit = strAt(ws, `C${r}`);
    const volume = numAt(ws, `D${r}`);
    const unitPrice = numAt(ws, `E${r}`);

    components.push({
      sourceCell: { sheet: OTHERS_SHEET_NAME, address: `A${r}` },
      referencedCell: { sheet: OTHERS_SHEET_NAME, address: `A${r}` },
      referencedBlockTitle: null,
      referencedBlockRow: null,
      quantityPerUnit: volume,
      unitPrice,
      costContribution: volume * unitPrice,
      lineType: 'material',
      confidence: 1,
      unit,
      materialName: name,
    });
    materials.push({ name, tier: tierRaw > 0 ? tierRaw : null, unit, volume, unitPrice });
  }

  if (components.length === 0) return null;

  const recipe: BoqRowRecipe = {
    perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
    subkonPerUnit: 0,
    components,
    markup: null,
    totalCached: 0,
  };

  return makeBoqStagingRow({
    code: ANCHOR_CODE,
    label: 'Material Umum (Tier 2 & 3)',
    chapter: 'Material Umum',
    subChapter: null,
    unit: 'ls',
    planned: 1,
    recipe,
    sourceSheet: OTHERS_SHEET_NAME,
    sourceRow: DATA_START_ROW,
    rowNumber,
    extraRaw: { others_materials: materials },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/others.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/simplifiedInput/others.ts tools/simplifiedInput/__tests__/others.test.ts
git commit -m "feat(simplified-input): Others sheet parser with Material Umum anchor"
```

---

### Task 5: Entry point + workbook detection

**Files:**
- Create: `tools/simplifiedInput/index.ts`
- Test: `tools/simplifiedInput/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `parseTier1Sheet`, `TIER1_SHEET_NAME` (Task 3); `parseOthersSheet`, `OTHERS_SHEET_NAME` (Task 4); `xlsx`.
- Produces:
  - `isSimplifiedInputWorkbook(buffer: Buffer): boolean`.
  - `parseSimplifiedInput(buffer: Buffer): { stagingRows: StagingRowV2[]; validationReport: ValidationReport }` — `validationReport` is required because `baseline.ts:494` writes it to `import_sessions.validation_report`; the simplified path has no AHS blocks to validate, so it is an empty-but-valid report.

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/index.test.ts
import * as XLSX from 'xlsx';
import { isSimplifiedInputWorkbook, parseSimplifiedInput } from '../index';

function workbookBuffer(sheets: Record<string, (string | number | null)[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const tier1Aoa = [
  ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
  [null, null, 8, 10, 13, 16, 19, 22],
  [],
  ['Bunker; Tangga', 2.76, 7, 9, 19, 0, 0, 0],
];
const othersAoa = [
  ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
  [],
  ['Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
];

describe('isSimplifiedInputWorkbook', () => {
  it('is true when both simplified sheets are present', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    expect(isSimplifiedInputWorkbook(buf)).toBe(true);
  });
  it('is false for a RAB-shaped workbook', () => {
    const buf = workbookBuffer({ 'RAB (A)': [['x']], Analisa: [['y']] });
    expect(isSimplifiedInputWorkbook(buf)).toBe(false);
  });
});

describe('parseSimplifiedInput', () => {
  it('emits Tier-1 boq rows plus the Others anchor, contiguously numbered', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    const { stagingRows } = parseSimplifiedInput(buf);
    expect(stagingRows).toHaveLength(2); // 1 Tier-1 work area + 1 anchor
    expect(stagingRows.every((r) => r.row_type === 'boq')).toBe(true);
    expect(stagingRows.map((r) => r.row_number)).toEqual([1, 2]);
    expect(stagingRows.map((r) => r.parsed_data.code)).toEqual(['T1-001', 'MATERIAL-UMUM']);
  });

  it('returns an empty-but-valid validation report', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    const { validationReport } = parseSimplifiedInput(buf);
    expect(validationReport.blocks).toEqual([]);
    expect(typeof validationReport.generated_at).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/index.test.ts`
Expected: FAIL — cannot find module `../index`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/index.ts
import * as XLSX from 'xlsx';
import type { StagingRowV2, ValidationReport } from '../boqParserV2/types';
import { parseTier1Sheet, TIER1_SHEET_NAME } from './tier1';
import { parseOthersSheet, OTHERS_SHEET_NAME } from './others';

export { TIER1_SHEET_NAME } from './tier1';
export { OTHERS_SHEET_NAME } from './others';

/** True iff the workbook is the team's two-sheet "SANO Input" format. */
export function isSimplifiedInputWorkbook(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
    const names = new Set(wb.SheetNames);
    return names.has(TIER1_SHEET_NAME) && names.has(OTHERS_SHEET_NAME);
  } catch {
    return false;
  }
}

/**
 * Parse a simplified-input workbook into StagingRowV2[] — the same shape
 * parseBoqV2 returns — so the existing insert → review → publish pipeline
 * consumes it unchanged. Emits Tier-1 work-area boq rows followed by the single
 * Material Umum anchor, renumbered contiguously from 1. The validationReport is
 * empty-but-valid (no AHS blocks to reconcile) so baseline.ts can persist it
 * exactly as it does for the RAB path.
 */
export function parseSimplifiedInput(
  buffer: Buffer,
): { stagingRows: StagingRowV2[]; validationReport: ValidationReport } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false });
  const tier1Ws = wb.Sheets[TIER1_SHEET_NAME];
  const othersWs = wb.Sheets[OTHERS_SHEET_NAME];

  const rows: StagingRowV2[] = [];
  if (tier1Ws) rows.push(...parseTier1Sheet(tier1Ws));
  if (othersWs) {
    const anchor = parseOthersSheet(othersWs);
    if (anchor) rows.push(anchor);
  }
  rows.forEach((r, i) => { r.row_number = i + 1; });

  return {
    stagingRows: rows,
    validationReport: { blocks: [], generated_at: new Date().toISOString() },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/simplifiedInput/index.ts tools/simplifiedInput/__tests__/index.test.ts
git commit -m "feat(simplified-input): detection + parse entry point"
```

---

### Task 6: Wire detection into the upload/staging flow

**Files:**
- Modify: `tools/baseline.ts` (the `parser_version === 'v2'` branch around line 429–436)
- Test: `tools/simplifiedInput/__tests__/index.test.ts` (already covers the parser; the wiring is verified by the Task 9 integration test)

**Interfaces:**
- Consumes: `isSimplifiedInputWorkbook`, `parseSimplifiedInput` (Task 5).

- [ ] **Step 1: Add the import**

At the top of `tools/baseline.ts`, near the existing `import { parseBoqV2 } from './boqParserV2';`:

```ts
import { isSimplifiedInputWorkbook, parseSimplifiedInput } from './simplifiedInput';
```

- [ ] **Step 2: Replace the parse dispatch**

Find (around line 429–436):

```ts
      const v2Buffer = await resolveFileInput(fileInput);
      // Default ingest is single-sheet `RAB (A)` (unchanged). Add-on rule: a
      // multi-building workbook whose materials span `RAB (B)`…`RAB (E)`
      // (e.g. Nusa Golf) is detected from its sheet-tagged breakdown sheets and
      // parsed across all RAB sheets, so its materials aren't lost. See
      // detectBoqSheetOption.
      const boqSheet = detectBoqSheetOptionFromBuffer(v2Buffer);
      const v2Result = await parseBoqV2(v2Buffer, { boqSheet });
```

Replace with:

```ts
      const v2Buffer = await resolveFileInput(fileInput);
      // Simplified "SANO Input" two-sheet format (Tier-1 work-group matrix +
      // tiered Others list) — an alternative to full RAB parsing. Detected by
      // its exact sheet names; emits the same { stagingRows, validationReport }
      // the rest of this function consumes. See
      // docs/superpowers/specs/2026-07-14-simplified-boq-input-parser-design.md
      let v2Result: {
        stagingRows: StagingRowV2[];
        validationReport: ValidationReport;
      };
      if (isSimplifiedInputWorkbook(v2Buffer)) {
        v2Result = parseSimplifiedInput(v2Buffer);
      } else {
        // Default ingest is single-sheet `RAB (A)` (unchanged). Add-on rule: a
        // multi-building workbook whose materials span `RAB (B)`…`RAB (E)`
        // (e.g. Nusa Golf) is detected from its sheet-tagged breakdown sheets and
        // parsed across all RAB sheets, so its materials aren't lost. See
        // detectBoqSheetOption.
        const boqSheet = detectBoqSheetOptionFromBuffer(v2Buffer);
        v2Result = await parseBoqV2(v2Buffer, { boqSheet });
      }
```

Notes:
- The `parseBoqV2` result has extra fields (`cells`, `boqRows`, etc.); assigning it to the narrower `v2Result` type is fine (structural width). The code below uses only `.stagingRows` and `.validationReport`.
- Add the type import if not already present: `import type { StagingRowV2, ValidationReport } from './boqParserV2/types';`
- The simplified path emits no `ahs_block` rows, so the existing `parent_ahs_staging_id` post-fix loop iterates zero of them (a safe no-op).

- [ ] **Step 3: Typecheck the change**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i baseline.ts` (or the project's typecheck script)
Expected: no errors referencing `baseline.ts`.

- [ ] **Step 4: Run the simplified-input suite to confirm nothing regressed**

Run: `npx jest tools/simplifiedInput`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add tools/baseline.ts
git commit -m "feat(simplified-input): route SANO Input workbooks through the new parser"
```

---

### Task 7: Migration 082 — isolated tier-1 beton + batang rebar rows

**Files:**
- Create: `supabase/migrations/082_simplified_input_catalog.sql`

**Interfaces:**
- Produces catalog rows with the EXACT names the parser emits: `Beton Readymix` (tier 1, m3) and the six `Besi beton … (batang)` rows (tier 1, batang). These are what Task 1/Task 3 material names resolve to via exact match.

- [ ] **Step 1: Write the migration**

```sql
-- 082_simplified_input_catalog.sql
-- Catalog rows for the simplified "SANO Input" format (spec 2026-07-14).
--
-- The Tier-1 sheet's materials must be TIER 1 (work-group gated) and — for
-- rebar — stored in BATANG, not kg. The existing readymix row is tier 2 and
-- the existing rebar rows are kg-based and referenced by 3 live projects
-- (887 master lines); mutating them would corrupt those projects' envelopes
-- (v_material_envelopes reads mc.unit live). So we INSERT isolated rows the
-- simplified path links to by exact name, and leave every existing row alone.
--
-- Idempotent: guarded by NOT EXISTS on code (no unique-constraint dependency).
-- Dashboard-pasteable (remote migration history is out of sync).

INSERT INTO material_catalog (code, name, category, tier, unit, supplier_unit, base_qty_per_supplier_unit)
SELECT v.code, v.name, 'Struktur', 1, v.unit, v.unit, NULL
FROM (VALUES
  ('BTN-RMX-T1',   'Beton Readymix',                 'm3'),
  ('REB-PL08-BTG', 'Besi beton polos 8 mm (batang)',  'batang'),
  ('REB-DE10-BTG', 'Besi beton ulir 10 mm (batang)',  'batang'),
  ('REB-DE13-BTG', 'Besi beton ulir 13 mm (batang)',  'batang'),
  ('REB-DE16-BTG', 'Besi beton ulir 16 mm (batang)',  'batang'),
  ('REB-DE19-BTG', 'Besi beton ulir 19 mm (batang)',  'batang'),
  ('REB-DE22-BTG', 'Besi beton ulir 22 mm (batang)',  'batang')
) AS v(code, name, unit)
WHERE NOT EXISTS (SELECT 1 FROM material_catalog mc WHERE mc.code = v.code);
```

- [ ] **Step 2: Apply the migration (remote, via MCP)**

Apply the file's SQL through the Supabase MCP `apply_migration` tool (name: `082_simplified_input_catalog`). If MCP write is unavailable in the current environment, paste the SQL into the Dashboard SQL editor.

- [ ] **Step 3: Verify the rows landed and existing rows are untouched**

Run (MCP `execute_sql`):

```sql
SELECT code, name, tier, unit, supplier_unit
FROM material_catalog
WHERE code IN ('BTN-RMX-T1','REB-PL08-BTG','REB-DE10-BTG','REB-DE13-BTG',
               'REB-DE16-BTG','REB-DE19-BTG','REB-DE22-BTG')
ORDER BY code;
-- Expected: 7 rows, tier=1, batang rows unit='batang', beton unit='m3'.

SELECT code, unit FROM material_catalog WHERE code IN ('REB-DE10','REB-PL08') ORDER BY code;
-- Expected: still unit='kg' (existing rows unchanged).
```

- [ ] **Step 4: Confirm idempotency**

Re-run the Step 1 SQL. Expected: `INSERT 0 0` (all rows already present, none inserted).

- [ ] **Step 5: Commit + add to the Dashboard deploy checklist**

```bash
git add supabase/migrations/082_simplified_input_catalog.sql
git commit -m "feat(simplified-input): migration 082 — isolated tier-1 beton + batang rebar rows"
```

Add a line to the migration Dashboard checklist (per the migration-history-divergence process): "Paste 082 before publishing any simplified 'SANO Input' workbook."

---

### Task 8: Material reconciliation / conflict surfacing

**Files:**
- Create: `tools/simplifiedInput/reconcile.ts`
- Test: `tools/simplifiedInput/__tests__/reconcile.test.ts`
- Modify: `tools/baseline.ts` (after the simplified parse, before insert)

**Interfaces:**
- Consumes: `reconcileMaterials`, `CatalogEntry` from `tools/excelParser.ts`; `StagingRowV2`; the `raw_data.others_materials` shape (Task 4).
- Produces: `detectOthersConflicts(anchorRow: StagingRowV2, catalog: CatalogEntry[], aliases: Map<string,string>): OthersConflict[]` where
  `OthersConflict = { name: string; matched: boolean; fileTier: number | null; catalogTier: number | null; filePrice: number; kind: 'unmatched' | 'tier' | null }`
  and `flagOthersConflicts(anchorRow, conflicts): void` (mutates the anchor's `needs_review` + `raw_data.material_conflicts`).

- [ ] **Step 1: Write the failing test**

```ts
// tools/simplifiedInput/__tests__/reconcile.test.ts
import { detectOthersConflicts, flagOthersConflicts } from '../reconcile';
import type { CatalogEntry } from '../../excelParser';
import type { StagingRowV2 } from '../../boqParserV2/types';

const catalog: CatalogEntry[] = [
  { code: 'SEM', name: 'Semen PC', category: 'x', tier: 2, unit: 'sak', aliases: [] },
  { code: 'PSR', name: 'Pasir pasang', category: 'x', tier: 2, unit: 'm3', aliases: [] },
];

function anchorWith(materials: any[]): StagingRowV2 {
  return {
    row_type: 'boq', row_number: 1, raw_data: { others_materials: materials },
    parsed_data: {}, needs_review: false, confidence: 1, review_status: 'PENDING',
    cost_basis: 'inline_split', parent_ahs_staging_id: null, ref_cells: null, cost_split: null,
  } as unknown as StagingRowV2;
}

describe('detectOthersConflicts', () => {
  it('flags a tier mismatch (file Tier 3 vs catalog tier 2)', () => {
    const anchor = anchorWith([{ name: 'Pasir Pasang', tier: 3, unit: 'm3', volume: 10, unitPrice: 1 }]);
    const conflicts = detectOthersConflicts(anchor, catalog, new Map());
    expect(conflicts).toEqual([
      { name: 'Pasir Pasang', matched: true, fileTier: 3, catalogTier: 2, filePrice: 1, kind: 'tier' },
    ]);
  });
  it('reports no conflict when file tier equals catalog tier', () => {
    const anchor = anchorWith([{ name: 'Semen PC', tier: 2, unit: 'sak', volume: 1, unitPrice: 1 }]);
    expect(detectOthersConflicts(anchor, catalog, new Map())).toEqual([]);
  });
  it('flags an unmatched material', () => {
    const anchor = anchorWith([{ name: 'Widget X', tier: 2, unit: 'bh', volume: 1, unitPrice: 1 }]);
    const conflicts = detectOthersConflicts(anchor, catalog, new Map());
    expect(conflicts[0]).toMatchObject({ name: 'Widget X', matched: false, kind: 'unmatched' });
  });
});

describe('flagOthersConflicts', () => {
  it('sets needs_review and records conflicts when any exist', () => {
    const anchor = anchorWith([]);
    flagOthersConflicts(anchor, [{ name: 'Pasir Pasang', matched: true, fileTier: 3, catalogTier: 2, filePrice: 1, kind: 'tier' }]);
    expect(anchor.needs_review).toBe(true);
    expect((anchor.raw_data as any).material_conflicts).toHaveLength(1);
  });
  it('leaves needs_review untouched when there are no conflicts', () => {
    const anchor = anchorWith([]);
    flagOthersConflicts(anchor, []);
    expect(anchor.needs_review).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/simplifiedInput/__tests__/reconcile.test.ts`
Expected: FAIL — cannot find module `../reconcile`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tools/simplifiedInput/reconcile.ts
import { reconcileMaterials, type CatalogEntry } from '../excelParser';
import type { StagingRowV2 } from '../boqParserV2/types';

export interface OthersConflict {
  name: string;
  matched: boolean;
  fileTier: number | null;
  catalogTier: number | null;
  filePrice: number;
  kind: 'unmatched' | 'tier' | null;
}

interface OthersMaterial {
  name: string;
  tier: number | null;
  unit: string;
  volume: number;
  unitPrice: number;
}

/**
 * Compare each Others material's file-declared tier against the tier of the
 * catalog row it reconciles to. "File wins" per the spec, but the shared
 * catalog is never mutated here — mismatches are surfaced for the reviewer /
 * the later catalog cleanup. Unmatched materials are flagged too.
 */
export function detectOthersConflicts(
  anchorRow: StagingRowV2,
  catalog: CatalogEntry[],
  aliases: Map<string, string>,
): OthersConflict[] {
  const materials = ((anchorRow.raw_data as { others_materials?: OthersMaterial[] }).others_materials) ?? [];
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const out: OthersConflict[] = [];

  for (const m of materials) {
    const { resolved } = reconcileMaterials(
      [{ rowNumber: 0, name: m.name, spec: null, unit: m.unit, unitPrice: m.unitPrice, resolvedCode: null, matchConfidence: 0 }],
      catalog,
      aliases,
    );
    const hit = resolved[0];
    if (!hit || !hit.resolvedCode || hit.matchConfidence <= 0) {
      out.push({ name: m.name, matched: false, fileTier: m.tier, catalogTier: null, filePrice: m.unitPrice, kind: 'unmatched' });
      continue;
    }
    const catalogTier = byCode.get(hit.resolvedCode)?.tier ?? null;
    if (m.tier != null && catalogTier != null && m.tier !== catalogTier) {
      out.push({ name: m.name, matched: true, fileTier: m.tier, catalogTier, filePrice: m.unitPrice, kind: 'tier' });
    }
  }
  return out;
}

/** Mutate the anchor row: raise needs_review and attach the conflict list. */
export function flagOthersConflicts(anchorRow: StagingRowV2, conflicts: OthersConflict[]): void {
  if (conflicts.length === 0) return;
  anchorRow.needs_review = true;
  (anchorRow.raw_data as Record<string, unknown>).material_conflicts = conflicts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/simplifiedInput/__tests__/reconcile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the check into baseline.ts (simplified path only)**

In `tools/baseline.ts`, right after `v2Result = parseSimplifiedInput(v2Buffer);` in the branch from Task 6, add:

```ts
        // Surface tier/price disagreements between the file and the catalog so a
        // reviewer sees them before publish (file wins, but the shared catalog is
        // not mutated — see spec §5.5). Non-fatal: on any load error we proceed
        // without conflict flags rather than block the import.
        try {
          const { catalog, aliasMap } = await loadCatalogAndAliases();
          const catalogEntries = catalog.map((c) => ({
            code: c.code, name: c.name, category: c.category, tier: c.tier, unit: c.unit, aliases: [],
          }));
          const anchor = v2Result.stagingRows.find((r) => (r.parsed_data as { code?: string }).code === 'MATERIAL-UMUM');
          if (anchor) {
            const { detectOthersConflicts, flagOthersConflicts } = await import('./simplifiedInput/reconcile');
            flagOthersConflicts(anchor, detectOthersConflicts(anchor, catalogEntries, aliasMap));
          }
        } catch (err) {
          console.warn('[simplified-input] conflict pre-check skipped:', err);
        }
```

Add the import near the top of `tools/baseline.ts`:

```ts
import { loadCatalogAndAliases } from './publishBaselineV2';
```

(Confirm `loadCatalogAndAliases` is exported there — it is, at `tools/publishBaselineV2.ts:319`.)

- [ ] **Step 6: Typecheck + run the suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'baseline|reconcile'`
Expected: no errors.
Run: `npx jest tools/simplifiedInput`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/simplifiedInput/reconcile.ts tools/simplifiedInput/__tests__/reconcile.test.ts tools/baseline.ts
git commit -m "feat(simplified-input): flag file-vs-catalog tier conflicts in staging review"
```

---

### Task 9: End-to-end integration test against the real workbook

**Files:**
- Create: `tools/simplifiedInput/__tests__/integration.test.ts`

**Interfaces:**
- Consumes: `parseSimplifiedInput`, `isSimplifiedInputWorkbook` (Task 5); the real asset `assets/BOQ/20260713 SANO Input - BDG D-18.xlsx`.

- [ ] **Step 1: Write the test**

```ts
// tools/simplifiedInput/__tests__/integration.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { parseSimplifiedInput, isSimplifiedInputWorkbook } from '../index';

const ASSET = path.resolve(__dirname, '../../../assets/BOQ/20260713 SANO Input - BDG D-18.xlsx');

// Guard: skip when the asset isn't present (keeps CI green in trimmed checkouts).
const maybe = fs.existsSync(ASSET) ? describe : describe.skip;

maybe('BDG D-18 simplified workbook', () => {
  const buf = fs.readFileSync(ASSET);

  it('is detected as a simplified-input workbook', () => {
    expect(isSimplifiedInputWorkbook(buf)).toBe(true);
  });

  it('parses to boq rows: Tier-1 work areas + exactly one Material Umum anchor', () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    expect(stagingRows.length).toBeGreaterThan(1);
    expect(stagingRows.every((r) => r.row_type === 'boq')).toBe(true);
    const anchors = stagingRows.filter((r) => (r.parsed_data as { code?: string }).code === 'MATERIAL-UMUM');
    expect(anchors).toHaveLength(1);
    // Row numbers are contiguous 1..N.
    expect(stagingRows.map((r) => r.row_number)).toEqual(stagingRows.map((_, i) => i + 1));
  });

  it('every Tier-1 row has a beton component (coeff 1.0) and only batang rebar components', () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    const tier1 = stagingRows.filter((r) => String((r.parsed_data as { code?: string }).code).startsWith('T1-'));
    expect(tier1.length).toBeGreaterThan(0);
    for (const r of tier1) {
      const comps = (r.parsed_data.recipe as { components: any[] }).components;
      const beton = comps.find((c) => c.materialName === 'Beton Readymix');
      expect(beton?.quantityPerUnit).toBe(1.0);
      for (const c of comps.filter((x) => x.materialName !== 'Beton Readymix')) {
        expect(c.unit).toBe('batang');
        expect(c.materialName).toMatch(/\(batang\)$/);
      }
    }
  });

  it('reproduces a known work area\'s rebar lonjor via planned × coefficient', () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    const kolom = stagingRows.find(
      (r) => r.raw_data.chapter === 'Lt. Basement' && r.raw_data.subChapter === 'Kolom',
    )!;
    const planned = (kolom.parsed_data as { planned: number }).planned;
    const d10 = (kolom.parsed_data.recipe as { components: any[] }).components
      .find((c) => c.materialName === 'Besi beton ulir 10 mm (batang)');
    expect(Math.round(planned * d10.quantityPerUnit)).toBe(517);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest tools/simplifiedInput/__tests__/integration.test.ts`
Expected: PASS (4 tests). If the "Lt. Basement ; Kolom" values differ in a future asset revision, adjust the known figures — do not loosen the arithmetic assertion.

- [ ] **Step 3: Run the whole simplified-input suite once more**

Run: `npx jest tools/simplifiedInput`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add tools/simplifiedInput/__tests__/integration.test.ts
git commit -m "test(simplified-input): end-to-end parse of the BDG D-18 workbook"
```

---

## Optional manual verification (post-implementation, live DB)

Not a coded task — a smoke check the implementer can run once migration 082 is applied and a simplified workbook has been uploaded + published to a **disposable test project**:

```sql
-- Rebar demand lands in batang (proves the batang rows were linked, no kg conversion):
SELECT mc.code, mc.unit, e.total_planned
FROM v_material_envelopes e JOIN material_catalog mc ON mc.id = e.material_id
WHERE e.project_id = '<test-project>' AND mc.code LIKE 'REB-%-BTG'
ORDER BY mc.code;

-- Others project totals equal the sheet's Volume column:
SELECT mc.name, e.total_planned
FROM v_material_envelopes e JOIN material_catalog mc ON mc.id = e.material_id
WHERE e.project_id = '<test-project>' AND mc.tier IN (2,3)
ORDER BY mc.name;
```

Delete the test project afterward.

## Self-Review

- **Spec coverage:** detection (§5.1→T5/T6), Tier-1 mapping (§5.2→T1/T3), Others anchor (§5.3→T4), batang rebar + migration (§5.4→T1/T7), reconciliation + conflict flags (§5.5→T8), validation (§6→T2 needs_review + T8), testing (§7→T1–T9). Covered.
- **Placeholder scan:** none — every step has real code/SQL/commands.
- **Type consistency:** `StagingRowV2`, `RecipeComponent`, `BoqRowRecipe`, `CostSplit`, `CatalogEntry` used per their definitions; `makeBoqStagingRow`, `buildRebarComponent`, `parseTier1Sheet`, `parseOthersSheet`, `parseSimplifiedInput`, `detectOthersConflicts`, `flagOthersConflicts` names consistent across tasks.
