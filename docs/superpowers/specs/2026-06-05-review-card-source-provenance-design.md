# Review-Card Source Provenance — Design

> Make every row in the BoQ import **review queue** show *where it came from in
> the original workbook* — an exact Excel cell reference plus its role in the
> AHS/BoQ structure — so an estimator can locate and verify the line instead of
> guessing what an opaque "BARIS 85" refers to.

- **Date:** 2026-06-05
- **Status:** Approved design, ready for implementation plan
- **Scope:** Parts 1 + 2 (this spec). Part 3 (in-app jump-to-source) is deferred
  and sketched only at the end.
- **Surfaces:** `tools/boqParserV2/*` (parser), `workflows/screens/BaselineScreen.tsx` (review queue UI).

---

## 1. Problem

In the review queue (`BaselineScreen`, `view === 'review'`), each staging row
renders as a card headed `{ROW_TYPE} — Baris {row_number}` followed by the first
four keys of `parsed_data` (see `BaselineScreen.tsx:999` and `:1014-1022`).

Two concrete failures make a card unreviewable:

1. **The "Baris N" number is misleading.** `row_number` is a running counter
   assigned during staging (`++rowNumber` in `tools/boqParserV2/index.ts`), **not**
   a spreadsheet row. "AHS — BARIS 85" means *the 85th staging row*, which has no
   relationship to any cell in the workbook. The estimator cannot find the line.

2. **No context / role.** The card shows the parser's interpretation
   (`material_name`, `coefficient`, …) but not which AHS block the component
   belongs to, nor whether that block is actually used by any BoQ item. A
   coefficient of `1.5` for "Usuk meranti" is impossible to judge in isolation.

The real provenance already exists in each row's `raw_data` (e.g. AHS components
carry `{ sourceRow, blockTitle }`; AHS blocks carry `{ titleRow, jumlahRow,
grandTotalAddress }`) — it is simply never surfaced, and for BoQ rows the source
**sheet** is dropped entirely during staging.

## 2. Goal & non-goals

**Primary goal (user: "A mostly"):** locate the line in the original Excel — show
an exact, correct **cell reference** (sheet + column + row).

**Secondary goal (user: "C as extra"):** show the line's role — the parent AHS
block and whether it maps to a BoQ item (or is an orphan).

**Non-goals for this spec:**

- In-app navigation to the source row (Part 3, deferred).
- Showing the raw original cell *text* side-by-side with the interpretation
  (the user is comfortable opening Excel; option "B" was declined).
- Any change to the publish gate, anomaly generation, or review/approve logic.

**Truth-correctness contract (per `CLAUDE.md` §1.1 / §12):** if a row's source
data is missing, the card states that plainly (`"sumber tidak tercatat"`). It
must **never** display a fabricated or guessed cell reference.

## 3. Design

### Part 1 — Parser stamps provenance into `raw_data`

The parser knows the true Excel addresses (SheetJS A1 addresses, already used
throughout). It is the correct place to compute the anchor, rather than letting
the UI hardcode column letters per row type.

Add three fields to every staging row's `raw_data` in
`tools/boqParserV2/index.ts` (and reflect them in `StagingRowV2`,
`tools/boqParserV2/types.ts:60`):

| Field | Meaning |
|---|---|
| `source_sheet` | The sheet the row originates from (`"Analisa"`, `"RAB (A)"`, `"RAB (B)"`, `"Material"`). For BoQ rows this comes from `extractTakeoffs`' existing `source_sheet` (currently computed but dropped at staging). |
| `source_row` | The 1-based Excel row number. Already present as `sourceRow` for `ahs`/`boq`/`material`; for `ahs_block` use `titleRow`. |
| `source_cell` | The **anchor cell** A1 address (sheet-local, e.g. `"D412"`) pointing at the cell that holds the row's human identifier. May be absent only for `material` if the reader can't supply the name column (see below) — in which case the card falls back to a row-level display, never a guessed column. |

**Anchor cell per row type:**

| Row type | `source_cell` | Identifier it points at | Source of the address |
|---|---|---|---|
| `ahs` (component) | `D{compRow}` | material name | column D is the material-name column (`index.ts` reads B=coeff, C=unit, **D=name**, E=price) |
| `ahs_block` | the title cell address | block title | **new:** capture in `detectBlocks.ts` — the matched title cell (column B or C) already has `.address`; store it as `titleAddress` on the block |
| `boq` | `A{sourceRow}` | BoQ code | column A is the code column (cf. the duplicate-code check `${source_sheet}!A${sourceRow}` in `extractTakeoffs.ts`) |
| `material` | the name cell address, else omitted | material name | best-effort from the material reader's name column; if unavailable, omit `source_cell` and show `Material · baris {row}` (honest row-level, no guessed column) |

`detectBlocks.ts` change: the `AhsBlock` type gains `titleAddress: string` (the
`.address` of whichever cell — B or C — matched the title regex). `index.ts`
then sets the block row's `source_cell = titleAddress` and each component's
`source_cell = "D" + compRow`.

These are additive `raw_data` fields. `raw_data` is a JSONB column
(`import_staging_rows`), so **no migration is needed**.

### Part 2 — Card renders location + chain

In `BaselineScreen.tsx`, the staging-row card (`visibleReviewRows.map`,
`:995-1023`):

**2a. Headline → cell reference.** Replace
`{row_type} — Baris {row_number}` with `📄 {source_sheet}!{source_cell}`
(e.g. `📄 Analisa!D412`), rendered prominently (monospace). The `row_type`
stays as a small label/badge so the kind of row is still visible. If
`source_cell`/`source_sheet` is absent, render `sumber tidak tercatat` in a
muted style instead — never a fabricated address.

> Note: the "Editor Koreksi" header at `:1054` also uses `Baris {row_number}`;
> update it to the same cell reference for consistency.

**2b. Context / chain line.** A `sourceContext(row, allRows)` helper returns the
secondary line:

- **AHS component** → resolve its parent block by **row-range containment**:
  find the `ahs_block` staging row whose `[titleRow, jumlahRow]` (from its
  `raw_data`) contains this component's `source_row`, on the same
  `source_sheet`. This is robust even when two blocks share a title. Render:
  `Komponen AHS: "{block title}"` plus, from the parent block's `parsed_data`,
  either `⚠ tidak dipakai BoQ manapun` (when `is_orphan`) or
  `Dipakai BoQ {linked_boq_code}`. If no containing block is found, show
  `Komponen AHS (blok induk tidak ditemukan)`.
- **AHS block** → its own `parsed_data.is_orphan` / `linked_boq_code`:
  `⚠ tidak dipakai BoQ manapun` or `Dipakai BoQ {linked_boq_code}`.
- **BoQ** → `{chapter} › {code}` from `raw_data.chapter` + `parsed_data.code`.
- **Material** → `Katalog material` (minimal; material rows rarely enter the
  review queue and unresolved-material anomalies are summarized separately).

`parsed_data` continues to render below as today (the
`material_name · unit · coefficient · price` line), unchanged.

### Data flow

```
parseAndStageWorkbook
  └─ parseBoqV2 (index.ts)
        ├─ detectBlocks → AhsBlock { …, titleAddress }
        └─ build StagingRowV2.raw_data { source_sheet, source_row, source_cell, … }
  └─ insertStagingRows → import_staging_rows (JSONB raw_data, no schema change)

BaselineScreen review queue
  └─ card
       ├─ headline  = sourceLocation(row)      → "📄 Analisa!D412"
       ├─ context   = sourceContext(row, rows) → "Komponen AHS: … · orphan"
       └─ parsed_data preview (unchanged)
```

## 4. Components / units

| Unit | Where | Responsibility | Depends on |
|---|---|---|---|
| `AhsBlock.titleAddress` | `detectBlocks.ts` | expose the title cell's A1 address | harvested cell `.address` |
| `raw_data` provenance fields | `index.ts` staging builder | stamp `source_sheet`/`source_row`/`source_cell` per row type | `detectBlocks`, `extractTakeoffs` |
| `StagingRowV2` type | `boqParserV2/types.ts` | type the new `raw_data` shape | — |
| `sourceLocation(row)` | `BaselineScreen.tsx` (or small helper module) | `raw_data` → display string `"sheet!cell"` or the missing-data fallback | `raw_data` fields |
| `sourceContext(row, allRows)` | same | `raw_data`/`parsed_data` + sibling rows → chain string | parent-block lookup by row-range |
| card render | `BaselineScreen.tsx:995-1023` | show headline + context + existing preview | the two helpers |

Each helper is pure (`row → string`), independently testable, and unaware of the
others.

## 5. Testing

- **Parser unit tests** (`tools/boqParserV2/__tests__`): for a fixture workbook,
  assert each row type's `raw_data.source_cell` resolves to the expected Excel
  cell — `ahs` → `D{compRow}`, `ahs_block` → title cell, `boq` → `A{sourceRow}`,
  `material` → name cell — and that `source_sheet` distinguishes `RAB (A)` from
  `RAB (B)`.
- **`sourceContext` unit tests:** an AHS component inside a known block resolves
  to that block's title and orphan/linked-BoQ state via row-range containment;
  a component whose row falls in no block yields the explicit
  "blok induk tidak ditemukan" fallback (not a crash, not a guess).
- **Missing-data test:** a row with no `source_cell` renders
  `"sumber tidak tercatat"`, never a fabricated address.
- **Regression:** existing review/approve/publish flows and counts unchanged.

## 6. Risks & mitigations

- **Anchor-column assumptions** (name=D, code=A). Mitigated by deriving the
  address from real harvested-cell addresses where possible (block title,
  material name) and by the parser unit tests pinning the columns against a
  fixture. If a future workbook layout differs, the test fails loudly rather
  than silently mislabeling.
- **Block title in B vs C.** `detectBlocks` already inspects both; we store the
  address of whichever actually matched, so no guessing.
- **Stale rows from older imports** won't have the new `raw_data` fields → they
  hit the `"sumber tidak tercatat"` fallback. Acceptable; re-importing populates
  them.

## 7. Part 3 (deferred) — in-app jump-to-source

A "🔎 Lihat baris asli di Audit Parser" button per card that opens
`AuditTraceScreen` with a new `initialFocus` prop. On open it selects the
correct section (BoQ/AHS/Material), reuses the screen's existing search/filter to
isolate the target row, and briefly highlights it; closing returns to the same
scroll position in the queue. Deferred because it touches the 1,848-line
`AuditTraceScreen`; Parts 1+2 fully satisfy the primary "locate" need on their
own.
