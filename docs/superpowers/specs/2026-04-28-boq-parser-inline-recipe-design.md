# BoQ Parser — Inline Recipe Detection & Hand-Priced Row Synthesis

**Date:** 2026-04-28
**Status:** Design approved, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-04-15-boq-parser-v2-design.md`

## Problem

Field reviewers running the v2 parser on `RAB ERNAWATI + 5M.xlsx` flagged three behaviors:

1. **Inconsistent BoQ→AHS linking.** Some structural-element rows (`Balok B25-1`) resolve to 8 AHS lines; sibling rows on the same sheet (`Sloof S36-1`, `Balok B24-1`, `Balok B24-2`, `Kolom K24..K2A5`) resolve to 0 AHS lines. The reviewer expects every concrete element to surface its recipe.
2. **Cross-sheet recipe extraction works only sometimes.** The `=Analisa!$F$535` chain works on Plesteran rows; the same shape applied elsewhere produces no recipe.
3. **Inline material breakdowns flatten incorrectly.** Workbook authors write `- Poer PC.5` as a label-only parent row with indented `- Beton`, `- Besi D13`, `- Besi D16`, `- Bekisting Batako` material children below. The parser treats each child as a separate top-level BoQ item (`III.A.1.1 Beton`, `III.A.1.2 Besi D13`, ...) instead of grouping them as components of "Poer PC.5".

Investigation against the four BoQ workbooks in `assets/BOQ/` (AAL-5, PD3, Nusa Golf I4, CONTOH_Template_Parser) reproduced part of the picture and surfaced an important constraint:

- The `Poer PC.X` vertical inline-material-breakdown pattern does **not** exist in any repo workbook. AAL-5/PD3/Nusa Golf encode the same decomposition horizontally as formulas in hidden columns (R, V, W, Z, AA, AF). The pattern is specific to the Ernawati workbook (not in repo).
- The literal-vs-formula authoring split **is** real but appears on hand-priced lump-sum rows (`Direksi keet`, `Tangga utama`, `Water feature`, `Strongband BB`). PD3 has 9 such rows; AAL-5 has 2; Nusa Golf has 1. The same label can be a formula in one workbook and a literal in another.
- The Excel reader currently in use (`xlsx` package, non-pro) **cannot read fill colors** — every cell returns `s = {patternType: "none"}`. Cell-color authoring conventions require a reader migration to ExcelJS or similar.

The fix has to work without a reader migration (deferred) and without access to the Ernawati workbook (not yet shareable). Design strategy: structural detection driven by element-type and material-type vocabularies, plus synthesis paths that surface hand-priced rows in the audit instead of leaving them as silent zeros.

## Goals

- Detect the `Poer PC.X` vertical inline-recipe pattern by structure alone (no color, no font cues), preserving material identity (`Beton`, `Besi D13`, `Bekisting Batako`) all the way through to the publish step so the downstream work-package aggregation layer can sum across selected items by material type.
- Eliminate "0 AHS line" rows for hand-priced lump-sum items by synthesizing AHS components from the inline cost split that the parser already extracts.
- Surface unresolved formula references in the audit so reviewers see exactly which cell addresses the parser doesn't recognize, without that surfacing being a fix.
- Ship without a database migration; reuse existing `cost_basis`, `parent_ahs_staging_id`, `ref_cells`, and `validation_report` columns from the v2 spec.
- Leave the v1 parser untouched (parallel-rebuild rule from the v2 spec).

## Non-goals

- Migrating from `xlsx` to ExcelJS. Deferred until structural detection proves insufficient on more workbooks.
- Detecting bold or fill-colored cells. Issue 3 (bold section headers being misinterpreted as AHS blocks) is being solved separately via authoring conventions, outside this design.
- Fixing the specific Ernawati formula chain that "should link but doesn't" — without the workbook in hand, the missing pattern can't be identified. This design adds a diagnostic that surfaces the unresolved reference; the actual classifier extension lands once the workbook is available.
- Rebuilding the work-package aggregation layer. This design preserves material identity through the staging rows; consumption is a separate concern.
- Catalog matching, fuzzy material disambiguation, or any audit-UI changes beyond rendering the new diagnostic chips.

## Core principle

Structural detection driven by closed vocabularies. Element-type words (`Poer`, `Sloof`, `Balok`, `Kolom`, ...) signal "this is a BoQ leaf or inline-recipe parent." Material-type words (`Beton`, `Besi DXX`, `Bekisting`, `Pasir`, ...) signal "this is a recipe component." The two vocabularies don't overlap, so the parser disambiguates inline-recipe parents from sub-sub-chapter dividers without needing color, bold, or any cell formatting.

---

## Section 1 — Data model

No DB migration. All needed columns already exist from the v2 spec.

### 1.1 New `cost_basis` enum value

`'inline_recipe'` joins the existing set (`catalog`, `nested_ahs`, `literal`, `takeoff_ref`, `cross_ref`, `inline_split`).

| Value | Source pattern | Component shape |
|---|---|---|
| `inline_split` (existing) | Hand-priced row with values in Material/Upah/Peralatan columns; no formula chain | 1–4 synthetic components, one per non-zero bucket |
| `inline_recipe` (new) | Label-only parent row (e.g. `- Poer PC.5`) followed by 2+ material-typed child rows in `RAB (A)` | N synthetic components, one per material child, each preserving material identity |

These are semantically distinct: `inline_split` carries no material identity (just M/L/E/S buckets); `inline_recipe` preserves the typed material breakdown that the work-package aggregation layer needs.

### 1.2 Reused fields

- `parent_ahs_staging_id` — links every synthetic component to its synthetic AHS block.
- `ref_cells` — populated with `{ "source_rows": [{ "sheet": "RAB (A)", "row": 53, "label": "- Beton" }, ...] }` for inline-recipe components, giving the audit screen the source provenance.
- `validation_report.unresolved_references[]` — new array entry type for Section 4's diagnostic.

### 1.3 No new columns

Every behavior in this design is expressible with existing schema. Phase 0 of the v2 spec already covered the schema additions; this design rides on them.

---

## Section 2 — Inline recipe detection

New module: `tools/boqParserV2/detectInlineRecipe.ts`. Approximately 120 lines. Called from `tools/boqParserV2/index.ts` between `extractBoqRows` and `validate`.

### 2.1 Vocabularies

New file `tools/boqParserV2/vocab.ts`:

```ts
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
  `^[\\s\\-–—]*(${ELEMENT_TYPES.join('|')})\\b`, 'i',
);

export const MATERIAL_RE = new RegExp(
  `^[\\s\\-–—]*(${MATERIAL_TYPES.join('|')})(\\s+[A-Z]?\\d+)?\\b`, 'i',
);
```

The two arrays are the only knobs. New element/material variants are one-line edits.

### 2.2 Detection algorithm

```
1. Walk byRow on the RAB sheet looking for candidate parents:
     - label matches ELEMENT_RE
     - C, D, E, F all empty (label-only)
     - label does NOT end with ":" (excludes existing sub-sub-chapter dividers
       like "Poer (Readymix fc' 30 MPa) :" handled at extractTakeoffs.ts:197)

2. For each candidate, walk forward collecting material children:
     - non-empty C and/or D (has unit and/or quantity)
     - label matches MATERIAL_RE
     - stop at: next ELEMENT_RE candidate, empty row,
       chapter heading, sub-chapter heading

3. Confirm group when ≥2 valid material children collected.
   Reject (no emit) when 0–1 children — the candidate was a divider.

4. For each confirmed group emit:
     a. One BoqRowV2 for the parent:
          code: derived by incrementing itemCounter under the current
                chapter/sub-chapter (occupies one BoQ slot like a regular
                leaf row — does NOT trigger sub-sub-chapter counter)
          label: parent's column-B text minus leading "-"/"—"
          unit: 'lot'
          planned: 1
          cost_basis: 'inline_recipe'
          total_cost: sum of children's column-F totals
          ref_cells: { source_rows: [{ sheet, row, label } per child] }
     b. One synthetic ahs_block staging row:
          row_type: 'ahs_block'
          parent staging id of the BoQ row above
     c. One ahs component staging row per child:
          row_type: 'ahs'
          parent_ahs_staging_id: synthetic block's id
          material_name: child's column-B text (preserved verbatim
                         minus leading "-"/"—")
          coefficient: child's column-D value (qty)
          unit: child's column-C value
          unit_price: child's column-E value
          total: child's column-F value
          cost_basis: null (it's a regular catalog-style component)

5. Mark all consumed source rows so extractBoqRows skips them
   (avoid duplicate emission as separate top-level items).
```

### 2.3 Disambiguation invariant

The existing sub-sub-chapter divider path at [extractTakeoffs.ts:197](tools/boqParserV2/extractTakeoffs.ts#L197) handles label-only rows that either end in `:` or have a numeric value in column A. Inline-recipe parents have neither characteristic AND are followed by ≥2 material-typed rows. The two paths cannot fire on the same row.

### 2.4 Edge cases

- **Children without leading `-`** — match if MATERIAL_RE matches the bare label.
- **Single-child group** — rejected (1 child below an element-typed parent is more likely an authoring quirk than a recipe).
- **Children with mixed prefixes** (`- Beton`, `Besi D13`, `  - Bekisting`) — all match because MATERIAL_RE allows optional dash + whitespace.
- **Parent label ambiguity** — e.g. a row labeled `Sloof PEKERJAAN BETON :` ends in `:`, so it's classified as a sub-sub-chapter divider regardless of the element keyword presence. Correct outcome.
- **Children outside MATERIAL_TYPES** — vocabulary is curated; if a workbook uses a material name we don't know (e.g. `Wiremesh`), it falls outside the group, which truncates collection. Mitigation: keep vocab.ts easy to extend; surface as an open question after Phase 4 trial.

---

## Section 3 — Hand-priced row synthesis (`inline_split`)

Today, `extractTakeoffs.ts` already classifies hand-priced rows: when a BoQ row has values in Material/Upah/Peralatan/Subkon columns but no formula chain, it sets `cost_basis = 'inline_split'` and populates `cost_split`. The audit screen shows "0 AHS line" because no `ahs_lines` are emitted from this classification.

### 3.1 Synthesis location

In `tools/boqParserV2/index.ts`, after `extractBoqRows` returns. Walk every row whose `cost_split` is non-null. For each such row:

```
emit one synthetic ahs_block staging row:
  title: BoQ label + " (hand-priced)"
  parent staging id of the BoQ row
  cost_basis: 'inline_split'

emit one ahs component per non-zero bucket:
  Material  → material_name: 'Material',  unit_price: cost_split.material
  Upah      → material_name: 'Upah',      unit_price: cost_split.labor
  Peralatan → material_name: 'Peralatan', unit_price: cost_split.equipment
  Subkon    → material_name: 'Subkon',    unit_price: subkon_cost_per_unit

each component:
  coefficient: 1
  unit: parent BoQ row's unit
  total: same as unit_price (coefficient = 1)
  parent_ahs_staging_id: synthetic block's id
  cost_basis: null
```

Skip components for buckets that are zero or null.

### 3.2 Audit display

The existing v2 trace-chip table already covers this:

| `cost_basis` | Trace chip label |
|---|---|
| `inline_split` | "Hand-priced (literal split)" |
| `inline_recipe` | "Inline recipe (RAB sheet)" |

No audit-UI code change beyond labeling — the chip rendering already branches on `cost_basis`.

### 3.3 Validation balance

Add a row-level check during `validate.ts` Pass 2e: for `inline_split` and `inline_recipe` synthetic blocks, assert `Σ component.unit_price ≈ block.total_cost (±Rp 1)`. Any mismatch flags `needs_review = true`. This catches workbook-author rounding errors before publish.

---

## Section 4 — Diagnostic warnings for unresolved references

Extend `tools/boqParserV2/validate.ts`. For every formula reference encountered during Pass 2c classification (`=Sheet!Cell`, `=$X$Y`, etc.) that the classifier could not resolve to a known AHS block title, Jumlah row, or catalog row:

```ts
validation_report.unresolved_references.push({
  type: 'unresolved_formula_reference',
  boq_row_code: row.code,
  source_address: row.sourceCell,        // e.g. "RAB (A)!E51"
  formula: row.formulaText,              // e.g. "=Analisa!$F$535"
  target: { sheet: 'Analisa', cell: 'F535' },
  message: 'Formula points at Analisa!F535 which does not match a Jumlah row, AHS title, or catalog row. Likely hand-priced or unrecognized layout.',
});
```

Audit screen renders each unresolved reference as a per-row warning chip with the message text and a "copy address" affordance.

This is a **diagnostic, not a fix.** The actual classifier extension happens in Phase 4 once a workbook reproduces the failure and the missing pattern can be identified from a real cell.

---

## Section 5 — Testing

### 5.1 New synthetic fixture

Build one minimal `.xlsx` at `assets/BOQ/__fixtures__/inline-recipe.xlsx` from the screenshots. One chapter, two `Poer PC.X` parents (`PC.5` and `PC.9`), each with 4 material children: Beton, Besi D13, Bekisting Batako, Bekisting Kayu (the last one tests vocabulary extension since the screenshots show only Bekisting Batako). One trailing hand-priced row (`Tangga utama`, sat=`m3`, unit price as literal in column I) tests the Section 3 synthesis path.

### 5.2 Unit tests

`tools/boqParserV2/__tests__/detectInlineRecipe.test.ts`:
- Parent detection: positive case (matches ELEMENT_RE, label-only, no `:`) and three negatives (has `:` suffix; has C/D values; first material child is the only one — group rejected).
- Material vocabulary: `Beton`, `Besi D13`, `Besi D16`, `Bekisting Batako` all match; `Wiremesh` (outside vocab) doesn't.
- Group boundary: stops at next parent, at empty row, at chapter heading.
- Disambiguation against `extractTakeoffs.ts:197` divider path: the same `byRow` input with label `Poer (Readymix) :` does NOT trigger inline-recipe emission.

`tools/boqParserV2/__tests__/synthesizeFromCostSplit.test.ts`:
- Four-bucket synthesis (M/L/E/S all non-zero).
- Zero-bucket skip (only Material non-zero → 1 component).
- Validation balance: `Σ unit_price = block.total_cost`.

`tools/boqParserV2/__tests__/validate.test.ts`:
- Unresolved-reference detection on a synthetic harvest where one BoQ row's formula points at a non-Jumlah cell.
- No false positives on AAL-5 (every formula resolves) — regression guard.

### 5.3 Integration / regression

`tools/boqParserV2/__tests__/parseBoqV2.snapshot.test.ts`: run the full pipeline against AAL-5, PD3, Nusa Golf I4, CONTOH, and the new inline-recipe fixture. Snapshot all staging rows.

Expected diffs after each phase:
- **Phase 1** (inline-recipe detection): only the inline-recipe fixture changes — parents collapse to one BoQ row, children become AHS components. Real workbooks: zero diff.
- **Phase 2** (cost_split synthesis): PD3 gains 9 synthetic AHS blocks with M/L/E components, AAL-5 gains 2, Nusa Golf gains 1. Inline-recipe fixture's hand-priced row gains synthetic block. CONTOH: zero diff.
- **Phase 3** (validation diagnostic): no row-level diffs; `import_sessions.validation_report.unresolved_references` populates on workbooks that have unresolved formulas (none expected from the four repo workbooks; validates clean).

Any unexpected diff is a regression. Snapshots committed and reviewed per phase.

---

## Section 6 — Migration / rollout

| Phase | Work | Effort |
|---|---|---|
| 1 | `vocab.ts` + `detectInlineRecipe.ts` + unit tests + synthetic fixture + index.ts wiring | 1 day |
| 2 | `cost_split` synthesis in index.ts + audit chip label + validation balance check | 0.5 day |
| 3 | Diagnostic validation pass + audit warning chip rendering | 0.5 day |
| 4 | Trial against Ernawati workbook when available; classifier extension if a missing pattern surfaces | 1 day, variable |

Each phase is independently shippable. No DB migration. v1 parser untouched throughout.

### 6.1 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Vocabulary lists miss element/material types from a future workbook | One-line edits to `vocab.ts`; surfaced by test failure on the new fixture |
| Sub-sub-chapter false positive — a divider line missing the `:` could match ELEMENT_RE | Guarded by ≥2-material-children requirement; divider followed by element rows fails this check |
| Synthetic AHS rows confuse audit-screen users | Existing v2 Trace chip labels distinguish `Hand-priced` and `Inline recipe` from `Catalog` and `Nested AHS` |
| Cost_split synthesis double-emits when both `inline_split` AND `inline_recipe` apply | They never coexist on the same row: `inline_recipe` consumes child rows that have their own M/L/E values, so the parent's M/L/E are zero (label-only). Test guards this. |
| Unresolved-reference diagnostic floods audit on AAL-5/PD3 | Snapshot regression test in 5.3 ensures clean validation on existing fixtures before release |

### 6.2 Rollback

All changes additive. Disable by reverting the four module additions and the index.ts wiring; existing staging data unaffected (cost_basis values `inline_recipe` and unresolved-reference entries are nullable / additive).

---

## File layout

```
tools/boqParserV2/
  vocab.ts                       ← new, ~30 lines
  detectInlineRecipe.ts          ← new, ~120 lines
  index.ts                       ← extended: call detectInlineRecipe;
                                   walk cost_split rows for synthesis
  validate.ts                    ← extended: unresolved-reference pass +
                                   inline-block balance check
  __tests__/
    detectInlineRecipe.test.ts   ← new
    synthesizeFromCostSplit.test.ts ← new
    validate.test.ts             ← extended (or new if not present)
    parseBoqV2.snapshot.test.ts  ← new

assets/BOQ/__fixtures__/
  inline-recipe.xlsx             ← new synthetic fixture

docs/superpowers/specs/
  2026-04-28-boq-parser-inline-recipe-design.md  ← this file
```

## Open questions

None blocking. Phase 4 is gated on access to the Ernawati workbook (or an equivalent reproducer) but the first three phases are shippable in isolation.
