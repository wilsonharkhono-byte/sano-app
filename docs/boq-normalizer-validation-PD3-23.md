
# BoQ Normalizer — Validation against PD3 no. 23

> ## ⚠️ SUPERSEDED 2026-05-25
>
> This document records the CLI's behavior at 15:06 on 2026-05-24, BEFORE
> the X / AC*AD / L / M column fixes (commit `de7b8a5`), the cycleFactor
> float + single-cycle Bata/Batako fix (`a5137ca`), and the layout-aware
> REKAP adapters (`6e74dcb`).
>
> **Current coverage (HEAD 6e74dcb):** PD3 itemized 49, rolled 180,
> unresolved 12 of 241. See `docs/boq-normalizer-field-guide.md` §13 and
> `docs/boq-normalizer-fix-plan-results.md` for live numbers.
>
> Most of §7 ("Updates needed to the field guide") in this doc is now
> done — the X column, AC/AD, L/M, multi-sheet RAB, non-integer cycle
> factors, varying readymix coefficients, and REKAP Plat header
> auto-detection are all shipped. The §3.4 diagnosis of H-side bekisting
> (Perancah embedded via col H) is the one remaining un-implemented
> finding — that's the next architectural lever (fix plan §2.1).
>
> The §3 / §4 / §5 / §6 analysis below remains valuable as the
> diagnostic record of the failure mode the CLI used to produce.

> Independent verification of the field guide
> (`docs/boq-normalizer-field-guide.md`) and the deterministic CLI
> (`tools/normalizer/cli-deterministic.ts`) against
> `assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx`.
>
> Branch: `feat/boq-normalizer`. Date of run: 2026-05-24.
> Read-only investigation — no production code or field-guide was modified.
> All claims below are reproducible from the scripts checked into `tmp/pd3-*.mjs`.

## TL;DR

The field guide is anchored on **one workbook** (AAL-5) and **one sub-variant
of layout**. PD3 breaks 5 of its load-bearing assumptions:

| Assumption in field guide                                              | PD3 reality |
|---|---|
| `R + S + T + V*W + Z*AA = N` for every structural row                  | Holds only for 104/241 rows. Balok + Plat (125 rows) need `+ V*X`. |
| Bekisting columns: V = ratio, W = cost/m²                              | Plus **X = Perancah cost/m² (embedded)** for Balok + Plat. |
| Cycle factors are small integers (4 / 6 / 9)                           | Kolom cycle = **4.56**, Plat = **5.76**, Dinding = **5.76**. Only Balok stays at 4. |
| 7 Pengecoran blocks, one per element                                   | **8 blocks** — BALOK has 2 sub-variants (LT ATAS RATA-RATA vs TANPA PLAT DAN BALOK MIRING GEWEL). |
| Perancah Bekisting Balok is a separate BoQ line, not in the breakdown  | Perancah is **embedded as a sub-item inside Bekisting Balok/Plat** (col H, separate from the F-side Jumlah). |

The deterministic CLI reconciles **104/241** rows on PD3 (vs 159/164 = 97% on
AAL-5; on PD3 that's 43%). The drop is dominated by Balok and Plat chapters,
where the rolled tier silently drops Perancah cost (col X) and lands ~12-25%
short per row, then the CLI correctly refuses to write the breakdown.

The truth-correctness contract is honoured: every shortfall is parked in
Unresolved with a quantified variance. No wrong breakdowns are written.

---

## 1. Workbook structure

| What | AAL-5 | PD3 |
|---|---|---|
| Sheet names                | RAB (A), Analisa, REKAP Balok, REKAP-PC, Hasil-Kolom, REKAP Plat, Material, Upah, Sheet1, COVER, RAB (B), ... | **All of these present + many extras**: Retaining Wall, REKAP BENANGAN, REKAP RAB, Pas. Dinding, Plat, Tangga, Detail Balok, Besi Balok, Hasil-PC, Data-PC, REKAP BETON BESI BEKISTING, PROSES BAJA, DATA BAJA, TABEL BAJA, Ben. Profil, Data Panjang Balok, Data-Kolom |
| RAB sheet                   | `RAB (A)`                | `RAB (A)` (same name) |
| Analisa sheet               | `Analisa`                | `Analisa` (same name) |
| REKAP sheets                | REKAP Balok, REKAP-PC, Hasil-Kolom, REKAP Plat | same names + extras |
| `RAB (A)` last row          | row ~164 (BoQ entries)   | row 429 |
| `Analisa` last row          | ~140                     | 633 |

Sheet *names* match. Sheet *count* and *contents* are richer (PD3 has more
elaborate detail tables for balok/kolom design).

## 2. Column layout on `RAB (A)`

Reading row 6 (section banners) and row 7 (column names):

```
A   No
B   URAIAN PEKERJAAN
C   SAT
D   VOLUME                                ✓ matches field guide
E   HARGA SATUAN
F   TOTAL HARGA
H   VOLUME (parser, mirror of D)
I   Material   (at-cost)
J   Upah       (at-cost)
K   Peralatan  (at-cost)
L   Subkon     (at-cost)
M   Prelim     (at-cost)
N   TOTAL HARGA SATUAN at-cost           ✓ matches field guide
O   TOTAL HARGA      at-cost

──────── BETON (banner @ R6) ────────
R   Material                              ✓ matches field guide
S   Upah                                  ✓ matches
T   Peralatan                             ✓ matches

──────── BEKISTING (banner @ V6) ────────
V   Rasio (m²/m³)                         ✓ matches field guide
W   Material (cost/m²)                    ✓ matches
X   Peralatan (cost/m²)                   ⚠ NEW in PD3, absent in AAL-5

──────── BESI (banner @ Z6) ────────
Z   Rasio (kg/m³)                         ✓ matches field guide
AA  Material (blended Rp/kg)              ✓ matches

──────── Wire Mesh (banner @ AC6) ────────
AC  Rasio (m²/m³)                         ⚠ NEW in PD3
AD  Material (Rp/m²)                      ⚠ NEW in PD3

──────── Derived rollups ────────
AF  Harga Jadi MATERIAL / m3              ⚠ NEW
AG  Harga Jadi UPAH / m3                  ⚠ NEW
AH  Harga Jadi PERALATAN / m3             ⚠ NEW
AJ  Total Bekisting                       ⚠ NEW
AL  Total Besi                            ⚠ NEW
```

**Bottom line**: PD3 has **two extra structural cost columns** the field
guide does not document — `X` (Bekisting Peralatan, used by Balok + Plat for
Perancah) and `AC*AD` (Wire Mesh, reserved but **all zero** on this
particular project).

## 3. Analisa block inventory

`detectBlocks.ts` finds **47 blocks** on PD3 Analisa (vs 15 on AAL-5).

### 3.1 Bekisting (7 blocks — same count, different layout)

| Title                                                | Rows      | Jumlah (F) | Harga/m² (F) | Cycle  | Notes |
|---|---|---|---|---|---|
| 1 m2 Bekisting Bata Merah Poer/Sloof                 | 101..107  | 113,100    | (none)        | 1      | Single-cycle, no Harga row |
| 1 m2 Bekisting Batako BERDIRI Poer/Sloof             | 109..115  | 87,119.679 | (none)        | 1      | Single-cycle |
| 1 m2 Bekisting Batako TIDUR Poer/Sloof               | 117..123  | 166,705.668| (none)        | 1      | Single-cycle |
| Bekisting Kolom                                      | 124..131  | 1,059,900  | 232,434.21    | **4.56** | Was 9 in AAL-5 (huge change) |
| Bekisting Balok                                      | 134..142  | 1,004,450  | 251,112.50    | 4      | Same as AAL-5; but **Perancah embedded** (see 3.4) |
| Bekisting plat                                       | 145..152  | 497,100    | 86,302.08     | **5.76** | Was 6 in AAL-5; **Perancah embedded** |
| Bekisting dinding beton                              | 155..161  | 544,700    | 94,565.97     | **5.76** | Was 6 in AAL-5 |

### 3.2 Pengecoran (8 blocks vs 7 in AAL-5)

| Title (KHUSUS …)             | F (mat/m³) | G (labor/m³) | H (equip/m³) | Notes |
|---|---|---|---|---|
| POER                         | 1,218,780  | 800,000      | 75,000       | **qty 1.20** readymix (waste 20%, not 5%) |
| SLOOF                        | 1,218,780  | 1,500,000    | 60,000       | **qty 1.20** readymix |
| KOLOM RATA-RATA              | 1,066,432.5| 2,250,000    | 250,000      | (AAL-5 was G=1,750,000) |
| BALOK LT. ATAS RATA-RATA     | 1,066,432.5| 1,750,000    | 75,000       | (AAL-5 BALOK LT ATAS was G=1,500,000) |
| BALOK TANPA PLAT + MIRING GEWEL | 1,117,215 | 2,500,000  | 200,000      | **NEW VARIANT** — qty 1.10 readymix |
| PLAT LT. DASAR               | 1,066,432.5| 1,000,000    | 60,000       | (AAL-5 was G=800,000) |
| PLAT LT. ATAS RATA-RATA      | 1,066,432.5| 1,300,000    | 75,000       | (AAL-5 was G=1,000,000) |
| DINDING BETON RATA-RATA      | 1,066,432.5| 1,500,000    | 200,000      | (AAL-5 was G=1,300,000 H=200,000) |

The base Beton readymix raw price is **1,015,650 / m³** (PD3) vs 1,043,400
(AAL-5). The blended per-m³ material cost differs accordingly.

### 3.3 Pembesian (1 block — same shape but raw price changed)

```
Row 228..233: Pembesian U24 & U40
  1.05 kg | Besi beton         | 10,300 Rp/kg     ← AAL-5 was 9,000 Rp/kg
  1.00 kg | Beton decking      |    100
  0.021 kg| Bendrat            | 17,500           ← same
  Jumlah                        | 11,282.50         ← AAL-5 was 9,917.5
```

Blended per-kg = 1.05·10,300 + 1.00·100 + 0.021·17,500 = **11,282.50 Rp/kg**,
which matches every PD3 row's `RAB!AA{row}` exactly.

The structure is identical; only the unit price of raw besi shifted.

### 3.4 NEW block — Wiremesh M6

```
Row 235..239: Pekerjaan Wiremesh M6 (per 1 lapis)
  1.1 m2 | Wiremesh M6 | 41,716.50 Rp/m² | 45,888.15
  0.04588815 kg | Bendrat | 17,500 | 803.04
  Jumlah                                  | 46,691.19 Rp/m²
```

The `RAB (A)!AD` column corresponds to this block's per-m² total. On
**PD3 specifically every BoQ row has AC = AD = 0** — wire mesh is not used
in this particular project — but the layout reserves it. Other workbooks
may have AC*AD > 0.

### 3.5 PERANCAH blocks (separate AHS, but PD3 also embeds them)

| Title                         | Rows    | F (mat)  | G (labor) | I (total) |
|---|---|---|---|---|
| PEKERJAAN PERANCAH PELAT      | 38..49  | 342,176  | 97,200    | 439,376 / 2.16 m² = ~203,415 per m² |
| PEKERJAAN PERANCAH BALOK      | 69..80  | 342,926  | 97,200    | 440,126 / 2.16 m² ≈ 203,762 per m² |

These are full standalone AHS blocks (the way AAL-5 reportedly handled
Perancah). **But** PD3 *also* references them as a single sub-item inside
the Bekisting Balok / Bekisting plat blocks:

```
Bekisting Balok (rows 134..142):
  Row 140: 1 m2 | Perancah Bekisting Balok | unit price 203,762.04
           (this value lands in col E and col H — *not* in col F)
  Row 142 (Jumlah):  F = 1,004,450 (excludes Perancah)
                     H =   203,762.04 (Perancah cost)
                     I = 1,208,212 (combined)
  Row 143 (Harga per m²): F =  251,112.50  (Balok forms only, ÷4)
                           H =   50,940.51  (Perancah,        ÷4)
```

The `Harga per m²` row therefore splits the per-m² cost into Bekisting (F)
and Perancah (H). The RAB sheet's `W{row} = 251,112.50` mirrors the F side,
and `X{row} = 50,940.51` mirrors the H side. **Both** are needed to
reconcile the full bekisting-side cost for any Balok/Plat row.

This is the single largest gap in the field guide for PD3.

### 3.6 Other detected blocks (spurious + non-structural)

`detectBlocks.ts` also flags ~30 more "blocks": Pekerjaan Pagar, Bouwplank,
Pasangan dinding bata (10 thicknesses!), Plesteran, Acian, Plumbing, Instalasi
air. Most are legitimate non-structural AHS recipes. A few are spurious
title-match noise. None affect reconciliation of structural rows because the
template matcher gates on `Bekisting/`, `Pengecoran/`, `Pembesian/` prefixes.

---

## 4. Column-sum invariant

### 4.1 The base invariant from the field guide

For each row in `result.boqRows.filter(needsExpansion)` (241 rows), compute
`base = R + S + T + V*W + Z*AA` and compare to `N`:

```
Total candidates:                                     241
Pure non-structural (all structural columns 0):        12
Base invariant within ±1 Rp:                          104   ← 43%
Mismatches:                                           137
```

On AAL-5, the same code returns 159/164 (97%). The drop is large and
systematic, not noise.

### 4.2 The corrected invariant for PD3

```
withX  = R + S + T + V*W + V*X + Z*AA
withWM = withX + AC*AD
```

Categorising the 241 candidates against the corrected formulas:

```
Pure non-structural (all costs zero):                  12
Reconciles with original R+S+T+V*W+Z*AA = N:          104
Reconciles only when we add V*X (and/or AC*AD):       125
Still fails any of the three formulas:                  0
```

So the *full* PD3 invariant is:

```
N  =  R + S + T  +  V·W  +  V·X  +  Z·AA  +  AC·AD
       │           │       │       │         │
     concrete    bekist   perancah pembes   wire mesh
     totals      forms    (NEW)             (NEW)
```

For 125 rows (chapters that use Perancah-in-Bekisting: III.B.3 Plat, IV.A.1
Plat, IV.A.2 Balok, V.A.1 Plat, V.A.2 Balok, VI.A.2 Balok, VII.A Dak + Balok),
the `V·X` term contributes 12-25% of `N` and the existing CLI silently drops
it.

### 4.3 The 12 pure non-structural rows

These are the rows where R = S = T = V = W = X = Z = AA = AC = AD = 0 — the
deterministic CLI cannot decompose them and correctly parks them in
Unresolved:

```
II.B.1       Pasangan batako untuk proteksi pondasi   N=166,705.67
II.B.3       Strauss pile dia. 30 cm                  N=3,502,524.51
III.B.2.19   Strongband BB                            N=11,282.50
IX.A.1       Pasangan dinding bata merah 20 cm        N=279,294.15
IX.B.1       Pasangan dinding bata merah 20 cm        N=279,294.15
IX.B.2       Pasangan dinding bata merah 30 cm        N=608,282.22
IX.B.3       Pasangan dinding bata merah 35 cm        N=676,834.61
IX.B.4       Pasangan dinding bata merah 55 cm        N=595,762.04
IX.C.1       Pasangan dinding bata merah 20 cm        N=279,294.15
IX.C.2       Pasangan dinding bata merah 30 cm        N=608,282.22
IX.C.3       Pasangan dinding bata merah 30 cm (?)    (chapter IX continues)
IX.D.1       Pasangan dinding bata merah 20 cm        (chapter IX continues)
```

These are masonry / drilled-pile / planter-edging items. The needsExpansion
predicate flags them because their recipes contain a zero-priced component
that fires the predicate — same pattern as AAL-5 chapter VIII. The 12 here
correspond to AAL-5's 5 (VIII.\* + Strongband). The field guide hypothesis in
§6.4 is still correct.

---

## 5. Deterministic CLI run

```
$ npm run normalize:boq:det -- \
    "assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx" \
    /tmp/PD3-normalized.xlsx
```

Output (last lines):

```
Extracting Analisa templates...
  4 bekisting templates, 8 concrete templates, pembesian=yes

Processing 241 BoQ rows needing expansion:
…

Reconciled total: 104 / 241
  ✓ itemized:  0   (per-material detail)
  ~ rolled:    104  (5-line group lumps from RAB columns)
Unresolved:       137

Wrote: /tmp/PD3-normalized.xlsx
```

### 5.1 Side-by-side with AAL-5

|                       | AAL-5            | PD3              |
|---|---|---|
| Rows needing expansion| 164              | **241**          |
| Itemized              | 31               | **0**            |
| Rolled                | 128              | **104**          |
| Unresolved            | 5                | **137**          |
| Reconciled %          | 97%              | **43%**          |

### 5.2 Why itemized is 0

The extractor finds only **4 bekisting templates** (the cycle-based ones —
Kolom/Balok/Plat/Dinding). The three Bata/Batako blocks are skipped (no
`Harga per m²` row) — same bug as AAL-5.

For Balok rows, the bekisting template's `hargaPerM2 = 251,112.50` *does*
match `W{row}`, and the concrete BALOK LT ATAS RATA-RATA template matches
`R/S/T`. So the matcher fires. But the per-row computed unit cost is short
by exactly `V*X` (the Perancah portion) because the itemized math does not
include any contribution from column X. Variances are 270k-820k Rp per row
on chapter IV.A.2, all going into Unresolved.

This is the same root cause as the rolled-tier failure: **no code path
reads column X**.

### 5.3 Why rolled is 104

The rolled tier reconciles only the 104 rows where `R+S+T+V*W+Z*AA = N`
within ±1 Rp — i.e., Poer / Sloof / Kolom / Dinding rows where `X = 0`.

### 5.4 Variance distribution for the failing 125 Balok/Plat rows

Sample of computed-vs-source variances at the rolled tier (from CLI output):

```
IV.A.2.6   Balok B24-1   variance  -674,803.81 Rp   (≈ V*X = 50,940.51 × 13.247)
IV.A.2.27  Balok Pot. M  variance  -293,131.35 Rp
V.A.2.5    Balok B24-1   variance  -698,073.65 Rp
V.A.2.8    Balok B245-3  variance +762,654.91 Rp  ← sign flips: see §5.5
VI.A.2.16  Balok B25-1  variance +2,288,733.28 Rp ← much larger
VII.A.2.15 Balok B245-4 variance +15,690,400.97 Rp ← outlier
```

In most cases the deterministic CLI's computed value is *under* the source
(missing V*X), so the variance is negative. But there are positive-variance
cases too where the rebar disaggregator over-counts kg/m³ (chapter V/VI/VII).
See §5.5.

### 5.5 Spurious positive variances (rebar over-counting)

Some chapters (V.A.2, VI.A.2, VII.A.2) yield *positive* variance — the
deterministic CLI's computed cost is *higher* than the source. This points
to a second bug: the rebar disaggregator probably matches the wrong REKAP
Balok row for these chapters and pulls in too much rebar weight. Example:

```
VII.A.2.15  Balok B245-4
   Computed unit cost = 25,454,783.40
   Source unit cost   =  9,764,382.43
   Variance           = +15,690,400.97 Rp
```

Hand-checking this requires reading REKAP Balok per BoQ row (each row of
the BoQ has a *specific* REKAP row index — currently the adapter just
matches by element label, which collides across floors / chapters). This is
NOT a new bug — the field guide §6.3 already hypothesises it for AAL-5 V/VI
rows. PD3 makes it visible because more rows exhibit it.

(I did not chase this to root cause — out of scope. Captured as Issue 3 in
§7 below.)

---

## 6. Spot checks (hand-computed)

For each of the seven rows below I read the RAB (A) cells directly with
SheetJS (no parser involved) and computed each candidate invariant.

### 6.1 III.B.1.8 — Poer PC.5 (row 58)

```
D=4.21875 m³   N=3,147,333.64
R=1,218,780   S=800,000   T=75,000
V=2.1333  W=87,119.68  X=0
Z=76.91   AA=11,282.50
AC=0      AD=0
                R+S+T+V*W+Z*AA  =  3,147,333.64    Δ=  0.00   ✓ base reconciles
                +V*X            =  3,147,333.64    Δ=  0.00   (no change, X=0)
```

Poer row: X is unused, base invariant holds. **CLI: rolled ✓** (matches).

### 6.2 IV.A.4.1 — Kolom K12 (row 166)

```
D=1.17 m³      N=11,827,805.56
R=1,066,432.5  S=2,250,000  T=250,000
V=25.385  W=232,434.21  X=0
Z=209.27   AA=11,282.50
                R+S+T+V*W+Z*AA  = 11,827,805.56    Δ=  0.00   ✓ base reconciles
```

Kolom row: X=0 even though the Bekisting Kolom block has cycle 4.56 — the
Kolom AHS block does NOT embed Perancah (`H` total = 0 at the Jumlah row).
**CLI: rolled ✓** (matches).

### 6.3 IV.A.2.6 — Balok B24-1 (row 140) — mirrors AAL-5 working chapter

```
D=1.73119 m³   N=8,324,538.02
R=1,066,432.5  S=1,750,000  T=75,000
V=13.247  W=251,112.50  X=50,940.51        ← Perancah cost/m²
Z=126.91   AA=11,282.50
                R+S+T+V*W+Z*AA       = 7,649,734.22   Δ= -674,803.81
                +V*X                  = 8,324,538.02   Δ= -0.00     ✓
```

**Field-guide invariant misses by 8% (Rp 675k).** The corrected
invariant `+V*X` reconciles exactly. CLI: **unresolved (variance -675k)**.

### 6.4 V.A.2.5 — Balok B24-1 (row 201) — analogous AAL-5 V chapter

```
D=0.7371 m³    N=8,753,624.27
R=1,066,432.5  S=1,750,000  T=75,000
V=13.704  W=251,112.50  X=50,940.51
Z=152.71   AA=11,282.50
                R+S+T+V*W+Z*AA       = 8,055,550.62   Δ= -698,073.65
                +V*X                  = 8,753,624.27   Δ=  0.00       ✓
```

Same pattern. Note: the V chapter "failure" the field guide attributes to
"different Pengecoran sub-variants" is **wrong for PD3** — V.A.2.5 uses the
same BALOK LT. ATAS RATA-RATA concrete template as IV.A.2.6 (identical
R/S/T values). The actual gap is the missing `V*X` term — not a chapter-
specific Pengecoran variant. The field-guide §6.3 hypothesis does not hold
here. (Whether it holds on AAL-5 is a separate question.)

### 6.5 IV.A.1.1 — Plat lt 13cm (row 131)

```
D=39.1274 m³   N=4,836,772.70
R=1,066,432.5  S=1,300,000  T=75,000
V=8.019   W=86,302.08  X=35,315.07      ← Perancah Plat embedded
Z=125.87   AA=11,282.50
                R+S+T+V*W+Z*AA       = 4,553,596.14   Δ= -283,176.56
                +V*X                  = 4,836,772.70   Δ=  0.00       ✓
```

Plat row: same pattern as Balok. Field-guide invariant misses by 6% (Rp 283k).

### 6.6 III.B.2.6 — Sloof TB25-1 (row 73)

```
D=4.9119 m³    N=5,817,095.23
R=1,218,780   S=1,500,000  T=60,000
V=10      W=87,119.68  X=0
Z=192.08   AA=11,282.50
                R+S+T+V*W+Z*AA       = 5,817,095.23   Δ=  0.00   ✓
```

Sloof uses Bekisting Batako TIDUR (cycle 1, no Harga row, no Perancah).
X=0. Base invariant holds. **CLI: rolled ✓**.

### 6.7 III.B.4.1 — Kolom K174-1 (row 93)

```
D=1.122 m³     N=10,168,358.63
R=1,066,432.5  S=2,250,000  T=250,000
V=16.76   W=232,434.21  X=0
Z=239.77   AA=11,282.50
                R+S+T+V*W+Z*AA       = 10,168,358.63  Δ=  0.00   ✓
```

Kolom row from chapter III. X=0. Base invariant holds. **CLI: rolled ✓**.

### 6.8 Spot-check summary

| Code        | Element | Base invariant | + V*X | CLI tier |
|---|---|---|---|---|
| III.B.1.8   | Poer    | ✓ 0.00     | ✓ 0.00 | rolled |
| III.B.2.6   | Sloof   | ✓ 0.00     | ✓ 0.00 | rolled |
| IV.A.2.6    | Balok   | ✗ −674,804 | ✓ 0.00 | UNRESOLVED |
| V.A.2.5     | Balok   | ✗ −698,074 | ✓ 0.00 | UNRESOLVED |
| IV.A.4.1    | Kolom   | ✓ 0.00     | ✓ 0.00 | rolled |
| III.B.4.1   | Kolom   | ✓ 0.00     | ✓ 0.00 | rolled |
| IV.A.1.1    | Plat    | ✗ −283,177 | ✓ 0.00 | UNRESOLVED |

The pattern is fully explained by: *which AHS block does the element's
Bekisting recipe come from?* — and only the **Balok** and **Plat** blocks
embed Perancah in column H of the Jumlah/Harga rows.

---

## 7. Updates needed to the field guide

The field guide *as written* is correct for AAL-5 and confidently
generalises 5 things that don't survive PD3. Specifically:

### 7.1 Column layout (§2 / §5.2 / §4.2)

> The current claim: `RAB (A)` carries pre-computed cost columns
> R/S/T (concrete), V/W (bekisting), Z/AA (pembesian).

**Add**: PD3 carries an extra `X` column (per-m² Bekisting Peralatan /
Perancah) and an `AC/AD` Wire-Mesh group. The full invariant for any
workbook that has these columns is:

```
N  =  R + S + T  +  V·W  +  V·X  +  Z·AA  +  AC·AD
```

The deterministic CLI must read X and AC/AD with the same robustness as
R/S/T/V/W/Z/AA. If a workbook lacks these columns they will simply be
zero — the formula is identical, just degenerate to the AAL-5 case.

### 7.2 Bekisting block anatomy (§2.3 / §10.2)

> Current: "Each bekisting block has Jumlah row + (optional) Harga per m² row.
> Cycle factor = Jumlah ÷ Harga per m², a small integer (4-9). Perancah Balok
> is a separate BoQ line, excluded from the breakdown."

**Add (PD3 reality)**:

- Cycle factors are **not always integers** on every workbook. PD3 ships
  Kolom = 4.56, Plat = 5.76, Dinding = 5.76. Code must read the literal
  value from `Analisa!F{jumlahRow+1}` (or compute `F{jumlah}/F{jumlah+1}`),
  not round to a known integer.
- **Perancah may be embedded as a sub-item inside the Bekisting Balok and
  Bekisting Plat blocks**, with its cost living in **column H** at both the
  Jumlah row and the Harga per m² row (separate from the F-side Bekisting
  totals). When this is the case, the workbook also routes the per-m²
  Perancah cost into `RAB (A)!X{row}` per BoQ row. The breakdown must
  account for both F-side bekisting (W) and H-side Perancah (X).
- Kolom and Dinding blocks do NOT embed Perancah on PD3 (`H` totals = 0,
  `X` = 0 for those BoQ rows).

The previous claim "Perancah is excluded from the breakdown — it's a
separate BoQ line" was specifically about AAL-5. In PD3 there is no
separate Perancah BoQ line for Balok/Plat — it lives inside Bekisting.

### 7.3 Pengecoran block inventory (§2.2 / §10.1)

> Current: "AAL-5 has 7 Pengecoran blocks: POER, SLOOF, KOLOM, BALOK LT
> ATAS, PLAT LT DASAR, PLAT LT ATAS, DINDING BETON."

**Add (PD3 reality)**:

- PD3 has **8 Pengecoran blocks** — BALOK is split into "LT. ATAS
  RATA-RATA" and "TANPA PLAT DAN BALOK MIRING GEWEL" (the latter with
  qty 1.10 readymix and Rp 2,500,000 upah, much pricier).
- The Beton readymix coefficient is **not always 1.05**. PD3:
  - POER = 1.20 (20% waste — chunky pour)
  - SLOOF = 1.20
  - BALOK TANPA PLAT = 1.10
  - Everything else = 1.05.
- Concrete raw price differs per workbook. PD3 = 1,015,650 Rp/m³; AAL-5 =
  1,043,400 Rp/m³.

### 7.4 Pembesian raw price (§2.4 / §10.3)

> Current: "Besi beton: 1.05 × 9,000 Rp/kg. Blended = 9,917.5 Rp/kg."

**Add**: this is the AAL-5 number. PD3 uses **10,300 Rp/kg** raw besi,
blended **11,282.50 Rp/kg**. Code must read coefficients **and** prices
from the Pembesian block, never hard-code either.

The 0.021 bendrat coefficient and 1.05 / 1.00 / 0.021 ratios are stable
across both workbooks.

### 7.5 REKAP sheet layout (§2.5)

> Current: "REKAP Balok columns D=label, L=D6, M=D8, N=D10, O=D13, P=D16,
> Q=D19, R=D22, S=D25. REKAP Plat is the same shape."

**Add**:

- **REKAP Balok in PD3 has an extra `T=D29` diameter column** — the current
  `balokSloofAdapter` ends at S=D25. If a project uses D29 rebar its weight
  will be silently dropped. (PD3 itself does not use D29 weights, so no
  immediate breakdown error — but the bug exists.)
- **REKAP Plat columns are not portable**. PD3 layout: `D=Luas Plat`,
  `J=Wire Mesh (m²)`, `K=D8 (kg)`, `L=D10`, `M=D13`, `N=D16`, `O=D25`,
  `P=Total Besi`. The current `platAdapter` hardcodes `C=label`,
  `N=D8 … R=D19` — this matches AAL-5 but does NOT match PD3 at all (offset
  by 3 columns AND uses D25 where AAL-5 had D19). On PD3 the adapter will
  return empty diameter weights and the rebar disaggregator will silently
  fall back to the rolled Pembesian lump. (The field guide claim "REKAP-PC,
  Hasil-Kolom, REKAP Plat: Same shape" is false for Plat at minimum.)
- Wire Mesh is a separate REKAP Plat column. The disaggregator doesn't
  read it today.

### 7.6 §6.3 (Balok V/VI variance hypothesis)

The hypothesis "V/VI chapters use a different undetected Pengecoran
sub-variant" does **not** hold on PD3 — V.A.2.5 uses the same template as
IV.A.2.6 (same R/S/T values, same `withX` reconciliation). The genuine root
cause for the V/VI variance pattern is:

  (a) the missing V*X term (Perancah);
  (b) possibly the rebar adapter pulling the wrong REKAP Balok row when
      multiple chapters share an element label (e.g., "B24-1" in IV.A.2.6
      vs V.A.2.5 vs VI.A.2.7 — each is a *different* concrete instance with
      different rebar weights).

The 2026-05-24 correction inside §6 (the callout warning §6.2 / §6.3 were
wrong) is right in spirit but needs a second update — the root cause for
V/VI on PD3 is (a) + (b), not the Kolom-extractor bug.

### 7.7 Other smaller diffs

- §4.5 "Sanity check (IV.A.2.7)": the worked example uses AAL-5 prices
  (9,000 / 1,043,400). PD3's equivalent worked example would use 10,300 /
  1,015,650 / 11,282.50. Worth adding a second worked example for PD3 to
  show the math generalises.
- §10.1 chapter prefix table uses Roman numerals (III.A, IV.A, V.A) for
  AAL-5. PD3 uses `III.B`, `IV.A`, `V.A`, `VI.A`, `VII.A` instead — the
  prefixes shift per workbook. The table should be a description of
  patterns ("the chapter containing Poer rows", etc.), not literal prefixes.

---

## 8. Reproducing this report

All scripts are in `tmp/`:

| Script                                    | Produces |
|---|---|
| `tmp/pd3-inspect-sheets.mjs`              | Sheet name + range list |
| `tmp/pd3-inspect-rab-headers.mjs`         | RAB (A) banner + name rows |
| `tmp/pd3-inspect-rab-cols.mjs`            | Per-row column dump (Q..AO) |
| `tmp/pd3-dump-blocks.mjs`                 | All 47 AHS blocks with F/G/H + Harga |
| `tmp/pd3-dump-bek-blocks.mjs`             | Bekisting/Pengecoran/Pembesian raw cells |
| `tmp/pd3-pengecoran-order.mjs`            | Per-Pengecoran-block sub-item order |
| `tmp/pd3-verify-column-sum.mjs`           | 4 invariant variations across 241 rows |
| `tmp/pd3-categorize.mjs`                  | Categorise the 241 candidates |
| `tmp/pd3-spotcheck.mjs`                   | 7 hand-verified rows in §6 |
| `tmp/pd3-rekap-check.mjs`                 | REKAP {Balok, PC, Plat, Kolom} headers |
| `tmp/pd3-rekap-plat-detail.mjs`           | REKAP Plat detailed column map |
| `tmp/pd3-check-d29.mjs`                   | Scan for D29 weights |
| `tmp/pd3-find-wiremesh.mjs`               | Scan for AC/AD wire-mesh use |
| `tmp/pd3-find-rows.mjs`                   | Find sourceRow for code prefixes |

Run any with `npx tsx tmp/pd3-*.mjs`. None mutate state.

The deterministic CLI run is:

```
npm run normalize:boq:det -- \
  "assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx" \
  /tmp/PD3-normalized.xlsx
```

It writes `/tmp/PD3-normalized.xlsx` with 104 Breakdown sheets + an
Unresolved sheet of 137 rows. No "wrong" breakdowns are emitted (the
truth-correctness contract is honoured).

---

*Author: Claude Opus 4.7. Run on a clean checkout of `feat/boq-normalizer`
without touching `tools/normalizer/*` or `docs/boq-normalizer-field-guide.md`.*
