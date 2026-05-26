# BoQ Normalizer — Field Guide

> A working document for any AI (or developer) picking up the BoQ Recipe Detail
> Normalizer cold. It captures the goal, the workbook anatomy, the math that
> reconciles, what works today, and the unresolved patterns waiting for the
> next iteration.

---

## 1. The goal (read this first)

We translate Indonesian RAB construction workbooks into **per-material breakdown
sheets** so the SANO app can show estimators exactly how much Multipleks, Usuk,
Besi D8, Bendrat, etc. each BoQ row consumes — instead of just one rolled-up
"Bekisting Balok Rp 251,113/m²" line.

**The output is a set of "Breakdown {code}" sheets** appended to the workbook.
Each sheet lists every component (material, labor, equipment) for one BoQ row,
with its `qty_per_m³`, `unit_price`, and `total cost`. Format is the same as
the manually-authored `Breakdown IV.A.2.7` in
`assets/BOQ/RAB R1 Pakuwon Indah AAL-5_Claude Override.xlsx` — that file is the
canonical reference. Open it and read the structure end-to-end before doing
anything else.

### 1.1 Truth-correctness contract (non-negotiable)

> **If a breakdown does not reconcile to the source unit cost within ±1 Rp, do
> NOT write it.** Put the row in an "Unresolved" sheet with the variance + a
> reason. No fake-correct numbers ever reach the workbook.

This rule exists because earlier iterations of the normalizer would silently
emit breakdowns with `⚠ MISMATCH` labels but realistic-looking numbers, which
fooled both the SANO audit aggregation and human reviewers. **Wrong numbers
are worse than absent numbers.** Always prefer "this row needs manual review"
over "here's a confident-looking total that's actually off by Rp 4,000,000".

### 1.2 Why this is hard

Indonesian RAB workbooks pack a lot of variation. Validated against three
workbooks (AAL-5, PD3-23, I4-29 — see §13), the variations include:

- **Per-contractor column conventions.** AAL-5 uses cols R/S/T (concrete),
  V/W (bekisting), Z/AA (pembesian). PD3 and I4-29 ADD col X (Perancah
  embedded in bekisting), AC/AD (wire mesh for plat), L (Subkon), M (Prelim).
- **Multi-sheet RAB layouts.** AAL-5 has one `RAB (A)` sheet. I4-29 has
  `RAB (A..E)` — one sheet per building with structural data in B..E.
- **Per-element Pengecoran blocks.** The same element (e.g., Balok B24-1)
  appears in 3+ chapters with different Pengecoran blocks per floor (lt
  atas / lt dasar / lt bawah have different upah and equipment costs).
- **Per-element Bekisting sub-items.** Balok has Multipleks + 2 Usuk + Paku
  + Form oil; Plat has a different mix; Kolom has yet another.
- **Cycle factors are workbook-specific** and not always integers. AAL-5
  uses 4/6/9; PD3 uses 4.56/5.76/5.76.
- **Single-cycle vs cyclic bekisting**. Cyclic blocks have `Jumlah` →
  `Harga per m²` (cycle factor = Jumlah/Harga). Single-cycle (Bata/Batako
  for Poer/Sloof) skip the `Harga per m²` row.
- **Pengecoran sub-item count varies.** AAL-5 has 3 sub-items per concrete
  block (readymix + sewa + upah). I4-29 has 4 (vibrator and pump split).
- **Pembesian unit prices are workbook-specific.** AAL-5: 9000/100/17500
  Rp/kg. I4-29: 10000/varies/varies.
- **REKAP sheets** carry per-row rebar diameter weights, not per-element.
  Each BoQ row reads its own REKAP row. REKAP column layouts also vary per
  workbook (see §6.6).

The truth-correctness contract holds via the **column-sum invariant**: the
workbook's own arithmetic gives the at-cost unit price as a sum of
pre-computed column products (see §4.0). When in doubt about an itemized
breakdown, fall back to a rolled lump per column — it reconciles by
construction.

A purely deterministic approach for itemized breakdowns captures clean
patterns but breaks on edge cases. The rolled-tier fallback (see §5) covers
~95% of structural rows across all three reference workbooks. A purely
LLM-driven approach handles edge cases but is expensive and slow. The
recommended architecture is **deterministic-first, LLM-fallback** (see §9).

---

## 2. Workbook anatomy

A standard SANO BoQ workbook has these sheets:

| Sheet | Purpose |
|---|---|
| `RAB (A)` | The BoQ — rows of items the contractor will deliver. Each row has volume (col D), unit price (E), at-cost columns (N, O), and **pre-computed component cost columns** R/S/T (concrete material / labor / equip per m³), V/W (bekisting ratio m²/m³ / cost per m²), Z/AA (pembesian kg/m³ / blended price per kg). |
| `Analisa` | The AHS (Analisa Harga Satuan) library — per-element/per-block recipes. |
| `REKAP Balok` | Per-row rebar diameter weights for Balok elements. Cols D=label, L=D6, M=D8, N=D10, O=D13, P=D16, Q=D19, R=D22, S=D25. |
| `REKAP-PC`, `Hasil-Kolom`, `REKAP Plat` | Same shape, for Poer/Kolom/Plat. |
| `Material`, `Upah` | Catalog sheets for material/labor reference prices. |
| `Sheet1`, `COVER` | Project metadata. |

### 2.1 The Analisa sheet — block structure

Each "block" represents one AHS recipe. Detected by `tools/boqParserV2/detectBlocks.ts`. A block has:

- **Title row**: matches `TITLE_UNIT_RE` (`^N <unit> <description>` like
  `"1 m2 Bekisting Bata Merah"`) OR `TITLE_WORK_RE` (verb-style like
  `"Pekerjaan Persiapan"`, `"Pasangan Bata"`, `"Pengecoran ..."`, `"Pembesian"`,
  `"Bekisting"`).
- **Component rows**: between title row and Jumlah row. Each component has
  qty (col B), unit (C), name (D), unit price (E), and may have totals in
  col F (material), G (labor), H (equipment).
- **Jumlah row**: ends the block. Sums the component totals.
- **Harga per ... row** (optional, after Jumlah): per-unit price for blocks
  with reuse cycles (bekisting). Computed as `Jumlah / cycle_factor`.

### 2.2 Concrete blocks (`Pengecoran Beton`)

For AAL-5 there are 7 concrete blocks:

```
Row 77-82:   Pengecoran Beton Readymix (KHUSUS POER)            F=1,232,100  G=800,000   H=75,000
Row 84-89:   Pengecoran Beton Readymix (KHUSUS SLOOF)           F=1,232,100  G=1,500,000 H=60,000
Row 91-96:   Pengecoran Beton Readymix (KHUSUS KOLOM RATA-RATA) F=1,078,087  G=1,750,000 H=250,000
Row 98-103:  Pengecoran Beton Readymix (KHUSUS BALOK LT. ATAS)  F=1,095,570  G=1,500,000 H=75,000
Row 105-110: Pengecoran Beton Readymix (KHUSUS PLAT LT. DASAR)  F=1,078,087  G=800,000   H=60,000
Row 112-117: Pengecoran Beton Readymix (KHUSUS PLAT LT. ATAS)   F=1,095,570  G=1,000,000 H=75,000
Row 119-124: Pengecoran Beton Readymix (KHUSUS DINDING BETON)   F=1,078,087  G=1,300,000 H=200,000
```

Each block has **3 sub-items** in this order:

1. **Beton readymix K-350** (material, col F) — qty 1.05 (waste-inclusive), unit price varies by block.
2. **Sewa peralatan, termasuk vibrator dan pump** (equipment, col H) — qty 1.0, price varies.
3. **Upah cor, besi, bekisting borongan** (labor, col G) — qty 1.0, price varies.

A BoQ row's pre-computed R/S/T columns (in `RAB (A)`) carry the same 3 values,
so you can **identify which Pengecoran block a row used** by matching
`RAB!R{row} == Analisa!F{jumlah_row}`, etc.

### 2.3 Bekisting blocks

For AAL-5 there are 7 bekisting blocks:

```
Row 13-19:   1 m2 Bekisting Bata Merah untuk Poer dan Sloof (campuran 1:4)
Row 21-27:   1 m2 Bekisting Batako POSISI BERDIRI untuk Poer dan Sloof
Row 29-35:   1 m2 Bekisting Batako POSISI TIDUR untuk Poer dan Sloof
Row 36-43:   Bekisting Kolom                  Harga per m²=116,217  cycle=9
Row 46-54:   Bekisting Balok                  Harga per m²=251,113  cycle=4
Row 57-64:   Bekisting plat                   Harga per m²=86,302   cycle=6
Row 67-73:   Bekisting dinding beton          Harga per m²=94,566   cycle=6
```

**Two distinct shapes**:

- **Cycle-based** (Kolom, Balok, Plat, Dinding beton): block has `Jumlah` row
  followed by `Harga per m²` row. Cycle factor = `Jumlah / Harga per m²`,
  typically a small integer (4-9). The reuse model: forms are used N cycles
  before being discarded, so per-cycle cost is `total_per_m² / N`.

- **Single-cycle** (Bata/Batako Poer/Sloof): block ends with `Jumlah` only,
  no `Harga per m²` row. Treat as cycle=1; the Jumlah is the per-m² cost.
  Caveat: in AAL-5 the `Jumlah` row may have value in col I (grand total)
  rather than col F — check both before deciding the cost.

A BoQ row's pre-computed `RAB!W{row}` carries the per-m² cost of whichever
bekisting block was used for that row, and `RAB!V{row}` is the m²-of-form
per-m³-of-beton ratio (typically 5-15).

### 2.4 The single Pembesian block

There's only one Pembesian block at `Analisa!127..132` (in AAL-5):

```
Row 127: Pembesian U24 & U40
Row 128: 1.05 kg | Besi beton           | 9000  | 9450
Row 129: 1.00 kg | Beton decking        | 100   | 100
Row 130: 0.021 kg| Bendrat              | 17500 | 367.5
Row 132: Jumlah  9917.5
```

The block models "to produce 1 kg of finished reinforcement, consume:"

- 1.05 kg raw rebar (5% waste)
- 1.0 kg-eq beton decking (1:1 with rebar)
- 0.021 kg bendrat (kawat ikat) — note: **0.021, NOT 0.02**

The "9917.5" is the **blended per-kg price**: `1.05×9000 + 1.00×100 + 0.021×17500`.

A BoQ row's `RAB!AA{row}` carries this blended price; `RAB!Z{row}` carries the
total kg/m³ of finished rebar for that row.

### 2.5 REKAP sheets — per-row rebar diameters

For each BoQ row, the REKAP sheet has ONE row listing the kg of each rebar
diameter used. Columns:

```
D = element label (e.g., "B24-1", "PC.5", "K177-1")
L = D6 (mm) weight in kg
M = D8 weight in kg
N = D10 weight in kg
O = D13 weight in kg
P = D16 weight in kg
Q = D19 weight in kg
R = D22 weight in kg
S = D25 weight in kg
```

For IV.A.2.7 (Balok B24-1, volume 0.2646 m³), REKAP Balok row 369:
- M369 = 19.91 kg total D8 → per-m³ = 19.91/0.2646 = **75.26 kg/m³**
- O369 = 24.32 kg total D13 → per-m³ = 24.32/0.2646 = **91.92 kg/m³**

`tools/boqParserV2/rebarDisaggregator/` already extracts these and attaches
them as recipe components named `"Besi D8"`, `"Besi D13"`, etc. with
`quantityPerUnit` in kg per m³. **Reuse this — don't re-read REKAP yourself.**

---

## 3. The target breakdown format

Every Breakdown sheet must match the schema in
`tools/boqParserV2/breakdownSheetReader.types.ts` — that's what the SANO parser
reads. The canonical example is `Breakdown IV.A.2.7` in the `_Claude Override`
workbook. Open it and study the columns:

| No | Component group | Material/Item | Spec/Note | Qty per native unit | Native unit | Native basis | Unit price (Rp) | Qty per m³ | Cost per m³ | Total qty (× vol) | Total cost |

Component groups for structural concrete rows (in order):

1. `BETON READYMIX (Material)` — the readymix sub-item from the Pengecoran block.
2. `BEKISTING {ELEMENT} (Material) — ratio {N} m²/m³` — the bekisting sub-items.
3. `PEMBESIAN (Material) — ratio {N} kg/m³` — the per-diameter rebar + waste + decking + bendrat.
4. `UPAH (Labor) — borongan` — the Upah cor row from Pengecoran.
5. `PERALATAN (Equipment)` — the Sewa peralatan row from Pengecoran.

**Perancah** (the scaffolding row in Bekisting Balok) is **NOT** part of the
breakdown — it appears as a separate BoQ line on its own. Excluded.

**Reconciliation block** at the bottom of every Breakdown sheet shows
`Computed unit cost`, `RAB (A) source unit cost`, `Variance`, plus the same
triplet for line total. The variance MUST be ≤ 1 Rp; if not, the sheet
shouldn't have been written.

---

## 4. The math (reference)

### 4.0 The column-sum invariant (the most important formula in this guide)

For ANY structural BoQ row, the at-cost per-m³ unit cost equals the sum of
the workbook's own pre-computed cost columns:

```
N = R + S + T + V·W + V·X + Z·AA + AC·AD + L + M
```

Where (in the BoQ row's RAB sheet — usually `RAB (A)`, sometimes multi-sheet):

| Col | Meaning | Always populated? |
|---|---|---|
| N | At-cost unit price (the reconciliation target) | Yes (any structural row) |
| R | Concrete material cost per m³ | Yes |
| S | Concrete labor cost per m³ | Yes |
| T | Concrete equipment cost per m³ | Yes |
| V | Bekisting m²-of-form per m³ beton ratio | Yes (rows with bekisting) |
| W | Bekisting cost per m² | Yes (rows with bekisting) |
| X | Bekisting peralatan / Perancah per m² | Workbook-dependent — populated in PD3, I4-29; AAL-5 leaves blank because Perancah is on its own BoQ line |
| Z | Pembesian kg per m³ | Yes (rows with rebar) |
| AA | Pembesian blended price per kg | Yes (rows with rebar) |
| AC | Wire mesh kg per m³ | Workbook-dependent — plat reinforcement in some workbooks |
| AD | Wire mesh price per kg | Same |
| L | Subkon (subcontractor) direct cost per m³ | Workbook-dependent |
| M | Prelim (preliminary) direct cost per m³ | Workbook-dependent |

**This invariant holds across all three reference workbooks** for every
structural row (95%+ — the residual is genuinely non-structural masonry).
The deterministic CLI's rolled tier (§5) is built on this invariant: emit a
lump per non-zero term. By construction, the rolled total equals N.

For per-material itemized breakdown, the formulas below decompose each term
into its AHS sub-items.

### 4.1 Concrete (R/S/T)

```
beton_readymix:    qty_per_m3 = AHS_qty (1.05 in AAL-5; 1.20 for Poer in PD3) × AHS_unit_price
sewa_peralatan:    qty_per_m3 = 1.0                × AHS_unit_price
upah_borongan:     qty_per_m3 = 1.0                × AHS_unit_price
```

Some workbooks (e.g., I4-29) split `sewa_peralatan` into two equipment
rows — vibrator and concrete pump separately. Group them by which cost
column they populate (col F=material, G=labor, H=equipment).

### 4.2 Bekisting (cycle-based)

```
factor = (m²_per_m³ ratio from RAB!V) / cycle_factor
For each sub-item INCLUDED in Jumlah (Perancah excluded):
  qty_per_m3 = AHS_qty_per_m² × factor
  cost_per_m3 = qty_per_m3 × AHS_unit_price
```

### 4.3 Bekisting (single-cycle, Bata/Batako)

```
factor = m²_per_m³ ratio from RAB!V  (no division by cycle)
For each sub-item:
  qty_per_m3 = AHS_qty_per_m² × factor
```

### 4.4 Pembesian (per-diameter + 3 derived)

Let K = total raw kg/m³ across all diameters (sum of REKAP weights / volume).

```
For each diameter d with weight K_d:
  Besi beton {d}     | qty_per_m3 = K_d            | price = 9000      (the AHS raw besi price)

besi_waste:           qty_per_m3 = K × 0.05         | price = 9000      (the same raw besi price)
beton_decking:        qty_per_m3 = K × 1.0          | price = 100
bendrat_kawat_ikat:   qty_per_m3 = K × 0.021        | price = 17500     (note: 0.021, NOT 0.02)
```

Sum of these = K × (1.05×9000 + 1.0×100 + 0.021×17500) = K × 9917.5,
which matches `RAB!AA{row} × RAB!Z{row}` (the workbook's blended computation).

### 4.5 Sanity check (IV.A.2.7)

```
Volume V = 0.2646 m³
Source unit cost = Rp 6,839,679.36

Beton readymix:    1.05 × 1,043,400 = 1,095,570
Bekisting (factor 2.5):
  Multipleks:      2 × 2.5 × 200,000 = 1,000,000
  Usuk vert:       9 × 2.5 × 47,600  = 1,071,000
  Usuk horiz:      3 × 2.5 × 47,600  = 357,000
  Paku:            1.5 × 2.5 × 13,000 = 48,750
  Form oil:        0.5 × 2.5 × 27,500 = 34,375
  Subtotal:                            2,511,125
Pembesian (K = 167.18):
  D8:   75.26 × 9000 = 677,327.99
  D13:  91.92 × 9000 = 827,270.87
  waste: 8.36 × 9000 = 75,229.94
  decking: 167.18 × 100 = 16,717.77
  bendrat: 167.18 × 0.021 × 17500 = 61,437.79
  Subtotal:                          1,657,984.35
Upah:                                 1,500,000
Peralatan:                            75,000
TOTAL:                                6,839,679.35
                                      ──────────
Variance from source: -0.01 Rp ✓
```

If your computed total differs from the source by more than ±1 Rp, **one of
your component values is wrong**. Don't loosen the tolerance — find the bug.

---

## 5. What works today (deterministic CLI, two-tier)

`tools/normalizer/cli-deterministic.ts` reconciles **159 of 164 structural
rows** on AAL-5 (the 5 unresolved are genuinely non-structural — Strong band
BB and 4 Pasangan dinding bata in chapter VIII). It uses a **two-tier strategy**:

### Tier 1 — itemized expansion (per-material detail)

For each BoQ row:

1. **Parse** the workbook with `parseBoqV2` (extracts rolled-up recipes,
   detected AHS blocks, REKAP rebar diameters).
2. **Extract templates** from the Analisa blocks:
   - Bekisting templates with `(blockTitle, hargaPerM2, cycleFactor, subItems)`.
   - Concrete templates with `(blockTitle, materialCostPerM3, laborCostPerM3, equipCostPerM3, subItems)`.
   - One Pembesian template with raw coefficients.
3. **Match templates** by the row's pre-computed cost columns:
   - Find bekisting template where `template.hargaPerM2 ≈ RAB!W{row}`.
   - Find concrete template where `template.{F,G,H} ≈ RAB!{R,S,T}{row}`.
4. **Build the breakdown** using the math in Section 4.
5. **Verify** computed unit cost equals source unit cost within ±1 Rp. If yes
   → write as itemized Breakdown sheet.

Currently reconciles 31/164 rows at the itemized tier (all IV.A.2.\* Balok
lt atas). The other tier-1 attempts fail because `extractBekistingTemplates`
mis-derives sub-item totals for Kolom/Plat/Dinding blocks — a real bug to
fix separately.

### Tier 2 — rolled lump breakdown (group totals from RAB columns)

When tier 1 fails, build a **5-line lump breakdown** from the workbook's own
pre-computed column totals:

```
Beton readymix lump:    qty=1.0,  unit=m³,  price=RAB!R{row}
Upah borongan lump:     qty=1.0,  unit=m³,  price=RAB!S{row}
Sewa peralatan lump:    qty=1.0,  unit=m³,  price=RAB!T{row}
Bekisting lump:         qty=V,    unit=m²,  price=RAB!W{row}     (only if V*W > 0)
Pembesian U24&U40 lump: qty=Z,    unit=kg,  price=RAB!AA{row}    (only if Z*AA > 0)
```

By construction, these 5 lumps sum to `RAB!N{row}` because that's literally
the workbook's own arithmetic: `N = R + S + T + V*W + Z*AA`. **159/164 rows
on AAL-5 reconcile at this tier within ±1 Rp** (the 5 that fall through to
tier 2.5 are non-structural — masonry rows have R=S=T=V=W=Z=AA=0).

Each lump carries `specNote: "rolled lump — group total only"` and a
`materialName` like `"Bekisting (lump — no per-material detail)"` so SANO's
audit UI naturally groups them separately from itemized per-material lines.

### Tier 2.5 — direct-reference lumps (masonry / pile / custom)

Rows whose structural columns are all zero (so the rolled tier has nothing
to emit) but whose `I/J/K/L/M` formulas still reference a specific Analisa
block fall through to `buildDirectReferenceBreakdown`. It reads the parsed
recipe components (each carries `lineType`, `unitPrice`, `quantityPerUnit`,
and a `referencedCell` pointer back to the Analisa block) and emits one
lump per component: material / labor / equipment go to their own
`BreakdownGroup`; subkon and prelim are grouped under material. By
construction the components sum to `cost_split.material + .labor + .equipment
+ .prelim + subkon_cost_per_unit`, so reconciliation is automatic.

Covers all 34 previously-Unresolved rows across the three reference
workbooks (Pasangan dinding bata merah, Strong band BB, bored pile, etc.).

### Tier 3 — Unresolved

Rows that fail all three tiers go to the Unresolved sheet. As of 2026-05-25
this set is **empty** on all three reference workbooks — every row reconciles
through one of itemized / rolled / direct-ref. Any future row that lands
here means the workbook has a layout we haven't seen before, not that the
row is genuinely unparseable — investigate before shipping.

### Run

```
npm run normalize:boq:det -- <input.xlsx> [output.xlsx]
```

---

## 6. What's unresolved (with hypotheses)

> **Important correction (2026-05-24):** earlier versions of this guide
> framed §6.2 and §6.3 as "Kolom rows have a different sub-item shape" and
> "V/VI chapters use different REKAP weights." Those framings were **wrong**.
> The actual root cause for those rows is a bug in `extractBekistingTemplates`
> when reading the Kolom sub-items — the templates DO match by cost column,
> but the rebuilt per-m² total is wrong (e.g., III.A.4.1 K174-1 computed 18.8×
> the source). The Level-2 rolled fallback (§5) makes coverage 31 → 159
> without fixing the bug, but if you want itemized detail back for Kolom rows
> you have to debug `extractBekistingTemplates` directly. The two sections
> below are kept as historical record + still-useful pointers for that debug.

As of the latest run against `RAB R1 Pakuwon Indah AAL-5.xlsx`, 159/164 rows
reconciled (31 itemized + 128 rolled). The 5 truly unresolved are listed at
§6.4 and §6.5 below. The patterns where itemized fails but rolled succeeds
are §6.1 through §6.3 — all symptomatic of the same root cause: the
itemized-tier code mishandles Kolom/Plat/Dinding bekisting blocks.

### 6.0 Itemized vs rolled — the corrected mental model

After cross-workbook validation (§13), the unresolved patterns split into
two distinct buckets:

- **Rows that reconcile via the column-sum invariant (§4.0) but fail
  itemized expansion.** The rolled tier (§5) handles these correctly today.
  They show up as `~ rolled` in CLI output, contributing correct group totals
  to SANO. Examples: Kolom rows (bug in `extractBekistingTemplates` for the
  Kolom block — fix outlined in §6.2). Bata/Batako bekisting (fix in §6.1).
  V/VI chapter Balok (was misframed in earlier versions of this guide — see
  §6.3).

- **Rows that fail the column-sum invariant.** These are GENUINELY
  non-structural rows — Pasangan dinding bata merah (masonry), Strong band BB
  custom items, Planter box custom forms. They cannot be expanded via the
  Bekisting+Concrete+Pembesian template because they aren't built from those
  components.

The fix priority is: **first, make sure rolled-tier reconciles every row
where the invariant holds** (already done across AAL-5/PD3/I4 thanks to the
9-column lump emission). **Second**, improve itemized expansion for rolled
rows that have known patterns (§6.1, §6.2 below). **Third**, accept the
genuine masonry/custom rows as Unresolved.

### 6.1 Bata/Batako bekisting (Poer + Sloof, chapter III.A.1–2)

**Symptom**: `extractBekistingTemplates` skips the block because there's no
"Harga per m²" row after Jumlah. The Bata blocks (rows 13/21/29) end at the
Jumlah row.

**Hypothesis**: For these blocks, `cycleFactor = 1` and the per-m² cost IS
the Jumlah value. The Jumlah may be in col F OR col I depending on layout.

**Investigation**: dump `Analisa!F{jumlah}`, `Analisa!I{jumlah}` for these
blocks and check which one matches Poer/Sloof rows' `RAB!W{row}` values.

### 6.2 Kolom rows show ~10-50% variance (IV.A.3.\*, V.A.3.\*)

**Symptom**: Template matches (Bekisting Kolom at F44=116,217 and Pengecoran
KOLOM at F=1,078,087, G=1,750,000, H=250,000 both match), but final variance
is large.

**Hypothesis**: The Bekisting Kolom block has a different sub-item shape than
Bekisting Balok. Inspect rows 37-41 (componentRows) — there might be qty
values, sub-items, or formula references that the current generic extractor
mishandles. Specifically, Bekisting Kolom may use **2 Multipleks + 10 Usuk +
2 Usuk + 2 Paku + 2.28 ltr Form oil** (per the user's manual Breakdown III.A.1.1
for Poer PC.1 which uses Bekisting Kolom — see `_Claude Override` workbook).

**Investigation**: dump Bekisting Kolom sub-items (Analisa rows 37-41), compute
per-cycle Jumlah by hand, verify it = 1,059,900 / 9 = 117,766.67? No, the dump
showed Harga per m² = 116,217 and Jumlah = 1,059,900, ratio = 9.1, rounded to 9.
That's the cycle factor. So the math should work. The variance must come from
elsewhere — possibly the rebar weights, the pembesian coefficient, or a missing
component.

### 6.3 Balok rows in chapters V and VI show smaller variance (~50k–500k Rp)

**Symptom**: Same element (B24-1) as IV.A.2.\* but in V.A.2.\* shows variance.
Templates match the same `BALOK LT ATAS` block, but source unit cost differs.

**Hypothesis**: V and VI may be different floors that use a different (yet
undetected) Pengecoran sub-variant. Or the rebar weights are different per row
(check REKAP Balok rows for V.A.2.\* — they likely have different weights than
IV.A.2.\* even for the same B24-1 label, because each REKAP row is for a
specific instance).

**Investigation**: pick V.A.2.6 (Balok B24-1) and compare its REKAP Balok row
+ recipe components to IV.A.2.7's. The difference should explain the variance.

### 6.4 Pasangan bata (chapter VIII)

**Symptom**: `needsExpansion` returns true (because a spurious zero component
fires the predicate), but the rows are masonry (Pasangan Dinding Bata Merah),
NOT structural concrete. No Bekisting/Concrete/Pembesian block matches.

**Hypothesis**: The predicate is too aggressive. Restrict to rows whose
recipe has at least one component referencing `/^(Bekisting|Pembesian|Pengecoran Beton)/i`
in its referencedBlockTitle.

**Investigation**: easy fix. Update `needsExpansion` to require positive
evidence of structural concrete, not just "has a zero-priced component".

### 6.5 Custom items (Strong band, Planter box, Penyangga kanopi)

**Symptom**: No standard Bekisting+Concrete+Pembesian template applies. These
are bespoke items.

**Hypothesis**: These rows have their own custom recipes that don't follow the
3-block template. They should probably stay rolled-up — the per-material
breakdown isn't meaningful here.

**Investigation**: explicitly skip rows whose chapter doesn't match a known
structural pattern. Or accept them as Unresolved and document.

---

## 7. How to investigate (practical guide)

### 7.1 Setup

```
cd /Users/carissatjondro/Dropbox/AI/Claude\ Code   # the main worktree
git checkout feat/boq-normalizer
npm install
```

### 7.2 Inspect a workbook

The tmp/ directory holds throwaway inspection scripts. Pattern:

```javascript
// tmp/inspect-something.mjs
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/your-workbook.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));

// e.g. dump a specific row's columns
const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
console.log('Recipe components:', row.recipe.components.map((c) => ({
  material: c.materialName,
  qtyPerUnit: c.quantityPerUnit,
  unitPrice: c.unitPrice,
  block: c.referencedBlockTitle,
  cell: `${c.referencedCell.sheet}!${c.referencedCell.address}`,
})));
```

Run: `npx tsx tmp/inspect-something.mjs`

### 7.3 Find the relevant AHS block for a failing row

```javascript
// For row X, find which block's costs match the row's R/S/T columns
const r = row.sourceRow;
const w = lookup.get(`RAB (A)!W${r}`)?.value;  // bekisting cost/m²
const R = lookup.get(`RAB (A)!R${r}`)?.value;  // concrete material/m³
const S = lookup.get(`RAB (A)!S${r}`)?.value;  // concrete labor/m³
const T = lookup.get(`RAB (A)!T${r}`)?.value;  // concrete equip/m³

console.log({ W: w, R, S, T });

// Then find blocks where Analisa!F{jumlahRow+1} ≈ w (bekisting)
// or Analisa!F{jumlahRow}, G, H ≈ R, S, T (concrete)
for (const b of result.ahsBlocks) {
  if (/Bekisting/i.test(b.title)) {
    const harga = lookup.get(`Analisa!F${b.jumlahRow + 1}`)?.value;
    if (Math.abs((harga ?? 0) - (w ?? 0)) < 5) console.log('MATCH BEKISTING:', b.title);
  }
  if (/Pengecoran Beton/i.test(b.title)) {
    const f = lookup.get(`Analisa!F${b.jumlahRow}`)?.value;
    const g = lookup.get(`Analisa!G${b.jumlahRow}`)?.value;
    const h = lookup.get(`Analisa!H${b.jumlahRow}`)?.value;
    if (Math.abs((f ?? 0) - (R ?? 0)) < 5 &&
        Math.abs((g ?? 0) - (S ?? 0)) < 5 &&
        Math.abs((h ?? 0) - (T ?? 0)) < 5) console.log('MATCH CONCRETE:', b.title);
  }
}
```

### 7.4 Hand-verify the math

Before changing code, **do the calculation by hand for one row**. Open the
workbook in Excel, look at the BoQ row's columns, the Analisa block's columns,
and the REKAP row's columns. Compute the breakdown by hand. Make sure the
total matches `RAB!N{row}` (the at-cost unit price).

If your hand-calc differs from the source: the workbook itself may have a
formula you haven't accounted for. Look at the row's `E{row}` (unit price with
markup) formula and trace back through any same-sheet references.

If your hand-calc matches but the code differs: there's a bug in the code.

### 7.5 The "find similar successful row" trick

If IV.A.2.7 works perfectly but V.A.2.6 fails, **compare them side by side**:

```javascript
const a = result.boqRows.find((r) => r.code === 'IV.A.2.7');
const b = result.boqRows.find((r) => r.code === 'V.A.2.6');
// Dump both rows' recipe components, RAB columns, REKAP weights, source totals.
// Whatever differs is the cause of failure.
```

---

## 8. Codebase map

### 8.1 Parser side (reads workbooks)

| File | Responsibility |
|---|---|
| `tools/boqParserV2/index.ts` | Main `parseBoqV2(buffer, options)` entry point. Calls all the pieces below. |
| `tools/boqParserV2/harvest.ts` | Reads raw XLSX cells via SheetJS. |
| `tools/boqParserV2/detectBlocks.ts` | Identifies AHS blocks in the Analisa sheet. `TITLE_WORK_RE` controls which titles count as block headers. |
| `tools/boqParserV2/extractTakeoffs.ts` | Extracts BoQ rows from the RAB sheet. |
| `tools/boqParserV2/recipeBuilder.ts` | Builds the rolled-up recipe components for each BoQ row by evaluating the inline_split formulas in columns I/J/K/L/M. |
| `tools/boqParserV2/rebarDisaggregator/` | Post-pass that replaces the Pembesian aggregate component with per-diameter components (D8, D13, etc.) by reading REKAP sheets. |
| `tools/boqParserV2/breakdownSheetReader.ts` | Reads `Breakdown {code}` sheets from a workbook back into structured `RowBreakdown` objects. This is what the SANO parser uses to consume normalized workbooks. |
| `tools/boqParserV2/recipeFromBreakdown.ts` | Converts a `RowBreakdown` into a `BoqRowRecipe` for the SANO downstream pipeline. |

### 8.2 Normalizer side (writes Breakdown sheets)

| File | Responsibility |
|---|---|
| `tools/normalizer/needsExpansion.ts` | Predicate: which BoQ rows are candidates for expansion. |
| `tools/normalizer/buildBreakdown.ts` | Expansion math for bekisting / pembesian / concrete blocks. Still has some legacy bugs — prefer the deterministic CLI's inline math. |
| `tools/normalizer/writeWorkbook.ts` | Writes Breakdown sheets + Recipe Index sheet into a workbook. |
| `tools/normalizer/cli-deterministic.ts` | **The recommended CLI**. No-LLM, matches templates by cost columns. |
| `tools/normalizer/cli.ts` | LLM-based CLI (calls Anthropic API). Costs ~$5/workbook. Fallback for edge cases. |
| `tools/normalizer/agentic.ts` | The agentic loop used by the LLM CLI. Per-row tool-use loop with `submit_breakdown` + reconciliation feedback. |
| `tools/normalizer/blockAnalyzer.ts` | Helpers for the LLM CLI (cell-context extraction, structured prompt). |
| `tools/normalizer/index.ts` | Orchestration shared between both CLIs. |

### 8.3 Output / consumer side

| File | Responsibility |
|---|---|
| `tools/baseline.ts` | `parseAndStageWorkbook` — invoked by the SANO app on upload. Calls parseBoqV2, inserts staging rows. |
| `workflows/screens/BaselineScreen.tsx` | The UI for BoQ upload + audit. Reads breakdown components via the staging rows. |
| `workflows/screens/components/RecipeView.tsx` | Per-row recipe drilldown UI. |
| `docs/superpowers/specs/2026-05-23-recipe-detail-normalizer-design.md` | The original design spec for this feature. |

---

## 9. The two CLIs and when to use each

### 9.1 Deterministic CLI (zero cost, fast)

```
npm run normalize:boq:det -- <input.xlsx> [output.xlsx]
```

Use this **first** for any workbook. It will reconcile rows whose templates
are clean (one Pengecoran + one Bekisting + per-row REKAP) and leave the rest
in the Unresolved sheet.

### 9.2 Agentic LLM CLI (~$5/workbook, slower, handles edge cases)

```
ANTHROPIC_API_KEY=sk-... npm run normalize:boq -- <input.xlsx> [output.xlsx]
```

Use this for the **unresolved rows** the deterministic CLI couldn't handle.
Claude reasons over the full Analisa sheet per row, iterates via
`submit_breakdown` tool calls until reconciliation passes (or gives up).

### 9.3 The recommended workflow

1. Run the deterministic CLI on the raw workbook.
2. Open the output workbook in Excel. Check the Unresolved sheet.
3. For each unresolved chapter pattern, either:
   - **Pattern-fix**: add a new chapter pattern to the deterministic CLI
     (if the pattern is reusable across workbooks).
   - **Manual fix**: author the Breakdown sheet by hand, with Claude.ai as
     an assistant (you can use this guide as the briefing).
   - **Agentic fallback**: re-run the agentic CLI on the unresolved rows.
4. Verify the Recipe Index sheet shows zero ⚠ reconciliation flags before
   handing the workbook to SANO.

---

## 10. Reference data (AAL-5 specific, but illustrative)

### 10.1 Chapter → element type mapping

| Chapter prefix | Element type | Bekisting block | Concrete block |
|---|---|---|---|
| III.A.1 | Poer | Bata/Batako (TBD) | Pengecoran POER |
| III.A.2 | Sloof | Bata/Batako (TBD) | Pengecoran SLOOF |
| III.A.3 | Plat lantai bawah | Bekisting plat | Pengecoran PLAT LT. DASAR |
| III.A.4 | Kolom (lt 1) | Bekisting Kolom | Pengecoran KOLOM |
| III.A.5 | Pit lift, dinding | Bekisting dinding beton | Pengecoran DINDING BETON |
| IV.A.1 | Plat lantai atas | Bekisting plat | Pengecoran PLAT LT. ATAS |
| IV.A.2 | Balok lt atas | Bekisting Balok | Pengecoran BALOK LT. ATAS ✓ works |
| IV.A.3 | Kolom (lt 2) | Bekisting Kolom | Pengecoran KOLOM |
| V.A.\* | Lt 3 floor | Same as IV.A.\* but possibly different sub-variants |
| VI.A.\* | Lt 4 / attic | Same as IV.A.\* but possibly different sub-variants |
| VIII.\* | Pasangan bata (masonry) | N/A — skip these rows |

### 10.2 Block cycle factors (AAL-5)

```
Bekisting Kolom:           cycle = 9   (Jumlah 1,059,900 / Harga 116,217)
Bekisting Balok:           cycle = 4   (Jumlah 1,004,450 / Harga 251,113)
Bekisting plat:            cycle = 6   (Jumlah 497,100 / Harga 86,302)
Bekisting dinding beton:   cycle = 6   (Jumlah 544,700 / Harga 94,566)
Bekisting Bata Merah:      cycle = 1   (single-use, no Harga per m² row)
Bekisting Batako (berdiri): cycle = 1
Bekisting Batako (tidur):   cycle = 1
```

### 10.3 Pembesian coefficients (AAL-5)

```
Besi beton:       coeff 1.05 (5% waste)  unit price 9,000 Rp/kg
Beton decking:    coeff 1.00              unit price 100 Rp/kg-eq
Bendrat:          coeff 0.021             unit price 17,500 Rp/kg
Blended per kg:                          9,917.5 Rp/kg
```

### 10.4 AAL-5 coverage (latest run)

```
Itemized (per-material):    31    (all IV.A.2.* Balok lt atas)
Rolled (5-line lump):       128   (every other structural row)
Unresolved:                 5     (V.A.2.31 Strong band + 4 VIII.* Pasangan bata)
                          ───
Total:                      164
```

The 31 itemized rows prove the per-material expansion works when the
templates extract cleanly. The 128 rolled rows prove the workbook's own
column arithmetic is correct and reconcilable. The 5 unresolved are
genuinely non-structural and contribute zero to the structural rollup.

---

## 11. Things to avoid

- **Loosening the reconciliation tolerance to "make tests pass."** If
  variance > 1 Rp, the breakdown is wrong. Find the bug.
- **Writing a Breakdown sheet that doesn't reconcile.** Always route those
  rows to Unresolved. Never to a `⚠ MISMATCH` Breakdown sheet.
- **Hardcoding cell addresses for one workbook.** Always read templates from
  the workbook's Analisa sheet. Different RAB workbooks lay out their AHS
  blocks differently.
- **Trusting `referencedBlockTitle` alone to identify a block.** The title
  comes from `detectAhsBlocks` and depends on `TITLE_WORK_RE` matching. For
  the same cell, two parser configurations might give different titles. The
  more reliable identifier is `referencedCell.sheet + referencedCell.address`
  matched against the AHS block's row range.
- **Calling the LLM for every workbook.** The deterministic CLI is free and
  works for clean chapters. Save the LLM for the residual.
- **Forgetting that `bendrat` is 0.021, NOT 0.02.** A common bug in earlier
  iterations.

---

## 12. The user's philosophical contract

This is more important than any technical detail above. The system was built
because the user wants:

> "the truth to be correct. i don't want claude to make up stuff to get the
> number."

Every architectural choice has to honor this. When in doubt:

- **Refuse to produce a number** rather than produce a wrong one.
- **Flag uncertainty** rather than smooth it over.
- **Show your work** in the breakdown sheets and the Recipe Index, so a
  human can verify.

The Indonesian construction sector runs on these numbers. A wrong material
quantity means a wrong purchase order, which means cost overrun or shortage
on site. Get it right or admit you can't.

---

---

## 13. Cross-workbook validation (2026-05-24)

The deterministic CLI was validated against three independent reference
workbooks by parallel agents. Findings preserved at:

- `docs/boq-normalizer-validation-PD3-23.md` — RAB R2 Pakuwon Indah PD3 no. 23
- `docs/boq-normalizer-validation-I4-29.md` — RAB Nusa Golf I4 no. 29 R3

### Coverage — two metrics, do not conflate them

| Workbook | Itemized | Rolled | Direct-ref | Unresolved | Total | Rp coverage | Material coverage |
|---|---|---|---|---|---|---|---|
| AAL-5    | 159 |  0  |  5 | 0 | 164 | 100% | **97.0%** |
| PD3-23   | 229 |  0  | 12 | 0 | 241 | 100% | **95.0%** |
| I4-29    | 281 |  41 | 17 | 0 | 339 | 100% | **82.9%** |
| ERNAWATI |  76 |  33 |  9 | 0 | 118 | 100% | **64.4%** |
| **All four** | **745** | **74** | **43** | **0** | **862** | **100%** | **86.4%** |

- **Rp coverage** = `(itemized + rolled + direct-ref) / total` — share of
  project Rp value whose total reconciles to source within ±1 Rp. This is
  the truth-correctness floor; with the direct-reference tier added (fix
  plan §2.2), it is now 100% across all three reference workbooks.
- **Material coverage** = `itemized / total` — share of rows with per-material
  detail (Multipleks, Usuk, kg D8 vs D13, etc.) available to procurement.
  **This is the original goal in §1.** The rolled and direct-ref tiers emit
  group lumps that reconcile by total but give limited per-material visibility
  — the audit screen sees "Bekisting Balok lump Rp 2.5M" instead of
  "Multipleks 1.32 lbr, Usuk vert 5.95 btg, ..."

Material coverage is now **86.4%** (was 76.7%) after the pembesian-lump
fallback landed (2026-05-26). The itemized tier now stays alive even when
the rebar disaggregator can't yield reconcilable per-diameter detail —
instead of bailing the whole row to rolled (which loses bekisting per-
material detail too), it emits a single `PEMBESIAN (Material) ... (lump)`
component while keeping `BEKISTING (Material)` itemized to Multipleks,
Usuk, Paku, Form oil. Triggers when (a) no rebar adapter matches the row
label (e.g., ERNAWATI Dinding rows whose rebar lives on a "Retaining Wall"
sheet) or (b) the disaggregator's per-diameter Σ disagrees with `RAB!Z`
by > 0.01 kg/m³ (e.g., ERNAWATI Plat where REKAP rows are per sub-area,
not per BoQ row). See the second `else if` branch in
`tools/normalizer/cli-deterministic.ts:buildBreakdownForRow`.

A second uplift came earlier the same day from the formula-driven
REKAP-row resolver: the disaggregator now reads the BoQ row's own
column-Z formula (`='REKAP Balok'!X291`) instead of label-searching for
"B24-1". See `tools/boqParserV2/rebarDisaggregator/resolveRekapRow.ts`.

The 34 previously-Unresolved rows are non-structural — Pasangan dinding bata
merah (masonry), Strong band BB, Planter box, bored pile, and similar custom
items where the column-sum invariant doesn't apply but the row's recipe
still references a specific Analisa block via I/J/K/L columns. The
direct-reference tier reads the recipe components and emits one lump per
component (material / labor / equipment / subkon / prelim), reconciling
by construction. See `tools/normalizer/cli-deterministic.ts:buildDirectReferenceBreakdown`.

### Key cross-workbook learnings

1. **The column-sum invariant holds for every structural row** across all
   three workbooks. This is the architectural floor — when the invariant
   holds (R + S + T + V·W + V·X + Z·AA + AC·AD + L + M = N), the rolled
   tier reconciles by construction.

2. **Earlier framings of §6.2 and §6.3 were wrong.** The "Kolom variance"
   and "V/VI Balok variance" weren't caused by REKAP weight differences or
   Pengecoran sub-variants. The root cause was the CLI missing X (Perancah),
   AC*AD (wire mesh), and L/M (subkon/prelim) columns. Adding those lumps
   pushed PD3 from 43% → 95% and I4-29 from 0% → 95%.

3. **Multi-sheet RAB is real.** I4-29 splits structural rows across
   `RAB (A..E)` (one sheet per building). The CLI now uses `boqSheet: 'auto'`
   to discover them. AAL-5 still has a single `RAB (A)`.

4. **Pengecoran sub-item count varies (3 vs 4).** I4-29 splits vibrator and
   pump into separate equipment rows. The CLI's column-grouping logic
   (F=material, G=labor, H=equipment) handles this naturally.

5. **Cycle factors are not always integers.** PD3 has Kolom = 4.56,
   Plat/Dinding = 5.76. Don't round to known integers — read the literal
   ratio from `F{jumlah}/F{jumlah+1}` in the Bekisting block.

6. **Pembesian and concrete prices are workbook-specific.** AAL-5 uses
   9000/100/17500 Rp/kg for the Pembesian sub-items; I4-29 uses
   10000/varies/varies. The rolled tier reads `RAB!AA{row}` directly so
   it's correct by construction; the itemized tier reads from the workbook's
   own AHS block, so it should also be correct (but check if you change
   that code).

7. **REKAP rebar diameter layouts vary.** AAL-5: L=D6, M=D8, N=D10, O=D13.
   PD3 Plat: K=D8, L=D10, M=D13, N=D16, O=D25. ~~The current adapters are
   hardcoded to AAL-5 columns.~~ **DONE 2026-05-24.** All four adapters
   (`balokSloof`, `poer`, `plat`, `kolom`) are now layout-aware via
   `rebarDisaggregator/adapters/headerDetect.ts`: each scans the sheet
   for the diameter-header row (cells whose values match the canonical
   diameter set 6/8/10/13/16/19/22/25/29/32) and builds a
   `{diameter → columnLetter}` map per workbook. Side benefit: the
   "Poer Z-vs-diameter discrepancy" (bottleneck #4) was caused by the
   old hardcoded Poer mapping being off by two columns (it was reading
   column I = "Lantai Kerja" as D8, a phantom 0.76 kg/m³); proper
   header detection eliminates it without any extra fallback code.

### Recommended next steps to push itemized coverage higher

The rolled tier covers 95% reliably. To upgrade more rows from rolled to
itemized:

0. ~~**H-side bekisting sub-item extraction.**~~ **DONE 2026-05-25.**
   Root cause: PD3 and I4 Bekisting Balok/Plat embed Perancah inside the
   block with cost in column H (separate Jumlah + Harga per m² row from
   the F-side forms). The extractor only captured F-side. Fix:
   `BekistingTemplate` now carries F-side and H-side sub-items separately,
   each with its own `cycleFactor`; `buildBreakdownForRow` emits both when
   `RAB!X{row} > 0`. Coverage impact: PD3 itemized 49 → 76 (+27),
   I4-29 itemized 17 → 46 (+29), AAL-5 unchanged (X=0 in all rows).
   Reviewer estimate was +125 for PD3 — actual was +27, because many
   PD3 Plat/Kolom rows have additional unmodeled blockers (different
   bekisting cycle layouts or pembesian price discrepancies) that keep
   them in rolled even with H-side fixed.


1. ~~**Fix `extractBekistingTemplates` for Kolom blocks.**~~ **DONE
   2026-05-24.** Root cause: `cycleFactor` was being `Math.round`ed (9.12 →
   9, 5.76 → 6) which broke the `V × W = Σ(subitem_cost_per_m³)` invariant
   by 1-2%. Fix: read cycleFactor as literal float. Coverage impact:
   AAL-5 itemized 31 → 59, PD3 itemized 0 → 19.

2. ~~**Add Bata/Batako single-cycle bekisting extraction.**~~ **DONE
   2026-05-24.** Root cause: blocks with no `Harga per m²` row were
   skipped. Fix: fall back to `Harga = Jumlah` (single cycle); also check
   col I for Jumlah since Bata/Batako blocks put grand totals there
   instead of col F. Coverage impact: all 11 AAL-5 Sloof rows upgraded
   rolled → itemized.

3. ~~**Make REKAP adapters layout-aware.**~~ **DONE 2026-05-24.** Shared
   `headerDetect.ts` helper scans rows 1..30 (Plat/Balok/Poer) or
   140..320 (Kolom's REKAP-VOLUME section) for the diameter-header row,
   producing a `{diameter → columnLetter}` map per workbook. All four
   adapters (`balokSloof`, `poer`, `plat`, `kolom`) consume the map; the
   prior hardcoded mappings (which only matched AAL-5 column letters)
   are gone. Coverage impact (combined with #4 below since they share
   one fix): AAL-5 itemized 59 → 74, PD3 19 → 49, I4-29 6 → 17. +56
   structural rows upgraded from rolled to itemized across the three
   reference workbooks. Total coverage unchanged at 95.4% (the
   truth-correctness contract — any row that doesn't reconcile within
   ±1 Rp still falls back to rolled).

4. ~~**Resolve Z-vs-diameter discrepancy in the poer rebar adapter.**~~
   **DONE 2026-05-24.** Root cause: the old hardcoded Poer mapping
   (`H=D6, I=D8, …, O=D25`) was off by two columns vs the actual AAL-5
   layout (`J=D6, K=D8, …, Q=D25`). Column I on AAL-5 REKAP-PC is
   "Lantai Kerja" (0.76 kg/m³ for PC.1) — the old adapter mis-reported
   that as a D8 weight, AND simultaneously mis-mapped every real
   diameter to a column 2 letters too low. The 0.76 kg/m³ phantom was
   the visible symptom; the silent damage was the entire diameter
   spectrum being misread. Header-aware detection (see #3) fixes both
   together. Verification: AAL-5 PC.5 `Σ(diameter weights) / volume =
   148.97 / 1.7578 = 84.749 kg/m³`, which equals `RAB(A)!Z59` exactly.

5. ~~**Audit Plat rebar (I4-29 specific).** I4 plat rows include wire-mesh
   accounting via `AC*AD` columns. The rolled tier handles them; for
   itemized, would need a dedicated wire-mesh sub-item separate from the
   per-diameter Besi components.~~ **DONE 2026-05-24.** Added an itemized
   `WIRE MESH (Material)` component in `buildBreakdownForRow` that fires
   whenever `AC > 0 && AD > 0`. AC*AD is disjoint from Z*AA by construction
   (the wire mesh AHS at Analisa rows 235..239 is a separate recipe from
   Pembesian U24 & U40 at rows 228..233; REKAP per-diameter weights cover
   U24/U40 only). The current I4-29_R3 workbook has AC/AD = 0 on every
   row, so this is defensive coverage — itemized count for I4-29 unchanged
   at 17. Any future plat row that populates AC*AD will graduate from
   rolled to itemized without falling foul of the column-sum invariant.

---

*Last updated: 2026-05-26 after the pembesian-lump fallback in the
itemized tier landed (on top of the same-day formula-driven REKAP-row
resolver). Material coverage 26.3% → 76.7% → **86.4%** across the four
reference workbooks. Itemized row count 196 → 661 → **745** (+549 since
the original baseline). Rp coverage stays at 100% (862/862 reconciled
within ±1 Rp). Counts are pinned in
`tools/normalizer/__tests__/deterministicCli.integration.test.ts` and any
drift means either the test needs updating to match a deliberate coverage
improvement, or a regression has been introduced. See
`docs/superpowers/specs/2026-05-23-recipe-detail-normalizer-design.md` for the
full design history, and the per-workbook validation docs for raw findings.*
