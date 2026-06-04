# BOQ_TRANSLATION_RULES — How to turn a messy BoQ workbook into one SANO can parse

> **For AI agents.** A messy / non-standard BoQ workbook is your INPUT. A clean SANO-friendly workbook is your OUTPUT. This document is the ruleset.
>
> Use Opus (full capability) for actual translations. Read `docs/PARSER_AI_GUIDE.md` first as the constitution — it defines the workbook schema this output must conform to. This file is the operational playbook on top of that.

---

## 0. Why this file exists

The SANO BoQ parser (`tools/boqParserV2/`) reads a workbook in **one specific shape** and produces `StagingRowV2[]` records that get inserted into `import_staging_rows`, reviewed in `BaselineScreen`, then published to `ahs_versions / boq_items / ahs_lines`.

When the input doesn't match the expected shape, the parser does its best — but many real BoQs from external estimating firms have:

- Wrong header row position
- Inconsistent column ordering
- Material names that don't match the catalog
- Free-form lump-sum items with no recipe link
- Ambiguous AHS references (chained formulas, missing pointers)
- Mixed Indonesian / abbreviation / typo variants for the same material
- Custom totals scattered across multiple sheets

Your job is to **transform** such a workbook into one the parser will handle cleanly with zero `needs_review` flags.

---

## 1. The canonical SANO BoQ workbook shape

Output must conform to this. The full schema is in `docs/PARSER_AI_GUIDE.md`; this is the operational summary.

### Required sheets

| Sheet | Required? | Contents |
|---|---|---|
| `RAB (A)` (or `RAB (B)`, `RAB (C)` for multi-section projects) | YES | The bill of quantities. One row per billable item. |
| `Analisa` | YES | AHS blocks (recipes). |
| `Material` | YES | Material catalog (code, name, unit, price). |
| `Upah` | YES | Labor catalog (code, role, unit, rate). |
| `REKAP RAB` | OPTIONAL | Holds the project markup factor cell. Required if any RAB row uses markup. |
| `REKAP Balok` / `REKAP Kolom` / `REKAP PC` / `REKAP Sloof` / `REKAP Plat` | OPTIONAL | Rebar takeoffs by structural element. Required if rebar disaggregation is needed. |

### `RAB (A)` column layout (header row 7, data row 8+)

| Col | Label | Description |
|---|---|---|
| A | `NO` | Roman numeral = chapter (`I`, `II`, `III`); single capital letter = sub-chapter (`A`, `B`, `C`); integer = data row code. |
| B | `URAIAN PEKERJAAN` | Item description in Indonesian. Sub-items prefixed with `"- "`. |
| C | `SAT` | Unit (m3, m2, m, kg, ls, titik, bh, set, unit). |
| D | `VOLUME` | Quantity. Literal number OR `=H{row}` passthrough OR `=SUMIFS('REKAP...'!K:K,...)`. |
| E | `HARGA SATUAN` | Per-unit price after markup. `=N{row}*'REKAP RAB'!$O$X` is the canonical pattern. |
| F | `TOTAL HARGA` | `=D{row}*E{row}`. |
| H | `VOLUME` (duplicate) | Authoritative quantity from takeoff sheet. Col D may point here. |
| I | `Material` | Per-unit material cost. AF-composite pattern: `=AF{row}` or direct `=Analisa!$F$XXX`. |
| J | `Upah` | Per-unit labor cost ("wages"). |
| K | `Peralatan` | Per-unit equipment cost. |
| L | `Subkon` | Per-unit subcontractor cost. |
| M | `Prelim` | Per-unit preliminaries cost. |
| N | `TOTAL HARGA SATUAN` | `=SUM(I{row}:M{row})`. Pre-markup unit cost. |

Label synonyms (treat as equivalent): `Material`=`Bahan`=`Bahan Material`; `Upah`=`Labor`=`Tukang`=`Upah Kerja`; `Peralatan`=`Alat`=`Equipment`; `Subkon`=`Sub-kontraktor`=`Sub Kontrak`; `Prelim`=`Persiapan`=`Pek. Persiapan`.

Header columns at row 7 is the SANO convention. If the input has header at row 1 or anywhere else, MOVE it to row 7.

### `Analisa` block structure

Each AHS block follows this pattern (variable row count between markers):

```
[title row]   "1 m3 Beton fc 30 MPa"  (or "Pekerjaan Persiapan")
[header row]  Uraian | Satuan | Koefisien | Harga | Jumlah
[component]   coef | unit | name | unit_price | subtotal
[component]   coef | unit | name | unit_price | subtotal
...
[empty]
[jumlah]      Jumlah | total
```

Title regex pattern the parser uses:
- `^\s*\d+\s+(m[123²³]|kg|ls|bh|pcs|titik|set|unit)\s+\S` — quantity + unit + description
- OR `^(Pekerjaan|Pasangan|Pemasangan|Pengecoran|Pembetonan|Pembesian)\b` — pure verb header

Anything else is NOT recognized as a title.

---

## 2. Translation pipeline

Apply transformations in this order. Each step is idempotent — if the input already conforms, it's a no-op.

### Step 1: Identify sheets

Scan the workbook's sheet names. Map them to canonical roles:

| Found pattern | Canonical role | Action |
|---|---|---|
| `RAB`, `BoQ`, `Bill of Quantities` | `RAB (A)` | Rename to `RAB (A)`. If multiple BoQ sections, split into `RAB (A)`, `RAB (B)`, etc. |
| `Analisa`, `AHS`, `Analisa Harga Satuan` | `Analisa` | Rename to `Analisa`. |
| `Material`, `Material Master`, `Bahan` | `Material` | Rename to `Material`. |
| `Upah`, `Labor`, `Tukang` | `Upah` | Rename to `Upah`. |
| `REKAP RAB`, `Summary` | `REKAP RAB` | Rename. |
| `REKAP Balok`, `Balok Takeoff` | `REKAP Balok` | Rename. |
| (similar for Kolom, PC, Sloof, Plat) | `REKAP <Element>` | Rename. |

If no Analisa sheet exists at all: STOP — without recipes, the parser can't link materials to BoQ rows. Tell the user to provide recipes or skip the recipe layer (lump-sum-only mode).

### Step 2: Find and align the header row

For each `RAB (X)` sheet:

1. Search rows 1-15 for any row whose cells include 3+ of these labels (case-insensitive): `NO`, `URAIAN`, `SAT`, `VOLUME`, `HARGA`, `TOTAL`, `MATERIAL`, `UPAH`, `PERALATAN`, `SUBKON`.
2. Move that row to **row 7**. (Insert blank rows above if needed, or delete rows.)
3. Data rows must start at row 8.

If the column order is non-standard, REORDER columns A–N to match the canonical layout above.

### Step 3: Normalize chapter / sub-chapter codes

For each data row:

1. If column A contains a roman numeral (`I`–`XX`), the row is a **chapter header**. Verify column B has descriptive text. No volume/price expected.
2. If column A is a single capital letter (`A`–`Z`), the row is a **sub-chapter header**. Same — no volume/price.
3. If column A is an integer (`1`, `2`, `3`, ...), the row is a **data row**. Verify columns C–N have appropriate values.
4. If column A is empty AND column B starts with `- ` (dash-space), the row is a **sub-item** of the previous data row. Inherit parent context.

Anything else in column A is an anomaly — investigate.

### Step 4: Normalize material names against the catalog

This is the highest-impact step. Most parser confusion comes from material-name mismatches.

For each name that appears in `Analisa` recipes:

1. Strip whitespace, normalize Unicode (NFC), lowercase for comparison.
2. Check if the name exists in `Material` sheet via:
   - Exact match → keep
   - Substring match (e.g., "Bata MRH" inside "Bata Merah") → suggest normalization
   - Fuzzy match (Levenshtein distance ≤ 3) → flag as likely typo
   - No match → check if it's a labor item (matches `^upah|^tukang|^pekerja|^mandor`), in which case look up in `Upah` sheet
   - Still no match → flag as unknown

3. When normalizing, REWRITE the material name to the canonical catalog spelling. Do this in BOTH the Analisa recipe AND any direct reference in RAB.

Common normalizations to apply automatically:

| Input variant | Canonical |
|---|---|
| `Bata Mrh`, `Bata MRH`, `Bata Mer` | `Bata Merah` |
| `Semen PC`, `Semen PC @50kg`, `PC 50kg` | `Semen Portland 50 kg` |
| `Besi D13`, `Besi Ulir D13`, `Rebar D13`, `D13` | `Besi Ulir D13` |
| `Pasir Lumajang`, `Pasir Lmj`, `Pasir Pasang` | `Pasir Pasang` (or specify if origin matters) |
| `Bekisting Plywood 12 mm`, `Plywood 12mm`, `Multipleks 12` | `Plywood 12 mm` |

If you can't determine canonical from context, add a note (`needs_review: true`) and pick the most common spelling already in the catalog.

### Step 5: Normalize units

Use the canonical Indonesian construction units:

| Input variant | Canonical |
|---|---|
| `m²`, `m2`, `M2`, `SQM` | `m2` |
| `m³`, `m3`, `M3`, `CUM` | `m3` |
| `m`, `m'`, `M`, `LM`, `meter` | `m` |
| `kg`, `KG`, `kilogram` | `kg` |
| `ls`, `LS`, `lump sum`, `lumpsum` | `ls` |
| `bh`, `BH`, `pcs`, `pc`, `each`, `EA`, `buah` | `bh` |
| `titik`, `TITIK`, `point` | `titik` |
| `set`, `SET` | `set` |
| `lembar`, `lbr`, `LBR`, `sheet` | `lembar` |
| `sak`, `SAK`, `zak`, `bag`, `bag (50 kg)` | `sak` |
| `org-hari`, `OH`, `org hari`, `man-day`, `man day` | `org-hari` |

Apply this normalization to every cell in column C of RAB, every component unit in Analisa, and every Unit column in Material/Upah.

### Step 6: Fix AHS title formatting

Each AHS block's title row in `Analisa` must match one of:

- `<qty> <unit> <description>` — e.g., `1 m3 Beton fc 30 MPa`, `1 kg Pembesian D13`, `1 m2 Bekisting Bata Merah`
- `<verb> <description>` — e.g., `Pekerjaan Persiapan`, `Pasangan Bata`

If you find a title like just `Beton fc 30 MPa` (missing qty + unit), PREPEND `1 m3 ` (or whatever the output unit is). The parser uses this prefix to know what "1 unit of this recipe" means.

If two AHS blocks have identical titles, RENAME one (e.g., add a discriminator like `Bekisting Poer (variant 1:4)` vs `Bekisting Poer (variant 1:3)`). The parser needs each title to be unique within the Analisa sheet.

### Step 7: Wire up BoQ → AHS references

For each RAB data row that should use a recipe:

1. Find the matching AHS block in `Analisa` by description.
2. Get its Jumlah row number.
3. In RAB row's column I (Material), write `=Analisa!$F${jumlahRow}`.
4. In RAB row's column N (Total per-unit), write `=SUM(I{row}:M{row})`.
5. In RAB row's column E (Unit Price), write `=N{row}*'REKAP RAB'!$O${markupCell}` (if markup applies) or just `=N{row}`.

If a row has no AHS recipe (lump-sum, subkon, direct purchase), DO NOT add a fake reference. Instead:

- Fill columns I/J/K/L/M with literal per-unit values that sum to N.
- Leave the cost basis as `inline_split` — the parser handles this case.
- Don't synthesize an Analisa block just to satisfy the parser; that's worse than honest direct cost.

### Step 8: Rebar disaggregation

If your RAB has rows for "Pembesian Poer", "Pembesian Balok", etc., AND your `REKAP Balok` / `REKAP Kolom` / `REKAP PC` / `REKAP Sloof` / `REKAP Plat` sheets exist with per-diameter breakdowns:

- The parser's `rebarDisaggregator` will automatically split the aggregate "Pembesian" into D8/D10/D13/D16/D19 lines.
- Each REKAP sheet's column structure must match what the adapters expect (see `tools/boqParserV2/rebarDisaggregator/adapters/`).
- If your REKAP sheets have different layouts, either reshape them OR pre-disaggregate (write five separate AHS components for D8/D10/D13/D16/D19 directly in Analisa).

### Step 9: Validate before output

After all transformations:

1. **AHS block balance:** for each block, sum the component subtotals (F column on component rows) and compare to the Jumlah cached value. If delta > 1 IDR per 1000 of jumlah, that block is imbalanced.
2. **BoQ row total balance:** for each data row, `D × E` should equal F (within float tolerance).
3. **Material catalog completeness:** every material name in Analisa exists in Material sheet.
4. **Unit consistency:** every component unit is in the canonical list.
5. **No formula traps:** no `#REF!`, `#NAME?`, `#DIV/0!` errors anywhere.

Fix violations before delivering the output. If you can't fix one, flag it in the output cell with a comment + write the issue to a `Translation_Notes` sheet.

---

## 3. Discrepancy resolution rules

When the input contradicts itself (e.g., the price in the catalog differs from the price in Analisa), apply this priority:

1. **Analisa subtotals are truth.** They're what the project budget was built against.
2. **Catalog prices are advisory.** If the catalog says Rp 1,500/kg but Analisa uses Rp 1,200/kg for the same material in a specific block, KEEP the Analisa value (preserve original cost basis) and DO NOT silently overwrite.
3. **If F ≠ D × E in a RAB row,** the F column is the truth (it's what the BoQ totals up to). Adjust D or E.
4. **If a recipe component's coef × price ≠ its row subtotal,** the row subtotal is truth. Recompute coef = subtotal / price.
5. **Multi-line descriptions:** preserve them. Don't collapse to a single line — they may have legal/contractual significance.

---

## 4. Conservative-by-default assumptions

When the input is ambiguous, lean toward "no harm done":

- **Unknown material → add to catalog with a placeholder unit price (0)** and flag as `needs_review`. Don't fabricate a price.
- **Unknown AHS title pattern → keep as-is**, mark the row `needs_review`. Don't try to be clever.
- **Conflicting sheet names → pick the one that looks most complete**, document the rejection. Don't merge sheets blindly.
- **Empty cells in critical columns → mark needs_review, don't default to zero.** A zero is a fact; a missing cell is unknown.

---

## 5. Output format

Deliver:

1. **The translated workbook** as `<original_filename>_sano.xlsx`.
2. **A `Translation_Notes` sheet** inside the workbook listing:
   - Every cell you changed and why
   - Every assumption you made
   - Every item flagged for human review
3. **A summary in stdout** with counts: `X rows translated, Y assumptions made, Z items need review`.

The Translation_Notes sheet is mandatory. The human estimator opens this first to verify your work.

---

## 6. What NOT to do

- **Don't hallucinate AHS recipes** for items that don't have one. Lump-sum is fine; fake AHS is worse than no AHS.
- **Don't change prices** to match the catalog — the project budget is built on the prices in Analisa.
- **Don't drop rows** that you don't understand. Flag them and keep them.
- **Don't merge similar items** (e.g., two slightly different "Plesteran 1:3" rows) — the estimator may have had a reason.
- **Don't rewrite formulas to literal numbers** unless the formula is broken. Formulas carry intent that literal numbers lose.
- **Don't strip "PC.X" codes** or other identifiers from descriptions. They're cross-references to other sheets.
- **Don't translate Indonesian descriptions to English.** The catalog and UI are bilingual; preserve the original.

---

## 7. Quick reference: what triggers `needs_review` in the parser

Mark a row as needing review when:

- AHS block subtotals are imbalanced (delta > 0.1% of jumlah)
- Material name in Analisa doesn't appear in Material sheet
- Unit in a component doesn't match the canonical list
- Cost basis can't be determined (no I/J/K/L/M split AND no Analisa reference)
- Sub-item (prefixed with `- `) appears without a parent data row above it
- Rebar disaggregation can't find a matching REKAP sheet

If you can fix any of these during translation, do it. If not, the parser will surface them in the BaselineScreen and the estimator handles it.

---

## 8. Verification self-test

Before declaring a translation complete, run this checklist mentally:

- [ ] Every sheet name matches the canonical list.
- [ ] `RAB (A)` header is at row 7, data starts at row 8.
- [ ] Every AHS block has a title row matching the regex.
- [ ] Every AHS block has a Jumlah row.
- [ ] Every BoQ row references either a real AHS block OR has an `inline_split`.
- [ ] Every material in Analisa appears in the Material sheet.
- [ ] Every unit is in the canonical list.
- [ ] No formula errors anywhere.
- [ ] AHS block subtotals balance to Jumlah within float tolerance.
- [ ] `Translation_Notes` sheet exists with at least one entry.
- [ ] The grand total in `RAB (A)` matches the original workbook total within float tolerance.

If all 11 items pass, the parser will produce a clean import.
