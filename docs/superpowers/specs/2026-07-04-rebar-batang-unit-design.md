# Rebar priced & ordered in batang — design

*Date: 2026-07-04 · Branch: feat/boq-normalizer*

## 1. Goal

Rebar (besi beton) is currently carried in the material catalog with `unit = kg`
and `supplier_unit = kg`. In the field, rebar is **bought and ordered in batang**
(12 m lonjor), not by weight. This change makes rebar **display and order in
batang** while keeping the internal kg-based estimation completely intact.

> User contract: "the RAB input will be all translated into batang, not kg. When
> supervisor orders, it will be in batang. If not, add a conversion rule (a fixed
> value per rebar type) so we don't break the formula that you have set."

## 2. Governing principle (truth-correctness)

**kg stays the internal estimation unit. Batang is a presentation/ordering unit
derived from a fixed per-diameter factor, converted only at the UI boundary.**

- The AHS ±1 Rp reconciliation, the Pembesian math (blended 9,917.5 Rp/kg), the
  envelopes, and the budget gate are **NOT touched**. They keep computing in kg.
- Batang appears only where we can derive it from a **known fixed factor**. Any
  rebar without a factor falls back to kg — no rebar ever shows a batang label
  next to a kg number. No made-up numbers reach the workbook or the order.

## 3. The fixed factor

`kg per batang = SNI theoretical weight (kg/m, nominal diameter, 7850 kg/m³) × 12 m`.

| Rebar        | Code       | kg/m (SNI) | **kg per 12 m batang** |
|--------------|------------|-----------:|-----------------------:|
| Ø6 polos     | REB-PL06   | 0.222      | 2.66                   |
| Ø8 polos     | REB-PL08   | 0.395      | 4.74                   |
| Ø10 ulir     | REB-DE10   | 0.617      | 7.40                   |
| Ø12 polos    | REB-PL12   | 0.888      | 10.66                  |
| Ø13 ulir     | REB-DE13   | 1.042      | 12.50                  |
| Ø16 ulir     | REB-DE16   | 1.578      | 18.94                  |
| Ø19 ulir     | REB-DE19   | 2.226      | 26.71                  |
| Ø22 ulir     | REB-DE22   | 2.984      | 35.81                  |
| Ø25 ulir     | REB-DE25   | 3.853      | 46.24                  |
| Ø32 ulir     | REB-DE32   | 6.313      | 75.76                  |

Batang length = **12 m** (confirmed). Chair bars and the mixed BJTP U24/U40
aggregate are **out of scope** (see §7 — they are removed, not converted).

Provenance is documented in `tools/rebarBatang.ts`, which exports the SNI kg/m
table and the derived kg/batang values. It is the single place the numbers are
defined; the DB column and the tests are both seeded/checked from it.

## 4. Data model change

Add one nullable column to `material_catalog`:

```sql
base_qty_per_supplier_unit NUMERIC   -- kg of `unit` per 1 `supplier_unit`.
                                     -- NULL = 1:1 (unit == supplier_unit).
```

For the 10 rebar rows above: `unit = 'kg'` (unchanged), `supplier_unit = 'batang'`,
`base_qty_per_supplier_unit = <kg per batang>`. Every other material stays NULL
(1:1), so the column is inert for non-rebar.

Semantics chosen deliberately: the column is generic ("how many base units make
one supplier unit"), not rebar-specific, so any future unit pair (e.g. semen
zak↔kg) can reuse it.

## 5. Conversion utility

`tools/materialUnitConversion.ts` — pure functions, no I/O:

```ts
// factor = base_qty_per_supplier_unit (kg per batang). null → treated as 1 (1:1).
supplierToBase(qtySupplier, factor): number        // batang → kg  (feeds the gate/envelope)
baseToSupplierExact(qtyBase, factor): number        // kg → batang (fractional, for display)
baseToSupplierOrder(qtyBase, factor): number        // kg → batang, rounded UP (for ordering)
supplierUnitPrice(pricePerBase, factor): number     // price/kg → price/batang

// Display helper — THE one entry point every UI surface uses (see §6.2):
displayQty(qtyBase, material): { qty: number; unit: string }
//   → { qty in batang, unit: 'batang' } when the material has a factor,
//   → { qty unchanged, unit: material.unit } otherwise.

// Input normalization — the one entry point for ingest (see §6.4):
normalizeUnit(raw): 'batang' | string               // 'btg'/'batang'/'lonjor' → 'batang'
toBaseQty(qty, rawUnit, material): { qtyBase, converted } | { error }
//   batang-denominated input × factor → kg; kg input passes through;
//   batang input with NO factor → error (route to unresolved, never guess).
```

Rules:
- **Ordering rounds UP** to whole batang (you cannot buy a fraction of a rod).
- **The gate/envelope always receives kg** (`supplierToBase`), so all existing
  kg-based logic is byte-for-byte unchanged.
- `factor == null` ⇒ identity (returns the input), so non-rebar is unaffected.

## 6. Wiring points

### 6.1 Procurement — `workflows/screens/PermintaanScreen.tsx`
- Material line shows `supplier_unit` (batang) and price per batang for rebar.
- The supervisor types the quantity **in batang**. Before that number is fed to
  `computeWorkGroupGate1Flag` / `buildTier2Result` / `buildTier3Result` and the
  allocation builders, convert it batang → kg via `supplierToBase`. The gate,
  envelope, and allocation math keep seeing kg. (This is the critical fix: today
  the typed number goes straight into a kg-based envelope comparison.)
- Persisted request line stores the batang quantity + `unit = 'batang'` for the
  human order, and the kg-equivalent where downstream consumers need kg.

### 6.2 Front-facing display — batang everywhere in the UI
**Every UI surface that renders a rebar quantity shows batang**, via the single
shared `displayQty` helper (§5). Underlying stored quantities stay kg.

- All quantity displays go through `displayQty(qtyBase, material)`; no screen
  does its own conversion, so display can never drift from the factor.
- Enumerated surfaces (implementation plan verifies the full list):
  `workflows/screens/BaselineScreen.tsx` (material balance / audit),
  `workflows/screens/PermintaanScreen.tsx`, `workflows/screens/Gate2Screen.tsx`,
  `workflows/screens/AuditTraceScreen.tsx`,
  `workflows/screens/components/RecipeView.tsx`,
  `workflows/screens/MaterialCatalogScreen.tsx`,
  `office/screens/MaterialCatalogScreen.tsx`, `office/screens/ApprovalsScreen.tsx`,
  plus material-takeoff exports (`tools/materialTakeoff.ts`) and the client
  report where material quantities appear.
- Where precision matters (audit/balance views), show batang with the
  kg-equivalent as secondary text (e.g. "27 batang (≈ 127.9 kg)") so the
  underlying truth stays visible — per the "show your work" contract.

### 6.3 Office catalog editor — `office/screens/MaterialCatalogScreen.tsx`
- Today it forces `supplier_unit = unit` ("Satuan supplier otomatis mengikuti
  satuan unit"). Relax this so rebar keeps `supplier_unit = batang` and its
  factor on edit; surface the factor as an (optional) editable field.

### 6.4 Input flexibility — batang-denominated workbooks (future-proofing)
Future RAB workbooks may state rebar quantities **in batang instead of kg**.
The ingest path accepts either denomination and normalizes to kg at the
boundary, so everything downstream keeps its kg invariant:

- Unit strings are normalized via `normalizeUnit` (`btg`, `batang`, `lonjor`
  → `batang`).
- When a parsed component/AHS line for a catalog-linked rebar carries a
  batang-denominated qty, `toBaseQty` converts it to kg with the material's
  factor before it is stored/reconciled.
- **Truth guard:** a batang-denominated rebar line whose material cannot be
  resolved to a catalog row with a factor is routed to review/Unresolved —
  never silently treated as kg and never guessed.
- Hook location: the publish/link boundary (`tools/publishBaselineV2.ts` /
  material-link step), where parsed lines meet the catalog — not inside the
  normalizer's reconciliation math, which stays workbook-native.

## 7. Row removals

- **Chair bars** `REB-CHR06`, `REB-CHR08`: remove from `material_master.csv`,
  `003_seed.sql`, and the live DB. They are referenced by nothing (no aliases,
  no code, no other seed rows), so the delete is safe. The migration delete is
  guarded (`WHERE code IN (...) AND NOT EXISTS (<any referencing row>)`), and the
  transactional FKs are `NO ACTION`, so a referenced row would fail loudly rather
  than cascade-delete data.
- **BJTP U24/U40 aggregate** (`AUTO-BESI-BETON-BJTP-U24-BJTD-U40-STANDARD-SNI`):
  not present in any source file — it is generated by the parser's AUTO
  material-code path at publish time. Delete it from the live DB **and** suppress
  its regeneration in the parser so it does not come back. (If suppression proves
  too invasive, fall back to documenting it as a known auto-row; flagged as a
  risk, see §10.)

## 8. Migration & data mechanics

Per the repo convention (remote history diverged; migrations are applied via the
Dashboard SQL editor; write them idempotent):

1. **`supabase/migrations/052_rebar_batang_unit.sql`** (idempotent):
   - `ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS base_qty_per_supplier_unit NUMERIC;`
   - `UPDATE material_catalog SET supplier_unit = 'batang', base_qty_per_supplier_unit = <v> WHERE code = '<REB-...>';` for the 10 rows.
   - Guarded `DELETE` of `REB-CHR06/08` and the BJTP aggregate.
2. **`assets/mock/material_master.csv`** (source of truth for the sync tool): add
   `Supplier Unit` + `Base Qty per Supplier Unit` columns, set batang + factor on
   the rebar rows, remove the chair-bar rows.
3. **`tools/syncMaterialCatalog.mjs`**: read the new `Base Qty per Supplier Unit`
   column and include `base_qty_per_supplier_unit` in the upsert + the change-diff.
4. **`supabase/migrations/003_seed.sql`**: patch the rebar seed rows so a fresh
   install matches (supplier_unit + factor, chair bars removed). Existing DBs are
   handled by 052; a fresh DB is handled by the patched seed.
5. **`assets/BOQ/Material Catalog.xlsx`**: regenerate via
   `tmp/export-material-catalog.mjs` (add the factor column, reflect deletions).
   The xlsx is a generated export — never the source of truth.

## 9. Types & tests

- Types to extend with an optional `base_qty_per_supplier_unit?: number | null`:
  `Material` (`tools/types.ts`), `ParsedMaterialRow` (`tools/baseline.ts`),
  `MaterialNamingCatalogEntry` (`tools/materialNaming.ts`), and the screen-level
  `MaterialOption` / `MaterialEntry` interfaces.
- Tests:
  - `materialUnitConversion` unit tests: round-trip kg↔batang, round-up ordering,
    price conversion, `factor == null` identity, `displayQty` batang/kg fallback.
  - `rebarBatang` table test: every kg/batang value equals `kg/m × 12` to 2 dp.
  - Guard test: a representative Pembesian reconciliation (e.g. IV.A.2.7) still
    lands within ±1 Rp — proving the kg path is untouched.
  - Procurement test: a typed batang qty produces the same gate result as the
    equivalent kg qty did before (batang→kg boundary is correct).
  - Ingest test (`toBaseQty`): batang-denominated input converts to kg with the
    factor; batang input without a factor errors (routed to review, not guessed);
    `btg`/`lonjor` spellings normalize.

## 10. Truth-contract guarantees & risks

Guarantees:
- No change to any AHS / normalizer / reconciliation code path. kg estimation and
  the ±1 Rp contract are preserved (proven by the guard test).
- Batang is shown only where a known fixed factor exists; otherwise kg. No rebar
  shows batang next to an unconverted kg quantity.
- Ordering rounds up to whole batang; the exact kg-equivalent is shown alongside
  for transparency.

Risks / open items:
- **BJTP aggregate regeneration** (§7): if suppressing the parser AUTO-row is too
  invasive for this pass, we delete it from live DB and document it as a known
  auto-generated row rather than chasing the generator.
- **Live DB references to chair bars**: if any project already references a chair
  bar, the guarded delete skips it and we surface it for manual review rather than
  force-deleting.
- **Price data**: rebar has no price in `material_catalog` (prices live in
  `ahs_price_book` / `price_history`, per kg). `supplierUnitPrice` converts the
  per-kg price to per-batang at display time; no stored price is rewritten.
