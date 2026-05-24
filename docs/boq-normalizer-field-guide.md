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

Indonesian RAB workbooks pack a lot of variation:

- The same element type (e.g., Balok B24-1) can appear in 3+ chapters with
  different Pengecoran (concrete) blocks per chapter (lt atas / lt dasar /
  lt bawah have different upah and equipment costs).
- Bekisting blocks have different sub-items per element type (Balok has 5
  sub-items + Perancah; Plat has 5 different sub-items; Kolom has yet another
  set).
- Some bekisting blocks use a "Jumlah" then "Harga per m²" with a cycle
  factor (typical: 4 cycles for Balok, 6 for Plat, 9 for Kolom).
- Others (Bata/Batako Poer/Sloof) skip the "Harga per m²" entirely — they're
  single-cycle.
- REKAP sheets carry per-row rebar diameter weights, not per-element. Each
  BoQ row reads its own REKAP row (e.g., REKAP Balok row 369 for IV.A.2.7).

A purely deterministic approach captures the "clean" patterns but breaks on
edge cases. A purely LLM-driven approach handles edge cases but is expensive
and slow. The recommended architecture is **deterministic-first, LLM-fallback**
(see Section 9).

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

For a BoQ row with volume V, the per-m³ unit cost = sum of these:

### 4.1 Concrete

```
beton_readymix:    qty_per_m3 = AHS_qty (1.05)     × AHS_unit_price
sewa_peralatan:    qty_per_m3 = 1.0                × AHS_unit_price
upah_borongan:     qty_per_m3 = 1.0                × AHS_unit_price
```

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

## 5. What works today (deterministic CLI)

`tools/normalizer/cli-deterministic.ts` reconciles all 30 IV.A.2.\* (Balok lt
atas) rows at exactly 0.00 Rp variance using this approach:

1. **Parse** the workbook with `parseBoqV2` (extracts rolled-up recipes,
   detected AHS blocks, REKAP rebar diameters).
2. **Extract templates** from the Analisa blocks:
   - Bekisting templates with `(blockTitle, hargaPerM2, cycleFactor, subItems)`.
   - Concrete templates with `(blockTitle, materialCostPerM3, laborCostPerM3, equipCostPerM3, subItems)`.
   - One Pembesian template with raw coefficients.
3. **For each BoQ row**, match templates by the row's pre-computed cost columns:
   - Find bekisting template where `template.hargaPerM2 ≈ RAB!W{row}`.
   - Find concrete template where `template.{F,G,H} ≈ RAB!{R,S,T}{row}`.
4. **Build the breakdown** using the math in Section 4.
5. **Verify** computed unit cost equals source unit cost within ±1 Rp.
6. **Write** Breakdown sheet only if verification passed. Otherwise list in
   Unresolved sheet.

This works because **the workbook's R/S/T/W columns already encode which block
was used** — we just have to read them.

Run:

```
npm run normalize:boq:det -- <input.xlsx> [output.xlsx]
```

---

## 6. What's unresolved (with hypotheses)

As of the latest run against `RAB R1 Pakuwon Indah AAL-5.xlsx`, 31/164 rows
reconciled. The 133 unresolved fall into these patterns:

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

### 10.4 The 31 reconciled rows on AAL-5

All in `IV.A.2.*` (Balok lt atas). 30 rows, all variances < 0.01 Rp.
These prove the deterministic approach works when the templates are clean.

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

*Last updated: 2026-05-24 after the deterministic CLI shipped, reconciling
30/164 rows on AAL-5. See `docs/superpowers/specs/2026-05-23-recipe-detail-normalizer-design.md`
for the full design history.*
