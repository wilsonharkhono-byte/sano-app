# BoQ Parser — Inline Recipe Detection & Hand-Priced Row Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v2 BoQ parser to (a) detect the vertical "Poer PC.5 → Beton/Besi/Bekisting" inline-material-breakdown pattern in `RAB (A)`, (b) synthesize AHS components from hand-priced rows that already carry an inline cost split, and (c) surface unresolved formula references as a diagnostic. No DB migration; no Excel reader change.

**Architecture:** Closed vocabularies (`ELEMENT_TYPES`, `MATERIAL_TYPES`) drive structural detection. A new `detectInlineRecipe.ts` module sits between `extractBoqRows` and the existing staging-row assembly in `index.ts`; consumed source rows are skipped via a new optional parameter on `extractBoqRows`. `cost_split` synthesis adds a parallel pass at the end of orchestration. The validation layer gains an unresolved-reference diagnostic that runs against formula references already collected during BoQ→AHS linkage.

**Tech Stack:** TypeScript, Jest with ts-jest preset (config in `package.json`), SheetJS (`xlsx`) for harvest, ExcelJS for programmatic test fixtures via `buildFixtureBuffer`.

**Spec:** [docs/superpowers/specs/2026-04-28-boq-parser-inline-recipe-design.md](../specs/2026-04-28-boq-parser-inline-recipe-design.md)

---

## File Structure

**Create:**
- `tools/boqParserV2/vocab.ts` — `ELEMENT_TYPES`, `MATERIAL_TYPES`, and their derived regexes. ~30 lines.
- `tools/boqParserV2/detectInlineRecipe.ts` — group detection algorithm. Exports `detectInlineRecipes()` returning `InlineRecipeGroup[]`. ~140 lines.
- `tools/boqParserV2/__tests__/vocab.test.ts` — regex match cases.
- `tools/boqParserV2/__tests__/detectInlineRecipe.test.ts` — group detection cases against programmatic fixtures.
- `tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts` — synthesis cases.
- `tools/boqParserV2/__tests__/unresolvedReferences.test.ts` — diagnostic cases.
- `tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts` — full-pipeline snapshot tests against existing real-workbook fixtures.

**Modify:**
- `tools/boqParserV2/types.ts` — add `'inline_recipe'` to `CostBasis` union; extend `RefCells` with optional `source_rows`; extend `ValidationReport` with optional `unresolved_references`.
- `tools/boqParserV2/extractTakeoffs.ts` — accept optional `skipRows: Set<number>` parameter on `extractBoqRows()` to omit consumed source rows.
- `tools/boqParserV2/index.ts` — call `detectInlineRecipes`, emit synthetic blocks for inline_recipe groups and inline_split BoQ rows, populate unresolved-reference diagnostic, pipe `validationReport` through.
- `tools/boqParserV2/validate.ts` — add `collectUnresolvedReferences()` helper that consumes the formula-reference collection from index.ts.

---

## Task 1: Vocabulary module and `inline_recipe` cost basis

**Files:**
- Create: `tools/boqParserV2/vocab.ts`
- Create: `tools/boqParserV2/__tests__/vocab.test.ts`
- Modify: `tools/boqParserV2/types.ts:4-14`

- [ ] **Step 1: Write the failing test**

Create `tools/boqParserV2/__tests__/vocab.test.ts`:

```typescript
import { ELEMENT_RE, MATERIAL_RE } from '../vocab';

describe('ELEMENT_RE', () => {
  it.each([
    '- Poer PC.5',
    '  - Sloof S36-1',
    '— Balok B25-1',
    'Kolom K24',
    '  Plat Lantai 1',
    'Tangga utama',
    'Pile P1',
    'Pondasi batu kali',
    'Lantai kerja',
    'Dinding bata',
    'Ringbalk RB1',
    'Atap baja ringan',
  ])('matches element type label: %s', (label) => {
    expect(ELEMENT_RE.test(label)).toBe(true);
  });

  it.each([
    'Beton readymix',
    '- Besi D13',
    'Bekisting Batako',
    'Pekerjaan Galian',
    '',
    '   ',
  ])('does not match non-element label: %s', (label) => {
    expect(ELEMENT_RE.test(label)).toBe(false);
  });
});

describe('MATERIAL_RE', () => {
  it.each([
    '- Beton',
    '  - Besi D13',
    '- Besi D16',
    'Bekisting Batako',
    'Bekisting Kayu',
    'Pasir Lumajang',
    'Semen PC',
    'Mortar instan',
    'Bata merah',
    'Plesteran konvensional',
    'Acian mortar',
    'Cat dasar',
    'Keramik 30x30',
    'Triplek 9mm',
    'Kayu meranti',
  ])('matches material type label: %s', (label) => {
    expect(MATERIAL_RE.test(label)).toBe(true);
  });

  it.each([
    'Poer PC.5',
    'Sloof S36-1',
    'Wiremesh M8',
    '',
  ])('does not match non-material label: %s', (label) => {
    expect(MATERIAL_RE.test(label)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/vocab.test.ts`
Expected: FAIL with "Cannot find module '../vocab'".

- [ ] **Step 3: Extend `CostBasis` and `RefCells` in `types.ts`**

Modify `tools/boqParserV2/types.ts`. Replace the `CostBasis` block (lines 4-14):

```typescript
export type CostBasis =
  | 'catalog'
  | 'nested_ahs'
  | 'literal'
  | 'takeoff_ref'
  | 'cross_ref'
  // BoQ-row only: the workbook already carries a cached per-unit cost
  // split (Material / Upah / Peralatan / Subkon columns) on the BoQ row
  // itself. No AHS-component traversal needed to compute the cost — the
  // row is self-contained for display purposes.
  | 'inline_split'
  // BoQ-row only: parent label-only row in RAB (A) followed by 2+
  // material-typed child rows. The children carry the per-material
  // quantities and unit prices verbatim.
  | 'inline_recipe';
```

Replace the `RefCells` block (lines 22-28) to add `source_rows`:

```typescript
export interface RefCells {
  unit_price?: CellRef;
  material_cost?: CellRef;
  labor_cost?: CellRef;
  equipment_cost?: CellRef;
  quantity?: CellRef[];
  // For inline_recipe parent BoQ rows: lists each child source row so
  // the audit can render provenance without walking children.
  source_rows?: Array<{ sheet: string; row: number; label: string }>;
}
```

- [ ] **Step 4: Create the vocab module**

Create `tools/boqParserV2/vocab.ts`:

```typescript
// Closed vocabularies driving the inline-recipe detector. Element-type
// words appear on the parent BoQ row ("- Poer PC.5"); material-type
// words appear on its children ("- Beton", "- Besi D13").
//
// The two arrays do not overlap — that's the disambiguation invariant
// that lets the detector distinguish inline-recipe parents from
// sub-sub-chapter dividers without reading bold/fill formatting.

export const ELEMENT_TYPES = [
  'Poer', 'Sloof', 'Balok', 'Kolom', 'Plat', 'Tangga',
  'Pile', 'Pondasi', 'Lantai', 'Dinding', 'Ringbalk', 'Atap',
];

export const MATERIAL_TYPES = [
  'Beton', 'Besi', 'Bekisting', 'Pasir', 'Semen',
  'Kayu', 'Triplek', 'Mortar', 'Bata', 'Plesteran',
  'Acian', 'Cat', 'Keramik',
];

export const ELEMENT_RE = new RegExp(
  `^[\\s\\-–—]*(${ELEMENT_TYPES.join('|')})\\b`,
  'i',
);

export const MATERIAL_RE = new RegExp(
  `^[\\s\\-–—]*(${MATERIAL_TYPES.join('|')})(\\s+[A-Z]?\\d+)?\\b`,
  'i',
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/vocab.test.ts`
Expected: PASS — all `it.each` cases green.

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/vocab.ts tools/boqParserV2/__tests__/vocab.test.ts tools/boqParserV2/types.ts
git commit -m "feat(boq-v2): add element/material vocabularies and inline_recipe cost basis"
```

---

## Task 2: Inline recipe detector

**Files:**
- Create: `tools/boqParserV2/detectInlineRecipe.ts`
- Create: `tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`

- [ ] **Step 1: Write the failing test (positive case)**

Create `tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`:

```typescript
import { detectInlineRecipes } from '../detectInlineRecipe';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('detectInlineRecipes', () => {
  it('detects a parent with 4 material children', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'E7', value: 'HARGA SATUAN' },
          { address: 'F7', value: 'TOTAL HARGA' },
          // Parent: label-only, no unit/qty
          { address: 'B10', value: '- Poer PC.5' },
          // Children: material-typed, with values
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 2.55 },
          { address: 'E11', value: 2631890 },
          { address: 'F11', value: 6711319.5 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' },
          { address: 'D12', value: 105.62 },
          { address: 'E12', value: 12009 },
          { address: 'F12', value: 1268391 },
          { address: 'B13', value: '- Besi D16' },
          { address: 'C13', value: 'kg' },
          { address: 'D13', value: 146.02 },
          { address: 'E13', value: 12009 },
          { address: 'F13', value: 1753554 },
          { address: 'B14', value: '- Bekisting Batako' },
          { address: 'C14', value: 'm2' },
          { address: 'D14', value: 7.56 },
          { address: 'E14', value: 100188 },
          { address: 'F14', value: 757421 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);

    const groups = detectInlineRecipes(cells, 'RAB (A)');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      parentRow: 10,
      parentLabel: 'Poer PC.5',
      childRows: [
        { sourceRow: 11, materialName: 'Beton', unit: 'm3', coefficient: 2.55, unitPrice: 2631890 },
        { sourceRow: 12, materialName: 'Besi D13', unit: 'kg', coefficient: 105.62, unitPrice: 12009 },
        { sourceRow: 13, materialName: 'Besi D16', unit: 'kg', coefficient: 146.02, unitPrice: 12009 },
        { sourceRow: 14, materialName: 'Bekisting Batako', unit: 'm2', coefficient: 7.56, unitPrice: 100188 },
      ],
    });
    expect(groups[0].parentTotalCost).toBeCloseTo(6711319.5 + 1268391 + 1753554 + 757421, 0);
    expect(groups[0].consumedRows.has(10)).toBe(true);
    expect(groups[0].consumedRows.has(14)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`
Expected: FAIL with "Cannot find module '../detectInlineRecipe'".

- [ ] **Step 3: Create the detector module**

Create `tools/boqParserV2/detectInlineRecipe.ts`:

```typescript
import type { HarvestedCell } from './types';
import { ELEMENT_RE, MATERIAL_RE } from './vocab';
import { toNumber } from './classifyComponent';

export interface InlineRecipeChildRow {
  sourceRow: number;
  materialName: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  total: number;
}

export interface InlineRecipeGroup {
  parentRow: number;
  parentLabel: string;
  parentTotalCost: number;
  childRows: InlineRecipeChildRow[];
  consumedRows: Set<number>;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  return toNumber(c.value);
}

function stripDashPrefix(label: string): string {
  return label.replace(/^[\s\-–—]+/, '').trim();
}

function isCandidateParent(map: Map<string, HarvestedCell>): boolean {
  const label = cellText(map.get('B'));
  if (!label) return false;
  if (!ELEMENT_RE.test(label)) return false;
  if (label.trim().endsWith(':')) return false;
  // Must be label-only: C/D/E/F empty
  if (cellText(map.get('C'))) return false;
  if (cellText(map.get('D'))) return false;
  if (cellText(map.get('E'))) return false;
  if (cellText(map.get('F'))) return false;
  return true;
}

function isMaterialChild(map: Map<string, HarvestedCell>): boolean {
  const label = cellText(map.get('B'));
  if (!label) return false;
  if (!MATERIAL_RE.test(label)) return false;
  // Must have at least a unit OR a quantity to count as a real component.
  const hasUnit = !!cellText(map.get('C'));
  const hasQty = cellNumber(map.get('D')) > 0;
  return hasUnit || hasQty;
}

function isChapterOrSubChapter(map: Map<string, HarvestedCell>): boolean {
  const a = cellText(map.get('A'));
  if (!a) return false;
  if (/^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3})\.?$/.test(a)) return true;
  if (/^[A-Z]\.?$/.test(a)) return true;
  return false;
}

function isEmpty(map: Map<string, HarvestedCell>): boolean {
  return !cellText(map.get('A')) && !cellText(map.get('B')) && !cellText(map.get('C'));
}

export function detectInlineRecipes(
  cells: HarvestedCell[],
  boqSheetName: string,
): InlineRecipeGroup[] {
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheetName) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map<string, HarvestedCell>();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }
  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);

  const groups: InlineRecipeGroup[] = [];
  let i = 0;
  while (i < sortedRows.length) {
    const row = sortedRows[i];
    const map = byRow.get(row)!;
    if (!isCandidateParent(map)) { i++; continue; }

    // Walk forward collecting material children until boundary.
    const children: InlineRecipeChildRow[] = [];
    let totalCost = 0;
    let j = i + 1;
    while (j < sortedRows.length) {
      const childRow = sortedRows[j];
      const childMap = byRow.get(childRow)!;
      if (isEmpty(childMap)) break;
      if (isChapterOrSubChapter(childMap)) break;
      if (isCandidateParent(childMap)) break;
      if (!isMaterialChild(childMap)) break;
      const total = cellNumber(childMap.get('F'));
      children.push({
        sourceRow: childRow,
        materialName: stripDashPrefix(cellText(childMap.get('B'))),
        unit: cellText(childMap.get('C')),
        coefficient: cellNumber(childMap.get('D')),
        unitPrice: cellNumber(childMap.get('E')),
        total,
      });
      totalCost += total;
      j++;
    }

    if (children.length >= 2) {
      const consumed = new Set<number>();
      consumed.add(row);
      for (const c of children) consumed.add(c.sourceRow);
      groups.push({
        parentRow: row,
        parentLabel: stripDashPrefix(cellText(map.get('B'))),
        parentTotalCost: totalCost,
        childRows: children,
        consumedRows: consumed,
      });
      i = j;        // skip past consumed children
    } else {
      i++;          // candidate rejected — try next row
    }
  }

  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`
Expected: PASS — the positive case green.

- [ ] **Step 5: Add negative test cases**

Append to `tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`:

```typescript
  it('rejects a parent whose label ends with ":" (sub-sub-chapter divider)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Poer (Readymix fc\' 30 MPa) :' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' },
          { address: 'D12', value: 1 },
          { address: 'E12', value: 1000 },
          { address: 'F12', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('rejects a parent that has unit or quantity values', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          // Has C and D — this is a leaf BoQ row, not a recipe parent
          { address: 'B10', value: '- Sloof S36-1' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 6.939 },
          { address: 'E10', value: 4626604 },
          { address: 'F10', value: 32104003 },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('rejects a parent with only one material child', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
          // Only one child — group should be rejected
          { address: 'B12', value: '- Sloof S36-1' },
          { address: 'C12', value: 'm3' },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('stops collecting at the next inline-recipe parent', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 1 }, { address: 'E11', value: 1000 }, { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 1 }, { address: 'E12', value: 1000 }, { address: 'F12', value: 1000 },
          // Next parent — first group ends here
          { address: 'B13', value: '- Poer PC.9' },
          { address: 'B14', value: '- Beton' },
          { address: 'C14', value: 'm3' }, { address: 'D14', value: 1 }, { address: 'E14', value: 1000 }, { address: 'F14', value: 1000 },
          { address: 'B15', value: '- Bekisting Batako' },
          { address: 'C15', value: 'm2' }, { address: 'D15', value: 1 }, { address: 'E15', value: 1000 }, { address: 'F15', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(2);
    expect(groups[0].parentLabel).toBe('Poer PC.5');
    expect(groups[0].childRows).toHaveLength(2);
    expect(groups[1].parentLabel).toBe('Poer PC.9');
    expect(groups[1].childRows).toHaveLength(2);
  });

  it('stops collecting at a chapter heading', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 1 }, { address: 'E11', value: 1000 }, { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 1 }, { address: 'E12', value: 1000 }, { address: 'F12', value: 1000 },
          // Roman numeral in column A → chapter heading; recipe ends
          { address: 'A13', value: 'IV' },
          { address: 'B13', value: 'PEKERJAAN ATAP' },
          { address: 'B14', value: '- Bekisting Kayu' },
          { address: 'C14', value: 'm2' }, { address: 'D14', value: 1 }, { address: 'E14', value: 1000 }, { address: 'F14', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(1);
    expect(groups[0].childRows).toHaveLength(2);
  });
```

- [ ] **Step 6: Run all detector tests**

Run: `npx jest tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 7: Commit**

```bash
git add tools/boqParserV2/detectInlineRecipe.ts tools/boqParserV2/__tests__/detectInlineRecipe.test.ts
git commit -m "feat(boq-v2): detect inline material breakdown groups in RAB sheet"
```

---

## Task 3: Wire inline recipes into the parser

**Files:**
- Modify: `tools/boqParserV2/extractTakeoffs.ts` (accept `inlineRecipeGroups` parameter; emit one parent BoqRowV2 per group with chapter-derived code, skip child source rows)
- Modify: `tools/boqParserV2/index.ts` (call detector, emit synthetic AHS block per group keyed by the parent's now-known BoQ code)

The integration choice matters: the spec requires the inline-recipe parent BoQ row's `code` to derive from the chapter/sub-chapter state machine ("occupies one BoQ slot like a regular leaf row"). That state lives inside `extractBoqRows`, so the parent row is emitted there — not separately in `index.ts`.

- [ ] **Step 1: Write the integration test**

Create `tools/boqParserV2/__tests__/parseBoqV2.inlineRecipe.test.ts`:

```typescript
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 inline recipe handling', () => {
  it('emits one BoQ row per inline-recipe parent with synthetic AHS components', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'A8', value: 'III' },
          { address: 'B8', value: 'PEKERJAAN STRUKTUR' },
          { address: 'A9', value: 'A' },
          { address: 'B9', value: 'Pondasi' },
          // Inline-recipe group 1
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 2.55 }, { address: 'E11', value: 2631890 }, { address: 'F11', value: 6711320 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 105.62 }, { address: 'E12', value: 12009 }, { address: 'F12', value: 1268391 },
          { address: 'B13', value: '- Bekisting Batako' },
          { address: 'C13', value: 'm2' }, { address: 'D13', value: 7.56 }, { address: 'E13', value: 100188 }, { address: 'F13', value: 757421 },
          // Regular leaf row after the recipe
          { address: 'B14', value: '- Sloof S36-1' },
          { address: 'C14', value: 'm3' }, { address: 'D14', value: 6.939 }, { address: 'E14', value: 4626604 }, { address: 'F14', value: 32104003 },
        ],
      },
      // Minimum-viable Analisa sheet so detectAhsBlocks doesn't throw
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);

    const boqRows = result.stagingRows.filter((r) => r.row_type === 'boq');
    const inlineRecipeBoq = boqRows.find(
      (r) => (r.parsed_data as { label?: string }).label === 'Poer PC.5',
    );
    expect(inlineRecipeBoq).toBeDefined();
    expect(inlineRecipeBoq!.cost_basis).toBe('inline_recipe');
    expect((inlineRecipeBoq!.parsed_data as { unit?: string }).unit).toBe('lot');
    expect((inlineRecipeBoq!.parsed_data as { planned?: number }).planned).toBe(1);
    // Code is chapter-derived: III chapter, A sub-chapter, first sub-item
    // under the section (label starts with "-" → isSubItem=true → III.A.1).
    expect((inlineRecipeBoq!.parsed_data as { code?: string }).code).toBe('III.A.1');
    expect((inlineRecipeBoq!.parsed_data as { total_cost?: number }).total_cost).toBeCloseTo(
      6711320 + 1268391 + 757421,
      0,
    );

    // The 3 child source rows must NOT appear as their own BoQ rows
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Beton')).toBeUndefined();
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Besi D13')).toBeUndefined();
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Bekisting Batako')).toBeUndefined();

    // The leaf Sloof row should still appear as its own BoQ row, code III.A.2
    const sloofBoq = boqRows.find(
      (r) => (r.parsed_data as { label?: string }).label?.includes('Sloof S36-1'),
    );
    expect(sloofBoq).toBeDefined();
    expect((sloofBoq!.parsed_data as { code?: string }).code).toBe('III.A.2');

    // Synthetic ahs_block + 3 ahs components linked to the parent's code
    const blocks = result.stagingRows.filter((r) => r.row_type === 'ahs_block');
    const recipeBlock = blocks.find(
      (r) => (r.parsed_data as { title?: string }).title === 'Poer PC.5 (inline recipe)',
    );
    expect(recipeBlock).toBeDefined();
    expect((recipeBlock!.parsed_data as { linked_boq_code?: string }).linked_boq_code).toBe('III.A.1');

    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${recipeBlock!.row_number}`,
    );
    expect(components).toHaveLength(3);
    const materialNames = components.map((c) => (c.parsed_data as { material_name?: string }).material_name);
    expect(materialNames).toEqual(['Beton', 'Besi D13', 'Bekisting Batako']);

    // Provenance: parent's ref_cells.source_rows lists each child row
    const sourceRows = (inlineRecipeBoq!.ref_cells as { source_rows?: Array<{ row: number; label: string }> } | null)?.source_rows;
    expect(sourceRows).toBeDefined();
    expect(sourceRows).toHaveLength(3);
    expect(sourceRows!.map((s) => s.label)).toEqual(['Beton', 'Besi D13', 'Bekisting Batako']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/parseBoqV2.inlineRecipe.test.ts`
Expected: FAIL with `inlineRecipeBoq` undefined (current parser flattens children as separate BoQ items).

- [ ] **Step 3: Update `extractBoqRows` to accept inline-recipe groups and emit parent rows in-line**

Modify `tools/boqParserV2/extractTakeoffs.ts`.

First, change the import block at the top to include the group type:

```typescript
import type { HarvestedCell, HarvestLookup, CostBasis, RefCells, CostSplit } from './types';
import { parseFormulaRef, toNumber } from './classifyComponent';
import type { InlineRecipeGroup } from './detectInlineRecipe';
```

Next, change the function signature (replace the existing `export function extractBoqRows(...)` line and its closing brace through to the matching parameter list — the existing block starts at line 95):

```typescript
export function extractBoqRows(
  cells: HarvestedCell[],
  lookup: HarvestLookup,
  boqSheetName: string,
  inlineRecipeGroups: InlineRecipeGroup[] = [],
): BoqRowV2[] {
```

Right after the `for (const c of cells)` byRow-build loop (~line 107 in current file), and before the `// Detect header row` block, add:

```typescript
  // Lookup table for the inline-recipe-aware paths inside the row loop.
  const recipeParentByRow = new Map<number, InlineRecipeGroup>();
  const recipeChildRows = new Set<number>();
  for (const g of inlineRecipeGroups) {
    recipeParentByRow.set(g.parentRow, g);
    for (const c of g.childRows) recipeChildRows.add(c.sourceRow);
  }
```

Then in the per-row loop (existing `for (const row of sortedRowNums)` near line 148), add the recipe handling immediately after the header skip and before the existing chapter-detection logic. Replace this block:

```typescript
  for (const row of sortedRowNums) {
    if (row <= headerRow) continue;
    const map = byRow.get(row)!;
    const label = cellText(map.get('B'));   // description
    const unit = cellText(map.get('C'));    // satuan
    if (!label) continue;
    const aText = cellText(map.get('A'));
    const aNorm = aText.trim().replace(/\.$/, '');

    const planned = cellNumber(map.get('D'));
```

with:

```typescript
  for (const row of sortedRowNums) {
    if (row <= headerRow) continue;
    // Children of an inline-recipe group must not surface as standalone
    // BoQ items — the recipe's synthesized AHS components subsume them.
    if (recipeChildRows.has(row)) continue;

    const map = byRow.get(row)!;
    const label = cellText(map.get('B'));   // description
    const unit = cellText(map.get('C'));    // satuan
    if (!label) continue;
    const aText = cellText(map.get('A'));
    const aNorm = aText.trim().replace(/\.$/, '');

    const planned = cellNumber(map.get('D'));

    // Inline-recipe parent: emit ONE BoqRowV2 with chapter-derived code
    // and inline_recipe cost basis. Bypass the label-only sub-sub-chapter
    // path (which would otherwise increment subSubChapterCounter).
    const recipeGroup = recipeParentByRow.get(row);
    if (recipeGroup) {
      const isSubItem = /^\s*[-–—]\s/.test(label);
      let code: string;
      if (isSubItem) {
        subItemCounter++;
        const parts = [chapterIndex ?? 'I'];
        if (subChapterLetter) parts.push(subChapterLetter);
        if (subSubChapterCounter > 0) parts.push(String(subSubChapterCounter));
        if (itemCounter > 0) parts.push(String(itemCounter));
        parts.push(`${subItemCounter}`);
        code = parts.join('.');
      } else {
        itemCounter++;
        subItemCounter = 0;
        const parts = [chapterIndex ?? 'I'];
        if (subChapterLetter) parts.push(subChapterLetter);
        if (subSubChapterCounter > 0) parts.push(String(subSubChapterCounter));
        parts.push(String(itemCounter));
        code = parts.join('.');
      }
      out.push({
        code,
        label: recipeGroup.parentLabel,
        unit: 'lot',
        planned: 1,
        sourceRow: row,
        cost_basis: 'inline_recipe',
        ref_cells: {
          source_rows: recipeGroup.childRows.map((c) => ({
            sheet: boqSheetName,
            row: c.sourceRow,
            label: c.materialName,
          })),
        },
        cost_split: null,
        subkon_cost_per_unit: null,
        total_cost: recipeGroup.parentTotalCost,
        chapter: chapterLabel,
        chapter_index: chapterIndex,
        sub_chapter: subChapterLabel,
        sub_chapter_letter: subChapterLetter,
        is_sub_item: isSubItem,
      });
      continue;
    }
```

The rest of the loop body (chapter detection, sub-chapter detection, subtotal skip, label-only divider handling, leaf handling) stays unchanged.

- [ ] **Step 4: Wire detector + group-aware extraction into `index.ts`**

Modify `tools/boqParserV2/index.ts`. Add the import at the top (after the existing imports):

```typescript
import { detectInlineRecipes, type InlineRecipeGroup } from './detectInlineRecipe';
```

Replace the line:

```typescript
  const boqRows = extractBoqRows(cells, lookup, boqSheet);
```

with:

```typescript
  const inlineRecipeGroups = detectInlineRecipes(cells, boqSheet);
  const boqRows = extractBoqRows(cells, lookup, boqSheet, inlineRecipeGroups);
```

- [ ] **Step 5: Emit synthetic AHS blocks for each inline-recipe group in `index.ts`**

Inside `index.ts`, after the existing `for (const block of ahsBlocks)` loop ends (the closing brace around line 242, just before the `for (const b of boqRows)` BoQ-row push loop on line 244), insert:

```typescript
  // Inline-recipe groups: synthesize one ahs_block + N components per
  // group, linked to the recipe parent's BoQ code (already assigned by
  // extractBoqRows). The parent itself is already in boqRows and gets
  // pushed by the loop below this block.
  for (const g of inlineRecipeGroups) {
    const parentBoq = boqRows.find((b) => b.sourceRow === g.parentRow);
    if (!parentBoq) continue;     // defensive: detector and extractor disagreed
    const blockRowNumber = ++rowNumber;
    stagingRows.push({
      row_type: 'ahs_block',
      row_number: blockRowNumber,
      raw_data: { sourceRow: g.parentRow, kind: 'inline_recipe' },
      parsed_data: {
        title: `${g.parentLabel} (inline recipe)`,
        jumlah_cached_value: g.parentTotalCost,
        linked_boq_code: parentBoq.code,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: 'inline_recipe',
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });

    for (const child of g.childRows) {
      stagingRows.push({
        row_type: 'ahs',
        row_number: ++rowNumber,
        raw_data: { sourceRow: child.sourceRow, kind: 'inline_recipe' },
        parsed_data: {
          material_name: child.materialName,
          unit: child.unit,
          coefficient: child.coefficient,
          unit_price: child.unitPrice,
        },
        needs_review: false,
        confidence: 1,
        review_status: 'PENDING',
        cost_basis: null,
        parent_ahs_staging_id: `block:${blockRowNumber}`,
        ref_cells: null,
        cost_split: null,
      });
    }
  }
```

- [ ] **Step 6: Run the integration test**

Run: `npx jest tools/boqParserV2/__tests__/parseBoqV2.inlineRecipe.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full parser test suite to catch regressions**

Run: `npx jest tools/boqParserV2/`
Expected: All existing tests still PASS. Any failure is a regression — investigate before proceeding.

- [ ] **Step 8: Commit**

```bash
git add tools/boqParserV2/extractTakeoffs.ts tools/boqParserV2/index.ts tools/boqParserV2/__tests__/parseBoqV2.inlineRecipe.test.ts
git commit -m "feat(boq-v2): emit one BoQ row per inline-recipe group with synthetic AHS components"
```

---

## Task 4: Synthesize AHS components from `inline_split` BoQ rows

**Files:**
- Modify: `tools/boqParserV2/index.ts` (after the existing inline-recipe emission, add cost_split synthesis)
- Create: `tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts`:

```typescript
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 cost_split synthesis', () => {
  it('emits ahs_block + components for hand-priced rows with non-zero buckets', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          // Header labels for split columns the parser already detects
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          // Hand-priced row: literal split values, no formula chain
          { address: 'B10', value: 'Direksi keet, gudang material' },
          { address: 'C10', value: 'ls' },
          { address: 'D10', value: 1 },
          { address: 'I10', value: 12000000 },
          { address: 'J10', value: 7000000 },
          { address: 'K10', value: 1000000 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);

    const boqRow = result.stagingRows.find(
      (r) =>
        r.row_type === 'boq' &&
        (r.parsed_data as { label?: string }).label === 'Direksi keet, gudang material',
    );
    expect(boqRow).toBeDefined();
    expect(boqRow!.cost_basis).toBe('inline_split');

    const block = result.stagingRows.find(
      (r) =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === 'Direksi keet, gudang material (hand-priced)',
    );
    expect(block).toBeDefined();
    expect(block!.cost_basis).toBe('inline_split');

    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${block!.row_number}`,
    );
    expect(components).toHaveLength(3);
    const names = components.map((c) => (c.parsed_data as { material_name?: string }).material_name);
    expect(names).toEqual(['Material', 'Upah', 'Peralatan']);
    const prices = components.map((c) => (c.parsed_data as { unit_price?: number }).unit_price);
    expect(prices).toEqual([12000000, 7000000, 1000000]);
  });

  it('skips zero-value buckets', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'B10', value: 'Tangga utama' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 1 },
          { address: 'I10', value: 7000000 },
          { address: 'J10', value: 0 },
          { address: 'K10', value: 0 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);
    const block = result.stagingRows.find(
      (r) =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === 'Tangga utama (hand-priced)',
    );
    expect(block).toBeDefined();
    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${block!.row_number}`,
    );
    expect(components).toHaveLength(1);
    expect((components[0].parsed_data as { material_name?: string }).material_name).toBe('Material');
  });

  it('does not synthesize when cost_split is null', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'B10', value: 'Galian tanah' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 100 },
          { address: 'E10', value: 50000 },
          { address: 'F10', value: 5000000 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);
    const result = await parseBoqV2(buf);
    const blocks = result.stagingRows.filter(
      (r) =>
        r.row_type === 'ahs_block' &&
        ((r.parsed_data as { title?: string }).title ?? '').includes('hand-priced'),
    );
    expect(blocks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts`
Expected: FAIL — block undefined (synthesis not yet implemented).

- [ ] **Step 3: Add the synthesis loop in `index.ts`**

Modify `tools/boqParserV2/index.ts`. Find the `for (const b of boqRows)` loop that pushes BoQ staging rows (the loop currently around lines 244-277). Immediately after that loop's closing brace — and before the `// parent key format: "block:..."` comment block that handles nested_ahs resolution — insert:

```typescript
  // Synthesize ahs_block + components for hand-priced BoQ rows.
  // The parser already classifies these as cost_basis='inline_split' and
  // populates cost_split, but emits no AHS components — so the audit
  // shows "0 AHS line". We synthesize one component per non-zero bucket
  // so the audit renders the actual numbers and flags the row for review.
  const inlineSplitBoqRows = boqRows.filter(
    (b) => b.cost_basis === 'inline_split' && b.cost_split,
  );
  for (const b of inlineSplitBoqRows) {
    const blockRowNumber = ++rowNumber;
    stagingRows.push({
      row_type: 'ahs_block',
      row_number: blockRowNumber,
      raw_data: { sourceRow: b.sourceRow, kind: 'inline_split' },
      parsed_data: {
        title: `${b.label} (hand-priced)`,
        jumlah_cached_value:
          (b.cost_split?.material ?? 0) +
          (b.cost_split?.labor ?? 0) +
          (b.cost_split?.equipment ?? 0) +
          (b.subkon_cost_per_unit ?? 0),
        linked_boq_code: b.code,
      },
      needs_review: true,
      confidence: 0.5,
      review_status: 'PENDING',
      cost_basis: 'inline_split',
      parent_ahs_staging_id: null,
      ref_cells: b.ref_cells,
      cost_split: b.cost_split,
    });

    const buckets: Array<{ name: string; value: number }> = [
      { name: 'Material', value: b.cost_split?.material ?? 0 },
      { name: 'Upah', value: b.cost_split?.labor ?? 0 },
      { name: 'Peralatan', value: b.cost_split?.equipment ?? 0 },
      { name: 'Subkon', value: b.subkon_cost_per_unit ?? 0 },
    ];
    for (const bucket of buckets) {
      if (bucket.value <= 0) continue;
      stagingRows.push({
        row_type: 'ahs',
        row_number: ++rowNumber,
        raw_data: { sourceRow: b.sourceRow, kind: 'inline_split', bucket: bucket.name },
        parsed_data: {
          material_name: bucket.name,
          unit: b.unit,
          coefficient: 1,
          unit_price: bucket.value,
        },
        needs_review: true,
        confidence: 0.5,
        review_status: 'PENDING',
        cost_basis: null,
        parent_ahs_staging_id: `block:${blockRowNumber}`,
        ref_cells: null,
        cost_split: null,
      });
    }
  }
```

- [ ] **Step 4: Run synthesis tests**

Run: `npx jest tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Run full test suite for regressions**

Run: `npx jest tools/boqParserV2/`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/index.ts tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts
git commit -m "feat(boq-v2): synthesize AHS lines from inline cost_split for hand-priced rows"
```

---

## Task 5: Diagnostic for unresolved formula references

**Files:**
- Modify: `tools/boqParserV2/types.ts` (extend `ValidationReport`, add `RefCells.source_rows`)
- Modify: `tools/boqParserV2/index.ts` (collect references during traversal, expose via return)
- Modify: `tools/boqParserV2/validate.ts` (compute unresolved set)
- Create: `tools/boqParserV2/__tests__/unresolvedReferences.test.ts`

- [ ] **Step 1: Extend `ValidationReport` types**

Modify `tools/boqParserV2/types.ts`. Replace the `ValidationReport` interface (lines 48-57) with:

```typescript
export interface UnresolvedReference {
  boq_row_code: string;
  source_address: string;     // e.g. "RAB (A)!E51"
  formula: string;
  target: { sheet: string; cell: string };
  message: string;
}

export interface ValidationReport {
  blocks: Array<{
    block_title: string;
    status: 'ok' | 'imbalanced';
    expected: number;
    actual: number;
    delta: number;
  }>;
  unresolved_references: UnresolvedReference[];
  generated_at: string;
}
```

(Note: `RefCells.source_rows` was already extended in Task 1; only the validation-report types are new here.)

- [ ] **Step 2: Update existing `validate.ts` to populate the new field**

Modify `tools/boqParserV2/validate.ts`. Replace the entire file:

```typescript
import type { AhsBlock } from './detectBlocks';
import type {
  ValidationReport,
  UnresolvedReference,
} from './types';

export function validateBlocks(blocks: AhsBlock[]): ValidationReport {
  const report: ValidationReport = {
    blocks: [],
    unresolved_references: [],
    generated_at: new Date().toISOString(),
  };
  for (const b of blocks) {
    const actual = b.componentSubtotals.reduce((sum, v) => sum + v, 0);
    const delta = actual - b.jumlahCachedValue;
    const tolerance = Math.max(1, Math.abs(b.jumlahCachedValue) * 1e-6);
    const status: 'ok' | 'imbalanced' = Math.abs(delta) <= tolerance ? 'ok' : 'imbalanced';
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

export interface AnalisaRefEncounter {
  boqCode: string;
  sourceAddress: string;
  formula: string;
  targetSheet: string;
  targetCell: string;
}

export function collectUnresolvedReferences(
  encounters: AnalisaRefEncounter[],
  blocks: AhsBlock[],
): UnresolvedReference[] {
  const blockGrandTotals = new Set<string>();
  const blockJumlahAddresses = new Set<string>();
  const blockRowRanges: Array<{ titleRow: number; jumlahRow: number }> = [];
  for (const b of blocks) {
    if (b.grandTotalAddress) blockGrandTotals.add(b.grandTotalAddress);
    blockJumlahAddresses.add(`F${b.jumlahRow}`);
    blockJumlahAddresses.add(`I${b.jumlahRow}`);
    blockRowRanges.push({ titleRow: b.titleRow, jumlahRow: b.jumlahRow });
  }

  const out: UnresolvedReference[] = [];
  for (const e of encounters) {
    if (blockGrandTotals.has(e.targetCell)) continue;
    if (blockJumlahAddresses.has(e.targetCell)) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(e.targetCell);
    const targetRow = m ? parseInt(m[2], 10) : null;
    let inRange = false;
    if (targetRow != null) {
      for (const r of blockRowRanges) {
        if (targetRow >= r.titleRow && targetRow <= r.jumlahRow) {
          inRange = true;
          break;
        }
      }
    }
    if (inRange) continue;
    out.push({
      boq_row_code: e.boqCode,
      source_address: e.sourceAddress,
      formula: e.formula,
      target: { sheet: e.targetSheet, cell: e.targetCell },
      message: `Formula points at ${e.targetSheet}!${e.targetCell} which does not match a Jumlah row, AHS title, or recognized block range. Likely hand-priced or unrecognized layout.`,
    });
  }
  return out;
}
```

- [ ] **Step 3: Update `index.ts` to collect references and feed the diagnostic**

Modify `tools/boqParserV2/index.ts`.

First, change the import line for validate to also pull the new exports:

```typescript
import { validateBlocks, collectUnresolvedReferences, type AnalisaRefEncounter } from './validate';
```

Next, declare the encounters array. Inside `parseBoqV2`, immediately before the existing `const ANALISA_REF_RE = ...` regex declaration, insert:

```typescript
  const analisaRefEncounters: AnalisaRefEncounter[] = [];
```

Now wire the seed loop. The existing `for (const b of boqRows)` loop (the one that builds `boqCodeByAnalisaAddress`) contains an inner block:

```typescript
    for (const c of rowCells) {
      const direct = collectAnalisaRefs(c.formula!, analisaSheet);
      for (const r of direct) {
        boqCodeByAnalisaAddress.set(`${r.sheet}!${r.addr}`, b.code);
      }
      // Follow same-sheet references for a single hop ...
```

Inside the inner `for (const r of direct)` loop, immediately after the `boqCodeByAnalisaAddress.set(...)` call, add:

```typescript
        analisaRefEncounters.push({
          boqCode: b.code,
          sourceAddress: `${c.sheet}!${c.address}`,
          formula: c.formula!,
          targetSheet: r.sheet,
          targetCell: r.addr,
        });
```

Now the hop loop. Further down inside the same outer `for (const b of boqRows)` loop is a `while (queue.length > 0 && hops < 100)` block whose body contains a `for (const r of direct)` that calls `boqCodeByAnalisaAddress.set(...)` again. Immediately after that `set(...)` call, add:

```typescript
        analisaRefEncounters.push({
          boqCode: b.code,
          sourceAddress: `${hopCell.sheet}!${hopCell.address}`,
          formula: hopCell.formula!,
          targetSheet: r.sheet,
          targetCell: r.addr,
        });
```

Finally, move the validation pass. The existing line `const validationReport = validateBlocks(ahsBlocks);` currently sits near the top of `parseBoqV2` (around line 43, right after `extractBoqRows` is called). Cut that single line. Then, immediately AFTER the outer `for (const b of boqRows)` loop ends — i.e. after the closing `}` of the loop that builds `boqCodeByAnalisaAddress` and `analisaRefEncounters` — paste:

```typescript
  const validationReport = validateBlocks(ahsBlocks);
  validationReport.unresolved_references = collectUnresolvedReferences(
    analisaRefEncounters,
    ahsBlocks,
  );
```

The new placement ensures the diagnostic runs after every reference has been collected.

- [ ] **Step 4: Write the diagnostic test**

Create `tools/boqParserV2/__tests__/unresolvedReferences.test.ts`:

```typescript
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 unresolved-reference diagnostic', () => {
  it('flags formulas that point at Analisa cells outside any detected block', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'B10', value: 'Pekerjaan Mystery' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 100 },
          // E points at Analisa!F999 which is outside any detected block
          { address: 'E10', value: 50000, formula: 'Analisa!$F$999', result: 50000 },
          { address: 'F10', value: 5000000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          // One small block: title at row 10, jumlah at row 14
          { address: 'B10', value: '1 m3 Beton' },
          { address: 'B11', value: 'Semen' }, { address: 'C11', value: 'sak' }, { address: 'D11', value: 'Semen PC' }, { address: 'E11', value: 65000 }, { address: 'B12', value: 0.22 }, { address: 'F12', value: 14300 },
          { address: 'B13', value: '' }, { address: 'D13', value: '' },
          { address: 'B14', value: 'Jumlah' },
          { address: 'F14', value: 14300, formula: 'SUM(F11:F13)', result: 14300 },
          // F999 exists but is far from any block range
          { address: 'F999', value: 50000 },
        ],
      },
    ]);

    const result = await parseBoqV2(buf);

    const unresolved = result.validationReport.unresolved_references;
    expect(unresolved.length).toBeGreaterThan(0);
    const hit = unresolved.find((u) => u.target.cell === 'F999');
    expect(hit).toBeDefined();
    expect(hit!.target.sheet).toBe('Analisa');
    expect(hit!.formula).toContain('F$999');
    expect(hit!.message).toContain('hand-priced');
  });

  it('does not flag references that point inside a detected block range', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Plesteran dinding' },
          { address: 'C10', value: 'm2' },
          { address: 'D10', value: 100 },
          { address: 'E10', value: 14300, formula: 'Analisa!$F$14', result: 14300 },
          { address: 'F10', value: 1430000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Beton' },
          { address: 'B11', value: 'Semen' }, { address: 'C11', value: 'sak' }, { address: 'D11', value: 'Semen PC' }, { address: 'E11', value: 65000 }, { address: 'B12', value: 0.22 }, { address: 'F12', value: 14300 },
          { address: 'B14', value: 'Jumlah' },
          { address: 'F14', value: 14300, formula: 'SUM(F11:F13)', result: 14300 },
        ],
      },
    ]);

    const result = await parseBoqV2(buf);
    expect(result.validationReport.unresolved_references).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run the diagnostic test**

Run: `npx jest tools/boqParserV2/__tests__/unresolvedReferences.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest tools/boqParserV2/`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/boqParserV2/types.ts tools/boqParserV2/validate.ts tools/boqParserV2/index.ts tools/boqParserV2/__tests__/unresolvedReferences.test.ts
git commit -m "feat(boq-v2): diagnostic warnings for unresolved Analisa formula references"
```

---

## Task 6: Snapshot regression test against real-workbook fixtures

**Files:**
- Create: `tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts`

This guards against accidental drift on AAL-5, PD3, Nusa Golf, and CONTOH while we iterate. Phase 2 (cost_split synthesis) is the only phase expected to change snapshots for these workbooks; the snapshot deltas should be inspected and committed deliberately.

- [ ] **Step 1: Write the snapshot test**

Create `tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '../index';

const FIXTURES = [
  { file: 'RAB R1 Pakuwon Indah AAL-5.xlsx', boqSheet: 'RAB (A)' },
  { file: 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx', boqSheet: 'RAB (A)' },
  { file: 'RAB Nusa Golf I4 no. 29_R3.xlsx', boqSheet: 'RAB (A)' },
  { file: 'CONTOH_Template_Parser.xlsx', boqSheet: 'RAB (A)' },
];

const BOQ_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ');

describe('parseBoqV2 real-workbook snapshots', () => {
  for (const { file, boqSheet } of FIXTURES) {
    const fullPath = path.join(BOQ_DIR, file);
    const exists = fs.existsSync(fullPath);
    const testFn = exists ? it : it.skip;
    testFn(`matches snapshot for ${file}`, async () => {
      const buf = fs.readFileSync(fullPath);
      const result = await parseBoqV2(buf, { boqSheet });
      // Deterministic projection of staging rows for the snapshot —
      // strip volatile fields like timestamps and limit to schema-stable
      // shape so unrelated cosmetic changes don't break the snapshot.
      const projection = result.stagingRows.map((r) => ({
        row_type: r.row_type,
        row_number: r.row_number,
        cost_basis: r.cost_basis,
        parent_ahs_staging_id: r.parent_ahs_staging_id,
        parsed_data: r.parsed_data,
      }));
      expect({
        rowCount: projection.length,
        rows: projection,
        unresolvedRefCount: result.validationReport.unresolved_references.length,
      }).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2: Run the snapshot test to seed snapshots**

Run: `npx jest tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts`
Expected: First run writes new snapshot files in `tools/boqParserV2/__tests__/__snapshots__/`. Tests PASS as snapshot creation always succeeds on first run.

- [ ] **Step 3: Verify the snapshot deltas are intentional**

Inspect the generated snapshots:

```bash
ls tools/boqParserV2/__tests__/__snapshots__/
```

Open `parseBoqV2.snapshot.test.ts.snap` and look for these expected new entries vs. pre-implementation behavior:
- AAL-5: 2 new `ahs_block` rows with title ending in `(hand-priced)` (Direksi keet, ...)
- PD3: 9 new `ahs_block` rows with title ending in `(hand-priced)`
- Nusa Golf: 1 new `ahs_block` row with title ending in `(hand-priced)`
- CONTOH: 0 new hand-priced blocks (template doesn't include literal-I rows)
- All four: zero `inline_recipe` blocks (none of these workbooks have the vertical pattern)
- Nonzero `unresolvedRefCount` is acceptable (Analisa has rows outside detected blocks); the value just needs to be stable.

If any of these expectations don't match — investigate before committing the snapshot.

- [ ] **Step 4: Commit the snapshots**

```bash
git add tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts tools/boqParserV2/__tests__/__snapshots__/
git commit -m "test(boq-v2): snapshot regression test against real BoQ workbooks"
```

---

## Final verification

- [ ] **Step 1: Run the entire parser test suite**

Run: `npx jest tools/boqParserV2/`
Expected: all tests PASS.

- [ ] **Step 2: Type-check the parser modules**

Run: `npx tsc --noEmit --project tsconfig.jest.json`
Expected: no errors.

- [ ] **Step 3: Sanity-check the diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD -- tools/boqParserV2/
```

Expected: 6 commits, ~10 files changed (3 new modules, 1 modified types, 1 modified extractTakeoffs, 1 modified validate, 1 modified index, 6 new test files, 1 snapshot directory).

---

## Phase 4 follow-up (post-merge, awaiting workbook)

Once `RAB ERNAWATI + 5M.xlsx` (or any equivalent reproducer) is available in `assets/BOQ/`:

1. Run the parser against it via the snapshot test (add fixture entry to the FIXTURES array). Inspect:
   - Are the inline-recipe parents detected? Count vs. expectation from the screenshots.
   - Does `unresolved_references` flag the rows the reviewer reports as "0 AHS line"? If so, those formula targets are the missing-pattern signal.
2. For each unresolved reference, open the workbook to that cell and identify the actual layout. Common possibilities:
   - References into `REKAP-PC`/`REKAP Balok` aggregator sheets (extend `classifyComponent.ts` formula classifier).
   - Multi-hop chains the current 100-hop limit doesn't reach (rare).
   - Sheets named outside the current Analisa/Material/Upah catalog detection.
3. Add a focused test fixture replicating the missing pattern, extend the classifier to handle it, ship as a follow-up PR.

This is intentionally not a numbered task because it depends on access to a workbook that isn't yet in the repo.
