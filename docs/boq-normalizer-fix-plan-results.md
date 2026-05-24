# BoQ Normalizer — Fix Plan Results

> Append-only log of CLI runs against the three reference workbooks.
> Each run is dated, headed with the HEAD commit, and shows the final
> 4-line summary block from `npm run normalize:boq:det`. Reconcile
> against `docs/boq-normalizer-field-guide.md` §13 — any drift means
> the field guide is stale, not the run.

---

## 2026-05-25 — HEAD `6e74dcb` (layout-aware REKAP adapters + Poer phantom fix landed)

Following commits in scope:
- `6e74dcb` — fix(normalizer): layout-aware REKAP adapters + Poer D8 phantom fix
- `6f798c0` — feat(normalizer): itemized wire-mesh (AC*AD) component
- `a5137ca` — fix(normalizer): cycleFactor float + single-cycle Bata/Batako bekisting

```
=== RAB R1 Pakuwon Indah AAL-5.xlsx ===
  ✓ itemized:  74  (per-material detail)
  ~ rolled:    85  (5-line group lumps from RAB columns)
Unresolved:       5

=== RAB R2 Pakuwon Indah PD3 no. 23.xlsx ===
  ✓ itemized:  49  (per-material detail)
  ~ rolled:    180  (5-line group lumps from RAB columns)
Unresolved:       12

=== RAB Nusa Golf I4 no. 29_R3.xlsx ===
  ✓ itemized:  17  (per-material detail)
  ~ rolled:    305  (5-line group lumps from RAB columns)
Unresolved:       17
```

### Aggregate

| Workbook | Itemized | Rolled | Unresolved | Total | Rp coverage | Material coverage |
|---|---|---|---|---|---|---|
| AAL-5    |  74 |  85 |  5 | 164 | 96.9% | **45.1%** |
| PD3-23   |  49 | 180 | 12 | 241 | 95.0% | **20.3%** |
| I4-29    |  17 | 305 | 17 | 339 | 95.0% |  **5.0%** |
| **All three** | **140** | **570** | **34** | **744** | **95.4%** | **18.8%** |

Matches field guide §13 table exactly as of this commit.

Test count: 212 (41 suites). All green.

### Notes

- The rolled tier carries 570 of 744 rows. The next lever — H-side
  bekisting extraction (fix plan §2.1) — should jump PD3 from 49 → ~145
  and I4-29 from 17 → ~200 (Balok+Plat row counts that currently fail
  ±1 Rp by exactly `V*X`). AAL-5 itemized should be unchanged (X = 0).

- The on-disk `assets/BOQ/*_normalized.xlsx` files were regenerated on
  this run and now match the field guide table.

---

## 2026-05-25 — HEAD `98648e6` then `(this commit)` (direct-reference tier landed)

Following commits in scope (since last entry):
- `cbcfa36` — feat(normalizer): H-side bekisting sub-item extraction (§2.1)
- `98648e6` — test(normalizer): pin per-workbook counts + variance gate (§1.3)
- `(HEAD)` — feat(normalizer): direct-reference tier for masonry / pile / custom (§2.2)

```
=== RAB R1 Pakuwon Indah AAL-5.xlsx ===
  ✓ itemized:      74  (per-material detail)
  ~ rolled:        85  (5-line group lumps from RAB columns)
  • direct-ref:    5   (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0

=== RAB R2 Pakuwon Indah PD3 no. 23.xlsx ===
  ✓ itemized:      76  (per-material detail)
  ~ rolled:        153 (5-line group lumps from RAB columns)
  • direct-ref:    12  (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0

=== RAB Nusa Golf I4 no. 29_R3.xlsx ===
  ✓ itemized:      46  (per-material detail)
  ~ rolled:        276 (5-line group lumps from RAB columns)
  • direct-ref:    17  (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0
```

### Aggregate

| Workbook | Itemized | Rolled | Direct-ref | Unresolved | Total | Rp coverage | Material coverage |
|---|---|---|---|---|---|---|---|
| AAL-5    |  74 |  85 |  5 | 0 | 164 | 100% | **45.1%** |
| PD3-23   |  76 | 153 | 12 | 0 | 241 | 100% | **31.5%** |
| I4-29    |  46 | 276 | 17 | 0 | 339 | 100% | **13.6%** |
| **All three** | **196** | **514** | **34** | **0** | **744** | **100%** | **26.3%** |

Matches field guide §13 table exactly as of this commit.

Test count: 216 (42 suites). All green. Regression test pins all four
counts per workbook + asserts `|variance| ≤ 1 Rp` on every breakdown.

### Notes

- Rp coverage is now at the ceiling (100%). No row is silently dropped
  to the Unresolved sheet across the three reference workbooks.

- Material coverage is unchanged at 26.3% — the direct-ref tier is a
  lump fallback, not a per-material upgrade. Lifting it further requires
  itemizing the rolled tier's structural rows (PD3 Plat/Kolom variants,
  I4-29 plat reinforcement paths), which is the next backlog item.

- Implementation is simpler than the fix plan estimated. The
  `pickDominantReferencedBlock` heuristic wasn't needed: emit one lump
  per `row.recipe.components[i]`, group by `lineType`, sum reconciles
  by construction. ~75 lines added in `cli-deterministic.ts`.
