# Rebar Disaggregator — Design Spec

**Date:** 2026-04-30
**Status:** Design approved, pending implementation plan
**Extends:** `tools/boqParserV2/recipeBuilder.ts` (post-pass after recipe build)

## Problem

The current BoQ parser correctly traces the formula chain from a structural BoQ row (Sloof, Balok, Kolom, Poer, Plat) into the `Analisa` sheet and produces a recipe that decomposes the cost into Beton + Bekisting + Besi (rebar) + Upah + Alat. The rebar component, however, comes out as a **single aggregate entry** — e.g. for Sloof S24-1: `"Pembesian U24 & U40" — 143.10 kg/m³ × Rp 10,442.50/kg`. The actual rebar split by diameter (D8 = 404.365 kg, D13 = 1,057.148 kg) lives in a different sheet (`REKAP Balok` row 267 in the Ernawati workbook) which the parser harvests but does not use.

For procurement and material aggregation by work-package, knowing the diameter-level split matters: a contractor needs to order `total D13 across all elements`, not `total kg of unspecified rebar`. The current output forces manual cross-referencing per element.

The formula evaluator can't simply be extended to read the diameter columns because the underlying Analisa block (`Pembesian U24 & U40`) uses `SUMIF` over rebar takeoffs in `REKAP Balok` / `Hasil-Kolom`, and the evaluator doesn't support `SUMIF` (returns 0 components with confidence 0.5).

## Goals

- Replace the single aggregate `besi` recipe component with N diameter-specific components per BoQ row, drawing diameter weights directly from `REKAP Balok`, `REKAP-PC`, `REKAP Plat`, and `Hasil-Kolom`.
- Preserve provenance: each emitted component points back to the exact REKAP cell it was sourced from, so downstream procurement views can group by origin sheet.
- Preserve cost conservation: sum of disaggregated component contributions ≈ original aggregate component contribution (within Rp 1).
- Stay additive: no changes to formula evaluator, Analisa-block detection, audit-UI render path beyond the new component shape, or staging-row schema.
- Skip silently when source data is missing: workbooks without REKAP sheets continue to work; BoQ rows without a matching REKAP row keep their aggregate component.

## Non-goals

- Extending the formula evaluator to handle `SUMIF`. Out of scope; targeted disaggregation is simpler and more reliable.
- Per-instance rebar accounting (e.g. per-floor or per-position). REKAP sheets aggregate by element type — this design uses that aggregate.
- Per-bar-role distinction in Kolom (stirrup vs main). For procurement, D10-stirrup and D10-main are combined into one `D10` component. Role information is preserved as nullable metadata for future use cases.
- Detecting rebar in non-rebar BoQ rows (e.g. preparation work, finishing). The disaggregator only fires when the existing recipe already contains a `besi`-style component.
- Rebar in workbooks that don't follow the REKAP pattern. Adapter selection is conservative — unknown layouts are skipped, not guessed.

---

## Section 1 — Architecture

A new module at `tools/boqParserV2/rebarDisaggregator/` (directory; see File Layout for breakdown) runs as a **post-pass** in the parser pipeline, after `recipeBuilder` and before `validate`:

```
parseBoqV2 pipeline (modified):

  harvest → catalog → blocks → extractBoqRows → recipeBuilder
                                                       │
                                                       ▼
                                             rebarDisaggregator (new)
                                                       │
                                                       ▼
                                                  validate → staging
```

Single responsibility: given the parser's harvested cells and BoQ rows with built recipes, produce a **modified `boqRows[]`** where qualifying rows have their rebar component replaced by diameter-specific components. Does not mutate harvested cells, formula evaluator state, Analisa blocks, or any other parser output.

The module's `index.ts` exports one function:

```typescript
export function disaggregateRebar(
  boqRows: BoqRowV2[],
  cells: HarvestedCell[],
  lookup: HarvestLookup,
): BoqRowV2[];
```

Pure transformation — same input always produces same output, no side effects.

Component matching for the rebar entry uses `component.name` first; falls back to `component.block?.title` if `name` doesn't match. Both compared against `/^Pembesian/i`.

---

## Section 2 — Sheet Adapters

Four adapters share a common interface, one per element family:

```typescript
interface RebarBreakdown {
  diameter: string;        // "D8", "D10", "D13", "D16", "D19", "D22", "D25"
  weightKg: number;        // total kg for this BoQ row
  sourceCell: string;      // e.g. "REKAP Balok!M267"
  role?: 'stirrup' | 'main';   // Kolom only; null for other adapters
}

interface RebarAdapter {
  name: string;                        // for logging
  sheetName: string;                   // e.g. "REKAP Balok"
  prefixPattern: RegExp;               // e.g. /^(Sloof|Balok)/i — matched against BoQ label
  lookupBreakdown(
    typeCode: string,                  // e.g. "S24-1"
    cells: HarvestedCell[],
  ): RebarBreakdown[] | null;          // null = type code not found
}
```

### 2.1 BalokSloof adapter

| Aspect | Value |
|---|---|
| Sheet | `REKAP Balok` |
| Label column | D |
| Diameter columns | L (D6), M (D8), N (D10), O (D13), P (D16), Q (D19), R (D22), S (D25) |
| Header rows | 263–264 |
| Data row range | 266–334 (workbook-specific; adapter scans column D for matching label, doesn't hard-code range) |
| Prefix pattern | `/^(Sloof|Balok)\s+(.+)$/i` |
| BoQ label examples | `"Sloof S24-1"`, `"Balok B23-1"`, `"- Balok B25-1"` (after strip-dash) |

### 2.2 Poer adapter

| Aspect | Value |
|---|---|
| Sheet | `REKAP-PC` |
| Label column | A |
| Diameter columns | H (D6), I (D8), J (D10), K (D13), L (D16), M (D19), N (D22), O (D25) |
| Header rows | 8–9 |
| Data row range | 11–22 (scan column A) |
| Prefix pattern | `/^Poer\s+(.+)$/i` |
| BoQ label examples | `"Poer PC.1"`, `"Poer PC.5"` |

### 2.3 Plat adapter

| Aspect | Value |
|---|---|
| Sheet | `REKAP Plat` |
| Label column | C |
| Diameter columns | N (D8), O (D10), P (D13), Q (D16), R (D19) — narrower than Balok/Poer |
| Header rows | 1–4 |
| Data row range | 6–55 |
| Prefix pattern | `/^Plat\s+(.+)$/i` |
| BoQ label examples | `"Plat S2"`, `"Plat S1"` |

Note: REKAP Plat does NOT have D6, D22, D25 columns. The adapter's diameter map omits those. If a workbook ever has plat rebar in those diameters, an unmapped weight stays in the aggregate (never disaggregated).

### 2.4 Kolom adapter

| Aspect | Value |
|---|---|
| Sheet | `Hasil-Kolom` |
| Label column | D |
| Stirrup diameter columns | H (D8 stirrup), I (D10 stirrup), J (D13 stirrup), K (D16 stirrup) |
| Main-bar diameter columns | L (D10 main), M (D13 main), N (D16 main), O (D19 main) |
| Header row | 147 |
| Data row range | 150–180 |
| Prefix pattern | `/^Kolom\s+(.+)$/i` |
| BoQ label examples | `"Kolom K24"`, `"Kolom KB2A"` |

Combination rule: D10 stirrup (column I) + D10 main (column L) = combined `D10` component (single emitted breakdown row). Same for D13 (J + M) and D16 (K + N). D8 (H) and D19 (O) appear in only one role each.

The adapter emits up to 5 distinct diameters: D8, D10, D13, D16, D19. The `role` field is left null since the components are combined.

### 2.5 Adapter dispatch

```typescript
const ADAPTERS: RebarAdapter[] = [
  balokSloofAdapter,
  poerAdapter,
  platAdapter,
  kolomAdapter,
];

function selectAdapter(label: string): { adapter: RebarAdapter; typeCode: string } | null {
  const cleaned = label.replace(/^[\s\-–—]+/, '').trim();
  for (const a of ADAPTERS) {
    const m = cleaned.match(a.prefixPattern);
    if (m) return { adapter: a, typeCode: m[1].trim() };
  }
  return null;
}
```

First match wins. Order is `balokSloof, poer, plat, kolom` — non-overlapping prefixes mean order doesn't actually matter, but kept consistent for readability.

---

## Section 3 — Component Transformation

Given a BoQ row with a built recipe, the disaggregator does:

```
1. Find the rebar component:
   - Iterate recipe.components
   - Match component.name (or component.block.title) against /^Pembesian/i
   - If no match, skip this BoQ row entirely
   - If multiple matches (rare), use the first

2. Resolve adapter & type code:
   - selectAdapter(boqRow.label) → { adapter, typeCode }
   - If null (no prefix match), skip

3. Look up REKAP breakdown:
   - adapter.lookupBreakdown(typeCode, cells) → RebarBreakdown[] | null
   - If null (type code not found in sheet), skip + log warning
   - If empty array (all diameters zero), skip + log warning

4. Validate sum:
   - aggregateKg = original_component.coef * boqRow.planned   (kg per m³ × volume)
   - disaggregatedKg = sum(b.weightKg for b in breakdown)
   - delta = aggregateKg - disaggregatedKg
   - if abs(delta) > max(1, aggregateKg * 0.001):  // 0.1% or Rp 1, whichever larger
     → attach validation_warning to BoQ row, but proceed with disaggregation
       (REKAP sheets are authoritative for diameter splits; aggregate may be stale)

5. Replace component:
   - Remove the original rebar component from recipe.components
   - For each non-zero breakdown b:
     emit component:
       lineType: 'material'
       name: `Besi ${b.diameter}`                  // e.g. "Besi D13"
       coef: b.weightKg / boqRow.planned           // kg per (BoQ unit, typically m³)
       coefUnit: 'kg/m3' (or whatever boqRow.unit is)
       unitPrice: original_component.unitPrice    // same Rp/kg from Pembesian block
       contribution: b.weightKg * unitPrice / boqRow.planned   // per-unit Rp
       source: b.sourceCell                       // e.g. "REKAP Balok!M267"
       block: original_component.block            // preserve link to Pembesian block
       disaggregatedFrom: original_component.name // "Pembesian U24 & U40"
       role: b.role                               // null for non-Kolom; preserved for Kolom

6. Return modified BoqRowV2[].
```

Conservation invariant: total recipe `Rp/m³` (sum of all component contributions) must remain unchanged after transformation, within Rp 1. Validated in tests.

---

## Section 4 — Edge Cases

| Case | Handling |
|---|---|
| BoQ label has no element prefix (`"Pasangan bata"`) | `selectAdapter` returns null → skip silently |
| Adapter selected but type code not found in REKAP sheet | Log warning `"Type {typeCode} not found in {sheetName}"` → skip; aggregate component remains |
| Recipe has no `besi`-named component | Step 1 fails → skip; recipe untouched |
| All disaggregated diameters are zero | Skip + log warning; keep aggregate component (likely workbook authoring issue) |
| Aggregate-vs-disaggregated kg mismatch >0.1% | Disaggregate anyway, attach `validation_warning` to BoQ row |
| Workbook has no `REKAP Balok` (or other adapter sheet) | Adapter's `lookupBreakdown` returns null on every call → all matching BoQ rows pass through untouched |
| Two BoQ rows match the same REKAP row | Each gets independent disaggregation pulling from same source; correct since REKAP totals are per-type-aggregate |
| `Hasil-Kolom` row range varies per workbook | Adapter scans column D in rows 145–250 for label match; no hard-coded row numbers |
| Type code in REKAP sheet is a formula (e.g. `=B5`) | Use cached `.v` value; behaves as the resolved string |
| Diameter weight cell is empty / null | Treated as 0; produces no component for that diameter |
| Prefix is wrapped in extra whitespace / Unicode dashes | `selectAdapter` strips leading `[\s\-–—]+` first |
| BoQ label has trailing extra info (e.g. `"Kolom K24 lantai 1"`) | `match[1]` captures only `"K24 lantai 1"` — REKAP lookup will fail; aggregate stays. Workbook-author convention should match REKAP exactly |

The disaggregator is **conservative by default**: when in doubt, leave the recipe unchanged. The user always sees at least the aggregate component; never less information than today.

---

## Section 5 — Testing & Rollout

### 5.1 Test fixtures

Use existing real workbooks under `assets/BOQ/`:
- `RAB ERNAWATI edit.xlsx` — primary; has Sloof, Balok, Kolom, Poer with rebar
- `RAB R1 Pakuwon Indah AAL-5.xlsx` — regression
- `RAB R2 Pakuwon Indah PD3 no. 23.xlsx` — regression
- `RAB Nusa Golf I4 no. 29_R3.xlsx` — regression

### 5.2 Unit tests (per adapter)

Each adapter file gets a test file. Cases per adapter:

```
balokSloofAdapter.test.ts
  ✓ matches "Sloof S24-1" prefix → typeCode "S24-1"
  ✓ matches "Balok B23-1" prefix → typeCode "B23-1"
  ✓ ignores leading dashes "  - Sloof S24-1"
  ✓ returns 2 breakdowns for S24-1 (D8=404.365, D13=1057.148; others zero)
  ✓ returns null for missing type code "S99-99"
  ✓ returns null when REKAP Balok sheet absent
```

Plat adapter: omit D6/D22/D25 cases. Kolom adapter: explicit "D10 stirrup + main combine into single D10" test. Poer adapter: standard cases for PC.1, PC.5.

### 5.3 Integration tests

`rebarDisaggregator.integration.test.ts`:

```
✓ Sloof S24-1: original 1 besi component → 2 components (Besi D8, Besi D13)
  - Each carries source: "REKAP Balok!M267" / "REKAP Balok!O267"
  - Each carries disaggregatedFrom: "Pembesian U24 & U40"
  - Sum of contributions matches original within Rp 1
  - Total recipe perUnit cost unchanged

✓ Kolom K24: D10 stirrup + D10 main combine into single D10 component

✓ Poer PC.1: Beton/Bekisting components untouched, only besi disaggregated

✓ BoQ row "Pasangan bata" (no element prefix): recipe untouched

✓ BoQ row whose Sloof type doesn't exist in REKAP: aggregate kept, warning attached
```

### 5.4 Snapshot regression

Update existing `parseBoqV2.snapshot.test.ts` (if exists on main; otherwise create) to include a new fixture for Ernawati. Expected delta after this change:
- Sloof/Balok/Kolom/Poer/Plat rows that previously had 1 besi component now have N (2-5) diameter components
- Total cost per BoQ row: identical (within Rp 1)
- Other recipe components: untouched

Snapshot delta on AAL-5/PD3/Nusa Golf: only rebar component count changes; all totals match. Any unrelated drift is a regression.

### 5.5 Rollout

No feature flag. The transformation is additive (more components, identical totals). Audit UI renders new components automatically using existing recipe-component code paths. If any consumer breaks, snapshot test catches it.

### 5.6 Effort estimate

| Phase | Effort |
|---|---|
| 4 adapters + dispatcher | 1 day |
| Recipe transformer + validation | 0.5 day |
| Unit + integration tests | 0.5 day |
| Snapshot regen + spot-check on 4 workbooks | 0.5 day |
| **Total** | **~2.5 days** |

### 5.7 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Workbook deviates from REKAP layout assumptions | Adapter scans flexibly (column D for label, doesn't hard-code rows); falls through to aggregate on lookup miss |
| Workbook uses different rebar AHS block name (not "Pembesian U24 & U40") | Component-match regex `/^Pembesian/i` is broad; if the block uses an entirely different naming, disaggregator silently doesn't fire and aggregate stays — safe degradation |
| Kolom stirrup/main combination produces wrong total | Conservation check at step 4 catches >0.1% drift, attaches validation_warning |
| New component schema breaks audit UI | `disaggregatedFrom` and `role` are new optional fields; existing UI ignores unknown fields; spot-check on local audit screen post-merge |
| Future workbooks with new element types (e.g. retaining wall) | Adapter list is a const array — adding a new adapter is a single import + 1 line; no breaking change |

---

## File Layout

```
tools/boqParserV2/
  rebarDisaggregator/
    index.ts                ← exports disaggregateRebar()
    types.ts                ← RebarBreakdown, RebarAdapter interfaces
    selectAdapter.ts        ← prefix-match dispatcher
    adapters/
      balokSloof.ts         ← REKAP Balok adapter
      poer.ts               ← REKAP-PC adapter
      plat.ts               ← REKAP Plat adapter
      kolom.ts              ← Hasil-Kolom adapter (with stirrup+main combination)
    transformRecipe.ts      ← given a BoqRowV2 + breakdown, produce modified recipe
  index.ts                  ← parser entry; hooks rebarDisaggregator post-recipeBuilder

  __tests__/
    rebarDisaggregator/
      balokSloofAdapter.test.ts
      poerAdapter.test.ts
      platAdapter.test.ts
      kolomAdapter.test.ts
      selectAdapter.test.ts
      transformRecipe.test.ts
    rebarDisaggregator.integration.test.ts
    parseBoqV2.snapshot.test.ts (updated)
```

Total new code: ~400 LOC source + ~400 LOC test.

## Open questions

None blocking. Workbook layout for `Hasil-Kolom` rows 150–180 was confirmed in investigation; adapter implementation is straightforward.
