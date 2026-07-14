# Simplified BoQ Input Parser — Design Spec

*Date: 2026-07-14. Status: approved in brainstorm (Scheme A + col-A-is-BoQ-item + synthetic "Material Umum" anchor + file-wins reconciliation + rebar batang end-to-end). Companion input format authored by the team: `assets/BOQ/20260713 SANO Input - BDG D-18.xlsx`.*

## 1. Context and goal

Today SANO ingests full Indonesian RAB workbooks via `parseBoqV2` — a heavy path that parses Analisa AHS blocks, REKAP rebar sheets, and reconciles per-material breakdowns to ±1 Rp. The team has authored a **simplified alternative input**: a two-sheet workbook where the estimator states material demand *directly*, skipping AHS derivation entirely.

**Goal:** a new parser that turns the simplified workbook into `boq_items` + material-link balance (`project_material_master_lines`), reusing the existing staging → review → publish pipeline unchanged. The simplified format is the team's **go-forward** input; the RAB path stays alive side-by-side (parallel-rebuild rule).

The key architectural insight: `publishBaselineV2` already builds material-master lines **directly from each BoQ row's `parsed_data.recipe.components[]`** (`tools/publishBaselineV2.ts:700–760`) — resolving each material by fuzzy catalog match, normalizing units, then `master_planned = boq.planned × coefficient`. So the simplified format is a **"pre-solved AHS"**: instead of deriving coefficients from Analisa, the team hands us the quantities, and each becomes a coefficient on a hand-built recipe. We write one parser that emits `StagingRowV2[]`; nothing downstream changes.

## 2. Non-goals

- **Client-facing Rp progress valuation.** The Tier-1 sheet carries no money by design; physical progress is quantity-only (volume installed ÷ planned), and mandor opname uses a labor borongan rate that is neither material cost nor present in this format. Out of scope.
- **Catalog cleanup.** The catalog has overlapping/duplicate material names during transition. This parser *reconciles to* existing entries and *flags* conflicts; the user performs the cleanup separately later.
- **Reworking the RAB rebar path or the existing kg rebar rows.** The simplified format links to *new, isolated* batang rebar catalog rows (§5.4); the existing kg rows and the RAB path are left exactly as they are. Consolidating the two rebar sets is the user's later catalog cleanup, not this build.
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
  - **Rebar per diameter** (cols C–H, one component per **nonzero** cell): `materialName` = the **exact name of the isolated batang rebar catalog row** for the diameter (see §5.4), `unit = 'btg'`, `quantityPerUnit = lonjor / betonM³` (batang per m³), `lineType = 'material'`, `unitPrice = 0`. `master_planned = betonM³ × (lonjor/betonM³) = lonjor` (whole batang preserved). Diameter→batang-row mapping: ø8→`REB-PL08-BTG`, ø10→`REB-DE10-BTG`, ø13→`REB-DE13-BTG`, ø16→`REB-DE16-BTG`, ø19→`REB-DE19-BTG`, ø22→`REB-DE22-BTG`. The parser emits the **exact** catalog name so `reconcileMaterials`' exact-match tier links it deterministically to the batang row (not the near-identical kg row); an unresolved diameter goes to review, never guessed.

**Chosen defaults (locked in brainstorm):**
- Beton coefficient is exactly `1.0` — col B is taken literally; no invented 1.05 waste (truth contract: if the team wanted waste it would be in the number).
- Rebar stays **batang end-to-end** — see §5.4.

### 5.3 Others sheet → synthetic anchor BoQ row

`project_material_master_lines.boq_item_id` is `NOT NULL`, but the Others totals are project-level. One synthetic `boq` row per import anchors them:

- **code**: `MATERIAL-UMUM`. **label**: `Material Umum (Tier 2 & 3)`. **chapter**: `Material Umum`. **unit**: `ls`. **planned**: `1`.
- **recipe.components** = one component per Others row: `materialName` = col A, `unit` = col C (Satuan), `quantityPerUnit` = col D (Volume), `unitPrice` = col E (Harga Satuan), `lineType = 'material'`. `master_planned = 1 × Volume = Volume` — exactly the project total, in the sheet's unit.

Shows as one extra clearly-labeled BoQ line. No schema change. (Considered and rejected: nullable `boq_item_id` — touches envelope views + a Dashboard-pasted migration, higher blast radius.)

### 5.4 Rebar batang end-to-end — isolated batang catalog rows

Rebar must stay in native batang; no kg round-trip. Publish's `normalizeComponentQty` (`publishBaselineV2.ts:66–87`) passes a batang quantity through **unchanged iff the linked catalog material's base unit is batang** (line 81–82); if the base unit is kg it converts batang→kg. Today the rebar rows are kg-based (migration 052).

**Why not flip the existing rows.** A live probe (2026-07-14) found **887 `project_material_master_lines` across 3 projects, plus 887 `ahs_lines`, storing rebar in kg**. `v_material_envelopes` reads `mc.unit` **live** and sums `planned_quantity`; flipping the shared rebar rows to `unit='batang'` would instantly relabel those 3 projects' kg sums as batang — a wrong-number corruption the truth contract (§1.1) forbids. So the shared rows are **not** touched.

**Therefore this design adds 6 isolated batang-native rebar rows** via migration (`0XX_rebar_batang_catalog.sql`, number assigned at implementation) — one per diameter the simplified format uses:

| Code | Name (exact) | unit | supplier_unit | base_qty_per_supplier_unit |
|---|---|---|---|---|
| `REB-PL08-BTG` | `Besi beton polos 8 mm (batang)` | `batang` | `batang` | `1` |
| `REB-DE10-BTG` | `Besi beton ulir 10 mm (batang)` | `batang` | `batang` | `1` |
| `REB-DE13-BTG` | `Besi beton ulir 13 mm (batang)` | `batang` | `batang` | `1` |
| `REB-DE16-BTG` | `Besi beton ulir 16 mm (batang)` | `batang` | `batang` | `1` |
| `REB-DE19-BTG` | `Besi beton ulir 19 mm (batang)` | `batang` | `batang` | `1` |
| `REB-DE22-BTG` | `Besi beton ulir 22 mm (batang)` | `batang` | `batang` | `1` |

Tier 1, category `Struktur`. Idempotent (`INSERT … ON CONFLICT (code) DO NOTHING`), Dashboard-pasteable (per the migration-history-divergence constraint). The names deliberately differ from the kg rows (` (batang)` suffix) so the parser's **exact-match** resolution never confuses a batang component with the kg row. Publish keeps these in batang automatically — **zero publish-code change**.

**Transitional state (by design, resolved in the user's later catalog cleanup):** the catalog now carries two rebar sets — kg rows (used by the 3 existing RAB projects, untouched and uncorrupted) and batang rows (used by simplified-format projects). This is the accepted trade-off for keeping rebar batang *without* corrupting existing data. The RAB import path is unaffected: it emits kg and links to the kg rows exactly as before. Consolidation (and any migration of existing projects to batang) is the user's separate cleanup, out of scope here.

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
- **Integration — parse→publish** against a disposable test project: run the sample through `parseSimplifiedInput` → `publishBaselineV2`, assert `v_material_envelopes` per-material `total_planned` equals the sheet (beton m³ per work area summed; rebar in batang per diameter; Others volumes), and that rebar rows carry unit `batang` (proves the batang rows were linked, no kg conversion). Guarded so it is skippable without live DB creds.
- **Migration**: the 6 batang rebar rows read back with `unit = 'batang'`; re-running the migration is a no-op; the existing kg rebar rows are unchanged (still `unit = 'kg'`).

## 8. Codebase touch-points

| File | Change |
|---|---|
| `tools/simplifiedInput/index.ts` | New. `parseSimplifiedInput`, `isSimplifiedInputWorkbook`. |
| `tools/simplifiedInput/tier1.ts` | New. Tier-1 rows → `boq` staging rows + recipes. |
| `tools/simplifiedInput/others.ts` | New. Others rows → `MATERIAL-UMUM` anchor row. |
| `tools/simplifiedInput/rebar.ts` | New. Diameter→batang-row (code + exact name) + batang component builder. |
| `tools/simplifiedInput/__tests__/` | New. Unit + integration tests. |
| `tools/baseline.ts` | Add detection branch at ~line 435. |
| `supabase/migrations/0XX_rebar_batang_catalog.sql` | New. Insert 6 isolated batang rebar rows. Idempotent, no change to existing rows. |

No change to `publishBaselineV2.ts`, the envelope views, the Tier gates, or the work-group classifier.

## 9. Rollout & risks

- **Deploy order:** paste the batang-rebar migration before publishing a simplified workbook (else the batang rebar rows don't exist and every rebar component flags unresolved). Add to the Dashboard checklist per the migration-history-divergence process.
- **No impact on existing projects:** the 3 kg-rebar projects and the RAB import path are untouched — the migration only INSERTs new rows. No RAB pause needed.
- **Transitional two-rebar-set catalog:** kg rows + batang rows coexist until the user's catalog cleanup; documented so it is expected, not mistaken for duplication drift.
- **Anchor visibility:** `Material Umum` appears as a BoQ line; documented so reviewers expect it.
- **Risk — misclassified `;` split:** a label without `;` yields a null sub_chapter (classifier degrades gracefully, as it already does for pre-064 imports). Acceptable.
- **Risk — file basis quirks** (Semen sak size, kayu usuk unit): caught as review items (§6), not silently ingested.
