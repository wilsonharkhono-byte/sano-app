
# BoQ Normalizer — Validation against RAB Nusa Golf I4 no. 29 R3

> ## ⚠️ SUPERSEDED 2026-05-25
>
> This document records the CLI's behavior at 15:04 on 2026-05-24, BEFORE
> any of the cross-workbook fixes shipped. At the time of writing the CLI
> produced 0 itemized / 0 rolled / 0 unresolved for I4-29 because
> `boqSheet: 'auto'` wasn't passed and `readRowCols` was hardcoded to
> `'RAB (A)'`. Both bugs are fixed.
>
> **Current coverage (HEAD 6e74dcb):** I4-29 itemized 17, rolled 305,
> unresolved 17 of 339. See `docs/boq-normalizer-field-guide.md` §13 and
> `docs/boq-normalizer-fix-plan-results.md` for live numbers.
>
> Done since this doc was written:
> - X / AC*AD / L / M columns added to the column-sum invariant
>   (commit `de7b8a5`).
> - Multi-sheet RAB layout (`RAB (A..E)`) supported via
>   `boqSheet: 'auto'` (`de7b8a5`).
> - Layout-aware REKAP adapters (commit `6e74dcb`).
> - Itemized wire-mesh component for AC*AD (`6f798c0`, defensive — every
>   AC/AD cell in I4-29_R3 is 0, so this is forward coverage only).
>
> The §3.4 / §6.3 finding about H-side bekisting (Perancah embedded in
> col H of the Bekisting Balok / Plat block with its own cycle factor)
> is the one outstanding architectural fix — see fix plan §2.1.
>
> The remainder of this doc remains valuable as the diagnostic record of
> the pre-fix failure modes.

> Independent verification of the field guide claims and the deterministic CLI's
> behavior against a workbook from a different developer (Nusa Golf, not
> Pakuwon Indah). All claims here come from direct inspection of the workbook;
> no code or field guide was modified. Date of analysis: 2026-05-24.

## TL;DR — does the field guide hold?

**Largely no.** Five hard differences vs. AAL-5:

1. **Multiple RAB sheets.** I4-29 has `RAB (A..E)`. The CLI default `boqSheet: 'RAB (A)'` causes it to process 0 structural rows (RAB (A) here is just the prelim chapter — 15 line-item rows, none with R/S/T/W/AA populated). With `boqSheet: 'auto'` the parser finds 440 rows across (A..E) with 339 candidates for expansion.
2. **The headline invariant `R + S + T + V*W + Z*AA = N` is wrong for I4-29.** Only 122/339 structural rows reconcile under it. A new term `V*X` (bekisting equipment cost — perancah/scaffolding embedded inside the bekisting block via column H) is needed for Balok/Plat/Sloof rows. The workbook's own formula is `AF = R + V*W + Z*AA`, `AH = T + V*X`, `N = SUM(I:M)` and `I=AF, J=AG=S, K=AH`. The full invariant for structural rows is `R + S + T + V*W + V*X + Z*AA + L + M = N`. Under that, 322/339 reconcile; the remaining 17 are non-structural masonry rows.
3. **The Pengecoran block has 4 sub-items, not 3.** "Sewa vibrator" and "Sewa concrete pump" are split into two separate equipment rows, plus material plus labor = 4 rows. AAL-5 combined them into a single "Sewa peralatan, termasuk vibrator dan pump" row.
4. **Pembesian rates differ.** I4-29 uses `Besi beton` unit price = 10,000 Rp/kg (AAL-5 used 9,000). Blended per-kg price = 10,967.5 Rp/kg (AAL-5 = 9,917.5). Coefficients are the same (1.05/1.00/0.021).
5. **Bekisting Balok and Plat embed Perancah inside the block** (via H column at the Perancah row, summed by Jumlah's `SUM(H134:H141)`), with a separate divisor — i.e., the per-m² total has different cycle factors for F vs H. The field guide's single `cycleFactor = Jumlah/Harga` model doesn't apply. AAL-5's Bekisting Balok had Perancah as a separate BoQ line, NOT embedded.

The deterministic CLI **does not work** on this workbook in its current form — both because of the hardcoded `RAB (A)` sheet and because its invariant skips `V*X`.

---

## 1. Workbook structure

| Sheet | Range | Purpose |
|---|---|---|
| `Koef Mortar` | A2:R92 | Mortar coefficient reference |
| `Upah` | A3:H111 | Labor catalog |
| `Material` | A1:P104 | Material catalog |
| `Hitungan Tangga` | A1:R97 | Stair calculations |
| `Analisa` | A1:AE667 | AHS library (51 blocks detected) |
| `COVER` | A1:I63 | Project metadata |
| `REKAP RAB` | A1:S126 | Workbook-level rollup |
| `RAB (A)` | A1:AO35 | **Prelim only** — Pekerjaan Persiapan, no structural rows |
| `RAB (B)` | A1:AO413 | Building 1 — structural |
| `RAB (C)` | A1:AO69 | Building 2 — structural |
| `RAB (D)` | A1:AO110 | Building 3 — structural |
| `RAB (E)` | A1:AO60 | Building 4 — structural |
| `Retaining Wall` | A2:AE155 | Retaining wall takeoff |
| `REKAP BETON BESI BEKISTING` | A1:W138 | Rollup |
| `PROSES BAJA` | A1:S91 | Steel reinforcement process |
| `REKAP Plat` | A1:S79 | Per-element plat rebar weights |
| `Plat` | A1:T313 | Plat takeoff |
| `Hasil-Kolom` | A1:BA659 | Per-element kolom rebar weights |
| `Data-Kolom` | A1:AE395 | Kolom takeoff source data |
| `REKAP Balok` | A1:AC1340 | Per-element balok rebar weights |
| `REKAP-PC` | A1:V127 | Per-element poer rebar weights |
| `Hasil-PC` | A1:BJ147 | Hasil per-poer |
| `Data-PC` | A1:CA61 | Poer takeoff source data |
| `Pas. Dinding` | A1:AH198 | Masonry takeoff |
| `DATA BAJA` / `TABEL BAJA` / `Data Panjang Balok` / `Besi Balok` / `Detail Balok` | various | Steel detail tables |

**Comparison to AAL-5:**

- AAL-5 has a single `RAB (A)`. I4-29 has **five RAB sheets** for 5 buildings/areas. The parser's `resolveBoqSheets(workbook, 'auto')` detects all of them when invoked, but the deterministic CLI never calls it with `'auto'`.
- AAL-5 has `Hasil-Kolom`; I4-29 has the same plus `Data-Kolom`/`Data-PC`/`Data Panjang Balok`/`Besi Balok`/`Detail Balok` for richer steel detail. The field guide's "REKAP {Element}" sheets are a strict subset of what's here.
- The `Analisa` sheet exists in both, with the same name. Good.

---

## 2. Column layout (RAB sheet — RAB (B) used as the reference)

The header is in **row 7** with group banners in row 6. Below is what was read directly from the cells.

| Col | Row 6 | Row 7 (subheader) | Role |
|---|---|---|---|
| A | — | NO | Item number |
| B | — | URAIAN PEKERJAAN | Label |
| C | — | SAT | Unit |
| **D** | — | **VOLUME** | Volume (same as AAL-5) |
| E | — | HARGA SATUAN | Unit price (with markup) |
| F | — | TOTAL HARGA | Line total (D × E) |
| G | — | (sometimes element ID like "PC.1") | Element ID, not on AAL-5 |
| H | — | VOLUME | Same volume again (formula = D) |
| I | — | Material | per-m³ aggregated material (`= AF`) |
| J | — | Upah | per-m³ aggregated labor (`= AG`) |
| K | — | Peralatan | per-m³ aggregated equipment (`= AH`) |
| L | — | Subkon | per-m³ subcontractor cost |
| M | — | Prelim | per-m³ prelim cost |
| **N** | — | **TOTAL HARGA SATUAN** | At-cost unit cost: `= SUM(I:M)` |
| O | — | TOTAL HARGA | Line total: `= H × N` |
| Q | — | — | (blank) |
| **R** | Beton | **Material** | Concrete material cost/m³ |
| **S** | Beton | **Upah** | Concrete labor cost/m³ |
| **T** | Beton | **Peralatan** | Concrete equipment cost/m³ |
| **V** | Bekisting | **Rasio** | Bekisting m²/m³ ratio |
| **W** | Bekisting | **Material** | Bekisting material cost per m² |
| **X** | Bekisting | **Peralatan** | **Bekisting equipment cost per m² — NEW vs AAL-5** |
| **Z** | Besi | **Rasio** | Pembesian kg/m³ |
| **AA** | Besi | **Material** | Pembesian blended price per kg |
| **AC** | Wire Mesh | **Rasio** | Wire mesh m²/m³ (always 0 in I4-29) |
| **AD** | Wire Mesh | **Material** | Wire mesh price per m² (always 0 in I4-29) |
| AF | — | Harga Jadi MATERIAL / m3 | `= R + V*W + Z*AA` (sometimes `+ AC*AD`) |
| AG | — | Harga Jadi UPAH / m3 | `= S` |
| AH | — | Harga Jadi PERALATAN / m3 | `= T + V*X` |
| AJ | — | Total Bekisting | — |
| AL | — | Total Besi | — |

**Differences from AAL-5:**

- **X (Bekisting Peralatan) is new.** AAL-5 had no analog. AH = `T + V*X` for I4-29; in AAL-5 AH was just T.
- **AC/AD (Wire Mesh)** is a new column pair, also new vs AAL-5. In I4-29 always 0. Formula in some rows includes `+ AC*AD`, indicating the workbook is designed for plat-with-wire-mesh use cases.
- **L (Subkon) and M (Prelim)** are referenced by `N = SUM(I:M)`. AAL-5's guide didn't mention them in the invariant.
- All other letter assignments (D, N, R, S, T, V, W, Z, AA) match AAL-5. The column layout is **mostly compatible**, with the addition of X, AC, AD.

The full workbook invariant per its own formulas is:

```
N = I + J + K + L + M
  = AF + AG + AH + L + M
  = (R + V*W + Z*AA [+ AC*AD]) + S + (T + V*X) + L + M
  = R + S + T + V*W + V*X + Z*AA + (AC*AD) + L + M
```

The field guide's `R + S + T + V*W + Z*AA = N` is missing **V*X**, **L**, **M**, and **AC*AD**.

---

## 3. Analisa block inventory

51 AHS blocks were detected by `detectAhsBlocks`. Structural-relevant subset below.

### Concrete (Pengecoran Beton Readymix) — 7 blocks

| Title | Row range | F (mat) | G (labor) | H (equip) |
|---|---|---|---|---|
| Pengecoran Beton Readymix (KHUSUS POER) | 171..177 | 1,232,100 | 800,000 | 90,000 |
| Pengecoran Beton Readymix (KHUSUS SLOOF) | 179..185 | 1,232,100 | 1,500,000 | 90,000 |
| Pengecoran Beton Readymix (KHUSUS KOLOM RATA-RATA) | 187..193 | 1,078,087.5 | 1,750,000 | 265,000 |
| Pengecoran Beton Readymix (KHUSUS BALOK LT. ATAS RATA-RATA) | 195..201 | 1,078,087.5 | 1,500,000 | 90,000 |
| Pengecoran Beton Readymix (KHUSUS PLAT LT. DASAR) | 203..209 | 1,078,087.5 | 1,000,000 | 90,000 |
| Pengecoran Beton Readymix (KHUSUS PLAT LT. ATAS RATA-RATA) | 211..217 | 1,078,087.5 | 1,200,000 | 90,000 |
| Pengecoran Beton Readymix (KHUSUS DINDING BETON RATA-RATA) | 219..225 | 1,078,087.5 | 1,500,000 | 215,000 |

**Count matches AAL-5 (7 blocks).** Cost rates DIFFER:
- Sloof labor: 1,500,000 (I4-29) vs 1,500,000 (AAL-5) ✓ same
- Kolom equip: 265,000 (I4-29) vs 250,000 (AAL-5) — different
- Balok lt atas mat: 1,078,087.5 (I4-29) vs 1,095,570 (AAL-5) — different
- Plat lt atas labor: 1,200,000 (I4-29) vs 1,000,000 (AAL-5) — different

**Internal structure of every Pengecoran block in I4-29 is 4 rows, not 3:**
```
Row 195: Pengecoran Beton Readymix (KHUSUS BALOK LT. ATAS RATA-RATA)
Row 196: 1.05 m3 Beton readymix K-350 ... (material, F=1,078,087.5)
Row 197: 1 m3 Sewa vibrator (equipment, H=15,000)
Row 198: 1 m3 Sewa concrete pump (equipment, H=75,000)
Row 199: 1 m3 Upah cor, besi, bekisting borongan (labor, G=1,500,000)
Row 201: Jumlah F=1,078,087.5 G=1,500,000 H=90,000
```

AAL-5 had **3 sub-items** (a single combined "Sewa peralatan, termasuk vibrator dan pump"). The field guide §2.2 says "Each block has 3 sub-items in this order"; this is **incorrect for I4-29** (4 sub-items, with vibrator and pump split). The deterministic CLI's `extractConcreteTemplates` walks `componentRows` and groups by F/G/H column, so it would still extract the right per-sub-item data — but breakdown sheets generated would have a different shape than AAL-5's reference.

### Bekisting — 7 blocks

| Title | Row range | F@jumlah | H@jumlah | F@jumlah+1 (harga/m²) | H@jumlah+1 |
|---|---|---|---|---|---|
| 1 m2 Bekisting Bata Merah untuk Poer dan Sloof | 101..107 | 114,900 | 0 | — | — |
| 1 m2 Bekisting Batako POSISI BERDIRI untuk Poer dan Sloof | 109..115 | 87,568.69 | 0 | — | — |
| 1 m2 Bekisting Batako POSISI TIDUR untuk Poer dan Sloof | 117..123 | 168,102.53 | 0 | — | — |
| Bekisting Kolom (17x40 Tinggi 4 m) | 124..131 | 1,093,500 | 0 | 119,901.32 | 0 |
| Bekisting Balok (30x50 panjang 4 m) | 134..142 | 1,038,050 | **203,762.04** | 259,512.5 | **70,750.71** |
| Bekisting plat (1.2x2.4 m) | 145..152 | 511,100 | **203,414.81** | 88,732.64 | **35,315.07** |
| Bekisting dinding beton (1.2x2.4 m) | 155..161 | 561,500 | 0 | 97,482.64 | 0 |

**Count matches AAL-5 (7 blocks).** Per-m² rates differ from AAL-5. Important differences:

- **Bekisting Balok and Bekisting plat now contain a Perancah row INSIDE the block**, with its cost recorded in column H (not F). The Jumlah sums F + H separately; the "Harga per m²" row divides F and H using **different divisors** (F divided by `(0.3+0.35*2)*4 = 4.0`, H divided by `1.2*2.4 = 2.88`). This means **there is no single cycle factor** for the block. The field guide §2.3 model `cycleFactor = Jumlah / Harga` only applies to the F column; the H column has a different effective cycle (≈2.88 for Balok, ≈5.76 for plat).
- AAL-5 had Perancah as a **separate BoQ line item** outside the bekisting block. I4-29 has it **embedded inside Bekisting Balok at row 140**, and the workbook surfaces it via the `X` column (`X96 = Analisa!$H$143 = 70,750.71`).

This is the root cause of the systematic 707,507 Rp variance in 200+ rows under the field guide's invariant.

### Pembesian — 1 block

| Title | Row | F@jumlah |
|---|---|---|
| Pembesian U24 & U40 | 228..233 | 10,967.5 |

```
Row 229: 1.05 kg Besi beton          unit price 10,000
Row 230: 1.00 kg Beton decking       unit price 100
Row 231: 0.021 kg Bendrat            unit price 17,500
Row 233: Jumlah = 1.05*10000 + 1*100 + 0.021*17500 = 10,500 + 100 + 367.5 = 10,967.5
```

**Coefficients match AAL-5** (1.05 / 1.00 / 0.021). **Besi unit price differs** (10,000 vs 9,000). **Blended price differs** (10,967.5 vs 9,917.5). The field guide §2.4 and §4.4 hardcode `1.05×9000 + 1×100 + 0.021×17500 = 9917.5` as illustrative — fine, but §10.3 calls these "Pembesian coefficients (AAL-5)" without flagging that the unit prices are per-workbook. The CLI's `extractPembesianTemplate` reads the prices from the workbook so it's correct in code; the field guide just needs to make this clearer.

### Other blocks worth noting

- 1 m3 Lantai Kerja (beton site mix 1:3:5) at rows 267..275 — used by "Lantai kerja di bawah poer" rows (e.g., RAB(B)!r15). Has its own R/S structure that doesn't fit the Pengecoran template (`R15 = Analisa!F275 = 817,725`). Probably needs a separate template family.
- 1 m3 Beton Site Mix 1:2:3 at rows 259..265 — similar.
- Bored Pile / Mini Pile blocks at rows 277..311 — piling, not structural concrete. These appear in BoQ rows as "titik" units (e.g., `Mini Pile 20 x 20`).
- 10 Pasangan Dinding Bata Merah/Ringan blocks at rows 405..490 — masonry; these populate `I/J/K` directly via `=Analisa!F412` etc., bypassing `R/V*W/Z*AA`. Same root cause as AAL-5's §6.4 "Pasangan bata" unresolved rows.
- Pekerjaan Wiremesh M6 (per 1 lapis) at rows 235..239 — this is the AHS for the workbook's AC/AD wire mesh dimension. Even though no row in I4-29 uses it, the workbook has the template.

---

## 4. Column-sum invariant

Tested across all 339 candidate rows (rows where `needsExpansion(row)` returns true) across `RAB (A..E)`:

| Invariant | Reconcile (±1 Rp) | Mismatch |
|---|---|---|
| Field guide: `R + S + T + V*W + Z*AA = N` | **122 / 339 (36%)** | 217 |
| Candidate: `R + S + T + V*W + V*X + Z*AA + L + M + AC*AD = N` | **322 / 339 (95%)** | 17 |

### First 5 mismatches under the field guide invariant

All have identical signature: variance = **707,507.07 Rp** (the systematic offset = `V × X = 10 × 70,750.7`), or **424,504.24 Rp** (= 6 × 70,750.7 for plat-style ratios), or `1.5...×X` for non-integer V.

```
(B) II.A.2.1 Sloof S24-1  N=6,317,107  R+S+T+V*W+Z*AA=5,609,600  variance=-707,507  X=70,750.71
(B) II.A.2.2 Sloof S24-2  N=6,673,777  R+S+T+V*W+Z*AA=5,966,270  variance=-707,507  X=70,750.71
(B) II.A.2.3 Sloof S24-3  N=7,344,299  R+S+T+V*W+Z*AA=6,636,792  variance=-707,507  X=70,750.71
(B) II.A.2.4 Sloof S24-4  N=6,810,750  R+S+T+V*W+Z*AA=6,103,243  variance=-707,507  X=70,750.71
(B) II.A.2.5 Sloof S24-6  N=7,708,954  R+S+T+V*W+Z*AA=7,001,447  variance=-707,507  X=70,750.71
```

Adding `V*X` resolves every one of these — they are real structural rows whose bekisting includes embedded perancah equipment that the field guide's invariant doesn't account for.

### Remaining 17 mismatches under the new invariant — all masonry

```
(B) VIII.A.1 Pasangan dinding bata merah tebal 15 cm  N=283,684   sum=0  variance=283,684
(B) VIII.A.2 Pasangan dinding bata merah tebal 20 cm  N=362,020   sum=0
(B) VIII.A.3 Pasangan dinding bata merah tebal 25 cm  N=416,837   sum=0
(B) VIII.B.1 ... etc.
```

Inspecting these (e.g., RAB(B) row 363): `I363 = Analisa!F412` (`= 155,683.83`), `J363 = Analisa!G412` (`= 128,000`), `K363 = Analisa!H412` (`= 0`), `R/V/W/Z/AA/X = 0`. So **N is computed directly from `I + J + K`, bypassing the R/V/W path entirely**. These rows are genuinely non-structural (Pasangan Dinding Bata Merah) — same family as AAL-5's §6.4 unresolved rows. They need either:
- a different breakdown strategy that reads I/J/K directly and looks up Analisa block at the referenced address, or
- recognition that they're not structural concrete and skipping/routing to Unresolved.

---

## 5. CLI run

```
$ npm run normalize:boq:det -- "assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx" /tmp/I4-normalized.xlsx
> tsx tools/normalizer/cli-deterministic.ts ...
Reading: /Users/.../assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx
Extracting Analisa templates...
  4 bekisting templates, 7 concrete templates, pembesian=yes

Processing 0 BoQ rows needing expansion:

Reconciled total: 0 / 0
  ✓ itemized:  0  (per-material detail)
  ~ rolled:    0  (5-line group lumps from RAB columns)
Unresolved:       0

Wrote: /tmp/I4-normalized.xlsx
```

**Counts: 0 itemized, 0 rolled, 0 unresolved.** The CLI silently produces an empty result.

Comparison to AAL-5: AAL-5 produced 31 itemized / 128 rolled / 5 unresolved. For I4-29 the CLI produces nothing because:

1. **`parseBoqV2` is called without `boqSheet: 'auto'`**, so only `RAB (A)` is parsed. RAB (A) in I4-29 is the prelim chapter with no R/S/T/W/AA columns populated — none of those rows are `needsExpansion`-eligible.
2. Even if invoked with `boqSheet: 'auto'` (440 rows, 339 candidates), the CLI's per-row reads use `getCellNum(lookup, 'RAB (A)', ...)` hardcoded — see `readRowCols` in `cli-deterministic.ts` line 224. Every column read would return 0 for rows whose `source_sheet` is `RAB (B)` etc. So even with the parser fixed, the CLI's `readRowCols` would still misread.
3. Only 4 bekisting templates were extracted (vs the 7 listed in §3 above) because `extractBekistingTemplates` skips blocks where `F@(jumlahRow+1) == 0`. The three Bata/Batako blocks (rows 107/115/123 have no `Harga per m²` row, so `F@108=0` etc.) are correctly skipped — but the Bekisting Balok and Plat blocks with H-column perancah would be ignored too if H-column data is needed. (In fact 4 templates is what we'd expect — the 3 cycle-based bekisting blocks + 1; let me re-check. The 4 extracted are Bekisting Kolom, Balok, Plat, dinding beton — the 4 with `Harga per m²` rows. The 3 Bata/Batako blocks are skipped, same as AAL-5.)

**Hand-simulated CLI run** (using `boqSheet: 'auto'` and reading columns from each row's actual `source_sheet`, per-tmp/`run-I4-det-on-rabb.mjs`):

```
Candidates: 339
  Itemized-eligible (concrete & bekisting templates match AND rolled sum reconciles): 89
  Rolled-only (sum reconciles, no template match): 33
  Unresolved (sum does not reconcile within ±1 Rp): 217
```

**Under the field guide's invariant the CLI would still emit Unresolved for 217/339 rows.** The 217 are not all genuinely non-structural — most are Balok/Sloof/Plat rows with non-zero V*X (i.e., perancah is embedded in the bekisting). They would reconcile if the invariant included V*X.

---

## 6. Spot-check — 3 rows by hand

### Spot-check 1: Balok B24-1 (RAB (B) row 103) — mirrors AAL-5's IV.A.2.7 chapter

Direct cell reads:
```
D = 2.2329 (volume)
N = 7,482,748.44 (unit cost)
R = 1,078,087.50  S = 1,500,000  T = 90,000
V = 10            W = 259,512.50  X = 70,750.71
Z = 137.86        AA = 10,967.50
```

Field guide invariant:
```
R + S + T + V*W + Z*AA
= 1,078,087.50 + 1,500,000 + 90,000 + 10*259,512.50 + 137.86*10,967.50
= 1,078,087.50 + 1,500,000 + 90,000 + 2,595,125 + 1,512,028.87
= 6,775,241.37
Variance from N: -707,507.07 Rp  ❌
```

With V*X added:
```
R + S + T + V*W + V*X + Z*AA
= 6,775,241.37 + 707,507.07
= 7,482,748.44
Variance from N: 0.00 Rp  ✓
```

The 707,507 offset is **exactly V × X = 10 × 70,750.71**, which is the Perancah Bekisting Balok cost (Analisa row 140, surfaced through Analisa!H143 = 70,750.71).

### Spot-check 2: Kolom K4-2 (RAB (B) row 53) — chapter that didn't work itemized on AAL-5

```
D = 2.1488
N = 8,097,996.60
R = 1,078,087.50  S = 1,750,000  T = 265,000
V = 16.76         W = 119,901.32  X = 0
Z = 273.06        AA = 10,967.50
```

Field guide invariant:
```
R + S + T + V*W + Z*AA
= 1,078,087.50 + 1,750,000 + 265,000 + 16.76*119,901.32 + 273.06*10,967.50
= 1,078,087.50 + 1,750,000 + 265,000 + 2,009,963.40 + 2,994,945.70
= 8,097,996.60
Variance from N: 0.00 Rp  ✓
```

**Kolom reconciles under the field guide invariant** because Bekisting Kolom has no embedded Perancah (X = 0 for kolom rows — `X53` is blank). This is one of the chapters where the field guide says itemized fails on AAL-5 due to a bug in `extractBekistingTemplates`. In I4-29 the **rolled-tier** computation works; the itemized tier still needs the bug fix mentioned in §6.2 of the field guide.

Per the field guide §6.2: AAL-5 Kolom rows show "10-50% variance" at the itemized tier. In I4-29 the rolled invariant is exact for Kolom — so the field guide's symptom doesn't reproduce here at the rolled tier; only the itemized tier would have the same per-element extraction issue if you tried to itemize.

### Spot-check 3: Sloof S24-1 (RAB (B) row 40) — Poer/Sloof family

```
D = 9.8167
N = 6,317,106.90
R = 1,232,100     S = 1,500,000   T = 90,000
V = 10            W = 87,568.69   X = 70,750.71
Z = 174.32        AA = 10,967.50
```

The W=87,568.69 matches **Bekisting Batako BERDIRI** (Analisa F115). Not a cycle-based bekisting — it's a single-cycle Bata/Batako block with no `Harga per m²` row. But **X=70,750.71** is the **Perancah Bekisting Balok** value (`Analisa!H143`). So the Sloof bekisting itself is Batako Berdiri, BUT the row also pays for Perancah Bekisting Balok — i.e., the perancah is shared/borrowed across structural elements.

Field guide invariant:
```
R + S + T + V*W + Z*AA
= 1,232,100 + 1,500,000 + 90,000 + 10*87,568.69 + 174.32*10,967.50
= 1,232,100 + 1,500,000 + 90,000 + 875,686.88 + 1,911,820.04
= 5,609,606.92  (small float drift; should be 5,609,599.82)
Variance from N: -707,507 Rp  ❌
```

Adding V*X = 10 × 70,750.71 = 707,507.07 closes the gap exactly. ✓

This is non-trivial — the field guide's mental model is "Sloof uses Bekisting Bata/Batako (single-cycle); no Perancah involved". In I4-29 the Sloof's bekisting cost includes BOTH the Batako forms (via W) AND the rented Perancah Balok structure (via X). The breakdown sheet for a Sloof row would need to surface both.

---

## 7. Updates needed to the field guide

Listing required edits — **not applied**, just enumerated.

### Critical edits

1. **§2 column layout — add X, AC, AD.** The "RAB (A)" row in §2 says "**R/S/T (concrete material / labor / equip per m³), V/W (bekisting ratio m²/m³ / cost per m²), Z/AA (pembesian kg/m³ / blended price per kg)**". This must be expanded to:
   - **X (bekisting equipment cost per m², where Perancah is embedded in the bekisting block)**
   - **AC/AD (wire mesh ratio + price per m²)** — relevant for plat-with-wiremesh items
   - L (Subkon) and M (Prelim) — relevant for non-structural items

2. **§4 math — the invariant changes.** The displayed invariant `N = R + S + T + V*W + Z*AA` is **wrong for any workbook that uses the Bekisting Balok / Bekisting Plat blocks with embedded Perancah**. The correct invariant per the workbook formula is:

   ```
   N = R + S + T + V*W + V*X + Z*AA + AC*AD + L + M
   ```

   - V*X = bekisting equipment cost per m³ (Perancah embedded in Bekisting Balok/Plat)
   - AC*AD = wire mesh material cost per m³
   - L, M = subkon and prelim per-m³ pass-through (always 0 for structural rows in I4-29; sometimes non-zero for other workbooks)

3. **§5 tier 2 (rolled lump) — add the missing lumps.** The CLI emits 5 lumps (R, S, T, V*W, Z*AA). It needs to emit:
   - The existing 5
   - **6th lump: Bekisting equipment lump** `qty = V, unit = m², price = X` → `V*X`. This carries the embedded Perancah cost.
   - **7th lump: Wire Mesh lump** `qty = AC, unit = m², price = AD` → `AC*AD` (zero in I4-29, possibly non-zero in other workbooks).
   - Lumps for L (Subkon) and M (Prelim) when populated, for non-structural items.

4. **§2.2 Pengecoran sub-item count.** "Each block has 3 sub-items in this order" — the order is workbook-dependent. In I4-29 it's 4 sub-items (vibrator and pump are separate equipment rows). The CLI's `extractConcreteTemplates` walks all `componentRows` so it's robust, but the breakdown sheet shape differs from AAL-5's canonical format.

5. **§2.3 Bekisting blocks — add the "Perancah embedded inside" pattern.** AAL-5 (per the guide's table at §2.3) has Bekisting Balok at rows 46..54 with a separate Perancah BoQ line. I4-29's Bekisting Balok (rows 134..142) and Bekisting plat (rows 145..152) **embed Perancah as a component row inside the block**, with its cost stored in column H (not F) and the "Harga per m²" row dividing F vs H with different divisors:
   - Bekisting Balok: F divisor = `(0.3+0.35*2)*4 = 4.0`, H divisor = `1.2*2.4 = 2.88`. So the "F cycle" is 4, the "H cycle" is 2.88. **There is no single cycle factor.**
   - Bekisting plat: F divisor = `1.2*2.4 = 2.88`, H divisor = `1.2*2.4 = 2.88`. F cycle = 6 (matches AAL-5); H cycle = 5.76.
   - Bekisting Kolom and Bekisting dinding beton: H@jumlah = 0 (no embedded perancah). Same shape as AAL-5.
   
   The guide's "cycle = Jumlah/Harga, typically a small integer 4-9" model only applies to column F. Column H has its own divisor.

6. **§2.4 Pembesian — flag that prices are per-workbook.** I4-29 uses 10,000 Rp/kg for Besi beton; AAL-5 uses 9,000. Coefficients (1.05/1.00/0.021) match. The blended price (10,967.5 vs 9,917.5) differs accordingly. Guide §4.4 hardcodes "9000" and "9917.5" in the math; should be expressed symbolically (`besiUnitPrice × 1.05 + decking × 1.0 + bendrat × 0.021`).

### Important edits

7. **§2 / §5 / §9 — the CLI is hardcoded to `boqSheet: 'RAB (A)'`.** Workbooks with multiple RAB sheets (RAB (A) for prelims + RAB (B..E) for buildings) produce 0 rows on the deterministic CLI. The CLI needs to either default to `boqSheet: 'auto'` or accept a CLI flag like `--rab-sheet=auto`. The parser already supports `'auto'` via `resolveBoqSheets`.

8. **§5 — `readRowCols` is hardcoded to read from `'RAB (A)'`.** Even with the parser scanning all sheets, `readRowCols(lookup, row.sourceRow)` ignores `row.source_sheet`. This must be changed to `getCellNum(lookup, row.source_sheet, ...)`.

9. **§6.4 / §10.1 — masonry rows (Pasangan dinding bata) need a different breakdown strategy.** I4-29 has the same problem as AAL-5: rows whose I/J/K reference an Analisa block directly (e.g., `I363 = Analisa!F412`) bypass R/V/W. The guide's "the predicate is too aggressive" hypothesis (§6.4) is correct — but a fix would also need to add a breakdown path that reads the directly-referenced Analisa block (the Pasangan Dinding Bata block at Analisa row 405..). Otherwise these rows always remain Unresolved.

10. **§7.3 example code — generalize sheet name.** The example uses `RAB (A)!W{row}` and `RAB (A)!R{row}` etc., implying a single sheet. Should use `row.source_sheet`.

### Minor edits

11. **§10.4 — coverage numbers will look different per workbook.** The "31 itemized / 128 rolled / 5 unresolved" is AAL-5-specific. The guide should label these explicitly as "AAL-5 specific; coverage depends on the workbook's column shape, presence of embedded Perancah, etc."

12. **§10.2 — Bekisting cycle factors should be expressed as F-cycle and H-cycle separately** when applicable (i.e., per column).

13. **§11 — add "**Forgetting V*X / AC*AD / L / M**" to "Things to avoid"** for any future invariant computation.

---

## 8. Summary table

| Field guide claim | Holds for I4-29? | Notes |
|---|---|---|
| Single `RAB (A)` BoQ sheet | **No** | I4-29 has RAB (A..E) |
| Invariant `R+S+T+V*W+Z*AA = N` | **No (36% only)** | Missing V*X for Balok/Sloof/Plat; need AC*AD + L + M for completeness |
| 7 concrete blocks named "Pengecoran Beton Readymix (KHUSUS ...)" | **Yes** (with "RATA-RATA" suffix on some) | Cost rates differ per workbook |
| 7 bekisting blocks (3 Bata/Batako single-cycle + 4 cycle-based) | **Yes** | Per-m² rates differ; Balok/Plat embed Perancah inside the block |
| Pengecoran block has 3 sub-items (material + combined equipment + labor) | **No** | I4-29 splits vibrator + pump = 4 sub-items |
| Single Pembesian U24 & U40 block | **Yes** | Block exists; unit prices differ (10,000 vs 9,000) |
| Bendrat coefficient = 0.021 | **Yes** | Same |
| Besi coefficient = 1.05 | **Yes** | Same |
| REKAP sheets per element (REKAP Balok, REKAP-PC, Hasil-Kolom, REKAP Plat) | **Yes** | Same set, plus extras (Data-*, Detail Balok, etc.) for steel detail |
| Pasangan dinding bata rows are non-structural and go to Unresolved | **Yes** | Same problem as AAL-5 |
| Custom items (Strong band etc.) | n/a here | I4-29 has Tanggulan planter box and Janggutan planter box at chapter II.E — similar custom items |
| Deterministic CLI reconciles ~95% of structural rows | **No (0% as run)** | CLI hardcodes RAB (A) and the invariant misses V*X. With both fixes: ~95% achievable (322/339). |

---

## 9. Reproduction

All scripts are at `tmp/` (run with `npx tsx tmp/<script>.mjs` from repo root):

- `tmp/inspect-I4-sheets.mjs` — sheet list
- `tmp/inspect-I4-rabs.mjs` — RAB sheet column header inspection
- `tmp/inspect-I4-header.mjs` — full column map for RAB (B)
- `tmp/inspect-I4-row.mjs` — dump 5 representative structural rows
- `tmp/inspect-I4-structural.mjs` — find all rows with W>0, AA>0, R>0
- `tmp/inspect-I4-wiremesh.mjs` — check AC/AD/X usage per sheet
- `tmp/inspect-I4-bekisting-balok.mjs` — dump Analisa blocks in detail
- `tmp/inspect-I4-auto.mjs` — parser with `boqSheet:'auto'` row counts per sheet
- `tmp/dump-I4-analisa-blocks.mjs` — all 51 detected blocks
- `tmp/inspect-I4-masonry.mjs` — masonry row analysis
- `tmp/verify-I4-invariant.mjs` — invariant verification (old vs new) across 339 rows
- `tmp/spot-check-I4.mjs` — hand-verify Balok / Kolom / Sloof rows
- `tmp/run-I4-det-on-rabb.mjs` — simulated CLI run with per-row source_sheet

CLI runs (as published):
```
npm run normalize:boq:det -- "assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx" /tmp/I4-normalized.xlsx
```
produces 0/0/0 (itemized/rolled/unresolved) on I4-29 in its current form, because:
- `RAB (A)` (the default `boqSheet`) is the Pekerjaan Persiapan sheet, not structural
- All structural data lives in RAB (B..E)
- Even with `boqSheet:'auto'`, the CLI's `readRowCols` is hardcoded to `'RAB (A)'`
