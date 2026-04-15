# BoQ Parser v2 — Design Spec

**Date:** 2026-04-15
**Status:** Design approved, pending implementation plan
**Supersedes (eventually):** `tools/boqParser.ts`, `tools/publishBaseline.ts`

## Problem

The current BoQ parser in `tools/boqParser.ts` is confused by multi-layer price references in real Indonesian estimator workbooks. Estimators build unit costs through a ratio system — e.g. "1 m3 of beam type 1 needs X cement, Y rebar, Z formwork" — then multiply that ratio by actual volumes. In practice the ratio chain has multiple layers: an AHS block's unit price often points at *another* AHS block's grand total (`=$I$199`), not a catalog material. Some component costs are computed from cross-cell multiplications that split across F/G/H columns (the rebar case). The current parser can't follow these chains and ends up with `unit_price = 0` or wrong totals, forcing estimators into post-publish cleanup.

Investigation of the reference workbook (RAB R1 Pakuwon Indah AAL-5) against raw cell data and screenshots confirmed:

- Excel's cached `.v` values are always correct — no need to re-evaluate formulas
- The Analisa sheet uses a small, recognizable set of intra-sheet absolute references (`=$I$199`, `=$F$240*B155`)
- 17 hardcoded literal prices exist in column E with no catalog link
- Rebar rows split their cost across F/G/H columns via three different formulas feeding material/labor/equipment
- REKAP Balok aggregates rebar takeoffs via SUMIFS chains pointing at a 9735-row Besi Balok sheet

The parser rewrite is deterministic and text-based — no image processing, no formula evaluation engine, no fuzzy inference.

## Goals

- Correctly parse multi-layer AHS price chains using the cached values Excel already computed
- Recognize and preserve the five reference patterns (catalog, nested_ahs, literal, takeoff_ref, cross_ref) used in real workbooks
- Give estimators an inline editing UI so they can correct any field the parser wrote, with live recompute and undo
- Validate each AHS block's internal math before publish (`Σ components ≈ Jumlah`) to catch classification bugs and workbook inconsistencies
- Ship incrementally without ever breaking the current v1 import flow
- Keep v1 as a permanent fallback until v2 is proven on multiple real projects

## Non-goals

- Writing a formula evaluator. Excel's cached `.v` values are trusted directly.
- Rebuilding the target schema. `ahs_lines` / `boq_items` keep the same shape; only additive columns are added for traceability.
- Taking screenshots or rendering XLSX to images. All classification is done on `.f` (formula text) + `.v` (cached value) pairs.
- Collaborative real-time editing of staging sessions. One estimator per session with a soft lock.
- Automating the cleanup of the material catalog's overlapping/duplicate names. Fuzzy matching in the audit UI surfaces ambiguity for the estimator to resolve; canonicalization is a separate future project.
- Deleting v1 code during this project. Sunset happens only after ≥4 weeks of clean v2 production use.

## Core principle: parallel rebuild

v2 is a **new file** (`tools/boqParserV2.ts`) sitting next to v1 (`tools/boqParser.ts`), not an in-place rewrite. Both are present in the build. A per-import-session toggle picks which parser runs. v1 stays untouched throughout Phases 0–6 and is only removed after explicit sunset in Phase 7. If v2 produces wrong numbers, the escape hatch is to flip the toggle back to v1 and re-import the file — zero database migration needed for rollback.

---

## Section 1 — Data Model

All schema changes are additive and nullable. v1 ignores every new field; v2 populates them.

### 1.1 New columns on `import_staging_rows`

**`cost_basis`** — text, nullable. Classification of how an AHS component's price is determined.

| Value | Meaning | Excel pattern |
|---|---|---|
| `catalog` | Unit price comes from a Material/Upah sheet lookup | `=Material!$F$12` or literal code match |
| `nested_ahs` | Unit price is another AHS block's Jumlah grand total | `=$I$199` (points at a Jumlah row in same sheet) |
| `literal` | Unit price is a hardcoded number, no link | `150000` typed directly into the cell |
| `takeoff_ref` | Quantity or price comes from a takeoff aggregation | `=SUM('REKAP Balok'!K526, 'REKAP-PC'!G21)` |
| `cross_ref` | Cost computed from another block's cell — rebar split | `=$F$240*B155` |

**`parent_ahs_staging_id`** — uuid, nullable, FK to `import_staging_rows(id)`. Set when `cost_basis = nested_ahs`. Points at the parent AHS block's *title row*, not its Jumlah row — the title row is the semantic parent. ON DELETE CASCADE.

**`ref_cells`** — jsonb, nullable. Raw reference provenance extracted from `.f`, populated with cached `.v` values from the parent-sheet lookup. Shape:
```json
{
  "unit_price":    { "sheet": "Analisa", "cell": "I199", "cached_value": 156799 },
  "material_cost": { "sheet": "Analisa", "cell": "F199", "cached_value": 130666 },
  "labor_cost":    { "sheet": "Analisa", "cell": "G199", "cached_value": 26133 }
}
```

**`cost_split`** — jsonb, nullable. For rebar-style rows where F/G/H carry material/labor/equipment splits, captures the resolved three-bucket split:
```json
{ "material": 1662746, "labor": 0, "equipment": 73744 }
```

### 1.2 New column on `import_sessions`

- `parser_version` — text, NOT NULL DEFAULT `'v1'`. Tracks which parser created this session.
- `validation_report` — jsonb, nullable. Stores Pass 2e results so the audit screen doesn't recompute.
- `locked_by` — uuid, nullable, FK to `profiles(id)`. Soft edit lock.
- `locked_at` — timestamptz, nullable.

### 1.3 New table `import_staging_edits`

Per-field edit history for the audit screen's undo and change-tracking.
```sql
CREATE TABLE import_staging_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_row_id uuid REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  import_session_id uuid REFERENCES import_sessions(id) ON DELETE CASCADE,
  edited_by uuid REFERENCES profiles(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  field_path text NOT NULL,
  old_value jsonb,
  new_value jsonb
);
CREATE INDEX idx_staging_edits_session ON import_staging_edits(import_session_id);
```

RLS mirrors `import_staging_rows`: access granted when the current user has a `project_assignments` row for the session's project.

### 1.4 New column on `ahs_lines`

- `origin_parent_ahs_id` — uuid, nullable. Breadcrumb for lines that came from unfolding a nested AHS block at publish time.

### 1.5 Reference pattern → `cost_basis` mapping

1. `=Sheet!$X$Y` → `catalog` when the referenced sheet is a catalog sheet (`Material`, `Upah`, or any sheet whose name does NOT match `/^(REKAP|Data|Hasil|Besi|Detail|Plat|Tangga|COVER)/i`). If the sheet name matches a known REKAP/aggregator pattern, treat as `takeoff_ref` instead. `ref_cells.unit_price` populated either way.
2. `=$X$Y` or `=XY` intra-sheet → `nested_ahs` when target is a Jumlah row. Walk backward from `$I$XX` to the nearest title row to resolve `parent_ahs_staging_id`.
3. `=SUMIFS(...)` / `=SUM(range)` in quantity cell → `takeoff_ref`. No unfolding; cached value + provenance stored.
4. `=B*E` (simple coefficient × unit price) → no classification flag; default path.
5. `=$F$240*B155` or similar cross-cell multiplies → `cross_ref`. `cost_split` populated from the cached `.v` of F/G/H of the current row verbatim.

Literal typed numbers in column E → `cost_basis = literal`. Become synthetic catalog-less entries at publish, and must be confirmed in audit.

---

## Section 2 — Parser Passes

Two passes over the workbook. Pass 1 is dumb and universal (read everything). Pass 2 is structural (classify and link). Separation allows Pass 2 re-runs on harvested data during development without re-reading the XLSX.

### 2.1 Pass 1 — Harvest

Walk every sheet, every cell. For each cell record:
```ts
interface HarvestedCell {
  sheet: string;
  address: string;       // "I199"
  row: number;
  col: number;
  value: unknown;        // .v — Excel's cached computed result
  formula: string | null; // .f — raw formula text, null if literal
}
```

Output: `harvestedCells: HarvestedCell[]` + a lookup `Map<"sheet!address", HarvestedCell>`. This is the source of truth for everything downstream.

### 2.2 Pass 2 — Structural classification

Sub-phases; each reads `harvestedCells` and emits staging rows.

**2a. Catalog extraction.** Sweep `Material`, `Upah`, and any catalog-patterned sheet. Emit `row_type = 'material'` staging rows with `code`, `name`, `unit`, `reference_unit_price` from `.v`. No formulas expected.

**2b. AHS block detection.** Sweep `Analisa` (and any sheet with AHS layout). Detect block boundaries by scanning column B/C for title rows matching `/^\d+\s*m[²³23]?\s+/i` (accepts both Unicode superscripts and plain "m2"/"m3" — e.g. "1 m3 Beton site mix"), then scan forward for the `Jumlah` row — recognized either by the literal text "Jumlah" in column A/B/C or by a SUM formula in column F whose range starts at the title row. Rows between title and Jumlah are candidate components; skip rows whose column B/C text matches column-header labels (`/^(Uraian|Satuan|Koefisien|Harga|Jumlah Harga|No)$/i`) or that are empty (no value in columns B-F).

For each block:
- One `row_type = 'ahs_block'` staging row for the title (new row type in v2; stores block unit, Jumlah cached value, `$I$XX` grand-total address)
- One `row_type = 'ahs'` staging row per component (matches existing v1 row type, so the existing `auditPivot.ts` filter at [tools/auditPivot.ts:94](tools/auditPivot.ts#L94) continues to see v2 components without modification)

**2c. Component classification.** For each component row, examine formulas in columns E, F, G, H and apply the reference-pattern matcher — a regex table of ~30 lines.

For `nested_ahs`: walk backward from the referenced `$I$XX` to the nearest title row in the same sheet. Its staging id is `parent_ahs_staging_id`. If the referenced block hasn't been emitted yet (forward reference), defer and resolve at end-of-pass.

For `cross_ref` (rebar split): read cached `.v` from the current row's F, G, H columns directly into `cost_split`. Three different formulas per column, three different cached values, all trusted.

**2d. Takeoff reference extraction.** Sweep `RAB (A)`. Each BoQ row has label, unit, quantity, unit cost. Classify the quantity cell's formula:
- Literal → store as-is
- `=SUM('REKAP X'!cell, ...)` → `cost_basis = takeoff_ref`, `ref_cells.quantity` lists every aggregation source. Do not unfold.
- Link to an AHS block (`=Analisa!$F$150` in unit-cost columns) → store the reference, emit a `boq → ahs_block` link row.

**2e. Validation sweep.** For each AHS block, assert `Jumlah.cached_value ≈ Σ component[F].cached_value` (±Rp 1). Failures flag `needs_review = true` with a reason. Results stored in `import_sessions.validation_report`.

### 2.3 What stays out of Pass 2

- Price lookup against the live Material catalog (happens at publish)
- Trade categorization (post-publish by `detectAndTagLaborTrades`)
- Unit conversion (trust the workbook's declared unit)

### 2.4 Complexity estimate

- Pass 1: ~80 lines
- 2a catalog: ~60 lines
- 2b AHS detection: ~100 lines
- 2c classification + regex table + forward-ref resolution: ~150 lines
- 2d BoQ walker: ~80 lines
- 2e validation: ~30 lines

~500 lines total for v2 parser vs ~1400 lines in v1. v2 is substantially smaller because deterministic formula classification replaces v1's fuzzy matching.

---

## Section 3 — Audit Screen Integration

`AuditTraceScreen.tsx` + `auditPivot.ts` gain v2-only affordances when rows carry `parser_version = 'v2'`. v1 rows render the existing pivots unchanged.

### 3.1 Trace chip (read-only expansion)

Every AHS component row shows a small `Trace` chip next to unit price, labeled by `cost_basis`:

| cost_basis | Label | Color |
|---|---|---|
| `catalog` | "Katalog: Material!F12" | neutral |
| `nested_ahs` | "Turunan dari: 1m3 Kolom Praktis" | primary |
| `literal` | "Literal (hardcoded)" | warning |
| `takeoff_ref` | "Takeoff: REKAP Balok!K526" | info |
| `cross_ref` | "Split F/G/H" | warning |

Tap → expands inline showing `ref_cells`: every source address + cached value. For `nested_ahs`, also renders the parent block's full component list inline so the estimator sees the whole chain without leaving the audit view. No click-through navigation.

### 3.2 Fuzzy material matcher

Extends the Material pivot in `pivotByMaterial`. For v2 rows:
1. Run exact-normalized match first (current behavior).
2. On miss, run fuzzy scorer (normalized Levenshtein + token-set) against the whole catalog.
3. Candidates scoring ≥ 0.7 collected.
4. If exactly one ≥ 0.9: auto-link with a "Cek" badge.
5. If multiple, or top score 0.7–0.9: "Ambigu" badge. Tap opens an inline picker (anchored under the tapped card) listing all candidates by score, plus "Create new catalog entry" and "Keep as-is (no link)".
6. Estimator's choice writes `parsed_data.material_id` on the staging row — no parser re-run.

New file: `tools/materialMatch.ts`, ~80 lines of pure scoring functions, unit-testable with no DB.

Fuzzy matching lives in the audit screen, not the parser. The parser stays deterministic; human judgment resolves the catalog's transitional overlap state.

### 3.3 Validation badges

AHS Block pivot header shows per-block status from `validation_report`:
- ✓ Green: balanced
- ⚠ Orange: "Tidak balans: selisih Rp X"
- ⓘ Blue: "Berisi referensi turunan (nested)"

Tapping ⚠ expands the full component list with the offending row(s) highlighted.

### 3.4 Inline editing (every field the parser wrote is editable)

**UI rule — hard constraint:** when the estimator taps "edit" on any card, the edit form expands **as a direct child of the tapped card, pushing subsequent cards down**. Never a modal, never a separate screen, never a drawer. Only one editor open at a time; tapping edit on a second card closes the first and re-anchors under the new target.

Editable fields by context:

| Tab | Row type | Editable fields |
|---|---|---|
| Material | Catalog row | name, unit, reference_unit_price, category, tier |
| Material | Ambiguous match | Pick catalog entry / create new / keep as literal |
| BoQ | BoQ item | label, unit, planned_qty, chapter |
| BoQ | BoQ→AHS link | Pick AHS block from fuzzy-search dropdown |
| AHS Block | Block title | unit, rename |
| AHS Block | Component | coefficient, unit_price, waste_factor, material_name, line_type |
| AHS Block | Literal component | unit_price (fulfills LITERAL_CONFIRMED) |
| AHS Block | Nested ref | Re-pick parent block |
| AHS Block | Cross-ref | Edit material/labor/equipment independently in `cost_split` |

Every cell is tap-to-edit. Save on blur. No modal.

### 3.5 Live recompute

On any edit, affected block's totals recompute in-memory and re-render:
- Component `coefficient` edit → `perUnitCost` → block `grand` + per-category totals → validation badge re-evaluates
- Block `Jumlah` edit → update target, recompute badge
- Material `reference_unit_price` edit → every bound AHS component refreshes

All in-memory pivot recomputation; `auditPivot.ts` already derives from flat staging arrays, so we re-run after each edit.

### 3.6 Add / delete rows

- **Add component** to a block: "+" button at block bottom. Creates `row_type = 'ahs'` with `cost_basis = literal` default; estimator fills in.
- **Delete component**: Swipe / trash icon. Soft-delete via `review_status = 'REJECTED'` (matches existing filter in `auditPivot.ts:94`). Un-rejectable.
- **Add BoQ row**: "+" at BoQ tab bottom.
- **Add whole AHS block**: "+" at AHS Block tab bottom → title + one empty component + Jumlah placeholder.

### 3.7 Undo / history

Every edit inserts into `import_staging_edits`:
```sql
staging_row_id, import_session_id, edited_by, edited_at,
field_path, old_value, new_value
```

- **Undo** button in audit header pops the last N edits for the session.
- **"Show changes"** per row expands to show estimator edits vs original parser output.
- Cost: one INSERT per field edit — cheap.

### 3.8 Persistence & lock

- Optimistic save (local update, background Supabase write)
- Failure → toast + revert + retry queue
- One estimator per session via `import_sessions.locked_by` soft lock. Second user opens read-only with a banner.

### 3.9 `auditPivot.ts` changes

Surgical, additive, non-breaking:
- `extractAhsRows` reads new fields when present
- New type `AuditAhsRowV2 = AuditAhsRow & { costBasis, parentAhsStagingId, refCells, costSplit, parserVersion }`
- `pivotByMaterial` branches on `parserVersion` for v2 fuzzy augmentation
- `pivotByAhsBlock` gets `validationStatus: 'ok' | 'imbalanced' | 'has_nested'` per block
- `pivotByBoq` unchanged — BoQ totals computed the same regardless of version

---

## Section 4 — Validation Rules & Publish Flow

### 4.1 Validation rules

Run after Pass 2 and on Publish. Results stored in `import_sessions.validation_report`.

**Blocking** (publish disabled until resolved):

| Rule | Check |
|---|---|
| `AHS_BLOCK_BALANCE` | `Σ component[F] ≈ block.Jumlah` (±Rp 1) |
| `NESTED_PARENT_EXISTS` | Every `parent_ahs_staging_id` resolves in this session |
| `LITERAL_CONFIRMED` | Every `cost_basis = literal` row has explicit estimator confirmation |
| `BOQ_HAS_AHS_LINK` | Every non-synthetic BoQ row has an AHS link or explicit takeoff_ref |
| `MATERIAL_AMBIGUITY` | Every "Ambigu" material-pivot badge resolved |

`LITERAL_CONFIRMED` has a "Konfirmasi semua literal di block ini" bulk button per block to keep friction low (typical workbook has ~17 literals → under a minute of taps).

**Advisory** (warn, don't block):

| Rule | Check |
|---|---|
| `NESTED_DEPTH > 3` | Parent chain deeper than 3 levels |
| `CROSS_REF_F_GH_SPLIT` | Any `cost_basis = cross_ref` — highlights rebar path for eyeballing |
| `UNUSED_CATALOG_ROW` | Material sheet row referenced by no block |
| `ORPHAN_AHS_BLOCK` | AHS block that no BoQ points at |

### 4.2 Publish flow

New file: `tools/publishBaselineV2.ts` next to v1. Dispatcher picks based on `import_sessions.parser_version`.

Target schema (`ahs_versions`, `ahs_lines`, `boq_items`) unchanged. All v2 complexity absorbed during flattening.

**Flattening algorithm** (depth-first, deepest first via topological sort on `parent_ahs_staging_id`):

```
for each AHS block staging row (deepest first):
  resolved_components = []
  for each component row in this block:
    switch component.cost_basis:
      case 'catalog':
        → emit ahs_line with material_id from fuzzy match,
          unit_price from ref_cells.unit_price.cached_value
      case 'literal':
        → emit ahs_line with material_id = null,
          unit_price = component.value, name from workbook
      case 'takeoff_ref':
        → emit ahs_line with takeoff_quantity populated,
          unit_price from ref_cells, no coefficient
      case 'cross_ref':
        → emit up to 3 ahs_lines (material/labor/equipment),
          each with line_type + unit_price from respective cost_split bucket
      case 'nested_ahs':
        → parent block already resolved (deepest-first ordering)
        → copy parent's resolved_components into THIS block,
          scaled by this component's coefficient
        → each copied line gets origin_parent_ahs_id set
```

Key decision: **nested_ahs unfolds at publish, not at parse**. Parser records the edge; publish resolves it once with full dependency ordering.

### 4.3 BoQ rows

`boq_items` unchanged. `ahs_version_id` points at the flattened version. Cost splits preserved via `cost_split` → existing downstream (cost roll-up, trade categorization, material aggregation) works without changes.

### 4.4 Rollback

Publish wrapped in a transaction (same as v1). On failure, staging stays exactly as it was; estimator edits in audit and retries. No partial publish.

If a published v2 import turns out wrong, delete the import session (cascade-deletes `ahs_versions` and `boq_items` via existing FK cascades) and re-run the XLSX through v1. Zero migration needed for rollback.

---

## Section 5 — Migration Plan

Each phase is independently shippable. If we stop at any phase the app still works.

### Phase 0 — Database migration (additive only)

Single SQL file `supabase/migrations/0NN_boq_parser_v2.sql`:
```sql
ALTER TABLE import_sessions
  ADD COLUMN parser_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN validation_report jsonb NULL,
  ADD COLUMN locked_by uuid NULL REFERENCES profiles(id),
  ADD COLUMN locked_at timestamptz NULL;

ALTER TABLE import_staging_rows
  ADD COLUMN cost_basis text NULL,
  ADD COLUMN parent_ahs_staging_id uuid NULL
    REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  ADD COLUMN ref_cells jsonb NULL,
  ADD COLUMN cost_split jsonb NULL;

CREATE TABLE import_staging_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_row_id uuid REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  import_session_id uuid REFERENCES import_sessions(id) ON DELETE CASCADE,
  edited_by uuid REFERENCES profiles(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  field_path text NOT NULL,
  old_value jsonb,
  new_value jsonb
);
CREATE INDEX idx_staging_edits_session ON import_staging_edits(import_session_id);

ALTER TABLE import_staging_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging_edits_assigned" ON import_staging_edits
  FOR ALL USING (
    import_session_id IN (
      SELECT id FROM import_sessions
      WHERE project_id IN (
        SELECT project_id FROM project_assignments
        WHERE user_id = auth.uid()
      )
    )
  );

ALTER TABLE ahs_lines
  ADD COLUMN origin_parent_ahs_id uuid NULL;
```

Zero breaking changes. Rollback = DROP the added columns/table.

### Phase 1 — Scaffold v2 parser (no wiring)

Create stub files:
- `tools/boqParserV2.ts` — exports `parseBoqV2()` stub
- `tools/publishBaselineV2.ts` — stub
- `tools/materialMatch.ts` — buildable, unit-testable in isolation
- `tools/types.ts` — additive updates for new staging columns

Ship as soon as it compiles. Zero behavior change.

### Phase 2 — Build v2 parser (no UI exposure)

Implement `parseBoqV2` top-to-bottom per Section 2. Test via hidden dev-only admin route "Parse XLSX with v2 (dry run)" dumping staging rows to a JSON preview without DB writes. Run against known fixtures (RAB R1 Pakuwon Indah AAL-5 + 1–2 others). Ship once dry-run output is verified.

### Phase 3 — Audit screen v2 rendering

Extend `auditPivot.ts` + `AuditTraceScreen.tsx` per Section 3:
- Trace chips
- Validation badges
- Inline-expanding edit panels (anchored under tapped card — hard rule)
- Fuzzy material matcher & picker
- Undo / edit history

Branch on `parser_version`. v1 rendering untouched. Ship once manually seeded v2 session renders correctly end-to-end.

### Phase 4 — Wire v2 into import flow (feature flag)

Toggle on import screen: "Parser version: v1 (stable) / v2 (beta)". Default v1. Visible to principal/admin roles only. Writes `import_sessions.parser_version` on session creation. Handler dispatches:
```ts
if (session.parser_version === 'v2') parseBoqV2(file);
else parseBoqV1(file);
```
Same dispatch on publish:
```ts
if (session.parser_version === 'v2') publishBaselineV2(sessionId);
else publishBaselineV1(sessionId);
```

### Phase 5 — Real-world trial

For the next 2–3 incoming projects, import each file twice — once v1 (official), once v2 (comparison). Compare published `ahs_lines` and `boq_items`: same totals? Same splits? Same line count after unfolding? Three clean matches = v2 ready as default.

### Phase 6 — Default v2, keep v1 as fallback

Flip toggle default from v1 to v2. v1 still available via toggle. No code removal.

### Phase 7 — Sunset v1 (≥4 weeks after Phase 6, zero fallbacks)

Only after 4+ weeks of clean v2 production use with no fallbacks to v1:
1. Remove toggle from import screen
2. Delete `tools/boqParser.ts` + `tools/publishBaseline.ts`
3. Delete v1 code branches in `auditPivot.ts` + `AuditTraceScreen.tsx`
4. Keep `parsed_data` / `raw_data` columns in `import_staging_rows` (historical v1 data)
5. Keep `parser_version` column permanently (read-only rendering of old sessions)

### Effort estimate

| Phase | Effort |
|---|---|
| 0 — Migration | 30 min |
| 1 — Scaffold | 1 hour |
| 2 — Build v2 parser | 2–3 days |
| 3 — Audit v2 rendering | 3–4 days |
| 4 — Wire import flow | 4 hours |
| 5 — Real-world trial | 1–2 weeks elapsed, minimal dev |
| 6 — Default flip | 15 min |
| 7 — Sunset v1 | 2–3 hours |

Active dev: ~1.5 weeks. Calendar time including trial: ~3–4 weeks.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| v2 produces wrong totals on unseen workbook | Phase 5 parallel-run catches it; toggle means instant v1 fallback |
| Migration locks the DB | All ADD COLUMN / CREATE TABLE / CREATE INDEX CONCURRENTLY — no long locks |
| Estimator confused by new audit UI | v1 rows render exactly as today; only v2 sessions show new affordances |
| Edit history table grows fast | One row per edit; typical session ≪100k rows; add cleanup only if needed |

---

## File layout

```
tools/
  boqParser.ts            ← untouched, v1
  boqParserV2.ts          ← new, ~500 lines
  publishBaseline.ts      ← untouched, v1
  publishBaselineV2.ts    ← new, ~300 lines
  materialMatch.ts        ← new, ~80 lines
  auditPivot.ts           ← v2 additions, non-breaking
  types.ts                ← additive type extensions
office/screens/
  AuditTraceScreen.tsx    ← v2 branches for trace chip, editing, badges
  ImportScreen (or equiv) ← parser version toggle (admin/principal only)
supabase/migrations/
  0NN_boq_parser_v2.sql   ← Phase 0 migration
```

## Open questions

None — all design questions resolved during brainstorming. Ready to hand off to the writing-plans skill for an implementation plan.
