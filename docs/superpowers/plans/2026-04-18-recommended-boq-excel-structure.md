# Recommended BoQ Excel Structure for v2 Parser

> Goal: keep the workbook format that estimators and clients already use (RAB / Analisa / Material / Upah), but tighten a handful of conventions so the parser resolves every BoQ line without guessing. Every recommendation here is reachable by adjusting an existing template — **no column reorders, no new sheets, no macros**.

---

## 1. Sheet names — lock in the canonical set

The parser defaults to these names. When a workbook uses different names, the import still works but requires manual override. Standardizing avoids that.

| Role | Canonical name | Notes |
|---|---|---|
| BoQ / Bill of Quantities | `RAB (A)` | Primary sheet. `RAB`, `RAB (B)`, etc. also accepted. |
| Analisa Harga Satuan | `Analisa` | Exactly one AHS sheet per workbook. |
| Material catalog | `Material` | Prices only — no computed cells. |
| Labor rate catalog | `Upah` | Prices only — no computed cells. |
| (Optional) Rekap / takeoff | `REKAP-*` | Any sheet starting with `REKAP`, `Hasil-`, `Data-`, `Plat`, `Tangga` is treated as an aggregation source, not a catalog. |

**Don't rename these.** If a project needs multiple BoQ sheets (RAB A, RAB B…), use the `RAB (x)` convention — the parser already accepts the parenthetical suffix.

---

## 2. RAB sheet — header row on row 7, labeled columns

The current template already does this. Keep it. What to tighten:

### 2.1 Header row must be row 7

Row 7 must contain a cell with the word **"URAIAN"** in column B. That's how the parser anchors everything below. Rows 1–6 can hold the project metadata (Pekerjaan, Lokasi, Pemilik, Tanggal) — the parser ignores them.

### 2.2 Required columns and labels

| Col | Label | Purpose |
|---|---|---|
| A | `NO` | Line number (numeric) or Roman chapter marker (I, II, III…) |
| B | `URAIAN PEKERJAAN` | Item description |
| C | `SAT` | Unit (m3, m2, kg, ls, titik, bh…) |
| D | `VOLUME` | Quantity — may be a literal number or a formula (`=H11`, `=SUMIFS(...)`) |
| E | `HARGA SATUAN` | Per-unit price (usually `=N11*markup`) |
| F | `TOTAL HARGA` | Line total — always `=D_*E_` |
| I | `Material` | **Per-unit** material cost — must be filled on real work items |
| J | `Upah` | Per-unit labor cost |
| K | `Peralatan` | Per-unit equipment cost |
| L | `Subkon` | Per-unit subcontractor cost (optional, but label if used) |
| M | `Prelim` | Per-unit preliminaries cost (optional) |
| N | `TOTAL HARGA SATUAN` | `=SUM(I:M)` — sanity cross-check |

### 2.3 The key rule: label every summary column in row 7

AAL-5 labels `Material` five times (at I, R, W, AA, AD) because later columns are intermediate aggregators for bekisting, rebar, and readymix. The parser now picks the leftmost occurrence — which is always correct if I is the canonical "Material per unit." To make this unambiguous:

- **I / J / K / L / M** must carry labels `Material / Upah / Peralatan / Subkon / Prelim`.
- Any other column labeled `Material`, `Upah`, or similar to the right of column M should either be renamed (`Material Readymix`, `Material Rebar`) or left unlabeled.

The parser handles either case today, but labeled intermediates make manual review much easier for estimators.

### 2.4 Chapter / section rows

Chapter rows are filtered automatically when:
- A has a Roman numeral (I, II, III, IV…) and B has a description with no unit in C.
- Or B has text but no unit in C AND no positive volume in D.

Keep using this pattern. Don't put a unit or volume on a chapter row.

### 2.5 Subtotal rows

Rows whose B column starts with `Subtotal` or `Jumlah` are skipped. Don't change this.

---

## 3. Analisa sheet — one block per AHS recipe

The current layout already works. The important conventions:

### 3.1 Block structure

| Col | Purpose |
|---|---|
| B | Title row: `1 m3 Pengecoran …` (unit prefix) OR `Pekerjaan …` |
| B (components) | Coefficient (e.g., 0.36) |
| C (components) | Unit (sak, m3, kg) |
| D (components) | Material/labor name |
| E (components) | Unit price — either a literal, `=Material!$G$14`, or an intra-sheet `=$F$150` (nested AHS) |
| F (components) | Subtotal = `=B*E` |
| G (components) | Labor subtotal |
| H (components) | Equipment subtotal |
| E (jumlah row) | Text: `Jumlah` |
| F (jumlah row) | `=SUM(F_start:F_end)` — material subtotal |
| G (jumlah row) | `=SUM(G_start:G_end)` — labor subtotal |
| H (jumlah row) | `=SUM(H_start:H_end)` — equipment subtotal |
| I (jumlah row) | `=SUM(F_jumlah:H_jumlah)` — grand total per unit |

### 3.2 One rule that breaks today's parser

**Titles must start with either a unit prefix (`1 m2`, `1 kg`, `10 titik`) or a work verb (`Pekerjaan`, `Pasangan`, `Pengecoran`, `Pembesian`).** AAL-5 honors this — keep it. Untitled blocks are silently dropped.

### 3.3 Don't: merged cells, gaps, or multi-row titles

Every component row must have a populated E cell (unit price). One blank-E row in the middle of a block is fine (acts as a spacer), but two in a row confuses block boundary detection. Titles must be in a single cell — not split across B and C.

---

## 4. Material / Upah sheets — flat tables

### 4.1 Material header row

| Col | Label |
|---|---|
| A | `No` or `Kode` (optional) |
| B | `Material` / `Bahan` / `Uraian` / `Nama` |
| C | `Produk` / `Model` / `Spec` (optional) |
| D | `Sat` / `Unit` / `Satuan` |
| E | `Harga` / `Price` / `Net` |

The catalog extractor already detects these labels fuzzily. As long as each sheet has one header row somewhere in rows 1–11 with a "name"-like column and a "price"-like column, it works.

### 4.2 Don't reuse a material name for two products

Your MEMORY note about catalog overlap during transition is still true. The parser's fuzzy matcher handles it, but the simplest prevention is: when the same material appears at multiple prices, append a spec (`Semen PC @50kg - Gresik` vs `Semen PC @50kg - Tiga Roda`).

---

## 5. How the parser now resolves a BoQ row

This was the main ambiguity you flagged. The current flow, after the fixes:

```
BoQ row "- Poer PC.5" at row 59
│
├─ Volume = D59 = 1.7578125 (literal or =H59 cached)
├─ Unit   = C59 = "m3"
├─ Total  = F59 = 6,967,773.50 (cached =D59*E59)
│
└─ Per-unit cost split (cached, no formula traversal needed):
   ├─ Material (I59)  = 2,428,240.77  ← comes from a chain
   │                                    I59=AF59, AF59=R59+V59*W59+Z59*AA59,
   │                                    R59=Analisa!$F$82, W59=Analisa!$F$35,
   │                                    AA59=Analisa!$F$132
   │                                    — the parser trusts the cached .v
   │                                    value at I59, which already encodes
   │                                    all of that math.
   ├─ Labor    (J59)  = 800,000
   └─ Equip.   (K59)  = 75,000
```

As long as I/J/K carry labels in row 7 and cached values in each work item row, the parser never needs to follow the formula chain. The audit screen shows M / U / P breakdowns immediately.

For blocks → BoQ linking, the parser now scans the whole RAB row for `Analisa!` references (with one hop through intermediate same-sheet cells), so references from I-J-K-R-S-W-AA all resolve. The only blocks that stay unlinked are ones referenced exclusively through a secondary sheet (Pas. Dinding, Plumbing, Retaining Wall). To link those too, either reference them from the RAB row directly, or add an agreed list of "link-carrier" sheets to the parser options.

---

## 6. Minimal changes you can make today to an existing workbook

Ranked by impact per minute of effort.

1. **Label I7 / J7 / K7 / L7** as `Material` / `Upah` / `Peralatan` / `Subkon` if they aren't already. This is the single biggest lever — it's what lets the audit UI show non-zero M/U/P/S figures without any AHS traversal.
2. **Make sure row 7 is the header row** in RAB sheets. No extra blank rows between metadata and the header.
3. **Name the Analisa sheet exactly `Analisa`** (not `Analisa Harga`, not `AHS`).
4. **Start AHS titles with either a unit prefix or a work verb.** Rename `"Beton Site Mix 1:2:3"` → `"1 m3 Beton Site Mix 1:2:3"`.
5. **Keep every block's Jumlah row populated.** Sum `F`, `G`, `H` in the Jumlah row, and let the grand total in `I` be `=SUM(F:H)`.
6. **Don't merge cells inside blocks.** If you need a visual header inside Analisa (e.g., "A. Material"), put it in its own row but leave column E empty so the block detector doesn't pick it up as a component.

None of these change the look of the workbook. Estimators keep using the same template; the parser stops guessing.

---

## 7. Optional — a "future-friendly" schema (for new projects only)

If you ever start a fresh template and want to make the parser's job trivial:

- Add a `element_code` column to the right of the cost breakdown (e.g., `Z7 = Element Code`, values like `PC.5`, `B-4`, etc.). The parser already reads a column labeled `elementCode` when present and uses it for cross-workbook continuity.
- Freeze row 7 and the first six columns in Excel so editors can't accidentally shift the header.
- Use named ranges for `rabHeader`, `analisaRange`, `materialRange`. Not required — the parser won't use them — but makes the workbook self-documenting and catches edit mistakes in Excel's Name Manager.

These are nice-to-haves. The six fixes in Section 6 are what actually matter.
