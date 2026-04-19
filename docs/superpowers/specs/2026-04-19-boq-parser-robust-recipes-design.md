# BoQ Parser v2 — Robust Composite Recipes + Multi-Sheet RAB + AI Guide

**Date:** 2026-04-19
**Branch:** `boq-parser-v2`
**Status:** Design approved, ready for plan

## 1. Problem & Goal

The v2 parser extracts BoQ rows, AHS blocks, and material prices correctly for simple cases, but three gaps limit its usefulness for real projects:

1. **Provenance loss on composite rows.** A BoQ row like "- Poer PC.5" is cached in the workbook as a single number, but the underlying formula (`AF = R + V*W + Z*AA`) says it's actually `1 m³ readymix + 2.13 m² bekisting + 84.75 kg rebar`, each priced from a different AHS block. The parser trusts the cached total but loses the recipe. Estimators can see the price but not *why* it's that price.
2. **Single-sheet BoQ only.** Large projects use `RAB (A)` through `RAB (E)` as zones or scopes. The parser reads one sheet. Nusa Golf's main BoQ is in `(B)`; we currently parse `(A)` and miss the bulk of items.
3. **Reconciliation gaps.** Two cost components are unaccounted for today:
   - The `M = Prelim` column (preliminaries) is dropped from cost splits.
   - The 20% markup (`E = N × 'REKAP RAB'!$O$X`) isn't captured, so the breakdown shown in the audit UI doesn't sum to the total.

**Goal:** make the parser robust across the RAB workbook family (AAL-5, PD3 no.23, Nusa Golf, and future similar projects), expose full composite recipes so audit users can trace every rupiah, and provide an AI-assist layer for the genuinely ambiguous tasks (catalog matching, anomaly explanation) without putting AI on the provenance critical path.

**Non-goal:** Opname workbooks (progress reports). Different format entirely; out of scope.

## 2. What we know about the RAB family

From inspecting the 3 RAB projects:

| Convention | Detail |
|---|---|
| Workbook-level sheets | `RAB (A..E)`, `Analisa`, `Material`, `Upah`, plus takeoff carriers (`REKAP-PC`, `REKAP Balok`, `Pas. Dinding`, `Plumbing`, etc.) |
| RAB header row | Row 7, column B contains `URAIAN PEKERJAAN` |
| RAB canonical columns | `A=NO  B=URAIAN  C=SAT  D=VOLUME  E=HARGA SATUAN  F=TOTAL  H=VOLUME  I=Material  J=Upah  K=Peralatan  L=Subkon  M=Prelim  N=TOTAL HARGA SATUAN  O=TOTAL HARGA` |
| Same labels repeated | `Material`, `Upah`, `Peralatan` appear again later in the row (intermediate aggregators at R/S/T, W, AA, AD). The leftmost occurrence is the primary. |
| Composite pattern | `I_N = AF_N`, `AF_N = R_N + V_N*W_N + Z_N*AA_N` where R/W/AA are cross-sheet `Analisa!` refs and V/Z are per-unit coefficients from `REKAP-PC`. |
| Markup pattern | `E_N = N_N * 'REKAP RAB'!$O$X` — each row's markup factor sits in a small `REKAP RAB` lookup. |
| Cross-RAB refs | Zero. Each `RAB (X)` sheet is independent; no formulas cross sheets. |
| BoQ codes | Hierarchical: Roman numeral chapter in col A, single letter subchapter, item counter. Sub-items prefix description with `"- "` under an unnumbered parent row. |

This consistency means the parser can be built as a template-family parser rather than a fully generic spreadsheet reader. Novel Excel constructs (INDIRECT, OFFSET, array formulas, macros) are out of scope — the dominant patterns are arithmetic + direct cell references.

## 3. Architecture

Additive passes over the existing v2 pipeline. Every existing test still passes.

```
Workbook (xlsx)
    ↓
[Pass 1  Harvest]                        — existing
    ↓
[Pass 2  Multi-sheet BoQ scanner]        — NEW
    ↓  auto-detect RAB (A..E) OR explicit list, parse each, merge
[Pass 3  AHS block detect]               — existing
    ↓
[Pass 4  Formula interpreter + recipe]   — NEW
    ↓  per-BoQ-row composite recipes with coefficients and refs
[Pass 5  Validation & staging]           — existing + recipe reconciliation checks
    ↓
ParseBoqV2Result
    ↓
(optional, separate module)
[AI assist layer]                        — NEW
    loads PARSER_AI_GUIDE.md as constitution
    handlers: fuzzy material matching, anomaly explanation, column suggestion
```

### 3.1 Module layout

```
tools/boqParserV2/
├── harvest.ts                  existing
├── detectBlocks.ts             existing
├── extractCatalog.ts           existing
├── classifyComponent.ts        existing
├── validate.ts                 existing, gains recipe reconciliation check
├── extractTakeoffs.ts          existing, refactored to emit per-sheet BoqRowV2[]
├── multiSheetScanner.ts        NEW — finds all RAB(*) sheets with cost data
├── formulaEval.ts              NEW — Excel expression interpreter
├── recipeBuilder.ts            NEW — turns interpreter output into BoqRowRecipe
├── index.ts                    updated — orchestrator
└── __tests__/
    ├── existing tests...
    ├── formulaEval.test.ts             NEW
    ├── recipeBuilder.test.ts           NEW
    ├── multiSheet.test.ts              NEW
    └── snapshots/
        ├── aal5_sample_recipes.json    NEW — 5–10 representative recipes
        ├── pd3_sample_recipes.json     NEW
        └── nusa_sample_recipes.json    NEW

tools/boqParserV2/aiAssist/              NEW subtree
├── loadGuide.ts                reads PARSER_AI_GUIDE.md at module init
├── matchMaterialName.ts        fuzzy match AHS material → catalog
├── explainAnomaly.ts           reason about reconciliation deltas
└── suggestColumnMapping.ts     propose column picks when detector fails

docs/
└── PARSER_AI_GUIDE.md          NEW — the "constitution"
```

### 3.2 Data model changes

```typescript
// CostSplit gets a prelim field so reconciliation matches the N column
export interface CostSplit {
  material: number;
  labor: number;
  equipment: number;
  prelim: number;   // NEW — AAL-5 M column
}

// New recipe type
export interface RecipeComponent {
  sourceCell: { sheet: string; address: string };    // e.g. RAB (A)!R59
  referencedBlockTitle: string | null;               // AHS block the ref resolves into
  referencedBlockRow: number | null;                 // top row of that block
  referencedCell: { sheet: string; address: string }; // e.g. Analisa!F82
  quantityPerUnit: number;                           // coefficient (1.0 for direct)
  unitPrice: number;                                 // cached value at referencedCell
  costContribution: number;                          // quantityPerUnit × unitPrice
  lineType: 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
  confidence: number;                                // 1.0 fully resolved, <1 partial
}

export interface Markup {
  factor: number;                                    // e.g. 1.20
  sourceCell: { sheet: string; address: string };    // 'REKAP RAB'!$O$4
  sourceLabel: string | null;                        // e.g. "Markup Struktur"
}

export interface BoqRowRecipe {
  perUnit: CostSplit;                                // pre-markup, sums to N_cached
  subkonPerUnit: number;                             // separate bucket (not in CostSplit)
  components: RecipeComponent[];                     // the composite breakdown
  markup: Markup | null;                             // null when row has no markup wrap
  totalCached: number;                               // F column, for cross-check
}

// BoqRowV2 gains recipe + source sheet
export interface BoqRowV2 {
  // ... existing fields ...
  recipe: BoqRowRecipe | null;
  source_sheet: string;                              // e.g. "RAB (B)"
}

// Code format: parenthesized sheet prefix when multiple RAB sheets exist
// Single-sheet project: "II.A.5"
// Multi-sheet project:  "(B) II.A.5"
```

### 3.3 Formula interpreter (`formulaEval.ts`)

A small expression evaluator. Target: **understand the RAB template's formula vocabulary, refuse the rest loudly.**

**Supported:**
- Binary arithmetic: `+ - * /` with left-to-right precedence (`*`/`/` above `+`/`-`)
- Parentheses
- Numeric literals (including comma-decimal Indonesian format via pre-normalization)
- Cell references: `A1`, `$A$1`, `'Sheet Name'!A1`, `Analisa!$F$82`, relative/absolute mixes
- `SUM(range)`, `SUM(cell1, cell2, ...)`
- `SUMIFS(...)` — treat as opaque quantity aggregation; produce a quantity ref but not a cost breakdown
- Unary minus

**Explicitly unsupported (produces a partial component with `confidence: 0.5` and flags for review):**
- `VLOOKUP`, `INDEX`, `MATCH`, `INDIRECT`, `OFFSET`
- Array formulas, named ranges
- `IF` branching inside cost chains

**Symbolic walk:**

1. Parse formula string → AST
2. Walk AST recursively. At each node, return `{ evaluatedValue, refs: RecipeComponent[] }`.
3. For a `*` node with a numeric literal or same-row coefficient-cell on one side and a cross-sheet ref on the other, emit one `RecipeComponent` with `quantityPerUnit = coefficient, referencedCell = crossSheetRef`.
4. For a `+` node, concatenate the refs from both sides.
5. For a bare cross-sheet ref, emit a component with `quantityPerUnit = 1`.
6. For an intra-sheet ref (`=AF59`), recurse into that cell's formula. Depth-limited (default 10).
7. For a `*'REKAP RAB'!$X$Y` wrap, extract as `markup`, do not include in components.

**Coefficient provenance:** when a coefficient comes from a cell (`V59 = 'REKAP-PC'!T16`), follow that ref too and record the source. The recipe preserves *where* the 2.13 bekisting ratio came from, not just the number.

### 3.4 Recipe builder (`recipeBuilder.ts`)

Wraps the interpreter output with AHS-block context:

- For each component's `referencedCell`, find the AHS block whose `titleRow..jumlahRow` range contains that cell's row.
- Set `referencedBlockTitle` and `referencedBlockRow`.
- Compute `costContribution = quantityPerUnit × unitPrice`.
- Validate: `sum(costContributions per lineType) ≈ CostSplit[lineType]` within 1 rupiah. If not, mark `confidence: 0.8` on the whole recipe and log.
- Separate material / labor / equipment / subkon / prelim components by which BoQ column produced them (I → material, J → labor, K → equipment, L → subkon, M → prelim).

### 3.5 Multi-sheet scanner (`multiSheetScanner.ts`)

```typescript
export type BoqSheetOption = string | string[] | 'auto';

function resolveBoqSheets(
  workbook: XLSX.WorkBook,
  option: BoqSheetOption,
): string[] {
  if (Array.isArray(option)) return option;
  if (option !== 'auto') return [option];
  // auto: any sheet matching RAB (X) or RAB X, with ≥1 Analisa ref OR ≥5 rows
  //       below row 7 containing both a unit and a volume
  return workbook.SheetNames.filter(isPlausibleRabSheet);
}
```

When multiple sheets are resolved:
- BoQ codes get parenthesized prefix: `(A) II.1`, `(B) I.5`.
- The prefix decision is made once per parse, based on the count of scanned RAB sheets: 1 sheet → no prefix, 2+ sheets → all codes prefixed. Codes never switch format mid-workbook.
- Single-sheet projects get no prefix (backward compatible): `II.1`.
- `source_sheet` is always populated (even for single-sheet), so downstream code can filter.
- The block-link resolver accumulates Analisa references from *all* scanned sheets, then runs orphan detection against the union — this eliminates the 0/47 linked count we saw in Nusa Golf.

### 3.6 AI assist layer

**Principle:** AI never produces provenance. It only helps when the parser has already produced structured output and needs a judgment call.

Four handlers, all reading `PARSER_AI_GUIDE.md` as shared system context:

1. **`matchMaterialName(ahsMaterialName, catalog)`** — given the AHS component's material description and the parsed catalog, return `{ matched: MaterialRow | null, confidence, reasoning }`.
2. **`explainAnomaly(row, recipe, delta)`** — given a BoQ row whose recipe doesn't reconcile to the cached N within tolerance, describe the likely cause in one sentence (e.g., "Prelim column value of Rp 150,000 not captured in split — check M column").
3. **`suggestColumnMapping(headerRow)`** — given a header row the detector couldn't map (e.g., a workbook that uses `Bahan` instead of `Material` in a non-standard position), propose the most likely column mapping with reasoning.
4. **`reviewOrphanBlock(block)`** — given an AHS block flagged orphan, decide whether it's a genuine template to keep (common recipe estimators pre-stock) or safe to archive.

Each handler:
- Accepts plain JSON input and returns plain JSON output (schema defined in the guide).
- Has a deterministic fallback if the AI call fails (return `null` / `confidence: 0`).
- Is a pure function of `(input, guideDoc)` — no hidden state, fully reproducible given the same guide version.

### 3.7 PARSER_AI_GUIDE.md — the constitution

A versioned reference document loaded into every AI call as system context. Contents (short summary of each section):

- **A. Schema reference** — canonical RAB/Analisa/Material/Upah structure with column letters and label synonyms (Indonesian / English).
- **B. Known formula patterns** — `AF=R+V*W+Z*AA`, `=N*'REKAP RAB'!$O$X`, `=H_N`, SUMIFS quantity patterns, what each means.
- **C. Data gotchas** — duplicate "Material" labels, sub-item hyphen prefix, Roman chapter markers, merged cells, orphan templates, subtotal rows, float tolerances, markup factors, Prelim column.
- **D. Decision rules** — when to return null, when to flag for human review, when to propose alternatives. Explicit: "never invent coefficients or prices."
- **E. Output JSON schemas** — strict schemas for each handler's response with examples.
- **F. Anti-patterns** — don't fabricate block titles, stay verbatim on material names, don't infer markup, don't collapse multi-line descriptions.

**Invariant:** when the parser learns a new pattern, this file must be updated in the same PR. Enforced via PR template checklist.

### 3.8 Markup handling (closes reconciliation gap)

- Interpreter detects the `* 'REKAP RAB'!$X$Y` wrap and peels it off the cost chain.
- `BoqRowRecipe.markup` carries the factor + source cell.
- `BoqRowRecipe.perUnit` stays pre-markup (sums cleanly to N).
- Reconciliation assertion: `perUnit.total × markup.factor × planned ≈ F_cached`.
- **Audit UI shows both**: per-unit pre-markup breakdown, a separate markup line, and the post-markup total. No hidden 20%.

### 3.9 Prelim column (closes 150k delta on AAL-5 row 11)

- `CostSplit` gains `prelim: number`.
- Column detector looks for `Prelim` / `preliminaries` / `persiapan` label in the header row.
- Defaults to `M` when unlabeled (AAL-5 canonical position).
- Audit UI's cost breakdown grows a "Prelim" pill alongside Material/Upah/Peralatan/Subkon.

## 4. Output of a parse — concrete example

For row 59 "- Poer PC.5" in AAL-5:

```jsonc
{
  "code": "(A) III.A.1.9",
  "label": "- Poer PC.5",
  "unit": "m3",
  "planned": 1.7578125,
  "source_sheet": "RAB (A)",
  "cost_basis": "inline_split",
  "cost_split": {
    "material": 2428240.77,
    "labor": 800000,
    "equipment": 75000,
    "prelim": 0
  },
  "subkon_cost_per_unit": 0,
  "total_cost": 6967773.50,
  "recipe": {
    "perUnit": {
      "material": 2428240.77, "labor": 800000, "equipment": 75000, "prelim": 0
    },
    "subkonPerUnit": 0,
    "markup": {
      "factor": 1.20,
      "sourceCell": { "sheet": "REKAP RAB", "address": "O4" },
      "sourceLabel": "Markup Struktur"
    },
    "components": [
      {
        "lineType": "material",
        "sourceCell": { "sheet": "RAB (A)", "address": "R59" },
        "referencedCell": { "sheet": "Analisa", "address": "F82" },
        "referencedBlockTitle": "Pengecoran Beton Readymix (KHUSUS POER)",
        "referencedBlockRow": 77,
        "quantityPerUnit": 1.0,
        "unitPrice": 1232100,
        "costContribution": 1232100,
        "confidence": 1.0
      },
      {
        "lineType": "material",
        "sourceCell": { "sheet": "RAB (A)", "address": "W59" },
        "referencedCell": { "sheet": "Analisa", "address": "F35" },
        "referencedBlockTitle": "1 m2 Bekisting Batako POSISI TIDUR untuk Poer dan Sloof",
        "referencedBlockRow": 29,
        "quantityPerUnit": 2.1333,
        "unitPrice": 166705.668,
        "costContribution": 355670.15,
        "confidence": 1.0
      },
      {
        "lineType": "material",
        "sourceCell": { "sheet": "RAB (A)", "address": "AA59" },
        "referencedCell": { "sheet": "Analisa", "address": "F132" },
        "referencedBlockTitle": "1 kg Pembesian",
        "referencedBlockRow": 126,
        "quantityPerUnit": 84.749,
        "unitPrice": 9917.5,
        "costContribution": 840470.51,
        "confidence": 1.0
      }
    ],
    "totalCached": 6967773.50
  }
}
```

Reconciliation: `1232100 + 355670.15 + 840470.51 ≈ 2428240.66` — matches `cost_split.material` (2,428,240.77) to within rupiah-scale float drift. Sums across all line types equal `N59`. Multiply by markup × volume → matches `F59`. Full traceability.

## 5. Testing strategy

- **Golden snapshots** — `__tests__/snapshots/*.json` hold expected recipes for representative rows per project. Any regression surfaces as a diff in PR review.
- **Per-project smoke tests** — AAL-5, PD3 no.23, Nusa Golf (all 5 sheets). Assertions:
  - Imbalanced blocks ratio < 5%
  - Recipe coverage (rows with a non-null recipe) > 80% for projects with Analisa
  - Recipe reconciliation: for every row with a recipe, `|sum(components.costContribution per lineType) − CostSplit[lineType]| < 1 rupiah`
  - Markup reconciliation: `CostSplit.total × markup.factor × planned ≈ total_cost` within tolerance `Math.max(1, abs(total_cost) × 1e-6)` — same tolerance scheme as block validation
  - Multi-sheet merge: Nusa Golf linked-blocks > 50%
- **Unit tests** — formulaEval against hand-built ASTs; recipeBuilder given mock interpreter output; multiSheetScanner against synthetic workbooks with 1, 3, 5 RAB sheets.
- **AI guide round-trip test** — load PARSER_AI_GUIDE.md, verify it parses into the expected sections (A–F). Schema examples in the guide must validate against the JSON schemas.

## 6. Trade-offs (explicit)

| Decision | Why | What we accept |
|---|---|---|
| In-house formula interpreter, not a library | Indonesian RAB uses ~6 Excel ops; a ~300-line evaluator has zero deps, is transparent, easy to extend with new patterns as we see them. | INDIRECT/OFFSET/array formulas unsupported → flagged with `confidence: 0.5`, human review. |
| AI never touches provenance | Provenance must be deterministic, reviewable, git-diffable. | AI can't fill gaps — orphan recipes stay orphan; a human decides. |
| `(A) II.1` code format | Distinguishable across sheets without renaming, stays human-readable. | UI code columns widen by ~4 chars. |
| Additive `recipe` field on BoqRowV2 | No existing consumer breaks. | Staging table schema needs to grow a `recipe` JSONB column. |
| PARSER_AI_GUIDE.md checked into repo | Versioned, reviewable, diffable, reproducible. | Must be kept in sync with the parser — PR checklist item. |
| Depth limit 10 on formula evaluation | Prevents pathological circular references from hanging. | Unusually deep chains (>10 hops) get `confidence: 0.7` + partial component. |
| Markup kept separate from components | Clearer audit: estimator sees which AHS blocks contribute + a distinct markup line. | Consumers need to know to apply markup at display time. |

## 7. Phased rollout

| Phase | Deliverables | Definition of done |
|---|---|---|
| **1 — Interpreter + recipes + AI guide** | `formulaEval.ts`, `recipeBuilder.ts`, `PARSER_AI_GUIDE.md`, Prelim + markup in CostSplit/BoqRowV2 | Golden recipe snapshot for AAL-5 Poer PC.5 matches. All existing tests pass. PARSER_AI_GUIDE.md written and committed. |
| **2 — Multi-sheet RAB** | `multiSheetScanner.ts`, `(A) II.1` code format, union-of-refs orphan detection | Nusa Golf all 5 RAB sheets parse, linked-blocks > 50%. PD3 (A)+(B) parse. AAL-5 unchanged (single-sheet behavior preserved). |
| **3 — AI material matching** | `matchMaterialName.ts`, loads guide, fallback to null on failure | Unit tests with mocked AI responses; handler returns `null` with `confidence: 0` on error; integration test exercises one real match. |
| **4 — AI anomaly explanation** | `explainAnomaly.ts`, surfaces in validation report | Anomaly descriptions render in audit UI's validation panel. |
| **5 — Audit UI recipe view** | Pivot screen shows recipe components + markup + pre/post-markup totals | Visual QA on Poer PC.5 row: estimator can click a BoQ row and see the three AHS blocks it consumes. |

Each phase ships independently. Phase 1 alone closes the reconciliation gaps and gives estimators the first real composite view.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Interpreter breaks on a formula shape we didn't anticipate | Interpreter returns partial result with `confidence: 0.5` and a diagnostic. The parser never crashes on a novel formula; it degrades. |
| PARSER_AI_GUIDE.md and parser drift out of sync | PR checklist: "Guide updated if parser learns a new pattern?" Plus a round-trip test that validates the guide parses. |
| AI helpers regress silently | Each helper has a deterministic fallback + unit tests with frozen fixtures. Handler behavior under "AI offline" mode is identical to pre-AI parser. |
| Snapshot tests become stale and just get regenerated without review | Snapshot diffs land in PRs; reviewer has to justify any recipe change. Add a CODEOWNERS entry for `__tests__/snapshots/*`. |
| Multi-sheet namespace breaks existing audit screen | Keep codes un-prefixed for single-sheet projects. Multi-sheet projects are new — UI work is scoped to phase 5. |
| Markup factor stored in a non-`REKAP RAB` sheet in some future workbook | Interpreter identifies markup by the "multiplied against a constant-per-row cell from a non-primary sheet" signature; sheet name isn't hardcoded. |

## 9. What this design doesn't address

- **Opname workbooks** — out of scope per user direction.
- **v1 parser** — remains alive side-by-side per the parallel-rebuild memory. No changes.
- **Database schema migration for recipes** — we need to grow `import_staging_rows` with a `recipe` JSONB column; this is implementation work covered by the plan phase.
- **Historical reparse** — projects already parsed in v2 don't automatically pick up recipes. A one-shot reprocess is implementation work.
- **Dashboard / reporting** — recipes enable new kinds of cost analysis (e.g., "total rebar consumption across all BoQ rows in a project"). That's a follow-up product decision.

## 10. What we'd revisit as the system grows

- **New project templates that deviate from the RAB family**: might warrant a second parser, or a config-driven "template descriptor" that the current parser consumes.
- **Performance**: formula evaluation + recipe building for a 300-row BoQ with depth-10 chains is ~O(300 × 10) = 3000 lookups. On a 4 MB workbook that's sub-second. At 10× scale it's still fine. At 100× scale we'd consider caching evaluated expressions.
- **AI confidence calibration**: once we have logs of real matches vs human overrides, we can tune confidence thresholds.
- **Guide as runtime config vs static doc**: if estimators want to teach the AI new patterns without engineering, the guide could grow into a small editable rules file. For now, keep it static and checked in.
