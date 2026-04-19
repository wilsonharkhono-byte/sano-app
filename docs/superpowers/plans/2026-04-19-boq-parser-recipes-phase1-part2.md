# BoQ Parser Recipes — Phase 1 Plan (Part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Continuation of [2026-04-19-boq-parser-recipes-phase1.md](./2026-04-19-boq-parser-recipes-phase1.md). Complete Tasks 1–6 in the first file before starting Task 7 here.

**Goal of this part:** Assemble recipes into `BoqRowRecipe`, wire them through `extractTakeoffs.ts` and `index.ts`, write the AI guide doc, and add a golden-snapshot regression test for Pakuwon AAL-5.

---

### Task 7: Recipe builder

**Files:**
- Create: `tools/boqParserV2/recipeBuilder.ts`
- Create: `tools/boqParserV2/__tests__/recipeBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tools/boqParserV2/__tests__/recipeBuilder.test.ts
import { buildRecipe } from '../recipeBuilder';
import type { HarvestedCell, HarvestLookup, CostSplit } from '../types';
import type { AhsBlock } from '../detectBlocks';

function mkLookup(cells: HarvestedCell[]): HarvestLookup {
  const m = new Map<string, HarvestedCell>();
  for (const c of cells) m.set(`${c.sheet}!${c.address}`, c);
  return m;
}

describe('buildRecipe', () => {
  const baseLookup = mkLookup([
    // Cost cells on the BoQ row
    { sheet: 'RAB (A)', address: 'I59', row: 59, col: 9, value: 2428240.77, formula: '=Analisa!$F$82' },
    { sheet: 'RAB (A)', address: 'J59', row: 59, col: 10, value: 800000, formula: '=Analisa!$G$82' },
    { sheet: 'RAB (A)', address: 'K59', row: 59, col: 11, value: 75000, formula: '=Analisa!$H$82' },
    { sheet: 'RAB (A)', address: 'E59', row: 59, col: 5, value: 2913889, formula: "=N59*'REKAP RAB'!$O$4" },
    { sheet: 'RAB (A)', address: 'F59', row: 59, col: 6, value: 5122541, formula: '=D59*E59' },
    { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 2428240.77, formula: '=SUM(I59:M59)' },
    // REKAP RAB markup
    { sheet: 'REKAP RAB', address: 'O4', row: 4, col: 15, value: 1.2, formula: null },
    // Analisa cells
    { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 2428240.77, formula: null },
    { sheet: 'Analisa', address: 'G82', row: 82, col: 7, value: 800000, formula: null },
    { sheet: 'Analisa', address: 'H82', row: 82, col: 8, value: 75000, formula: null },
  ]);

  const blocks: AhsBlock[] = [
    {
      title: 'Pengecoran Beton Readymix (KHUSUS POER)',
      titleRow: 77,
      jumlahRow: 89,
      jumlahCachedValue: 2428240.77,
      grandTotalAddress: 'I89',
      components: [],
      componentRows: [],
      componentSubtotals: [],
    },
  ];

  const costSplit: CostSplit = { material: 2428240.77, labor: 800000, equipment: 75000, prelim: 0 };

  it('assembles recipe with three line types and a markup', () => {
    const recipe = buildRecipe({
      sourceRow: 59,
      sourceSheet: 'RAB (A)',
      costSplit,
      subkonPerUnit: 0,
      splitColumns: { material: 'I', labor: 'J', equipment: 'K', subkon: null, prelim: null },
      markupCell: 'E',
      totalCell: 'F',
      lookup: baseLookup,
      blocks,
      analisaSheet: 'Analisa',
    });

    expect(recipe.perUnit).toEqual(costSplit);
    expect(recipe.subkonPerUnit).toBe(0);
    expect(recipe.markup).toEqual({
      factor: 1.2,
      sourceCell: { sheet: 'REKAP RAB', address: 'O4' },
      sourceLabel: null,
    });
    expect(recipe.components.length).toBeGreaterThanOrEqual(3);
    const byType = recipe.components.reduce<Record<string, number>>((acc, c) => {
      acc[c.lineType] = (acc[c.lineType] ?? 0) + c.costContribution;
      return acc;
    }, {});
    expect(byType.material).toBeCloseTo(2428240.77, 0);
    expect(byType.labor).toBeCloseTo(800000, 0);
    expect(byType.equipment).toBeCloseTo(75000, 0);
    // referencedBlockTitle is filled in when the referenced row falls in a block's range
    expect(recipe.components[0].referencedBlockTitle).toBe('Pengecoran Beton Readymix (KHUSUS POER)');
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/recipeBuilder.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `tools/boqParserV2/recipeBuilder.ts`**

```typescript
import type { HarvestLookup, CostSplit, BoqRowRecipe, RecipeComponent } from './types';
import type { AhsBlock } from './detectBlocks';
import { evaluateFormula } from './formulaEval';

type LineType = RecipeComponent['lineType'];

export interface BuildRecipeInput {
  sourceRow: number;
  sourceSheet: string;
  costSplit: CostSplit;
  subkonPerUnit: number;
  splitColumns: {
    material: string;
    labor: string;
    equipment: string;
    subkon: string | null;
    prelim: string | null;
  };
  markupCell: string;           // usually 'E'
  totalCell: string;            // usually 'F'
  lookup: HarvestLookup;
  blocks: AhsBlock[];
  analisaSheet: string;
}

function findBlockFor(
  blocks: AhsBlock[],
  cell: { sheet: string; address: string },
  analisaSheet: string,
): AhsBlock | null {
  if (cell.sheet !== analisaSheet) return null;
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(cell.address);
  if (!m) return null;
  const row = parseInt(m[2], 10);
  return blocks.find(b => row >= b.titleRow && row <= b.jumlahRow) ?? null;
}

function evalColumn(
  col: string,
  lineType: LineType,
  input: BuildRecipeInput,
): { components: RecipeComponent[]; markup: BoqRowRecipe['markup'] } {
  const addr = `${col}${input.sourceRow}`;
  const cell = input.lookup.get(`${input.sourceSheet}!${addr}`);
  if (!cell) return { components: [], markup: null };

  const res = evaluateFormula(cell, input.lookup, { targetSheet: input.analisaSheet });
  const components: RecipeComponent[] = res.components.map(c => {
    const block = findBlockFor(input.blocks, c.referencedCell, input.analisaSheet);
    return {
      sourceCell: c.sourceCell,
      referencedCell: c.referencedCell,
      referencedBlockTitle: block?.title ?? null,
      referencedBlockRow: block?.titleRow ?? null,
      quantityPerUnit: c.coefficient,
      unitPrice: c.unitPrice,
      costContribution: c.costContribution,
      lineType,
      confidence: c.confidence * res.confidence,
    };
  });
  return {
    components,
    markup: res.markup
      ? { factor: res.markup.factor, sourceCell: res.markup.sourceCell, sourceLabel: null }
      : null,
  };
}

export function buildRecipe(input: BuildRecipeInput): BoqRowRecipe {
  const mat = evalColumn(input.splitColumns.material, 'material', input);
  const lab = evalColumn(input.splitColumns.labor, 'labor', input);
  const eqp = evalColumn(input.splitColumns.equipment, 'equipment', input);
  const subkon = input.splitColumns.subkon
    ? evalColumn(input.splitColumns.subkon, 'subkon', input)
    : { components: [], markup: null };
  const prelim = input.splitColumns.prelim
    ? evalColumn(input.splitColumns.prelim, 'prelim', input)
    : { components: [], markup: null };

  // Markup comes from the E column (price per unit), which wraps N with the
  // REKAP RAB factor. Detect it there rather than on I/J/K.
  const priceCell = input.lookup.get(`${input.sourceSheet}!${input.markupCell}${input.sourceRow}`);
  const priceEval = priceCell
    ? evaluateFormula(priceCell, input.lookup, { targetSheet: input.analisaSheet })
    : null;

  const totalCell = input.lookup.get(`${input.sourceSheet}!${input.totalCell}${input.sourceRow}`);
  const totalCached = totalCell ? Number(totalCell.value ?? 0) : 0;

  return {
    perUnit: input.costSplit,
    subkonPerUnit: input.subkonPerUnit,
    components: [
      ...mat.components,
      ...lab.components,
      ...eqp.components,
      ...subkon.components,
      ...prelim.components,
    ],
    markup: priceEval?.markup
      ? { factor: priceEval.markup.factor, sourceCell: priceEval.markup.sourceCell, sourceLabel: null }
      : (mat.markup ?? lab.markup ?? eqp.markup ?? null),
    totalCached,
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/recipeBuilder.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/recipeBuilder.ts tools/boqParserV2/__tests__/recipeBuilder.test.ts
git commit -m "feat(boq-v2): recipe builder assembles components with block context + markup"
```

---

### Task 8: Wire recipe into extractTakeoffs + BoqRowV2

**Files:**
- Modify: `tools/boqParserV2/extractTakeoffs.ts`
- Modify: `tools/boqParserV2/index.ts`
- Modify: `tools/boqParserV2/__tests__/extractTakeoffs.test.ts` (expect new field)

- [ ] **Step 1: Add a recipe field to BoqRowV2**

In `tools/boqParserV2/extractTakeoffs.ts`, update the `BoqRowV2` interface:

```typescript
export interface BoqRowV2 {
  code: string;
  label: string;
  unit: string;
  planned: number;
  sourceRow: number;
  cost_basis: CostBasis | null;
  ref_cells: RefCells | null;
  cost_split: CostSplit | null;
  subkon_cost_per_unit: number | null;
  total_cost: number | null;
  chapter: string | null;
  chapter_index: string | null;
  sub_chapter: string | null;
  sub_chapter_letter: string | null;
  is_sub_item: boolean;
  recipe: BoqRowRecipe | null;
}
```

And add the import at the top:

```typescript
import type { HarvestedCell, HarvestLookup, CostBasis, RefCells, CostSplit, BoqRowRecipe } from './types';
```

The extractor itself doesn't yet build recipes — it just initializes the field to `null`. In the `out.push({...})` at the end of the row loop, add `recipe: null,` as a field.

- [ ] **Step 2: Export the column detector from extractTakeoffs**

To avoid duplicating column detection, export it as a named helper. In `tools/boqParserV2/extractTakeoffs.ts` change `function detectCostSplitColumns(...)` to `export function detectCostSplitColumns(...)`. Also add a small helper `findHeaderRow` and export it:

```typescript
export function findHeaderRow(byRow: Map<number, Map<string, HarvestedCell>>): number {
  const sorted = Array.from(byRow.keys()).sort((a, b) => a - b);
  for (const row of sorted) {
    const b = byRow.get(row)?.get('B');
    if (b && /uraian/i.test(String(b.value ?? ''))) return row;
  }
  return -1;
}
```

Refactor the existing header-detection loop inside `extractBoqRows` to call `findHeaderRow(byRow)`.

- [ ] **Step 3: Build recipe in `index.ts` after extractBoqRows**

In `tools/boqParserV2/index.ts`, import the builder and helpers:

```typescript
import { buildRecipe } from './recipeBuilder';
import { detectCostSplitColumns, findHeaderRow } from './extractTakeoffs';
```

After `const boqRows = extractBoqRows(cells, lookup, boqSheet);` add:

```typescript
// Recipe assembly: for every BoQ row that already has a cost_split, run the
// formula interpreter across I/J/K/L/M columns to produce a composite recipe.
// When the column detector returns null (no split columns in this workbook),
// we skip recipe assembly and leave b.recipe = null.
{
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheet) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }
  const headerRow = findHeaderRow(byRow);
  const splitCols = detectCostSplitColumns(byRow, headerRow);

  if (splitCols) {
    for (const b of boqRows) {
      if (!b.cost_split) continue;
      b.recipe = buildRecipe({
        sourceRow: b.sourceRow,
        sourceSheet: boqSheet,
        costSplit: b.cost_split,
        subkonPerUnit: b.subkon_cost_per_unit ?? 0,
        splitColumns: splitCols,
        markupCell: 'E',
        totalCell: 'F',
        lookup,
        blocks: ahsBlocks,
        analisaSheet,
      });
    }
  }
}
```

In the BoQ staging push, add `recipe: b.recipe` to `parsed_data`:

```typescript
parsed_data: {
  code: b.code,
  label: b.label,
  unit: b.unit,
  planned: b.planned,
  unit_price: b.cost_split
    ? b.cost_split.material + b.cost_split.labor + b.cost_split.equipment + b.cost_split.prelim + (b.subkon_cost_per_unit ?? 0)
    : null,
  subkon_cost_per_unit: b.subkon_cost_per_unit,
  total_cost: b.total_cost,
  recipe: b.recipe,
},
```

- [ ] **Step 4: Run all boqParserV2 tests**

Run: `npx jest tools/boqParserV2 --no-coverage`
Expected: all green. Existing tests that assert specific BoqRowV2 shapes may need `recipe: null` added if they used exact-match expectations (toMatchObject should still pass).

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/extractTakeoffs.ts tools/boqParserV2/index.ts
git commit -m "feat(boq-v2): attach BoqRowRecipe to every BoQ row with a cost split"
```

---

### Task 9: Golden snapshot test for AAL-5 Poer PC.5

**Files:**
- Create: `tools/boqParserV2/__tests__/snapshots/aal5_poer_pc5.json`
- Create: `tools/boqParserV2/__tests__/recipeSnapshot.test.ts`

- [ ] **Step 1: Generate the snapshot**

Run this ad-hoc script once to produce the snapshot. Create `tmp/gen-snapshot.ts`:

```typescript
import * as fs from 'fs';
import { parseBoqV2 } from '../tools/boqParserV2';

(async () => {
  const buf = fs.readFileSync('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = await parseBoqV2(ab as ArrayBuffer);
  const target = result.boqRows.find(b => /Poer PC\.5$/.test(b.label));
  if (!target) throw new Error('Poer PC.5 not found');
  // Canonicalize numbers to 2 decimals to avoid rupiah-scale float drift
  const canonical = JSON.parse(JSON.stringify(target.recipe, (_k, v) =>
    typeof v === 'number' ? Number(v.toFixed(2)) : v
  ));
  fs.writeFileSync(
    'tools/boqParserV2/__tests__/snapshots/aal5_poer_pc5.json',
    JSON.stringify(canonical, null, 2),
  );
  console.log('wrote snapshot for', target.code, target.label);
})();
```

Then: `mkdir -p tools/boqParserV2/__tests__/snapshots && npx ts-node --project tsconfig.jest.json tmp/gen-snapshot.ts`

- [ ] **Step 2: Review the snapshot manually**

Open `tools/boqParserV2/__tests__/snapshots/aal5_poer_pc5.json`. Verify:
- `perUnit.material ≈ 2428240.77`
- `perUnit.labor ≈ 800000`
- `perUnit.equipment ≈ 75000`
- `markup.factor = 1.2`
- `markup.sourceCell.sheet === 'REKAP RAB'`
- `components` contains entries referencing `Analisa!F82`, `Analisa!F35`, `Analisa!F132` with sensible coefficients

If anything's off, diagnose before proceeding. Do NOT commit a bad snapshot.

- [ ] **Step 3: Write the snapshot assertion test**

Create `tools/boqParserV2/__tests__/recipeSnapshot.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '..';

describe('AAL-5 recipe snapshots', () => {
  it('Poer PC.5 recipe matches golden snapshot', async () => {
    const buf = fs.readFileSync('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = await parseBoqV2(ab as ArrayBuffer);
    const target = result.boqRows.find(b => /Poer PC\.5$/.test(b.label));
    expect(target).toBeDefined();
    const canonical = JSON.parse(JSON.stringify(target!.recipe, (_k, v) =>
      typeof v === 'number' ? Number(v.toFixed(2)) : v
    ));
    const expected = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'snapshots', 'aal5_poer_pc5.json'), 'utf8'),
    );
    expect(canonical).toEqual(expected);
  }, 60000);
});
```

- [ ] **Step 4: Run the test**

Run: `npx jest tools/boqParserV2/__tests__/recipeSnapshot.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit snapshot + test**

```bash
git add tools/boqParserV2/__tests__/snapshots/ tools/boqParserV2/__tests__/recipeSnapshot.test.ts
git commit -m "test(boq-v2): golden snapshot for AAL-5 Poer PC.5 recipe"
```

---

### Task 10: Extend smoke test with reconciliation assertions

**Files:**
- Modify: `tmp/parseV2.smoke.test.ts`

- [ ] **Step 1: Add reconciliation assertions**

At the end of the smoke test's assertions (just before the final closing brace), append:

```typescript
  // Recipe coverage and reconciliation: every BoQ row with a cost_split
  // should have a recipe, and the components per line type should sum to
  // the split values within 1 rupiah.
  const withRecipe = result.boqRows.filter(r => r.recipe).length;
  const withSplit = result.boqRows.filter(r => r.cost_split).length;
  console.log('\nRECIPE COVERAGE:');
  console.log('  rows with recipe :', withRecipe, '/', withSplit, '(', Math.round(100 * withRecipe / Math.max(1, withSplit)), '% of split rows)');

  let reconciled = 0;
  let mismatches = 0;
  for (const r of result.boqRows) {
    if (!r.recipe || !r.cost_split) continue;
    const byType: Record<string, number> = { material: 0, labor: 0, equipment: 0, subkon: 0, prelim: 0 };
    for (const c of r.recipe.components) byType[c.lineType] += c.costContribution;
    const matOk = Math.abs(byType.material - r.cost_split.material) <= Math.max(1, r.cost_split.material * 1e-4);
    const labOk = Math.abs(byType.labor - r.cost_split.labor) <= Math.max(1, r.cost_split.labor * 1e-4);
    const eqpOk = Math.abs(byType.equipment - r.cost_split.equipment) <= Math.max(1, r.cost_split.equipment * 1e-4);
    if (matOk && labOk && eqpOk) reconciled++;
    else if (mismatches < 5) {
      mismatches++;
      console.log(`  reconciliation miss row ${r.sourceRow} ${r.code} "${r.label.slice(0, 30)}": `
        + `mat Δ${Math.round(byType.material - r.cost_split.material)} `
        + `lab Δ${Math.round(byType.labor - r.cost_split.labor)} `
        + `eqp Δ${Math.round(byType.equipment - r.cost_split.equipment)}`);
    }
  }
  console.log('  reconciled       :', reconciled, '/', withRecipe);
  expect(reconciled / Math.max(1, withRecipe)).toBeGreaterThan(0.7);
```

- [ ] **Step 2: Run the smoke test**

Run: `npx jest tmp/parseV2.smoke.test.ts --no-coverage --testPathIgnorePatterns="/node_modules/"`
Expected: PASS. Reconciliation > 70% (many AAL-5 rows have the AF composite; some simple rows reconcile trivially).

- [ ] **Step 3: Commit**

```bash
git add tmp/parseV2.smoke.test.ts
git commit -m "test(boq-v2): smoke-test reconciles component sums with cost_split"
```

---

### Task 11: PARSER_AI_GUIDE.md — the constitution

**Files:**
- Create: `docs/PARSER_AI_GUIDE.md`
- Create: `tools/boqParserV2/__tests__/parserGuide.test.ts`

- [ ] **Step 1: Write the guide document**

Create `docs/PARSER_AI_GUIDE.md` with the six sections described in the spec. This is a long document — write each section concretely, no placeholders. Sections:

- **A. Schema reference** — canonical RAB header layout (A=NO, B=URAIAN, C=SAT, D=VOLUME, E=HARGA SATUAN, F=TOTAL, H=VOLUME, I=Material, J=Upah, K=Peralatan, L=Subkon, M=Prelim, N=TOTAL HARGA SATUAN, O=TOTAL HARGA). Label synonyms (Indonesian/English). AHS block structure (title, components, Jumlah F/G/H, grand total I). Material and Upah sheets shape. Link carrier sheets (REKAP-PC, REKAP Balok, Pas. Dinding, Plumbing, Retaining Wall).

- **B. Known formula patterns** — `AF = R + V*W + Z*AA` composite (readymix + bekisting + rebar). `E = N * 'REKAP RAB'!$O$X` markup. `D = H` volume passthrough from takeoff sheet. `SUMIFS('REKAP-PC'!..., ...)` quantity aggregation. `=Analisa!$F$row` direct block reference.

- **C. Data gotchas** — duplicate "Material" labels in header (leftmost wins). Sub-items with `"- "` prefix under unnumbered parent row. Roman numerals in col A as chapter markers. Forbidden merged cells inside AHS blocks. Orphan templates (AHS blocks with zero BoQ references). Subtotal rows starting with "Jumlah" or "Subtotal". Float drift tolerance `Math.max(1, value × 1e-6)`. Per-row markup factors vary (usually 1.20). Prelim column often unlabeled — defaults to M.

- **D. Decision rules for AI helpers** — if confidence on a material match < 0.6, return `null`. If reconciliation delta exceeds 1%, flag but don't auto-correct. If a column mapping is ambiguous, propose 2 candidates with reasons. Never invent coefficients, prices, material names, or block titles.

- **E. Output JSON schemas** — for each handler: `matchMaterialName`, `explainAnomaly`, `suggestColumnMapping`, `reviewOrphanBlock`. Each schema includes a "confidence" (0–1) and a "reasoning" (one sentence).

- **F. Anti-patterns** — don't fabricate AHS block titles; keep material names verbatim; don't guess markup from context; don't collapse multi-line descriptions; don't paraphrase.

Note: the actual content is lengthy. Write it concretely — each gotcha should reference the specific column or row pattern. Use code fences for JSON schema examples.

- [ ] **Step 2: Write a sanity test that parses the guide**

```typescript
// tools/boqParserV2/__tests__/parserGuide.test.ts
import * as fs from 'fs';
import * as path from 'path';

describe('PARSER_AI_GUIDE.md', () => {
  const guidePath = path.join(__dirname, '..', '..', '..', 'docs', 'PARSER_AI_GUIDE.md');
  const content = fs.readFileSync(guidePath, 'utf8');

  it('contains all six required sections', () => {
    expect(content).toMatch(/##\s+A\.\s+Schema reference/i);
    expect(content).toMatch(/##\s+B\.\s+Known formula patterns/i);
    expect(content).toMatch(/##\s+C\.\s+Data gotchas/i);
    expect(content).toMatch(/##\s+D\.\s+Decision rules/i);
    expect(content).toMatch(/##\s+E\.\s+Output JSON schemas/i);
    expect(content).toMatch(/##\s+F\.\s+Anti-patterns/i);
  });

  it('mentions the canonical column layout', () => {
    expect(content).toMatch(/URAIAN/);
    expect(content).toMatch(/HARGA SATUAN/);
    expect(content).toMatch(/Material.*Upah.*Peralatan/s);
  });

  it('documents the AF composite pattern', () => {
    expect(content).toMatch(/R\s*\+\s*V\s*\*\s*W\s*\+\s*Z\s*\*\s*AA/);
  });

  it('has output JSON schema examples', () => {
    expect(content).toMatch(/```json/);
    expect(content).toMatch(/confidence/);
  });
});
```

- [ ] **Step 3: Run**

Run: `npx jest tools/boqParserV2/__tests__/parserGuide.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/PARSER_AI_GUIDE.md tools/boqParserV2/__tests__/parserGuide.test.ts
git commit -m "docs(boq-v2): PARSER_AI_GUIDE.md — constitution for AI helpers"
```

---

### Task 12: Final full-suite verification

- [ ] **Step 1: Run ALL tests**

Run: `npx jest --no-coverage`
Expected: all green.

- [ ] **Step 2: Run the AAL-5 smoke test**

Run: `npx jest tmp/parseV2.smoke.test.ts --no-coverage --testPathIgnorePatterns="/node_modules/"`
Expected: PASS with:
- imbalanced = 0
- rows with cost_split >= 98%
- rows with recipe >= 95% of split rows
- reconciliation rate > 70%

- [ ] **Step 3: Commit anything uncommitted**

```bash
git status
# if clean, done
# if dirty, figure out why, commit, re-run suite
```

---

## Self-Review Checklist (run after completing the plan)

- [ ] Each task's Step 1 test fails when the implementation is missing (verified via explicit "run, expect FAIL" step).
- [ ] Each task's last step commits.
- [ ] No `TBD` / `TODO` / `similar to task N` / `implement later` anywhere in this plan.
- [ ] Type names match across tasks: `BoqRowRecipe`, `RecipeComponent`, `Markup`, `CostSplit` (with `prelim`), `EvalResult`, `EvalComponent`, `EvalOptions`, `BuildRecipeInput`.
- [ ] Function names match: `tokenize`, `parse`, `evaluateFormula`, `buildRecipe`, `parseBoqV2`.
- [ ] File paths match across tasks — `tools/boqParserV2/formulaEval/` subdirectory is referenced consistently.
- [ ] Spec requirements covered: Prelim (Task 1), tokenizer (2), parser (3), evaluator + composite (4,5), markup (6), recipe builder (7), wiring (8), snapshot (9), smoke test (10), AI guide (11).
- [ ] Tasks 2–4 split in sensible order. Tasks 5 and 6 are the only ones building on prior file content rather than creating new modules — that's correct because the evaluator is where complexity accretes.

Phases 2–5 of the spec are NOT covered here. They need their own plans. After Phase 1 lands, the next plan should cover multi-sheet RAB support and the `(A) II.1` code prefix.
