# Material Rollup for Procurement — Design

> Goal: when the field supervisor requests material, the totals should roll up
> into a **larger procurement block** — e.g. *"III.A.4 — Kolom Lantai 1"* that
> compiles every column type on floor 1 into one orderable material list, so
> purchasing orders in bulk instead of line-by-line.
> Date: 2026-06-13. Status: **design** (no code written yet).

---

## 1. The core idea

Every structural bullet already carries a hierarchical code
(`III.A.3.2.1`, `III.A.3.2.2`, …) and a per-material breakdown (readymix m³,
multipleks m², besi D8/D10/D13 kg, bendrat kg, …). A rollup is just:

1. **Group** bullets by a procurement key.
2. **Sum** each material's `qty_per_m³ × volume` across the group, by `(material, unit)`.
3. **Refuse to sum** any bullet whose breakdown hasn't reconciled — list it aside.

Step 3 is not optional. It is the whole reason this is trustworthy (see §5).

## 2. The grouping key (validated against the Sonny workbook)

Drop the final (bullet) segment of the code. The remaining prefix **is** the
procurement block, and its label is the bullet's `sub_chapter`.

```
III.A.3.2.1  Kolom K174  ┐
III.A.3.2.2  Kolom K212  ├─►  group  III.A.3.2  "Kolom Lantai 1"
...                      ┘
```

Measured on `SANO Sonny Citraland Selat Golf.xlsx`:

| Group | Label | Bullets | Total vol | Recipe OK |
|---|---|---|---|---|
| `III.A.3.1` | Kolom Elevasi -0.80 | 7 | 3.40 m³ | 0 / 7 |
| `III.A.3.2` | Kolom Lantai 1 | 14 | 42.70 m³ | 0 / 14 |
| `III.A.4` | **"Kolom Lantai 1"** ⚠ (actually Plat) | 3 | 117.09 m³ | 0 / 3 |
| `III.A.5` | **"Kolom Lantai 1"** ⚠ (actually Dinding) | 6 | 90.27 m³ | 0 / 6 |

The grouping is correct. Two problems block a *useful* rollup today, both
pre-existing bugs, neither caused by the rollup itself.

## 3. Blocker A — wrong group labels (must fix first)

`III.A.4` and `III.A.5` inherit the stale label **"Kolom Lantai 1"** from the
previous numbered item, even though they hold *Plat lantai* and *Dinding*. A
procurement block titled "Kolom Lantai 1" that emits slab rebar is exactly the
kind of wrong-PO error the system exists to prevent.

Cause: in `extractBoqRows`, the numeric-item branch sets `itemCounter` but never
refreshes `subChapterLabel`:

```ts
// tools/boqParserV2/extractTakeoffs.ts  (numeric col-A item branch)
if (/^\d+$/.test(aText)) {
  itemCounter = parseInt(aText, 10);
  itemSubgroupCounter = 0;
  subItemCounter = 0;
  subChapterLabel = label;   // ← ADD THIS: use the item's own title
  continue;
}
```

Named decorators ("Kolom Lantai 1", "Sloof Elevasi -0.80") still override it
afterward, so item-3's subgroups keep their specific names while item-4/5 get
their real titles ("Plat lantai…", "Dinding…"). **Re-run the `extractTakeoffs`
and `recipeSnapshot` snapshots** — AAL-5 VII numeric items will gain a populated
`sub_chapter`, which is correct but will move snapshots.

## 4. Blocker B — breakdowns don't reconcile (SUMIF + Kolom)

`recipeOK = 0` across all Kolom groups: every bullet has at least one component
with a zeroed/empty quantity, from two known causes —

- **SUMIF → 0** (`formulaEval/evaluate.ts:190` implements only `SUM`).
- **Kolom bekisting/variance** (field guide §6.2).

Until these reconcile, the rollup can group the rows but **cannot honestly total
their materials** — it would have to exclude all of them. So SUMIF is a hard
prerequisite for a usable Kolom/Plat/Dinding material order. (Balok floors
IV.A.2.* reconcile and *can* roll up today.)

## 5. The truth-correctness contract applied to rollups

A procurement total feeds a real purchase order. A wrong total means over-order
(waste) or shortage (site stoppage). Therefore:

- **Only reconciled bullets are summed.** A bullet counts only if its breakdown
  closed to ±1 Rp against the source unit cost.
- **Unreconciled bullets are listed, never summed.** The rollup shows a
  `Needs review` section with each excluded bullet, its variance, and the
  reason. The headline total is explicitly *"materials for the N of M bullets
  that reconciled."*
- **No blended fake units.** Aggregate strictly by `(material_name, unit)`.
  Don't coerce "lembar" and "m²" into one number; convert only via an explicit,
  catalogued factor.

## 6. Aggregation math

For procurement key *G* with reconciled bullets *b ∈ G*:

```
total_qty[material, unit] = Σ_b  ( qty_per_m³[b, material] × volume[b] )
order_qty[material]       = ceil( total_qty / catalog.pack_size )   // optional
```

`qty_per_m³` and `volume` come straight from the verified breakdown sheets
(`breakdownSheetReader`). `pack_size` / `supplier_unit` come from
`material_catalog` (besi per 12 m batang, multipleks per 1.22×2.44 lembar,
readymix per m³, etc.) so the output is directly orderable.

## 7. Where it surfaces

1. **In-app "Procurement Rollup" view** — list of groups; expand a group to see
   per-material totals + the `Needs review` exclusions. Filter by floor/chapter.
2. **Export (XLSX Material Take-Off)** — one sheet per group, plus a combined
   "Order list" sheet keyed by supplier unit. (`assets/BOQ/SANO_MaterialTakeoff_AAL5.xlsx`
   is prior art for the layout.)

## 8. Implementation sketch

- **No schema change required to start.** Derive the rollup at read time:
  `rollup_group = code.split('.').slice(0, -1).join('.')`, label = `sub_chapter`,
  aggregate over `ahs_lines` / breakdown components joined to `boq_items`.
- Add a pure, testable `rollupMaterials(rows): RollupGroup[]` in `tools/` that
  takes parsed/breakdown rows and returns `{ key, label, totals[], excluded[] }`.
  Unit-test it the way `findDuplicateBoqCodes` is tested.
- Surface via a new screen/component; reuse `RecipeView` patterns.

## 9. Sequencing (recommended)

1. **Blocker A** (label fix) — 1 line + snapshot refresh.
2. **Blocker B** (SUMIF in evaluator + route residual zeros to Unresolved).
3. `rollupMaterials()` pure function + tests (works for Balok immediately).
4. In-app view + XLSX export.

Steps 3–4 can start against the Balok floors (already reconciling) in parallel
with 2; Kolom/Plat/Dinding totals light up once 2 lands.

## 10. Open decisions (need your call)

- **Group granularity.** Subgroup level (`III.A.3.2` = "Kolom Lantai 1") as
  proposed, or a coarser floor level (all of `III.A.*` for floor 1)? Procurement
  usually orders rebar/readymix per pour, which maps to the subgroup level — but
  confirm against how your mandors actually request.
- **Cross-floor consolidation.** Should one PO combine the same material across
  floors (all besi D13 in the tower), or stay per-block? Affects the export's
  "Order list" sheet.
- **Waste/rounding policy.** Round up to supplier pack size per block, or sum
  raw then round once at the PO? Rounding per block over-orders slightly but is
  simpler on site.
