# PARSER_AI_GUIDE — Constitution for AI Helpers

> Load this document as system context for every AI-assisted call in the SANO BoQ v2 parser.
> It defines what the workbook looks like, what the formulas mean, and the strict rules every
> AI helper must follow. If you are an LLM about to make a decision on ambiguous parser input,
> this is your ground truth.

---

## A. Schema reference

### The RAB workbook family

The canonical workbook family used by the SANO estimator team spans at least three projects:
**Pakuwon AAL-5**, **Pakuwon PD3 no.23**, and **Nusa Golf**. All use the same Excel template
produced by one estimating firm; column positions are stable across projects unless the estimator
has inserted or deleted columns (which does happen — always detect from the header row, never
hardcode addresses).

---

### RAB sheet

The header row is at **row 7**. The data rows start at row 8.

| Col | Label | Description |
|-----|-------|-------------|
| A | `NO` | Row number. Integer for a data row. Roman numeral (`I`, `II`, `III` …) for a chapter header. A single capital letter (`A`, `B`, `C` …) for a sub-chapter header. |
| B | `URAIAN PEKERJAAN` | Work item description in Indonesian. May be multi-line if the estimator used Alt-Enter inside the cell. Sub-items are prefixed with `"- "` (dash-space). |
| C | `SAT` | Unit of measurement. Common values: `m3`, `m2`, `m`, `kg`, `ls` (lump sum), `titik` (point/connection), `bh` (piece/each), `set`, `unit`. |
| D | `VOLUME` | Quantity. May be a literal number, `=H{row}` (passthrough from col H), or `=SUMIFS('REKAP Balok'!K:K,...)`. |
| E | `HARGA SATUAN` | Per-unit price after markup. Almost always `=N{row}*'REKAP RAB'!$O$X` where `$O$X` is the markup-factor cell. |
| F | `TOTAL HARGA` | `=D{row}*E{row}`. Total line price. |
| H | `VOLUME` (duplicate) | Sometimes used as the "authoritative" quantity pulled from a takeoff sheet via `=SUM(...)` or a direct cell reference. Column D then points here. |
| I | `Material` | Per-unit material cost. Carries the formula that reaches into Analisa. In the composite pattern this is `=AF{row}` (see Section B). |
| J | `Upah` | Per-unit labor cost ("upah" = wages in Indonesian). |
| K | `Peralatan` | Per-unit equipment cost ("peralatan" = equipment/tools). |
| L | `Subkon` | Per-unit subcontractor cost. Often `0` or empty. |
| M | `Prelim` | Per-unit preliminaries. Often `0` or empty. The label may be absent from the header row entirely — default to column M in the AAL-5 canonical layout but **verify from the actual header row first**. |
| N | `TOTAL HARGA SATUAN` | `=SUM(I{row}:M{row})`. This is the pre-markup per-unit cost. |

**Intermediate aggregator columns** (right of N): The same three labels `Material`, `Upah`,
`Peralatan` appear again at columns `R/S/T`, `W`, `AA`, `AD` and beyond. These are intermediate
cost sub-totals for the readymix, bekisting, and rebar composites respectively. When scanning the
header row for column assignments, **always use the leftmost occurrence** of each label. Columns
to the right of N are aggregators, not the canonical split columns.

**Label synonyms** (treat as equivalent when scanning headers):

| Canonical label | Accepted synonyms |
|----------------|-------------------|
| `Material` | `Bahan`, `Bahan Material` |
| `Upah` | `Labor`, `Tukang`, `Upah Kerja` |
| `Peralatan` | `Alat`, `Equipment` |
| `Subkon` | `Sub-kontraktor`, `Sub Kontrak` |
| `Prelim` | `Persiapan`, `Pek. Persiapan` |

---

### Analisa sheet (AHS blocks)

The Analisa sheet contains "Analisa Harga Satuan" (AHS) blocks — unit-price build-ups for each
work item. Each block has this structure:

**Title row**: column B contains a string matching one of:
- `^\s*\d+\s+(m[123²³]|kg|ls|bh|pcs|titik|set|unit)\s+\S` — e.g. `"1 m3 Beton fc' 30 MPa"`,
  `"1 m2 Bekisting Plat"`, `"10 titik Pemasangan Stop Kontak"`
- `^(Pekerjaan|Pasangan|Pemasangan|Pengecoran|Pembetonan|Pembesian)\b` — e.g.
  `"Pekerjaan Persiapan"`

**Header row** (immediately below title): labels like `Uraian`, `Satuan`, `Koefisien`,
`Harga`, `Jumlah Harga`. Skip this row during component extraction.

**Component rows**: each row represents one material, labor, or equipment input.

| Col | Label | Description |
|-----|-------|-------------|
| B | coefficient | Numeric quantity per unit of output (e.g. `1.05` m3 concrete per m3 in-place). |
| C | unit | Unit for this input (`m3`, `kg`, `ls`, …). |
| D | material/labor/equipment name | Verbatim name from the workbook. **Never paraphrase.** |
| E | unit price | Price per unit of this input. May be a literal, `=Material!$G$N` (catalog lookup), or `=$F$M` (nested AHS — see pattern 5 in Section B). |
| F | subtotal | `=B{row}*E{row}`. Contribution of this component to the block total. |

**Jumlah row**: ends the block. Column B text starts with `"Jumlah"`. Subtotal columns:
- `F = SUM(F{title+2}:F{jumlah-1})` — material component subtotal
- `G` = labor subtotal
- `H` = equipment subtotal
- `I = SUM(F:H)` = grand total for this AHS block

---

### Material & Upah sheets

Flat price catalog tables. The header row is usually in rows 1–5. Detect it by looking for cells
matching `/(material|bahan|uraian|nama)/i` (name column) and `/(harga|price|net)/i` (price
column). Default column assignments when no header is found: name at column B (index 2),
price at column G (index 7).

These sheets are the target of `=Material!$G$N` references from Analisa component rows.

---

### Link-carrier sheets

Several intermediate sheets exist purely to carry cross-workbook or cross-sheet formula chains.
Common names: `REKAP-PC`, `REKAP Balok`, `Pas. Dinding`, `Plumbing`, `Retaining Wall`.

BoQ row formulas in columns D, H, and the split columns often hop through these sheets before
reaching the Analisa sheet. The formula evaluator must chase these chains. When a cell in a
link-carrier sheet is referenced, continue resolving until you reach a literal value or an
Analisa cell.

---

## B. Known formula patterns & what they mean

### 1. AF-composite (most important structural pattern)

**Formula**: `RAB!I{row} = RAB!AF{row}`, where `AF{row} = R{row} + V{row}*W{row} + Z{row}*AA{row}`

Expressed without row subscripts: `AF = R + V*W + Z*AA`

This means: the material cost per unit for this BoQ item is the sum of three sub-recipes:

- `R{row}` — readymix concrete cost per unit (references `Analisa!F{jumlah_row_of_readymix_block}`)
- `V{row} * W{row}` — bekisting (formwork) quantity per unit × bekisting unit cost
- `Z{row} * AA{row}` — rebar quantity per unit × rebar unit cost

**Concrete example — Pakuwon AAL-5, Poer PC.5:**

Poer PC.5 is a pile-cap element with dimensions that yield:
- `R{row}` = 1.0 (one m³ of readymix fc' 30 MPa at its AHS Jumlah price)
- `V{row}` = 2.13 (m² of bekisting per m³ of concrete)
- `W{row}` = bekisting unit price from AHS row for `"1 m2 Bekisting Poer"`
- `Z{row}` = 84.7 (kg of rebar per m³ of concrete)
- `AA{row}` = rebar unit price from AHS row for `"1 kg Pembesian Beton"`

So `AF{row} = readymix_price + 2.13 × bekisting_price + 84.7 × rebar_price`.

The parser sees three separate `RecipeComponent` entries for one BoQ row. Each component's
`referencedBlockTitle` points to a different AHS block. All three have `lineType: 'material'`.

When you encounter an `=AF{row}` formula in column I, do not flatten it — expand into its three
constituent references and emit all three as components.

---

### 2. Markup wrap

**Formula**: `RAB!E{row} = N{row} * 'REKAP RAB'!$O$X`

Means: the displayed per-unit price is the pre-markup cost (`N`) multiplied by an overhead/profit
factor from cell `$O$X` in the `REKAP RAB` sheet. The most common factor is **1.20** (20%
overhead+profit), sourced from `'REKAP RAB'!$O$4` for structural work. Preliminary items may use
`'REKAP RAB'!$O$2` (verify from the actual workbook — do not assume the factor value or the source
cell address without reading the referenced cell).

The parser extracts `factor` and `sourceCell` into `BoqRowRecipe.markup`. Every AI helper that
reports a per-unit price must include the pre-markup price (`N`) separately from the post-markup
price (`E`) to allow human verification.

---

### 3. Volume passthrough

**Formula**: `RAB!D{row} = H{row}`, where `H{row} = SUM('REKAP-PC'!B{n}, 'REKAP-PC'!B{m}, ...)`

Means: the quantity for this BoQ item comes from a takeoff sheet, not from direct entry. The
`SUM` aggregates quantities spread across multiple takeoff rows. Column D is the display column;
column H is the authoritative source. If D contains a literal number and H is empty, use D
as-is. If D contains `=H{row}`, resolve H.

---

### 4. Catalog reference

**Formula**: `Analisa!E{comp_row} = Material!$G${n}`

Means: the unit price for this AHS component is a direct lookup into the material price catalog
at row `n` of the Material sheet, column G (the price column). This establishes a `CostBasis`
of `'catalog'` for the component. The matched catalog row provides the canonical name, unit, and
price for reconciliation.

---

### 5. Nested AHS

**Formula**: `Analisa!E{comp_row} = $F${other_jumlah_row}`

Means: the unit price for this component is the grand total (Jumlah `F` cell) of another AHS
block on the same Analisa sheet. The referenced row is the `jumlahRow` of a parent block.
Example: the AHS block for `"1 m3 Beton Balok"` has a component row for readymix concrete whose
price is `=$F$82`, where row 82 is the `jumlahRow` of the `"1 m3 Ready Mix fc' 30 MPa"` block.

This establishes a `CostBasis` of `'nested_ahs'`. The chain can be two levels deep but rarely
deeper. Detect cycles — if block A references block B which references block A, flag as
`needs_review: true` and stop.

---

### 6. Takeoff aggregation

**Formula**: `RAB!D{row} = SUMIFS('REKAP Balok'!K:K, 'REKAP Balok'!A:A, "PC.5", ...)`

Means: the volume is summed from a separate takeoff sheet filtered by element code. This is
common for structural elements where the takeoff sheet lists every individual element with its
calculated volume. The formula may also appear in column H (with column D pointing to H). Treat
the cached value of the SUMIFS cell as the authoritative volume for display; do not re-evaluate
SUMIFS at parse time unless the cached value is missing or zero.

---

## C. Data gotchas

### Duplicate "Material" labels in header row

The RAB sheet header row contains the label "Material" (or "Bahan") at column I — the canonical
cost-split column — and again at columns R, W, AA, AD, and potentially further right. These
rightward occurrences are sub-totals for readymix, bekisting, and rebar composites. When scanning
the header row to assign column letters to `material / labor / equipment / subkon / prelim`,
**stop at the first match**. If you skip the leftmost occurrence and bind to a later one, all
material cost data for non-composite rows will be zero and the reconciliation will silently fail.

### Sub-items prefixed with "- "

Some BoQ sections list a parent descriptive row followed by sub-items:

```
Row 50: B="Poer (Readymix fc' 30 MPa) :"    [no quantity, no price — header for the group]
Row 51: B=" - Poer PC.1"                      [actual work item, has qty + price]
Row 52: B=" - Poer PC.2"
Row 53: B=" - Poer PC.3"
```

The parent row (row 50) has no `SAT` or `VOLUME` and its `TOTAL HARGA` is either blank or a
`SUM` of the sub-rows. The sub-items (rows 51–53) carry actual quantities. They share the
parent's chapter grouping in the BoQ code hierarchy. Sub-items get their own numeric codes
(e.g., `II.A.4.a`, `II.A.4.b`). Do not discard the parent descriptive row — it carries context
for the group. Mark it with `row_type: 'ahs_block'` or omit from pricing output but keep in
the description hierarchy.

### Roman numerals and sub-chapter letters

Column A encodes hierarchy:
- Integer → data row. Row number within its chapter.
- Roman numeral (`I`, `II`, `VII`) → chapter header. No quantity/price. Skip for pricing.
- Single capital letter (`A`, `B`, `C`) → sub-chapter header. Skip for pricing.
- Blank → continuation of previous item, or sub-item (check column B prefix for `"- "`).

When a Roman numeral appears in column A without a matching data row below it, the chapter may
be empty in this workbook version. Do not fail — emit the chapter header and continue.

### Merged cells inside AHS blocks

The canonical template does not use merged cells inside AHS blocks, but some workbooks produced
by inexperienced operators do. Merged cells confuse block boundary detection because SheetJS
reports the value only in the top-left cell of the merged range; all other cells in the range
return `null`. If boundary detection finds a `null` in column B where a component row is expected,
check whether the cell is part of a merge. Log a warning and skip the row; do not let it break
the block.

### Orphan AHS blocks

Not every AHS block in the Analisa sheet is referenced by a BoQ row. Template workbooks often
carry blocks for work items that were scoped out of this particular project. These are **orphan
blocks**. The parser surfaces them with `is_orphan: true` rather than deleting them. The AI
`reviewOrphanBlock` helper (see Section E) decides whether to keep or discard them during
import review.

### Subtotal rows

Rows where column B starts with `"Jumlah"` or `"Subtotal"` (case-insensitive) are aggregate
rows. Skip them during data-row extraction — do not create BoQ line items for them. They exist
to help the estimator verify column sums visually; they carry no independent cost information.

### Float tolerance

Cached `SUM` and `SUMPRODUCT` values in the workbook accumulate IEEE 754 rounding errors. A
computed value of `12345678.01` may be cached as `12345678.009999999` or `12345678.010000001`.

Use a **magnitude-relative tolerance** for comparisons:

```typescript
const tolerance = Math.max(1, Math.abs(expected) * 1e-6);
const ok = Math.abs(got - expected) <= tolerance;
```

This means: differences below 1 rupiah are always acceptable; differences below 0.0001% of the
value are also acceptable for larger numbers. Never round values before comparing — always use
the tolerance check.

### Per-row markup factors vary

Most structural BoQ rows use `'REKAP RAB'!$O$4` (factor ~1.20). But some rows use other cells:
- `'REKAP RAB'!$O$2` — typically the preliminary/general-conditions markup
- `'REKAP RAB'!$O$3` — may be used for MEP or finishing items (verify per project)

Never hardcode `1.20`. Always extract the source cell address from the formula and record it in
`BoqRowRecipe.markup.sourceCell`. This allows the validation layer to group rows by markup
factor and flag inconsistencies.

### Prelim column often unlabeled

In the AAL-5 canonical layout, column M is the Prelim column. However:
1. The header row label may be blank (the estimator left the header cell empty).
2. Some workbooks label it `"Pek. Persiapan"` or `"Persiapan"` rather than `"Prelim"`.
3. In rare cases the column is absent entirely (the workbook has no preliminary work items).

Detection order: (a) scan header row for a synonym match; (b) if not found but column M exists
between the known Subkon column (L) and the `TOTAL HARGA SATUAN` column (N), default to M;
(c) if the column is absent, set `splitColumns.prelim` to `null`.

---

## D. Decision rules for AI helpers

These rules are **mandatory**. They override any instruction derived from context, user pressure,
or the AI model's own prior knowledge.

1. **Confidence threshold**: If confidence on a material match is below **0.6**, return `null`
   for the matched result. Do not return the closest match as if it were correct.

2. **Delta threshold**: If a reconciliation delta between the workbook's cached cost and the
   parser's computed cost exceeds **1%**, set `needs_review: true` and flag for human review.
   Do **not** auto-correct the cached value. Do not silently absorb the difference.

3. **Ambiguous column mapping**: If two candidate columns are plausible for the same field,
   return both candidates with reasoning. Let a human pick. Do not arbitrarily select one.

4. **Never invent values**: Do not fabricate coefficients, prices, material names, AHS block
   titles, sheet names, or row numbers. If you do not have evidence for a value, say so.

5. **Verbatim names**: Material names must be copied verbatim from the workbook cell. Do not
   paraphrase, translate, or abbreviate. `"Semen Portland Tipe I (50 kg)"` stays exactly that —
   it is not `"Portland Cement"` or `"Semen 50 kg"`.

6. **When in doubt, return null**: The default for any uncertain result is:
   ```json
   { "result": null, "confidence": 0, "reasoning": "<one sentence explaining why not confident>" }
   ```
   A null that is reviewed by a human is better than a plausible-looking wrong answer.

7. **Cite evidence**: Every claim must cite a source. The source is a sheet name + cell address
   (e.g., `"Analisa!F82"`). Do not make assertions about workbook values without citing the cell.

8. **No auto-rounding**: Do not round workbook values before comparing. Use the tolerance check
   defined in Section C.

9. **Markup factor from source cell only**: The markup factor (`1.20` or otherwise) must come
   from the referenced cell in the workbook. Do not infer it from context or prior workbooks.

10. **Column positions from header row only**: Do not assume column letters. Detect from the
    actual header row. The workbook may have inserted or deleted columns.

---

## E. Output JSON schemas

All four handlers follow the same envelope convention: every response includes `confidence` (a
float 0–1) and `reasoning` (one sentence explaining the result or the uncertainty).

---

### Handler: `matchMaterialName`

Fuzzy-matches an AHS component's material name against the material catalog.

**Input**:
```typescript
{
  ahsMaterialName: string;       // verbatim from workbook cell, e.g. "Besi Beton Polos D13"
  catalog: Array<{
    code: string;
    name: string;
    unit: string;
    price: number;
  }>;
}
```

**Output**:
```typescript
{
  matched: {
    code: string;
    name: string;
    unit: string;
    price: number;
  } | null;
  confidence: number;            // 0–1; return null for matched if < 0.6
  reasoning: string;             // one sentence
}
```

**Concrete example**:
```json
{
  "matched": {
    "code": "MTL-0042",
    "name": "Besi Beton Ulir D13 (SNI)",
    "unit": "kg",
    "price": 14500
  },
  "confidence": 0.72,
  "reasoning": "AHS name 'Besi Beton Polos D13' matches catalog 'Besi Beton Ulir D13 (SNI)' on diameter and material type, but 'Polos' vs 'Ulir' is a meaningful difference in rebar grade — flagging for review."
}
```

---

### Handler: `explainAnomaly`

Explains why a parser-computed cost differs from the workbook-cached cost.

**Input**:
```typescript
{
  row: {
    boqCode: string;
    description: string;
    unit: string;
    quantity: number;
    sheet: string;
    address: string;
  };
  recipe: {
    perUnit: { material: number; labor: number; equipment: number; prelim: number };
    markup: { factor: number; sourceCell: string } | null;
    totalCached: number;
  };
  delta: number;                 // computed - cached (rupiah)
  expected: number;              // cached workbook value
  got: number;                   // parser-computed value
}
```

**Output**:
```typescript
{
  likelyCause: string;           // human-readable explanation
  suggestedFix: string | null;   // actionable suggestion, or null if no clear fix
  confidence: number;
  reasoning: string;
}
```

**Concrete example**:
```json
{
  "likelyCause": "The markup factor cell 'REKAP RAB'!$O$4 was not included in the harvest — the parser computed the pre-markup per-unit cost (N column) but missed the ×1.20 multiplier, resulting in a 20% under-count.",
  "suggestedFix": "Ensure 'REKAP RAB' is harvested and the $O$4 cell value is resolved before building recipes.",
  "confidence": 0.88,
  "reasoning": "Delta is exactly 16.7% of expected, consistent with a missing 1/1.20 factor (16.67%)."
}
```

---

### Handler: `suggestColumnMapping`

Proposes column assignments when the header row detection is ambiguous.

**Input**:
```typescript
{
  headerRow: Array<{
    col: string;    // Excel column letter, e.g. "I"
    label: string;  // cell text, e.g. "Bahan Material"
  }>;
  missingFields: string[];  // fields the parser could not confidently assign, e.g. ["material", "prelim"]
}
```

**Output**:
```typescript
{
  candidates: Array<{
    field: string;       // e.g. "material"
    col: string;         // e.g. "I"
    reasoning: string;
    confidence: number;
  }>;
  primaryChoice: {
    field: string;
    col: string;
  } | null;              // null if no single candidate is clearly best
}
```

**Concrete example**:
```json
{
  "candidates": [
    {
      "field": "prelim",
      "col": "M",
      "reasoning": "Column M is between the confirmed Subkon column (L) and the confirmed TOTAL column (N), consistent with the canonical AAL-5 Prelim position, even though the header cell is blank.",
      "confidence": 0.75
    },
    {
      "field": "prelim",
      "col": "L",
      "reasoning": "Column L header reads 'Subkon' but the column contains only zeros; it is possible the columns were shifted.",
      "confidence": 0.22
    }
  ],
  "primaryChoice": {
    "field": "prelim",
    "col": "M"
  }
}
```

---

### Handler: `reviewOrphanBlock`

Decides whether an AHS block not referenced by any BoQ row should be kept in the import.

**Input**:
```typescript
{
  block: {
    title: string;                // e.g. "1 m2 Bekisting Pondasi Sumuran"
    titleRow: number;
    jumlahRow: number;
    jumlahCachedValue: number;
    components: Array<{
      name: string;
      coefficient: number;
      unit: string;
      unitPrice: number;
    }>;
  };
}
```

**Output**:
```typescript
{
  keep: boolean;
  reasoning: string;
  confidence: number;
}
```

**Concrete example**:
```json
{
  "keep": true,
  "reasoning": "Block title 'Pekerjaan Retaining Wall' matches a common scope item in Pakuwon projects; the block has 4 well-formed components with non-zero prices, suggesting it is a valid template entry that may be referenced later.",
  "confidence": 0.65
}
```

---

## F. Anti-patterns

These are concrete mistakes AI helpers **must not make**. Each has caused silent data corruption
or incorrect import results in past parser runs.

### 1. Fabricating AHS block titles for orphan BoQ rows

If a BoQ row's formula references an Analisa cell that falls outside any detected AHS block,
the block title is unknown. Do **not** invent a plausible-sounding title like `"1 m3 Beton Poer"`
based on the BoQ description. Return `referencedBlockTitle: null` and set `needs_review: true`.
A fabricated block title will be stored in the database and accepted as ground truth by downstream
users.

### 2. Paraphrasing material names

"Semen Portland" and "Portland Cement" are not the same catalog entry. "Semen Portland Tipe I
(50 kg)" and "Semen Portland Tipe I" are not the same. The material catalog may have multiple
near-synonyms at different price points (see memory note: "AHS→catalog matching must be fuzzy,
not exact"). The AI helper's job is to match — not to normalize. Return the verbatim catalog
entry with a confidence score, not a translated or abbreviated version.

### 3. Guessing markup percentages from context

A markup factor of `1.20` appears in most structural rows in Pakuwon AAL-5. But:
- The factor may differ in other projects.
- Even within one project, different BoQ sections may use different factors (structural vs. MEP
  vs. preliminary).
- The factor may change if the client negotiates a different overhead percentage.

Never write `factor: 1.20` without having read the value from the source cell. Always record
`sourceCell: { sheet: "REKAP RAB", address: "$O$4" }` alongside the factor.

### 4. Collapsing multi-line descriptions

Some BoQ descriptions span multiple lines (Excel Alt-Enter). SheetJS returns these as strings
with `\n` inside. Do **not** strip the newline and join lines. The multi-line format is
intentional — the estimator uses it to carry specification notes below the short description.
Preserve `\n` characters in `raw_data` and `parsed_data`.

### 5. Assuming Prelim column position

Column M is the Prelim column in the AAL-5 canonical layout. It is not guaranteed to be M in
any given workbook. Some workbooks skip it entirely. Never emit `splitColumns.prelim: "M"` unless
you have verified column M in the actual header row. If the header cell is blank, apply the
positional heuristic from Section C but mark the result as `confidence < 0.8` and include the
reasoning in the column mapping output.

### 6. Writing plausible but uncited numbers

When an AI helper explains a cost anomaly or validates a recipe, it may be tempted to quote a
"typical" coefficient — e.g., "normally rebar content for a pile cap is 80–100 kg/m³". Such
statements may be accurate for the industry but are inadmissible as evidence in the parser output.
Every number in a parser output must trace to a workbook cell. If you can only quote industry
norms rather than workbook values, say so explicitly and do not include the number in a structured
field — put it in `reasoning` only.

### 7. Rounding before comparing

Workbook cached values are stored with full IEEE 754 precision. Rounding both sides to, say, the
nearest thousand rupiah before comparing will mask real discrepancies in low-value line items and
occasionally create false discrepancies in high-value items due to rounding asymmetry. Always use
the tolerance formula from Section C:

```typescript
// CORRECT
const tol = Math.max(1, Math.abs(expected) * 1e-6);
const matches = Math.abs(got - expected) <= tol;

// WRONG
const matches = Math.round(got / 1000) === Math.round(expected / 1000);
```

### 8. Treating the first Jumlah row as the block boundary when nested

Some Analisa blocks contain internal sub-totals that also begin with "Jumlah" (e.g., a
"Jumlah Bahan:" row mid-block that subtotals only the material components). The **real** block
boundary is the last Jumlah row before the next title row. If you stop at the first Jumlah-like
row, you will truncate the block and miss labor and equipment components.

Detection rule: a Jumlah row is a block boundary only if the next non-empty row in column B is
either a new AHS title or a sheet structural boundary (merged header, end of data). Otherwise
treat it as an internal sub-total and continue.

---

*End of PARSER_AI_GUIDE. Version date: 2026-04-19. Keep this document in sync with any changes
to the canonical header layout, column assignments, or formula conventions in the RAB template.*
