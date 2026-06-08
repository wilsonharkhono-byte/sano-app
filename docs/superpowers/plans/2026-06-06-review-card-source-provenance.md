# Review-Card Source Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every BoQ import review-queue card show an exact Excel cell reference (`📄 Analisa!D412`) plus its AHS/BoQ role, replacing the meaningless staging-counter "Baris N".

**Architecture:** The v2 parser stamps `source_sheet` / `source_row` / `source_cell` into each staging row's JSONB `raw_data` (no DB migration). Two pure helpers (`sourceLocation`, `sourceContext`) turn that into display strings, and the review card in `BaselineScreen` renders them. Missing data shows "sumber tidak tercatat", never a fabricated cell.

**Tech Stack:** TypeScript, ts-jest, React Native (Expo), SheetJS-harvested cells.

Spec: `docs/superpowers/specs/2026-06-05-review-card-source-provenance-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tools/boqParserV2/detectBlocks.ts` | Modify | Add `titleAddress` to `AhsBlock`; capture the matched title cell's address. |
| `tools/boqParserV2/extractCatalog.ts` | Modify | Add `sourceSheet` + `nameAddress` to `CatalogRow` (material anchor + sheet). |
| `tools/boqParserV2/index.ts` | Modify | Stamp `source_sheet`/`source_row`/`source_cell` into each staging row's `raw_data`. |
| `tools/sourceProvenance.ts` | Create | Pure helpers `sourceLocation(row)` + `sourceContext(row, allRows)`. |
| `tools/__tests__/sourceProvenance.test.ts` | Create | Unit tests for the helpers. |
| `tools/boqParserV2/__tests__/detectBlocks.test.ts` | Modify | Assert `titleAddress`. |
| `tools/boqParserV2/__tests__/sourceProvenance.parser.test.ts` | Create | Assert `raw_data` provenance per row type from a fixture. |
| `workflows/screens/BaselineScreen.tsx` | Modify | Render location headline + context line on the card and Koreksi header. |

Run the whole suite any time with: `npx jest` (from repo root).

---

## Task 1: Capture the AHS block title-cell address

**Files:**
- Modify: `tools/boqParserV2/detectBlocks.ts:3-12` (interface) and `:75-132` (detection loop)
- Test: `tools/boqParserV2/__tests__/detectBlocks.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe('detectAhsBlocks', ...)` in `tools/boqParserV2/__tests__/detectBlocks.test.ts`:

```ts
  it('captures the title cell address', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', value: 1500000 },
          { address: 'F144', value: 75000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 85000 },
        ],
      },
    ]);
    const cells = harvestWorkbook(wb);
    const blocks = detectAhsBlocks(cells, 'Analisa');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].titleAddress).toBe('B142');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest detectBlocks -t "captures the title cell address"`
Expected: FAIL — `titleAddress` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add `titleAddress` to the `AhsBlock` interface**

In `tools/boqParserV2/detectBlocks.ts`, change the interface (lines 3-12) to add one field:

```ts
export interface AhsBlock {
  title: string;
  titleRow: number;
  titleAddress: string | null;        // e.g. "B142" — the cell holding the title text
  jumlahRow: number;
  jumlahCachedValue: number;
  grandTotalAddress: string | null;  // e.g. "I150"
  components: HarvestedCell[];        // the E-column cells of component rows
  componentRows: number[];            // row numbers
  componentSubtotals: number[];       // the F-column cached values (B×E subtotal) per component, same index as components
}
```

- [ ] **Step 4: Capture the matched title cell in the detection loop**

In `tools/boqParserV2/detectBlocks.ts`, replace these lines (currently `:77-80`):

```ts
    const b = cellText(cellAt(row, 'B'));
    const c = cellText(cellAt(row, 'C'));
    const titleText = isTitleRow(b) ? b : isTitleRow(c) ? c : null;
    if (!titleText) continue;
```

with:

```ts
    const bCell = cellAt(row, 'B');
    const cCell = cellAt(row, 'C');
    const titleCell = isTitleRow(cellText(bCell)) ? bCell : isTitleRow(cellText(cCell)) ? cCell : null;
    if (!titleCell) continue;
    const titleText = cellText(titleCell) as string;
```

Then in the `blocks.push({ ... })` call (currently `:122-131`), add the `titleAddress` field right after `titleRow`:

```ts
    blocks.push({
      title: titleText.trim(),
      titleRow: row,
      titleAddress: titleCell.address,
      jumlahRow,
      jumlahCachedValue: toNumber(jumlahF?.value),
      grandTotalAddress: jumlahI?.address ?? null,
      components,
      componentRows,
      componentSubtotals,
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest detectBlocks`
Expected: PASS (the new test and all existing `detectBlocks` tests).

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/detectBlocks.ts tools/boqParserV2/__tests__/detectBlocks.test.ts
git commit -m "feat(boq-v2): capture AHS block title-cell address in detectBlocks"
```

---

## Task 2: Capture material source sheet + name-cell address

**Files:**
- Modify: `tools/boqParserV2/extractCatalog.ts:4-10` (interface) and `:100-122` (row loop)
- Test: `tools/boqParserV2/__tests__/extractCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append this to `tools/boqParserV2/__tests__/extractCatalog.test.ts` (inside the top-level `describe`, or add a new `describe('catalog provenance', ...)`). It mirrors the existing fixture style in that file — if the existing tests use a different fixture helper, match their import; the assertion is what matters:

```ts
  it('records sourceSheet and nameAddress for each material row', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Uraian' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'zak' },
          { address: 'D2', value: 65000 },
        ],
      },
    ]);
    const cells = harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    const semen = rows.find(r => r.name === 'Semen PC');
    expect(semen).toBeDefined();
    expect(semen!.sourceSheet).toBe('Material');
    expect(semen!.nameAddress).toBe('B2');
  });
```

Make sure the file imports the helpers it uses. If they are not already imported at the top, add:

```ts
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest extractCatalog -t "records sourceSheet and nameAddress"`
Expected: FAIL — `sourceSheet`/`nameAddress` are `undefined`.

- [ ] **Step 3: Extend the `CatalogRow` interface**

In `tools/boqParserV2/extractCatalog.ts`, change the interface (lines 4-10):

```ts
export interface CatalogRow {
  code: string;
  name: string;
  unit: string;
  reference_unit_price: number;
  sourceRow: number;
  sourceSheet: string;
  nameAddress: string | null;   // A1 address of the name cell, e.g. "B2"
}
```

- [ ] **Step 4: Populate the new fields in the row loop**

In `tools/boqParserV2/extractCatalog.ts`, replace the body of the `for (const row of sortedRows)` loop (currently `:100-122`) so it grabs the name cell before stringifying it, and pushes the two new fields:

```ts
    for (const row of sortedRows) {
      if (row <= headerRow) continue;
      const cols = byRow.get(row);
      if (!cols) continue;

      const nameCell = cols.get(colMap.name);
      const name = cellText(nameCell);
      if (!name || name.length < 2) continue;

      const unit = cellText(cols.get(colMap.unit));
      const priceCell = cols.get(colMap.price);
      const price = priceCell ? toNumber(priceCell.value) : 0;

      const codeCell = cols.get(1);
      const code = codeCell ? cellText(codeCell) : '';

      out.push({
        code: code || name,
        name,
        unit,
        reference_unit_price: price,
        sourceRow: row,
        sourceSheet: sheet,
        nameAddress: nameCell ? nameCell.address : null,
      });
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest extractCatalog`
Expected: PASS (new test + existing catalog tests).

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/extractCatalog.ts tools/boqParserV2/__tests__/extractCatalog.test.ts
git commit -m "feat(boq-v2): record material source sheet + name-cell address"
```

---

## Task 3: Stamp provenance into staging `raw_data`

**Files:**
- Modify: `tools/boqParserV2/index.ts` — material builder (`:177-195`), ahs_block builder (`:304-340`), ahs component builder (`:361-378`), boq builder (`:382-414`)
- Test: `tools/boqParserV2/__tests__/sourceProvenance.parser.test.ts` (create)

Context for the implementer: in `index.ts`, `analisaSheet` is the Analisa sheet name; AHS component rows iterate `block.components`/`block.componentRows` with `compRow` as the Excel row; `b` is a takeoff with `b.source_sheet` and `b.sourceRow`; `m` is a `CatalogRow`.

- [ ] **Step 1: Write the failing test**

Create `tools/boqParserV2/__tests__/sourceProvenance.parser.test.ts`:

```ts
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('staging raw_data provenance', () => {
  it('stamps source_sheet/source_row/source_cell per row type', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' }, { address: 'B1', value: 'Uraian' },
          { address: 'C1', value: 'Satuan' }, { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' }, { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'zak' }, { address: 'D2', value: 65000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Lantai Kerja' },
          { address: 'B12', value: 'Semen PC' }, { address: 'C12', value: 'zak' },
          { address: 'D12', value: 'Semen PC' }, { address: 'E12', value: 65000 },
          { address: 'F12', value: 6825 },
          { address: 'B15', value: 'Jumlah' }, { address: 'F15', value: 6825 },
        ],
      },
    ]);
    const result = await parseBoqV2(wb);

    const block = result.stagingRows.find(r => r.row_type === 'ahs_block');
    expect((block!.raw_data as any).source_sheet).toBe('Analisa');
    expect((block!.raw_data as any).source_cell).toBe('B10');

    const comp = result.stagingRows.find(r => r.row_type === 'ahs');
    expect((comp!.raw_data as any).source_sheet).toBe('Analisa');
    expect((comp!.raw_data as any).source_row).toBe(12);
    expect((comp!.raw_data as any).source_cell).toBe('D12');

    const material = result.stagingRows.find(r => r.row_type === 'material');
    expect((material!.raw_data as any).source_sheet).toBe('Material');
    expect((material!.raw_data as any).source_cell).toBe('B2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest sourceProvenance.parser`
Expected: FAIL — `source_sheet`/`source_cell` are `undefined`.

- [ ] **Step 3: Stamp the material builder**

In `tools/boqParserV2/index.ts`, in the `for (const m of materialRows)` loop, change the `raw_data` (currently `raw_data: { sourceRow: m.sourceRow }`, ~line 181) to:

```ts
      raw_data: {
        sourceRow: m.sourceRow,
        source_sheet: m.sourceSheet,
        source_row: m.sourceRow,
        source_cell: m.nameAddress,
      },
```

- [ ] **Step 4: Stamp the ahs_block builder**

In the `for (const block of ahsBlocks)` loop, change the block `raw_data` (currently `:307-311`) to add the three fields:

```ts
      raw_data: {
        titleRow: block.titleRow,
        jumlahRow: block.jumlahRow,
        grandTotalAddress: block.grandTotalAddress,
        source_sheet: analisaSheet,
        source_row: block.titleRow,
        source_cell: block.titleAddress,
      },
```

- [ ] **Step 5: Stamp the ahs component builder**

In the inner `for (let idx = 0; idx < block.components.length; idx++)` loop, change the component `raw_data` (currently `raw_data: { sourceRow: compRow, blockTitle: block.title }`, ~line 364) to:

```ts
        raw_data: {
          sourceRow: compRow,
          blockTitle: block.title,
          source_sheet: eCell.sheet,
          source_row: compRow,
          source_cell: `D${compRow}`,
        },
```

- [ ] **Step 6: Stamp the boq builder**

In the `for (const b of boqRows)` loop, change the boq `raw_data` (currently `:386-393`) to add the three fields:

```ts
      raw_data: {
        sourceRow: b.sourceRow,
        chapter: b.chapter,
        chapterIndex: b.chapter_index,
        subChapter: b.sub_chapter,
        subChapterLetter: b.sub_chapter_letter,
        isSubItem: b.is_sub_item,
        source_sheet: b.source_sheet,
        source_row: b.sourceRow,
        source_cell: `A${b.sourceRow}`,
      },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest sourceProvenance.parser`
Expected: PASS.

- [ ] **Step 8: Run the full parser suite for regressions**

Run: `npx jest tools/boqParserV2`
Expected: PASS (no existing parser test broken by the additive `raw_data` fields).

- [ ] **Step 9: Commit**

```bash
git add tools/boqParserV2/index.ts tools/boqParserV2/__tests__/sourceProvenance.parser.test.ts
git commit -m "feat(boq-v2): stamp source_sheet/source_row/source_cell into staging raw_data"
```

---

## Task 4: `sourceProvenance` display helpers

**Files:**
- Create: `tools/sourceProvenance.ts`
- Test: `tools/__tests__/sourceProvenance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/sourceProvenance.test.ts`:

```ts
import { sourceLocation, sourceContext } from '../sourceProvenance';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: 'id', session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 1, needs_review: false,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('sourceLocation', () => {
  it('formats sheet!cell when both present', () => {
    const r = row({ raw_data: { source_sheet: 'Analisa', source_cell: 'D412' } });
    expect(sourceLocation(r)).toBe('Analisa!D412');
  });
  it('falls back to row-level when cell is missing', () => {
    const r = row({ raw_data: { source_sheet: 'Material', source_row: 7 } });
    expect(sourceLocation(r)).toBe('Material · baris 7');
  });
  it('shows "sumber tidak tercatat" when nothing is recorded', () => {
    expect(sourceLocation(row({ raw_data: {} }))).toBe('sumber tidak tercatat');
  });
});

describe('sourceContext', () => {
  const block = row({
    row_type: 'ahs_block',
    raw_data: { source_sheet: 'Analisa', titleRow: 10, jumlahRow: 15 },
    parsed_data: { title: 'PEKERJAAN PAGAR SENG T. 3m', is_orphan: true, linked_boq_code: null },
  });

  it('links an AHS component to its parent block by row range (orphan)', () => {
    const comp = row({ row_type: 'ahs', raw_data: { source_sheet: 'Analisa', source_row: 12 } });
    expect(sourceContext(comp, [block, comp])).toBe(
      'Komponen AHS: "PEKERJAAN PAGAR SENG T. 3m" · ⚠ tidak dipakai BoQ manapun',
    );
  });

  it('shows linked BoQ for a non-orphan block', () => {
    const linked = row({
      row_type: 'ahs_block',
      raw_data: { source_sheet: 'Analisa', titleRow: 20, jumlahRow: 25 },
      parsed_data: { title: 'Bekisting Balok', is_orphan: false, linked_boq_code: 'IV.A.2.7' },
    });
    expect(sourceContext(linked, [linked])).toBe('Dipakai BoQ IV.A.2.7');
  });

  it('reports when no containing block is found', () => {
    const orphanComp = row({ row_type: 'ahs', raw_data: { source_sheet: 'Analisa', source_row: 999 } });
    expect(sourceContext(orphanComp, [block, orphanComp])).toBe('Komponen AHS (blok induk tidak ditemukan)');
  });

  it('shows chapter › code for a BoQ row', () => {
    const boq = row({ row_type: 'boq', raw_data: { chapter: 'III.A.1' }, parsed_data: { code: 'III.A.1.2' } });
    expect(sourceContext(boq, [boq])).toBe('III.A.1 › III.A.1.2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/sourceProvenance`
Expected: FAIL — `Cannot find module '../sourceProvenance'`.

- [ ] **Step 3: Implement the helpers**

Create `tools/sourceProvenance.ts`:

```ts
import type { ImportStagingRow } from './types';

type Raw = Record<string, unknown>;

function raw(row: ImportStagingRow): Raw {
  return (row.raw_data ?? {}) as Raw;
}
function parsed(row: ImportStagingRow): Raw {
  return (row.parsed_data ?? {}) as Raw;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/**
 * Display string for where a staging row came from in the source workbook.
 * Prefers an exact cell (`Analisa!D412`); falls back to row-level
 * (`Material · baris 7`) only when the precise column is unknown; never
 * fabricates a cell — returns `sumber tidak tercatat` when nothing is recorded.
 */
export function sourceLocation(row: ImportStagingRow): string {
  const r = raw(row);
  const sheet = str(r.source_sheet);
  const cell = str(r.source_cell);
  const rowNum = num(r.source_row);
  if (sheet && cell) return `${sheet}!${cell}`;
  if (sheet && rowNum != null) return `${sheet} · baris ${rowNum}`;
  return 'sumber tidak tercatat';
}

function findContainingBlock(
  allRows: ImportStagingRow[],
  sheet: string | null,
  srow: number | null,
): ImportStagingRow | null {
  if (srow == null) return null;
  for (const r of allRows) {
    if (r.row_type !== 'ahs_block') continue;
    const rd = raw(r);
    const bSheet = str(rd.source_sheet);
    if (sheet && bSheet && bSheet !== sheet) continue;
    const t = num(rd.titleRow);
    const j = num(rd.jumlahRow);
    if (t != null && j != null && srow >= t && srow <= j) return r;
  }
  return null;
}

function blockUsage(blockParsed: Raw): string | null {
  if (blockParsed.is_orphan) return '⚠ tidak dipakai BoQ manapun';
  const code = str(blockParsed.linked_boq_code);
  return code ? `Dipakai BoQ ${code}` : null;
}

/**
 * Secondary "role / chain" line for a card. Returns null when there is no
 * useful context to show (caller omits the line).
 */
export function sourceContext(
  row: ImportStagingRow,
  allRows: ImportStagingRow[],
): string | null {
  const r = raw(row);
  const p = parsed(row);
  switch (row.row_type) {
    case 'ahs': {
      const parent = findContainingBlock(allRows, str(r.source_sheet), num(r.source_row));
      if (!parent) return 'Komponen AHS (blok induk tidak ditemukan)';
      const title = str(parsed(parent).title) ?? '(tanpa judul)';
      const usage = blockUsage(parsed(parent));
      return `Komponen AHS: "${title}"${usage ? ` · ${usage}` : ''}`;
    }
    case 'ahs_block':
      return blockUsage(p);
    case 'boq': {
      const chapter = str(r.chapter);
      const code = str(p.code);
      if (chapter && code) return `${chapter} › ${code}`;
      return code ?? chapter ?? null;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/sourceProvenance`
Expected: PASS (all `sourceLocation` + `sourceContext` cases).

- [ ] **Step 5: Commit**

```bash
git add tools/sourceProvenance.ts tools/__tests__/sourceProvenance.test.ts
git commit -m "feat(boq): sourceLocation/sourceContext display helpers for review cards"
```

---

## Task 5: Render location + context on the review card

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` — imports, card header (`:997-1011`), Koreksi header (`:1054`), styles

This is a React Native view; it is verified by re-running the app (Step 5), with the display logic already covered by Task 4's unit tests.

- [ ] **Step 1: Import the helpers**

Near the other imports at the top of `workflows/screens/BaselineScreen.tsx`, add:

```ts
import { sourceLocation, sourceContext } from '../../tools/sourceProvenance';
```

- [ ] **Step 2: Replace the card header block**

In the `visibleReviewRows.map(row => ( ... ))` card, replace the header `View` (currently `:997-1011`):

```tsx
                <View style={styles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowType}>{row.row_type.toUpperCase()} — Baris {row.row_number}</Text>
                    <View style={styles.confRow}>
                      <Text style={styles.hint}>Confidence: </Text>
                      <Text style={[styles.confValue, { color: confidenceColor(row.confidence) }]}>
                        {(row.confidence * 100).toFixed(0)}%
                      </Text>
                    </View>
                  </View>
                  <Badge
                    flag={row.review_status === 'APPROVED' || row.review_status === 'MODIFIED' ? 'OK' : row.review_status === 'REJECTED' ? 'CRITICAL' : row.needs_review ? 'WARNING' : 'INFO'}
                    label={row.review_status}
                  />
                </View>
```

with (introduces a `const ctx` so the context line is computed once):

```tsx
                <View style={styles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sourceLoc}>📄 {sourceLocation(row)}</Text>
                    {(() => {
                      const ctx = sourceContext(row, stagingRows);
                      return ctx ? <Text style={styles.sourceCtx}>{ctx}</Text> : null;
                    })()}
                    <View style={styles.confRow}>
                      <Text style={styles.hint}>{row.row_type.toUpperCase()} · Confidence: </Text>
                      <Text style={[styles.confValue, { color: confidenceColor(row.confidence) }]}>
                        {(row.confidence * 100).toFixed(0)}%
                      </Text>
                    </View>
                  </View>
                  <Badge
                    flag={row.review_status === 'APPROVED' || row.review_status === 'MODIFIED' ? 'OK' : row.review_status === 'REJECTED' ? 'CRITICAL' : row.needs_review ? 'WARNING' : 'INFO'}
                    label={row.review_status}
                  />
                </View>
```

- [ ] **Step 3: Update the Koreksi editor header**

In the same file, replace the editor header (currently `:1054`):

```tsx
                      Editor Koreksi — {row.row_type.toUpperCase()} Baris {row.row_number}
```

with:

```tsx
                      Editor Koreksi — 📄 {sourceLocation(row)}
```

- [ ] **Step 4: Add the two styles**

In the `StyleSheet.create({ ... })` for this screen, locate the existing `rowType` style and add two siblings next to it:

```ts
  sourceLoc: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, fontWeight: '700', color: COLORS.text },
  sourceCtx: { fontSize: 12, color: COLORS.textSec, marginTop: 2 },
```

If `Platform` is not already imported from `react-native` in this file, add it to that import; if `COLORS.text` / `COLORS.textSec` are not the exact token names used in this file, use the same tokens the neighboring styles use (e.g. whatever `rowType` and `hint` reference).

- [ ] **Step 5: Verify in the running app**

Run the web app and re-upload `SPH 4 Sonny Citraland Selat Golf - Normalized.xlsx`, then open the review queue.
Expected: each card's headline reads `📄 Analisa!D{n}` (or the correct sheet/cell), AHS component cards show `Komponen AHS: "…" · ⚠ tidak dipakai BoQ manapun` or `Dipakai BoQ …`, and no card shows a bare "Baris {counter}". Confirm an orphan AHS component (e.g. under "PEKERJAAN PAGAR SENG T. 3m") shows the orphan warning.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git commit -m "feat(baseline): show source cell reference + AHS/BoQ context on review cards"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Part 1 → Tasks 1-3 (`titleAddress`, material anchor, `raw_data` stamping). Part 2 → Tasks 4-5 (helpers + card). Truth-correctness (no fabricated cell) → `sourceLocation` fallback chain + its unit test. Part 3 explicitly out of scope. ✓
- **Type consistency:** `titleAddress` (Task 1) is read in Task 3 (`block.titleAddress`); `sourceSheet`/`nameAddress` (Task 2) read in Task 3 (`m.sourceSheet`/`m.nameAddress`); `source_sheet`/`source_row`/`source_cell` stamped in Task 3 are the exact keys read by `sourceLocation`/`sourceContext`/`findContainingBlock` in Task 4 and rendered in Task 5. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows full code. ✓
- **Risk note:** the AHS component anchor assumes column D = material name (confirmed in `index.ts`'s B/C/D/E layout) and BoQ anchor column A = code (confirmed by the duplicate-code check). Task 3's fixture test pins both.
