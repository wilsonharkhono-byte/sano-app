# Simplified BoQ Input Parser — Design Spec

*Date: 2026-07-14. Status: approved in brainstorm (Scheme A + col-A-is-BoQ-item + synthetic "Material Umum" anchor + file-wins reconciliation + rebar batang end-to-end). Companion input format authored by the team: `assets/BOQ/20260713 SANO Input - BDG D-18.xlsx`.*

## 1. Context and goal

Today SANO ingests full Indonesian RAB workbooks via `parseBoqV2` — a heavy path that parses Analisa AHS blocks, REKAP rebar sheets, and reconciles per-material breakdowns to ±1 Rp. The team has authored a **simplified alternative input**: a two-sheet workbook where the estimator states material demand *directly*, skipping AHS derivation entirely.

**Goal:** a new parser that turns the simplified workbook into `boq_items` + material-link balance (`project_material_master_lines`), reusing the existing staging → review → publish pipeline unchanged. The simplified format is the team's **go-forward** input; the RAB path stays alive side-by-side (parallel-rebuild rule).

The key architectural insight: `publishBaselineV2` already builds material-master lines **directly from each BoQ row's `parsed_data.recipe.components[]`** (`tools/publishBaselineV2.ts:700–760`) — resolving each material by fuzzy catalog match, normalizing units, then `master_planned = boq.planned × coefficient`. So the simplified format is a **"pre-solved AHS"**: instead of deriving coefficients from Analisa, the team hands us the quantities, and each becomes a coefficient on a hand-built recipe. We write one parser that emits `StagingRowV2[]`; nothing downstream changes.

## 2. Non-goals

- **Client-facing Rp progress valuation.** The Tier-1 sheet carries no money by design; physical progress is quantity-only (volume installed ÷ planned), and mandor opname uses a labor borongan rate that is neither material cost nor present in this format. Out of scope.
- **Catalog cleanup.** The catalog has overlapping/duplicate material names during transition. This parser *reconciles to* existing entries and *flags* conflicts; the user performs the cleanup separately later.
- **Adding or reworking catalogue rows.** The simplified format links to the existing curated catalogue (strict-50) via fuzzy matching (§5.4, §5.5). No catalogue rows are added or mutated; unmatched materials are flagged for review.
- **±1 Rp reconciliation.** There is no source unit cost to reconcile against — the team *is* the source. Validation is structural, not arithmetic (§6).

## 3. The input format

Two sheets, detected by exact name match: `SANO Input Tier 1` and `SANO Input Others`.

### 3.1 `SANO Input Tier 1`

One row per work area. Header spans two rows (row 1 group labels, row 2 diameter sub-headers); data starts at row 4. Blank spacer rows separate zones and are skipped.

| Col | Meaning | Unit |
|---|---|---|
| A | Work area label: `{Zone} ; {Element}` (e.g. `Lt. Basement ; Kolom`) | — |
| B | Beton Readymix volume | m³ |
| C | Besi ø8 | lonjor (batang) |
| D | Besi ø10 | lonjor |
| E | Besi ø13 | lonjor |
| F | Besi ø16 | lonjor |
| G | Besi ø19 | lonjor |
| H | Besi ø22 | lonjor |

Rebar counts are **already in whole lonjor/batang** — the team pre-converted; there is no kg anywhere in this sheet.

### 3.2 `SANO Input Others`

Flat project-level material list. Header row 1, data from row 3.

| Col | Meaning |
|---|---|
| A | Material name |
| B | Tier (2 or 3) |
| C | Satuan (unit) |
| D | Volume (project total qty) |
| E | Harga Satuan (unit price, Rp) |
| F | Total Harga (= D×E, a cached formula) |

Tier 2 = quantity-envelope materials (Semen, Batako, Kawat beton, Kayu usuk, Multipleks, Paku, Bata merah). Tier 3 = Rupiah-budget consumables (Pasir, Kerikil, fuel, Air kerja, Form oil, Kawat ayam).

## 4. Architecture

**Scheme A — Pre-solved AHS adapter.** New module `tools/simplifiedInput/`. Public entry:

```ts
export function parseSimplifiedInput(buffer: Buffer): { stagingRows: StagingRowV2[] };
export function isSimplifiedInputWorkbook(buffer: Buffer): boolean;
```

`parseSimplifiedInput` returns the **same `StagingRowV2[]`** shape as `parseBoqV2`. It emits only two `row_type`s: `boq` (Tier-1 rows + the Others anchor) and `material` (new catalog upserts for unmatched materials). No `ahs`/`ahs_block` rows are needed — `ahs_versions` are created unconditionally by publish (`publishBaselineV2.ts:1065`), and master lines derive from `boq.recipe.components`.

Data flow:

```
simplified.xlsx
  → parseAndStageWorkbook (baseline.ts) detects simplified sheets
  → parseSimplifiedInput() → StagingRowV2[]
  → INSERT import_staging_rows        (existing)
  → BaselineScreen review + approve   (existing)
  → publishBaselineV2()               (existing, UNCHANGED)
       → boq_items, ahs_lines, project_material_master + _lines
  → envelopes / Tier gates / work-groups / opname progress read it (existing)
```

Rejected alternative (**B — parallel direct-write publish path**): re-implements fuzzy matching, unit normalization, and envelope writes that already exist and work; breaks `ahs_lines` readers. Not pursued.

## 5. Component design

### 5.1 Format detection

`isSimplifiedInputWorkbook(buffer)` returns true iff the workbook's sheet names contain both `SANO Input Tier 1` and `SANO Input Others`. Wired into `parseAndStageWorkbook` (`tools/baseline.ts:435`) as a branch **before** the `parseBoqV2` call in the `parser_version === 'v2'` path:

```ts
const v2Buffer = await resolveFileInput(fileInput);
if (isSimplifiedInputWorkbook(v2Buffer)) {
  var { stagingRows } = parseSimplifiedInput(v2Buffer);
} else {
  const boqSheet = detectBoqSheetOptionFromBuffer(v2Buffer);
  ({ stagingRows } = await parseBoqV2(v2Buffer, { boqSheet }));
}
```

The existing insert + `parent_ahs_staging_id` post-fix logic is unchanged (the simplified path emits no parent links, so the post-fix is a no-op over its rows). RAB detection is untouched — the two paths never collide.

### 5.2 Tier-1 sheet → BoQ rows

Each data row → one `boq` staging row. `parsed_data`:

- **code**: synthesized stable id in sheet order — `T1-001`, `T1-002`, … Deterministic (same file → same codes) so re-publish upserts on `project_id,code` cleanly.
- **label**: col A verbatim.
- **chapter**: the substring before `;` (zone, e.g. `Lt. Basement`). **sub_chapter**: the substring after `;` (element, e.g. `Kolom`). When there is no `;`, the whole label is the chapter and sub_chapter is null. This feeds the work-group classifier (`tools/boqWorkGroups.ts`) for free — no extra work.
- **unit**: `m³`. **planned**: col B (beton volume). This is the progress denominator (m³ installed ÷ m³ planned). `planned > 0` is required by the `boq_items` CHECK; a Tier-1 row with zero beton is quarantined to review (§6), never force-published.
- **recipe** (`BoqRowRecipe`): `components` =
  - **Beton Readymix**: `quantityPerUnit = 1.0`, `unit = 'm³'`, `materialName = 'Beton Readymix'`, `lineType = 'material'`, `unitPrice = 0` (no price in the sheet; Tier-1 material cost is not tracked). `master_planned = betonM³ × 1.0 = betonM³`.
  - **Rebar per diameter** (cols C–H, one component per **nonzero** cell): `materialName` = a natural rebar name for the diameter (`Besi beton ulir 10 mm`, etc.), `unit = 'batang'`, `quantityPerUnit = lonjor / betonM³`, `lineType = 'material'`, `unitPrice = 0`. Resolved via the exact→alias→fuzzy matcher to the curated kg rebar rows and converted batang→kg at publish (§5.4); an unresolved diameter goes to review, never guessed.

**Chosen defaults (locked in brainstorm):**
- Beton coefficient is exactly `1.0` — col B is taken literally; no invented 1.05 waste (truth contract: if the team wanted waste it would be in the number).
- Rebar stays **batang end-to-end** — see §5.4.

### 5.3 Others sheet → project-level materials, no BoQ relation (revised 2026-07-16)

> **Revision.** The first draft hung all Others on ONE synthetic `MATERIAL-UMUM` BoQ row (to satisfy `boq_item_id NOT NULL`). That row is a single rejectable point of failure — and in practice it got REJECTED in review, silently dropping every Tier-2/3 material. It also contradicts the model: **Tier-2/3 are project-level envelopes with no BoQ relation** (Tier 2 = quantity envelope, Tier 3 = Rupiah budget). Replaced with the honest model below.

Each Others row → one **project-level material staging row** (`row_type = 'material'`, `parsed_data.project_material = true`, carrying `name`, `unit`, `tier`, `volume`, `reference_unit_price`). Using `'material'` (not `'boq'`) keeps them out of every BoQ / supersede / work-group path automatically — no guards needed.

At publish, `buildProjectMaterialLines` reconciles each to the catalogue (fuzzy, file-wins) and writes a `project_material_master_line` with **`boq_item_id = NULL`** and `planned_quantity = Volume` (absolute). Migration `082_project_material_lines_nullable_boq.sql` makes the column nullable. The material-level readers already tolerate null (they SUM per material, no `boq_items` join), so **the Tier-2/3 envelope + budget gates work unchanged**. The one code addition: `deriveMaterialBalance` (the balance report) gets an additive read of null-anchor master lines — its primary path re-derives `planned = boq.planned × coefficient` from `ahs_lines`, which would otherwise miss project-level materials.

No `MATERIAL-UMUM` row, nothing rejectable, no fake BoQ item. REJECTED material rows and catalogue-unresolved materials are skipped at publish (surfaced, not invented).

### 5.4 Rebar batang — link to the curated kg rows (revised 2026-07-15)

> **Revision.** An earlier draft added *isolated* `REB-*-BTG` batang catalog rows (to avoid corrupting existing kg-rebar projects). That was superseded by the **strict-50 catalogue rebuild** (2026-07-15), which trimmed the catalogue to 50 curated items and re-published the older projects. The curated set keeps rebar as the standard rows (`Besi beton {polos|ulir} N mm`, **`unit=kg`, `supplier_unit=batang`**, with a batang→kg factor) — i.e. the catalogue already carries *both* units. So the isolated rows and their migration are dropped; the simplified format links to the existing curated rows.

The model is the standard SANO rebar model ([[rebar-batang-units]]): **stored in kg, displayed/ordered in batang.** The simplified sheet gives rebar in whole lonjor; the parser emits each diameter as a component with `unit = 'batang'`, `quantityPerUnit = lonjor / betonM³`, and a natural material name (`Besi beton ulir 10 mm`, etc.). At publish, `normalizeComponentQty` (`publishBaselineV2.ts:66–87`) converts batang→kg via the catalogue row's `base_qty_per_supplier_unit`, so the master line is stored in kg; SANO's rebar views convert back to batang for display and ordering. **Zero publish-code change; no migration.**

Diameter → name: ø8→`Besi beton polos 8 mm`, ø10→`Besi beton ulir 10 mm`, ø13/16/19/22→`Besi beton ulir {N} mm`. These are resolved through the exact→alias→fuzzy matcher (the parser stays "broad" — a differently-named curated row still binds); a diameter that fails to resolve, or a catalogue row missing its batang factor, is flagged for review, never guessed.

### 5.5 Material reconciliation (file wins + flag)

Every material name (beton, each rebar diameter, each Others row) is reconciled to the catalog using the **existing** `resolveCatalogId` → `reconcileMaterials` exact→alias→fuzzy cascade (`publishBaselineV2.ts:98`), the same matcher the RAB path uses.

- **Matched** → reuse that catalog id. The line links; the file's quantity is authoritative.
- **Unmatched** → the component keeps `material_id = null` and is flagged `needs_review: true` as unresolved (the file's tier/price/unit are captured on the row for the reviewer). **No catalog entry is auto-created** — the import/publish path has no catalog-write step (the catalog is seeded only by `003_seed.sql`), and silently inventing a catalog row is exactly the kind of unverified write §1.1 forbids. The reviewer adds the material to the catalog (or the user does so in the later cleanup), then re-publishes; this matches how the RAB path already handles unresolved materials.
- **File wins on tier + price.** For a **matched existing** material whose tier or price disagrees with the catalog, the row is flagged `needs_review: true` with the discrepancy surfaced (file value vs catalog value), so it is visible in staging before publish and during the later catalog cleanup. The shared catalog row is **not** silently mutated (it may be referenced by other projects); the file value is captured on the staging row and, per "file wins," governs this import's behavior. (This is the safe reading of "file wins" chosen in brainstorm; flipping to overwrite-catalog-now is a one-line change if the user later wants it.)

Reconciliation results (which file material → which catalog id, at what confidence, with what conflicts) are captured on each staging row's `parsed_data`/`raw_data` so the review UI and the eventual cleanup can see them.

## 6. Truth-correctness & validation

No arithmetic reconciliation (no source cost). Structural checks, each routing the row to the staging review (`needs_review: true`) rather than dropping or guessing (CLAUDE.md §1.1):

- Blank/duplicate synthesized code, missing label.
- `planned ≤ 0` on a Tier-1 row (also quarantined by the `boq_items` CHECK downstream).
- Unit not recognized against the catalog for a matched material — surfaces the known basis quirks in the sample file: Semen "sak 40 kg" vs catalog "sak 50 kg"; "Kayu usuk 5/7" stated as `m3` where the qty/price read as per-batang. These become explicit unit-mismatch review items, not silent 25%-off envelopes.
- Material unresolved by fuzzy match (`material_id` stays null; flagged).
- Tier/price conflict on a matched material (§5.5).

Nothing is auto-corrected; every uncertainty is a visible review item.

## 7. Testing

- **Unit — detection**: `isSimplifiedInputWorkbook` true for the sample, false for a RAB workbook and for a breakdown-normalized workbook.
- **Unit — Tier-1 mapping**: a known row (e.g. `Lt. Basement ; Kolom`, beton 39.0227…, ø10=517, ø16=174, ø19=91, ø22=60) → correct `code/label/chapter/sub_chapter/unit/planned` and a recipe whose beton coefficient is 1.0 and whose rebar coefficients reproduce the exact lonjor counts after `master_planned = planned × coefficient`.
- **Unit — Others anchor**: anchor `planned=1`, each component `master_planned = Volume`, tier/price carried from the file; a Tier-3 row's budget equals `Volume × Harga`.
- **Unit — reconciliation/flags**: matched material reuses id; unmatched keeps `material_id` null + flags `needs_review` (no catalog row invented); tier/price conflict flags `needs_review`.
- **Integration — parse→publish** against a disposable test project: run the sample through `parseSimplifiedInput` → `publishBaselineV2`, assert `v_material_envelopes` per-material `total_planned` equals the sheet (beton m³ per work area summed; rebar converted lonjor→kg via the catalogue factor per diameter; Others volumes). Guarded so it is skippable without live DB creds.

## 8. Codebase touch-points

| File | Change |
|---|---|
| `tools/simplifiedInput/index.ts` | New. `parseSimplifiedInput`, `isSimplifiedInputWorkbook`. |
| `tools/simplifiedInput/tier1.ts` | New. Tier-1 rows → `boq` staging rows + recipes. |
| `tools/simplifiedInput/others.ts` | New. Others rows → `MATERIAL-UMUM` anchor row. |
| `tools/simplifiedInput/rebar.ts` | New. Diameter→natural rebar name + batang component builder. |
| `tools/simplifiedInput/__tests__/` | New. Unit + integration tests. |
| `tools/baseline.ts` | Add detection branch at ~line 435. |

No migration, and no change to `publishBaselineV2.ts`, the envelope views, the Tier gates, or the work-group classifier. The feature links to the existing curated catalogue via fuzzy matching.

## 9. Rollout & risks

- **No migration / no catalogue changes:** rebar and beton resolve to existing curated rows (`Besi beton …`, `Ready mix fc' … MPa`) via fuzzy matching. Nothing to paste before publishing.
- **Beton grade is ambiguous:** the sheet says only "Beton Readymix"; the catalogue has `Ready mix fc' 25 MPa` and `fc' 30 MPa`. The match may resolve to one or flag for review — the estimator confirms the grade. Not guessed.
- **Anchor visibility:** `Material Umum` appears as a BoQ line; documented so reviewers expect it.
- **Risk — misclassified `;` split:** a label without `;` yields a null sub_chapter (classifier degrades gracefully, as it already does for pre-064 imports). Acceptable.
- **Risk — file basis quirks** (Semen sak size, kayu usuk unit): caught as review items (§6), not silently ingested.
