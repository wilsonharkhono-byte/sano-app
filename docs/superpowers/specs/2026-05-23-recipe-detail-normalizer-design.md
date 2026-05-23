# Recipe Detail Normalizer — Design Spec

**Date:** 2026-05-23
**Status:** Design approved, pending implementation plan
**Extends:** `tools/boqParserV2/` (new pre-parse step + small parser extension)
**Reference workbook:** `assets/BOQ/RAB R1 Pakuwon Indah AAL-5_Claude Override.xlsx` — sheet `Breakdown IV.A.2.7` is the canonical example of the desired output.

## Problem

For structural-concrete BoQ rows (Sloof, Balok, Kolom, Plat), the parser today emits **rolled-up recipe components** that hide procurement-relevant detail:

- **Bekisting**: one line at "10 m² × Rp 251,113/m²" instead of the five materials underneath (Multipleks, Usuk vert, Usuk horz, Paku, Form oil).
- **Reinforcement**: per-diameter lines (D8, D13, …) all at a *blended* unit price (Rp 9,918/kg) that bakes in waste, decking, and bendrat. The three sub-items never appear as their own lines.
- **Concrete**: one line at "1.0 m³ × Rp 1,095,570" — the 5 % waste is baked into the unit price; native qty 1.05 m³ is invisible.
- **Spurious zero rows**: when an AHS column is blank (e.g. RAB!X132 — bekisting equipment), the parser still emits `qty × 0 = 0` rows.

For the canonical row **IV.A.2.7 Balok B24-1** (volume 0.2646 m³), the parser currently emits 7 components against a manually-authored breakdown of **13 components**. Total cost reconciles (Rp 6,839,680 vs Rp 6,839,679); per-line quantities do not.

Procurement, material aggregation, and on-site verification all need per-material detail, not roll-ups.

## Goals

- For every BoQ row that needs expansion, produce a recipe that matches the per-material breakdown shown in the user's manual `Breakdown IV.A.2.7` reference sheet.
- Apply to all four structural concrete element types: Sloof, Balok, Kolom, Plat.
- Coefficients (waste %, decking ratio, bendrat ratio, cycle factor, bekisting sub-items, ratios per m³ beton) must come from the workbook itself (`Analisa` AHS blocks). No hardcoded ratios — different contractors use different templates.
- Cost conservation: post-expansion total per row matches the source `RAB (A)!F{row}` at-cost line total within Rp 1.
- The expanded breakdown must be **reviewable and editable by non-programmer team members in Excel** before parsing. Programming knowledge must not be required to fix an Opus mis-extraction.
- Stay additive: workbooks without breakdown sheets continue to parse exactly as today.
- Gated rollout: behavior is off by default behind a feature flag until validated on multiple reference workbooks.

## Non-goals

- Replacing the existing `rebarDisaggregator`. It still runs as a fallback for rows without a breakdown sheet.
- Inline LLM calls during parse. Opus runs once per workbook in a separate explicit step (the Normalizer), not on every parse.
- Schema discovery for non-structural-concrete rows (e.g. plumbing, finishing). Out of scope.
- A standalone CLI. The Normalizer is invoked from inside the SANO app on the existing Baseline upload screen.
- Editing the original RAB workbook in place. The Normalizer produces a sibling `_normalized.xlsx` file.
- Supporting workbooks where the Analisa sheet is missing or the AHS reference chain is broken. The Normalizer skips rows it cannot reconcile and flags them in the Recipe Index.

---

## Section 1 — Architecture

Two-step pipeline:

```
Raw RAB workbook (user upload)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  Normalizer (backend service)                        │
│   1. Dry-parse via parseBoqV2 to find rolled-up rows │
│   2. For each unique AHS block referenced, call Opus │
│      once with ~30 cells of context → block schema   │
│   3. For each BoQ row needing expansion, combine row │
│      data + block schema → write "Breakdown {code}"  │
│      sheet                                           │
│   4. Write "Recipe Index" sheet with per-row status  │
│   5. Reconciliation check; flag mismatches           │
│   6. Save as <name>_normalized.xlsx in storage       │
└──────────────────────────────────────────────────────┘
        │
        ▼  (team optionally downloads, reviews, edits, re-uploads)
        ▼
┌──────────────────────────────────────────────────────┐
│  Parser (parseBoqV2, lightly extended)               │
│   • breakdownSheetReader enumerates Breakdown sheets │
│   • For each matching BoQ code, recipe is built      │
│     from the breakdown's sub-items (NOT from the     │
│     rolled-up Analisa cells)                         │
│   • Rows without a matching breakdown sheet fall     │
│     through to today's logic (incl. rebarDisaggregator) │
└──────────────────────────────────────────────────────┘
        │
        ▼
BoqRowV2[] with per-material components → existing downstream
(takeoffs, validation, DB staging)
```

The Normalizer is a backend service (Supabase Edge Function — see Section 8). It calls Opus directly because the API key cannot live in the client.

The Parser change is small and pure: read Breakdown sheets if present and a flag is on, otherwise use today's behavior. No mutation of harvested cells, formula evaluator, Analisa block detection, audit UI shape, or staging schema.

---

## Section 2 — Breakdown Sheet Schema

Each row that needs expansion gets its own sheet, named `Breakdown {code}` (e.g. `Breakdown IV.A.2.7`). Sheet names are truncated to 31 chars if needed (Excel limit); a Recipe Index entry preserves the full code.

### Layout

```
Row 1:  BREAKDOWN — {code} {description} (At-Cost)
Row 2:  Source: RAB (A)!{row} + Analisa AHS blocks (auto-generated by Normalizer YYYY-MM-DD)
Row 3:  (blank)
Row 4:  Description    | {description}
Row 5:  Unit           | {unit}                          (e.g. m3)
Row 6:  Volume         | {volume}                        (e.g. 0.2646)
Row 7:  Unit cost (Rp/{unit}) | {sum_of_cost_per_unit_column}
Row 8:  Line total at-cost (Rp) | {unit_cost × volume}
Row 9:  (blank)
Row 10: Header row — 12 columns:
        No | Component group | Material / Item | Spec / Note
           | Qty per native unit | Native unit | Native basis
           | Unit price (Rp) | Qty per {unit} | Cost per {unit}
           | Total qty (× vol) | Total cost (Rp)
Rows 11..N: Component data rows. Group rows have only "No" and "Component group" populated.
Row N+1: (blank)
Row N+2: SUBTOTAL — At-cost per {unit} | {} | {} | {} | {} | {} | {} | {} | {Σ Cost per unit} | {} | {Σ Total cost}
Row N+4: RECONCILIATION
Row N+5: Computed unit cost (=J{subtotal_row}) | {value}
Row N+6: RAB (A)!N{row} (source)               | {value}
Row N+7: Variance                              | {delta} | ✓ OK (rounding) | ⚠ MISMATCH
Row N+9: Computed line total (=L{subtotal_row}) | {value}
Row N+10: RAB (A)!F{row} (source at-cost)      | {value}
Row N+11: Variance                             | {delta} | ✓ OK | ⚠ MISMATCH

Where {subtotal_row} is the SUBTOTAL row (N+2 above). Its J cell = SUM(J11:J{N}); L cell = SUM(L11:L{N}).
```

### Component groups

Stable enum used in column B (Component group), populated only on group-header rows:

- `BETON READYMIX (Material)`
- `BEKISTING {ELEMENT} (Material)` — element ∈ {BALOK, SLOOF, KOLOM, PLAT, DINDING}
- `PEMBESIAN (Material)`
- `UPAH (Labor)`
- `PERALATAN (Equipment)`

The "Component group" is what `breakdownSheetReader` uses to classify each row's `lineType` (`material` | `labor` | `equipment`).

### What the parser actually reads

Per data row, the parser uses:

- **Column C** (Material/Item) → `component.materialName`
- **Column F** (Native unit) → `component.unit`
- **Column H** (Unit price) → `component.unitPrice`
- **Column I** (Qty per {unit}) → `component.quantityPerBoqUnit`
- **The group header above this row** → `component.lineType`

Cost columns J and L are recomputed by the parser to double-check; if the workbook value disagrees with the recomputed value beyond ±1 Rp, the row gets a `confidence < 1` flag and a "Needs Review?" warning.

### Recipe Index sheet

A single sheet listing every breakdown produced:

```
| BoQ Code | BoQ Description | Sheet Name | Volume | Components | Reconciles? | Notes |
|----------|-----------------|------------|--------|------------|-------------|-------|
| IV.A.2.7 | - Balok B24-1   | Breakdown IV.A.2.7 | 0.2646 | 13 | ✓ | |
| IV.A.2.8 | - Balok B24-2   | Breakdown IV.A.2.8 | 0.691  | 13 | ⚠ | Cost mismatch +12 Rp |
| …        |                 |                    |        |    |   | |
```

Reviewers scan this first.

---

## Section 3 — Normalizer (Backend Service)

### Entry points

```
POST /api/boq/probe
Body: { storage_path: string }
Response:
{
  rows_total: number,
  rows_needing_expansion: number,
  blocks_referenced: number
}
```

Probe runs a dry parseBoqV2 + the `needsExpansion(row)` predicate and returns counts. No Opus call. Used by the BaselineScreen banner to decide whether to surface the "Normalize" button.

```
POST /api/boq/normalize
Body: { storage_path: string, options?: { force_reanalyze_blocks?: boolean } }
Response:
{
  normalized_path: string,         // e.g. "boqs/2026/aal5_R1_normalized.xlsx"
  summary: {
    rows_normalized: number,
    rows_skipped: number,
    rows_with_mismatch: number,
    blocks_analyzed: number,
    blocks_from_cache: number,
    elapsed_ms: number
  },
  warnings: Array<{ code: string, message: string }>
}
```

### Implementation outline

```
1. Pull workbook bytes from Supabase storage.
2. Run parseBoqV2 in "dry" mode (no DB writes) to obtain:
     - all BoQ rows with their current recipe components
     - the list of unique referenced AHS blocks
     - the list of HarvestedCells (Analisa block content)
3. Identify rows needing expansion (predicate `needsExpansion(row)`):
     - has any component with referencedBlockTitle matching /^Bekisting/i, OR
     - has any component with referencedBlockTitle matching /^Pembesian/i, OR
     - has any component with referencedBlockTitle matching /^Pengecoran Beton/i, OR
     - has any component where unitPrice × quantityPerUnit === 0 (spurious zero).
4. For each unique AHS block reference among those rows, call analyzeBlock(blockId, cells) → BlockSchema.
     - Cache key: SHA256(workbook_bytes) + blockId.
     - Cache TTL: per-workbook (cache invalidates when workbook hash changes).
     - LLM call: see Section 3.2 below.
5. For each BoQ row needing expansion:
     a. Determine which BlockSchema(s) apply (concrete, bekisting, pembesian).
     b. Read row-level scalars from RAB (A):
          - volume (col D), at-cost unit price (col N), line total (col O)
          - bekisting ratio m²/m³ (col V), bekisting harga/m² (col W)
          - pembesian kg/m³ (col Z), pembesian unit blended (col [)
     c. Combine block schema + row scalars → list of (group, item, qty_per_boq_unit, unit_price).
     d. Write Breakdown {code} sheet.
6. Compute reconciliation per row; flag in Recipe Index.
7. Save normalized workbook to storage, return summary.
```

### 3.2 Opus call for block analysis

One call per unique AHS block. Input: ~30 cells (the block header, all sub-rows up to and including the "Jumlah" / "Harga per m²" lines, plus a row or two before/after for context). Output: structured JSON.

**Prompt skeleton (system + user messages):**

```
System:
You analyze Indonesian construction "Analisa Harga Satuan" (AHS) blocks from RAB workbooks.
For each block you must extract its structured breakdown so a downstream parser can apply it
to BoQ rows of the matching element type.

Output strict JSON matching this schema (no prose):
{
  "blockType": "bekisting" | "pembesian" | "concrete",
  "elementHint": string | null,    // e.g. "Balok", "Plat", "Dinding", "Sloof"
  "subItems": [
    {
      "materialName": string,
      "specNote": string | null,
      "qtyPerNativeUnit": number,
      "nativeUnit": string,             // e.g. "lbr", "btg", "kg", "ltr", "m2", "m3"
      "unitPrice": number,
      "includedInRolledUpTotal": boolean // false for items like Perancah that are NOT in Jumlah
    }
  ],
  "cycleFactor": number | null,     // bekisting only — e.g. 4 reuses
  "ratioBasis": "per_m2_form_per_cycle" | "per_kg_finished_rebar" | "per_m3_concrete",
  "rolledUpTotalPerNativeUnit": number,   // i.e. Harga per m² / per kg / per m³
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}

Rules:
- subItems must include only the AHS line items between the block header and its "Jumlah" line.
- The "Jumlah" and "Harga per m²" rows are NOT subItems; they are derived.
- Items present in the block but flagged "tidak masuk" or visually separated (e.g. Perancah) get includedInRolledUpTotal: false.
- cycleFactor = Jumlah / Harga per m² (round to nearest integer if within ±0.05 of an integer).
- For "pembesian" blocks, ratioBasis is "per_kg_finished_rebar" and qtyPerNativeUnit is the coefficient (e.g. 1.05 for raw besi).
- For "concrete" blocks, ratioBasis is "per_m3_concrete" and qtyPerNativeUnit for the readymix sub-item is the waste-inclusive coefficient (e.g. 1.05).

User:
Block reference: Analisa!F55 (Bekisting Balok)
Cells (sheet!cell = value):
{ ... 30 cells of formatted CSV ... }
```

Model: `claude-opus-4-7` with `temperature: 0`, JSON-only response, max tokens budget per block ≈ 800.

### 3.3 Building Breakdown sheets from BlockSchema

For a BoQ row with volume V (m³), unit "m3", and references:

- Bekisting block schema with cycleFactor=4, subItems @ qtyPerNativeUnit (per m² form per cycle)
- Bekisting ratio R_form = 10 (m² form per m³ beton) ← read from RAB!V{row}
- Pembesian block schema with subItems: besi (coeff 1.05 @ 9000), decking (1.00 @ 100), bendrat (0.02 @ 17500)
- Pembesian kg/m³ total K = 167.18 ← read from RAB!Z{row}
- Per-diameter kg/m³ from REKAP Balok!M/O… (reuses existing rebarDisaggregator adapter logic)
- Concrete block schema with subItems: readymix (1.05 @ 1043400), labor (1.00 @ 1500000), equipment (1.00 @ 75000)

**Bekisting expansion (per sub-item):**

```
qty_per_m3_beton = qtyPerNativeUnit × R_form / cycleFactor
                 = (lbr/m²/cycle) × (m²/m³) / cycles
                 = lbr/m³
total_qty = qty_per_m3_beton × V
cost_per_m3 = qty_per_m3_beton × unitPrice
total_cost = cost_per_m3 × V
```

Perancah is **not** emitted as a component (it has `includedInRolledUpTotal: false` and lives on a separate BoQ line).

**Pembesian expansion (per diameter):**

For each diameter d with weight K_d kg/m³:

```
emit: "Besi beton {d}", native unit "kg",
      qty_per_m3 = K_d,
      unit_price = 9000 (raw, from block schema)
```

Plus three synthetic lines applied to **total raw weight** K = Σ K_d:

```
emit: "Besi beton — waste (5%)",      qty = K × 0.05,  price = 9000
emit: "Beton decking",                 qty = K × 1.00,  price = 100
emit: "Bendrat (kawat ikat)",          qty = (K × 1.05) × 0.02, price = 17500
```

Coefficients (`0.05`, `1.00`, `0.02`) come from the block schema's `subItems[i].qtyPerNativeUnit`, not hardcoded.

**Concrete expansion (per sub-item):**

```
For "Beton readymix K-350" (the material sub-row):
  emit qty_per_m3 = 1.05 (waste-inclusive coefficient from block schema),
       native_unit = "m3",
       unit_price = 1,043,400 (raw, not the baked 1,095,570).

For "Sewa peralatan":  qty 1.0, unit_price 75,000  (Equipment group)
For "Upah cor + besi + bekisting borongan":  qty 1.0, unit_price 1,500,000  (Labor group)
```

The total reconciles to the same `Cost per m³` value (1,095,570) because 1.05 × 1,043,400 = 1,095,570.

### 3.4 Reconciliation

For each row, the Normalizer computes:

```
unit_cost_computed   = Σ subItems[i].cost_per_m3_beton
line_total_computed  = unit_cost_computed × volume
delta_unit_cost      = unit_cost_computed - RAB!N{row}
delta_line_total     = line_total_computed - RAB!F{row}  // F is the at-cost line total
```

Tolerance: ±1 Rp on `delta_line_total`. Outside tolerance → `Reconciles? = ⚠` and `Notes` populated.

---

## Section 4 — Parser Changes

### 4.1 New file: `tools/boqParserV2/breakdownSheetReader.ts`

```typescript
export interface BreakdownRow {
  group: 'material' | 'labor' | 'equipment';
  materialName: string;
  specNote: string | null;
  qtyPerNativeUnit: number;
  nativeUnit: string;
  unitPrice: number;
  qtyPerBoqUnit: number;
  costPerBoqUnit: number;
}

export interface RowBreakdown {
  boqCode: string;
  description: string;
  unit: string;
  volume: number;
  components: BreakdownRow[];
  reconciles: boolean;
  sourceSheet: string;  // e.g. "Breakdown IV.A.2.7"
}

export function readBreakdownSheets(workbook: XLSX.WorkBook): Map<string, RowBreakdown>;
```

Enumerates sheets matching `/^Breakdown\s+(.+)$/`, parses each, validates structure (header rows, column count, recomputes column J and L), returns a map by `boqCode`.

### 4.2 New file: `tools/boqParserV2/recipeFromBreakdown.ts`

```typescript
export function buildRecipeFromBreakdown(
  row: BoqRowV2,
  breakdown: RowBreakdown,
): BoqRowRecipe;
```

Converts each `BreakdownRow` into a `RecipeComponent` with the existing shape, marking the source as the breakdown sheet (`sourceCell: "{sheet}!{row}"`).

### 4.3 Modified: `tools/boqParserV2/index.ts`

After `recipeBuilder` and before `disaggregateRebar`:

```typescript
const breakdowns = process.env.SANO_BOQ_RECIPE_DETAIL === 'on'
  ? readBreakdownSheets(workbook)
  : new Map();

const boqRowsWithBreakdowns = boqRows.map((row) => {
  const bd = breakdowns.get(row.code);
  if (!bd) return row;
  return { ...row, recipe: buildRecipeFromBreakdown(row, bd) };
});

// Run disaggregateRebar ONLY on rows without a breakdown.
const { boqRows: postRebar, warnings } = disaggregateRebar(
  boqRowsWithBreakdowns.filter((r) => !breakdowns.has(r.code)),
  cells,
);
// Merge back …
```

### 4.4 Modified: `tools/boqParserV2/validate.ts`

New check: if `breakdowns.size > 0` but flag is off, push a warning `BREAKDOWN_SHEETS_PRESENT_BUT_FLAG_OFF`.

New check: if a breakdown sheet exists but cannot be parsed (malformed), push `BREAKDOWN_SHEET_MALFORMED` with the sheet name.

### 4.5 No changes to

- `harvest.ts`, `detectBlocks.ts`, `extractTakeoffs.ts`, `extractCatalog.ts`, `classifyComponent.ts`, `formulaEval/*`, `multiSheetScanner.ts`.
- `rebarDisaggregator/*` — runs unchanged for rows without breakdown sheets.
- Database staging-row schema or any downstream takeoff / publish path.

---

## Section 5 — UI Integration (BaselineScreen)

Existing flow on `workflows/screens/BaselineScreen.tsx`:

```
[Upload File BoQ / AHS]   →   pick file → upload to Supabase → parse
```

New flow when `SANO_BOQ_RECIPE_DETAIL=on`:

```
[Upload File BoQ / AHS]
       │
       ▼
File picked, uploaded to Supabase
       │
       ▼ (POST /api/boq/probe — lightweight count, no Opus call)
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Detected: {N} rows need detail expansion.                       │
│ Normalize this BoQ with AI? (~30s for ~50 rows)                 │
│  [Normalize with AI]   [Skip — parse rolled-up]                 │
└─────────────────────────────────────────────────────────────────┘
       │ (user picks Normalize)
       ▼
Loading: "Normalizer running…"  (POST /api/boq/normalize)
       │
       ▼ (normalized file path returned)
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Normalized: {N} rows, {M} reconciled, {K} flagged.              │
│  [Download to review]   [Continue → Parse]                      │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (Continue)
       ▼
Existing parse pipeline reads the normalized workbook.
```

If the user picks `Skip`, the parser still runs but behaves as it does today (rolled-up). If `Download to review`, the user opens the file in Excel, reviews the Recipe Index sheet, edits as needed, then re-uploads and parses.

No new top-level screen — this is a banner + two buttons inserted into the existing upload flow.

---

## Section 6 — Feature Flag

`SANO_BOQ_RECIPE_DETAIL` (string, values `on` | `off`, default `off`).

- **Backend**: read from `process.env` in the parser and the Normalizer Edge Function.
- **Client**: exposed via `app.config.ts` Constants extra; gates the "Detected … Normalize?" banner.
- **Both must be on**: if backend is on but client is off, parser will use breakdown sheets if present but UI won't surface the Normalizer button (legacy parser flow continues to work).

---

## Section 7 — Testing Strategy

### 7.1 Golden reference

`Breakdown IV.A.2.7` from `assets/BOQ/RAB R1 Pakuwon Indah AAL-5_Claude Override.xlsx` is the canonical reference. Normalizer output for IV.A.2.7 must match every cell within ±1 Rp on cost columns and exact match on qty columns.

### 7.2 Unit tests

- `breakdownSheetReader.test.ts` — parses the manual `Breakdown IV.A.2.7` sheet, asserts 13 components with the documented qty/price/group.
- `recipeFromBreakdown.test.ts` — converts a `RowBreakdown` to a `BoqRowRecipe` and asserts shape.
- `normalizer/blockAnalyzer.test.ts` — mocks Opus, asserts cell-context formatting and JSON parsing.
- `normalizer/buildBreakdown.test.ts` — given a fixed block schema + row data, asserts the breakdown rows match the manual reference.

### 7.3 Integration test

`tools/boqParserV2/__tests__/normalizer.integration.test.ts`:
- Load AAL-5 raw workbook.
- Run Normalizer with **mocked** Opus (returns fixed block schemas).
- Pipe through parseBoqV2 with flag on.
- Assert IV.A.2.7 recipe components match manual breakdown line by line.

### 7.4 Conservation tests

- Every Balok / Sloof / Kolom / Plat row in AAL-5 must reconcile pre-vs-post within Rp 1.
- Spurious-zero rows must be absent from the normalized output's components.

### 7.5 Rollout gates

Flag stays off in production until:

1. AAL-5 reconciles cleanly with zero ⚠ flags in Recipe Index.
2. `RAB Nusa Golf I4 no. 29_R3.xlsx` and `RAB R2 Pakuwon Indah PD3 no. 23.xlsx` each normalize without manual fixups (zero ⚠ flags).
3. One team member manually reviews a normalized output end-to-end and signs off.

---

## Section 8 — Deployment & Open Decisions

### 8.1 Normalizer hosting

**Default**: Supabase Edge Function `boq-normalize`. Aligns with the rest of the backend already on Supabase. Anthropic SDK + xlsx-populate are both compatible with the Deno runtime. Anthropic API key lives in Supabase secrets.

Alternative: a Node API route (if a Vercel / Express layer is added later). Out of scope for this design.

### 8.2 Cost & latency budget

- Per-block Opus call: ~30 input cells (~500 tokens) + ~500-token JSON output. Cost per block @ Opus 4.7 pricing: ≈ $0.012.
- Typical workbook: ~5 unique blocks (bekisting × 3 element types + pembesian × 1 + concrete × 1). Per-workbook LLM cost: ≈ $0.06.
- Latency: ~3 s per block in parallel = ~5 s total for the 5-block average. UI loader copy: "Normalizer running… ~30s for typical workbook" (conservative).

### 8.3 Caching

Per-workbook block schemas cached server-side by SHA256(workbook_bytes) + blockId. Re-running Normalize on an unchanged workbook hits the cache and skips Opus.

### 8.4 Failure modes

- **Opus returns invalid JSON**: 1 retry with stricter prompt; on second failure, mark block as `low confidence` and skip rows that depend on it (they fall through to rolled-up).
- **Block schema reconciliation fails**: flag the row in Recipe Index as ⚠ MISMATCH; the breakdown sheet is still written so the user can edit it manually.
- **Workbook missing Analisa sheet**: Normalizer aborts with a clear error; parser falls back to today's behavior.

### 8.5 Versioning

The Recipe Index sheet includes a `normalizer_version` cell. Bumped when the prompt or output schema changes. Parser warns if the breakdown sheets were produced by an older Normalizer version than it expects.

---

## Appendix A — Worked example: IV.A.2.7 Balok B24-1

Source row: `RAB (A)!132`, volume 0.2646 m³.

Block schemas extracted from Analisa:

```
Bekisting Balok (Analisa!46–55):
  cycleFactor = 4
  ratioBasis  = "per_m2_form_per_cycle"
  subItems    = [
    { Multipleks 15 mm,         qty 2.00 lbr, price 200,000, includedInRolledUpTotal: true },
    { Usuk 5/7 (vertikal),       qty 9.00 btg, price 47,600,  includedInRolledUpTotal: true },
    { Usuk 5/7 (horizontal),     qty 3.00 btg, price 47,600,  includedInRolledUpTotal: true },
    { Paku,                      qty 1.50 kg,  price 13,000,  includedInRolledUpTotal: true },
    { Form oil,                  qty 0.50 ltr, price 27,500,  includedInRolledUpTotal: true },
    { Perancah Bekisting Balok,  qty 1.00 m²,  price 150,000, includedInRolledUpTotal: false },
  ]

Pembesian U24 & U40 (Analisa!127–130):
  ratioBasis  = "per_kg_finished_rebar"
  subItems    = [
    { Besi beton,   qty 1.05 kg, price 9,000  },
    { Beton decking, qty 1.00 kg, price 100    },
    { Bendrat,       qty 0.02 kg, price 17,500 },
  ]

Pengecoran Beton Readymix (Balok lt. atas) (Analisa!98–103):
  ratioBasis  = "per_m3_concrete"
  subItems    = [
    { Beton readymix K-350, qty 1.05 m³, price 1,043,400 },
    { Sewa peralatan,        qty 1.00 m³, price 75,000    },
    { Upah cor+besi+bekisting, qty 1.00 m³, price 1,500,000 },
  ]
```

Row scalars:

```
R_form = 10 m²/m³ (RAB!V132)
K (total rebar kg/m³) = 167.18 (RAB!Z132)
  K_D8  = 75.2587 (REKAP Balok!M369)
  K_D13 = 91.9190 (REKAP Balok!O369)
```

Breakdown sheet `Breakdown IV.A.2.7` rows (qty_per_m3_beton column):

| Group | Material | qty/m³ | unit | unit_price | cost/m³ | total qty | total cost |
|---|---|---|---|---|---|---|---|
| BETON READYMIX | Beton readymix K-350 | 1.0500 | m³ | 1,043,400 | 1,095,570 | 0.2778 | 289,888 |
| BEKISTING BALOK | Multipleks 15 mm | 5.0000 | lbr | 200,000 | 1,000,000 | 1.3230 | 264,600 |
| BEKISTING BALOK | Usuk 5/7 (vertikal) | 22.5000 | btg | 47,600 | 1,071,000 | 5.9535 | 283,387 |
| BEKISTING BALOK | Usuk 5/7 (horizontal) | 7.5000 | btg | 47,600 | 357,000 | 1.9845 | 94,462 |
| BEKISTING BALOK | Paku | 3.7500 | kg | 13,000 | 48,750 | 0.9923 | 12,899 |
| BEKISTING BALOK | Form oil | 1.2500 | ltr | 27,500 | 34,375 | 0.3308 | 9,096 |
| PEMBESIAN | Besi beton D8 | 75.2587 | kg | 9,000 | 677,328 | 19.9134 | 179,221 |
| PEMBESIAN | Besi beton D13 | 91.9190 | kg | 9,000 | 827,271 | 24.3218 | 218,896 |
| PEMBESIAN | Besi beton — waste (5%) | 8.3589 | kg | 9,000 | 75,230 | 2.2118 | 19,906 |
| PEMBESIAN | Beton decking | 167.1777 | kg-eq | 100 | 16,718 | 44.2352 | 4,424 |
| PEMBESIAN | Bendrat (kawat ikat) | 3.5107 | kg | 17,500 | 61,438 | 0.9289 | 16,256 |
| UPAH | Upah cor + besi + bekisting (borongan) | 1.0000 | m³ | 1,500,000 | 1,500,000 | 0.2646 | 396,900 |
| PERALATAN | Sewa peralatan (vibrator, pump) | 1.0000 | m³ | 75,000 | 75,000 | 0.2646 | 19,845 |

SUBTOTAL unit cost: 6,839,679 — reconciles with `RAB!N132` = 6,839,679 (variance 0).
Line total: 1,809,779 — reconciles with `RAB!O132` = 1,809,779 (variance 0).

---

## Appendix B — Files touched

**New:**
- `tools/boqParserV2/breakdownSheetReader.ts`
- `tools/boqParserV2/recipeFromBreakdown.ts`
- `tools/boqParserV2/__tests__/breakdownSheetReader.test.ts`
- `tools/boqParserV2/__tests__/normalizer.integration.test.ts`
- `tools/normalizer/index.ts`
- `tools/normalizer/blockAnalyzer.ts`
- `tools/normalizer/buildBreakdown.ts`
- `tools/normalizer/types.ts`
- `tools/normalizer/__tests__/*`
- `supabase/functions/boq-normalize/index.ts`

**Modified:**
- `tools/boqParserV2/index.ts` — wire breakdown reader before disaggregateRebar
- `tools/boqParserV2/validate.ts` — new warnings
- `workflows/screens/BaselineScreen.tsx` — Normalize banner + buttons
- `app.config.ts` — expose flag to client
- `.env.example` — document `SANO_BOQ_RECIPE_DETAIL` and `ANTHROPIC_API_KEY` for Edge Function

**Unchanged:**
- `tools/boqParserV2/{harvest,detectBlocks,extractTakeoffs,extractCatalog,classifyComponent,multiSheetScanner,recipeBuilder}.ts`
- `tools/boqParserV2/formulaEval/*`
- `tools/boqParserV2/rebarDisaggregator/*` (still runs for rows without breakdown sheets)
- Downstream takeoff / publish / DB staging paths
