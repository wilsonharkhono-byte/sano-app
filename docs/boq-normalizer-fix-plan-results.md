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

---

## 2026-05-26 — formula-driven REKAP-row resolver

Following commits in scope:
- `(HEAD)` — fix(parser): formula-driven REKAP-row resolution in rebar disaggregator

Run results (now four reference workbooks; ERNAWATI promoted to the
pinned set since the fix exposed it):

```
=== RAB R1 Pakuwon Indah AAL-5.xlsx ===
  ✓ itemized:      144  (per-material detail)
  ~ rolled:        15  (5-line group lumps from RAB columns)
  • direct-ref:    5   (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0

=== RAB R2 Pakuwon Indah PD3 no. 23.xlsx ===
  ✓ itemized:      214  (per-material detail)
  ~ rolled:        15  (5-line group lumps from RAB columns)
  • direct-ref:    12  (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0

=== RAB Nusa Golf I4 no. 29_R3.xlsx ===
  ✓ itemized:      245  (per-material detail)
  ~ rolled:        77  (5-line group lumps from RAB columns)
  • direct-ref:    17  (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0

=== RAB ERNAWATI edit.xlsx ===
  ✓ itemized:      58  (per-material detail)
  ~ rolled:        51  (5-line group lumps from RAB columns)
  • direct-ref:    9   (recipe-derived lumps for masonry / pile / custom)
Unresolved:        0
```

### Aggregate

| Workbook | Itemized | Rolled | Direct-ref | Unresolved | Total | Rp coverage | Material coverage |
|---|---|---|---|---|---|---|---|
| AAL-5    | 144 |  15 |  5 | 0 | 164 | 100% | **87.8%** |
| PD3-23   | 214 |  15 | 12 | 0 | 241 | 100% | **88.8%** |
| I4-29    | 245 |  77 | 17 | 0 | 339 | 100% | **72.3%** |
| ERNAWATI |  58 |  51 |  9 | 0 | 118 | 100% | **49.2%** |
| **All four** | **661** | **158** | **43** | **0** | **862** | **100%** | **76.7%** |

Material coverage tripled (26.3% → 76.7%). Itemized row count rose
196 → 661 (+465 rows) across the now-four reference workbooks.

Test count: 225 (43 suites). All green.

### Root cause

The rebar disaggregator used label-search to find a REKAP row for each
BoQ row's element type (e.g., "B24-1" → first REKAP Balok row in
column D containing "B24-1"). When REKAP has **one summary row per
floor** for the same element type — as in ERNAWATI (Lantai 1/2/3 each
get their own "B24-1" entry), PD3, and I4 — the search always picked
the first floor's row, applying its diameter weights to every floor's
BoQ row. That made the Pembesian per-diameter components short of
the actual `Z×AA` total by 70–90%, the itemized variance check failed
(>1 Rp), and the row fell back to rolled.

### Fix

`tools/boqParserV2/rebarDisaggregator/resolveRekapRow.ts` reads the BoQ
row's column-Z formula directly (e.g., `='REKAP Balok'!X291` for
ERNAWATI IV.A.2.3 Balok B24-1 Lantai 2) and extracts the row number.
All four adapters (`balokSloof`, `plat`, `poer`, `kolom`) now accept
an optional `LookupHint.rekapRow` and use it when provided, falling
back to label-search only when the formula doesn't cite the expected
REKAP sheet.

### Notes

- AAL-5's old label-search "worked" by accident: REKAP entries for
  every element type happened to be single-row (one floor's data
  reused across all floor BoQ rows). The fix found 70 additional
  AAL-5 rows that the workbook's formulas actually distinguished by
  floor — those went from rolled lump to itemized per-material.
- PD3 went from 76 itemized → 214 (+138). I4 went from 46 → 245
  (+199). These were the rows that always had per-floor REKAP entries
  but the label-search collapsed them.
- Truth-correctness contract intact: every newly-itemized row still
  reconciles to source within ±1 Rp by construction.
- The remaining rolled rows (158 across all four workbooks) are
  structural rows where the row uses a different bekisting cycle, a
  different pembesian price, or some other unmodeled variation — they
  reconcile by Rp but don't have per-material detail yet.
