# Rebar Batang Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebar (besi beton) is displayed and ordered in batang (12 m rods) everywhere in the app, while all internal estimation, gates, and reconciliation stay kg-based via a fixed per-diameter conversion factor.

**Architecture:** A new `material_catalog.base_qty_per_supplier_unit` column stores kg-per-batang for the 10 rebar rows (`supplier_unit = 'batang'`). A pure conversion module converts at UI/ingest boundaries only: typed batang → kg before any gate/persist; stored kg → batang at display. `material_request_lines.quantity` and every DB trigger stay kg-canonical and untouched. Spec: `docs/superpowers/specs/2026-07-04-rebar-batang-unit-design.md`.

**Tech Stack:** TypeScript, React Native (Expo), Supabase (Postgres), jest (ts-jest, `npm test`), plain-JS `.mjs` node scripts, SheetJS.

## Global Constraints

- **Truth contract:** never show a batang label next to an unconverted kg number; a batang-denominated input with no factor is an error routed to review, never guessed.
- **kg-canonical persistence:** `material_request_lines.quantity`, `purchase_order_lines.quantity`, `ahs_lines.coefficient`, and all envelope/gate math stay in base units (kg for rebar). DB triggers (033/047/048/049) are NOT modified.
- **Fixed factors (kg per 12 m batang, 2 dp):** D6 2.66, D8 4.74, D10 7.40, D12 10.66, D13 12.50, D16 18.94, D19 26.71, D22 35.81, D25 46.24, D32 75.76 (SNI kg/m × 12).
- **Migrations are idempotent** and applied by the user via the Supabase Dashboard SQL editor (remote history diverged — see MEMORY.md).
- Removed rows: `REB-CHR06`, `REB-CHR08` (chair bars) and live-DB `AUTO-BESI-BETON-BJTP-U24-BJTD-U40-STANDARD-SNI`. Guarded deletes only.
- Indonesian UI copy where surrounding copy is Indonesian (e.g. "batang", "≈ X kg").
- Run tests with `npx jest <path> -t <name>`; full suite `npm test`.

---

### Task 1: `tools/rebarBatang.ts` — the fixed factor table

**Files:**
- Create: `tools/rebarBatang.ts`
- Test: `tools/__tests__/rebarBatang.test.ts`

**Interfaces:**
- Produces: `REBAR_KG_PER_M: Record<number, number>` (diameter mm → SNI kg/m), `BATANG_LENGTH_M = 12`, `REBAR_KG_PER_BATANG: Record<number, number>` (diameter mm → kg per batang, 2 dp), `rebarFactorByCode(code: string): number | null` (catalog code → kg/batang), `REBAR_CATALOG_FACTORS: Array<{ code: string; kgPerBatang: number }>` (the 10 rows for data tasks).

- [ ] **Step 1: Write the failing test**

```ts
// tools/__tests__/rebarBatang.test.ts
import {
  REBAR_KG_PER_M,
  REBAR_KG_PER_BATANG,
  BATANG_LENGTH_M,
  rebarFactorByCode,
  REBAR_CATALOG_FACTORS,
} from '../rebarBatang';

describe('rebarBatang', () => {
  it('derives every kg-per-batang value as kg/m × 12, rounded to 2 dp', () => {
    for (const [dia, kgPerM] of Object.entries(REBAR_KG_PER_M)) {
      const expected = Math.round(kgPerM * BATANG_LENGTH_M * 100) / 100;
      expect(REBAR_KG_PER_BATANG[Number(dia)]).toBe(expected);
    }
  });

  it('matches the fixed contract values', () => {
    expect(REBAR_KG_PER_BATANG[6]).toBe(2.66);
    expect(REBAR_KG_PER_BATANG[8]).toBe(4.74);
    expect(REBAR_KG_PER_BATANG[10]).toBe(7.4);
    expect(REBAR_KG_PER_BATANG[12]).toBe(10.66);
    expect(REBAR_KG_PER_BATANG[13]).toBe(12.5);
    expect(REBAR_KG_PER_BATANG[16]).toBe(18.94);
    expect(REBAR_KG_PER_BATANG[19]).toBe(26.71);
    expect(REBAR_KG_PER_BATANG[22]).toBe(35.81);
    expect(REBAR_KG_PER_BATANG[25]).toBe(46.24);
    expect(REBAR_KG_PER_BATANG[32]).toBe(75.76);
  });

  it('maps catalog codes to factors', () => {
    expect(rebarFactorByCode('REB-PL08')).toBe(4.74);
    expect(rebarFactorByCode('REB-DE13')).toBe(12.5);
    expect(rebarFactorByCode('REB-DE32')).toBe(75.76);
    expect(rebarFactorByCode('CEM-OPC50')).toBeNull();
    expect(rebarFactorByCode('REB-WR01')).toBeNull(); // bendrat is wire, stays kg
  });

  it('exposes exactly the 10 rebar catalog rows', () => {
    expect(REBAR_CATALOG_FACTORS).toHaveLength(10);
    expect(REBAR_CATALOG_FACTORS.map((f) => f.code).sort()).toEqual([
      'REB-DE10', 'REB-DE13', 'REB-DE16', 'REB-DE19', 'REB-DE22',
      'REB-DE25', 'REB-DE32', 'REB-PL06', 'REB-PL08', 'REB-PL12',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/rebarBatang.test.ts`
Expected: FAIL — `Cannot find module '../rebarBatang'`

- [ ] **Step 3: Write the implementation**

```ts
// tools/rebarBatang.ts
// Fixed kg↔batang conversion factors for besi beton (rebar).
//
// Provenance: SNI theoretical weight for nominal diameter d (steel density
// 7850 kg/m³): kg/m = 0.006165 × d². Standard Indonesian lonjor = 12 m.
// kg per batang = kg/m × 12, rounded to 2 dp — these are the FIXED contract
// values stored in material_catalog.base_qty_per_supplier_unit (migration
// 052). Change them here and in the DB in lockstep, or not at all.

export const BATANG_LENGTH_M = 12;

/** SNI theoretical weight (kg/m) by nominal diameter (mm). */
export const REBAR_KG_PER_M: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  13: 1.042,
  16: 1.578,
  19: 2.226,
  22: 2.984,
  25: 3.853,
  32: 6.313,
};

/** kg per 12 m batang by nominal diameter (mm), 2 dp. */
export const REBAR_KG_PER_BATANG: Record<number, number> = Object.fromEntries(
  Object.entries(REBAR_KG_PER_M).map(([dia, kgPerM]) => [
    Number(dia),
    Math.round(kgPerM * BATANG_LENGTH_M * 100) / 100,
  ]),
);

/** Catalog code → diameter for the 10 rebar rows (kg-estimated, batang-ordered). */
const DIAMETER_BY_CODE: Record<string, number> = {
  'REB-PL06': 6,
  'REB-PL08': 8,
  'REB-DE10': 10,
  'REB-PL12': 12,
  'REB-DE13': 13,
  'REB-DE16': 16,
  'REB-DE19': 19,
  'REB-DE22': 22,
  'REB-DE25': 25,
  'REB-DE32': 32,
};

/** kg-per-batang for a catalog code, or null if the code is not a rebar bar. */
export function rebarFactorByCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const dia = DIAMETER_BY_CODE[code];
  return dia != null ? REBAR_KG_PER_BATANG[dia] : null;
}

/** The 10 (code, factor) pairs — the single source the data tasks seed from. */
export const REBAR_CATALOG_FACTORS: Array<{ code: string; kgPerBatang: number }> =
  Object.entries(DIAMETER_BY_CODE).map(([code, dia]) => ({
    code,
    kgPerBatang: REBAR_KG_PER_BATANG[dia],
  }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/rebarBatang.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/rebarBatang.ts tools/__tests__/rebarBatang.test.ts
git commit -m "feat(catalog): fixed SNI kg-per-batang factor table for rebar"
```

---

### Task 2: `tools/materialUnitConversion.ts` — boundary conversions

**Files:**
- Create: `tools/materialUnitConversion.ts`
- Test: `tools/__tests__/materialUnitConversion.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; factor values arrive as arguments).
- Produces:
  - `supplierToBase(qtySupplier: number, factor: number | null | undefined): number`
  - `baseToSupplierExact(qtyBase: number, factor: number | null | undefined): number`
  - `baseToSupplierOrder(qtyBase: number, factor: number | null | undefined): number` (rounds UP)
  - `supplierUnitPrice(pricePerBase: number, factor: number | null | undefined): number`
  - `normalizeUnit(raw: string | null | undefined): string` (`btg`/`batang`/`lonjor` → `'batang'`; otherwise trimmed lowercase)
  - `displayQty(qtyBase: number, material: { unit: string; supplier_unit?: string | null; base_qty_per_supplier_unit?: number | null }): { qty: number; unit: string; baseQty: number; baseUnit: string; converted: boolean }`
  - `toBaseQty(qty: number, rawUnit: string | null | undefined, material: { unit: string; supplier_unit?: string | null; base_qty_per_supplier_unit?: number | null }): { ok: true; qtyBase: number; converted: boolean } | { ok: false; error: string }`
  - `MaterialUnitInfo` (the material param type above, exported)

- [ ] **Step 1: Write the failing test**

```ts
// tools/__tests__/materialUnitConversion.test.ts
import {
  supplierToBase,
  baseToSupplierExact,
  baseToSupplierOrder,
  supplierUnitPrice,
  normalizeUnit,
  displayQty,
  toBaseQty,
} from '../materialUnitConversion';

const D10 = { unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 };
const SEMEN = { unit: 'zak', supplier_unit: 'zak', base_qty_per_supplier_unit: null };

describe('materialUnitConversion', () => {
  it('round-trips batang↔kg exactly', () => {
    expect(supplierToBase(14, 7.4)).toBeCloseTo(103.6, 10);
    expect(baseToSupplierExact(103.6, 7.4)).toBeCloseTo(14, 10);
  });

  it('null/zero factor is identity (1:1)', () => {
    expect(supplierToBase(5, null)).toBe(5);
    expect(baseToSupplierExact(5, undefined)).toBe(5);
    expect(baseToSupplierOrder(5, 0)).toBe(5);
    expect(supplierUnitPrice(9000, null)).toBe(9000);
  });

  it('ordering rounds UP to whole batang', () => {
    expect(baseToSupplierOrder(100, 7.4)).toBe(14);   // 13.51 → 14
    expect(baseToSupplierOrder(103.6, 7.4)).toBe(14); // exact stays 14
    expect(baseToSupplierOrder(0, 7.4)).toBe(0);
  });

  it('converts per-kg price to per-batang', () => {
    expect(supplierUnitPrice(9000, 7.4)).toBeCloseTo(66600, 6);
  });

  it('normalizes batang spellings', () => {
    expect(normalizeUnit('btg')).toBe('batang');
    expect(normalizeUnit('Batang')).toBe('batang');
    expect(normalizeUnit(' LONJOR ')).toBe('batang');
    expect(normalizeUnit('kg')).toBe('kg');
    expect(normalizeUnit(null)).toBe('');
  });

  it('displayQty converts rebar, passes non-rebar through', () => {
    expect(displayQty(103.6, D10)).toEqual({
      qty: 14, unit: 'batang', baseQty: 103.6, baseUnit: 'kg', converted: true,
    });
    expect(displayQty(3, SEMEN)).toEqual({
      qty: 3, unit: 'zak', baseQty: 3, baseUnit: 'zak', converted: false,
    });
  });

  it('toBaseQty: batang input × factor → kg; kg passes through', () => {
    expect(toBaseQty(14, 'btg', D10)).toEqual({ ok: true, qtyBase: 103.6, converted: true });
    expect(toBaseQty(50, 'kg', D10)).toEqual({ ok: true, qtyBase: 50, converted: false });
    expect(toBaseQty(3, 'zak', SEMEN)).toEqual({ ok: true, qtyBase: 3, converted: false });
  });

  it('toBaseQty: batang input with no factor is an ERROR, never guessed', () => {
    const res = toBaseQty(14, 'batang', SEMEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/batang/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/materialUnitConversion.test.ts`
Expected: FAIL — `Cannot find module '../materialUnitConversion'`

- [ ] **Step 3: Write the implementation**

```ts
// tools/materialUnitConversion.ts
// Boundary conversions between a material's BASE unit (what estimation, gates,
// envelopes, and every stored quantity use — kg for rebar) and its SUPPLIER
// unit (what humans order — batang for rebar).
//
// factor = material_catalog.base_qty_per_supplier_unit = base units per ONE
// supplier unit (kg per batang). null/0/absent ⇒ 1:1, all functions identity.
//
// Truth contract: gates and persistence always receive BASE quantities;
// supplier units exist only at input/display boundaries. A supplier-unit
// input without a factor is an error, never a silent pass-through.

export interface MaterialUnitInfo {
  unit: string;
  supplier_unit?: string | null;
  base_qty_per_supplier_unit?: number | null;
}

function factorOrNull(factor: number | null | undefined): number | null {
  return typeof factor === 'number' && isFinite(factor) && factor > 0 ? factor : null;
}

/** Supplier qty (batang) → base qty (kg). Identity without a factor. */
export function supplierToBase(qtySupplier: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? qtySupplier : qtySupplier * f;
}

/** Base qty (kg) → exact supplier qty (fractional batang, for display). */
export function baseToSupplierExact(qtyBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? qtyBase : qtyBase / f;
}

/** Base qty (kg) → whole supplier units, rounded UP (you can't buy 0.4 rod). */
export function baseToSupplierOrder(qtyBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  if (f == null) return qtyBase;
  // Guard float dust: 103.60000000000001 / 7.4 must not ceil 14 → 15.
  return Math.ceil(qtyBase / f - 1e-9);
}

/** Price per base unit (Rp/kg) → price per supplier unit (Rp/batang). */
export function supplierUnitPrice(pricePerBase: number, factor: number | null | undefined): number {
  const f = factorOrNull(factor);
  return f == null ? pricePerBase : pricePerBase * f;
}

const BATANG_SPELLINGS = new Set(['btg', 'batang', 'lonjor']);

/** Normalize a raw unit string; all batang spellings collapse to 'batang'. */
export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? '').trim().toLowerCase();
  return BATANG_SPELLINGS.has(u) ? 'batang' : u;
}

/**
 * THE display entry point: convert a stored base quantity to what the UI
 * shows. Rebar (has factor) → batang with kg kept alongside; everything else
 * passes through. No screen converts on its own.
 */
export function displayQty(
  qtyBase: number,
  material: MaterialUnitInfo,
): { qty: number; unit: string; baseQty: number; baseUnit: string; converted: boolean } {
  const f = factorOrNull(material.base_qty_per_supplier_unit);
  if (f == null) {
    return { qty: qtyBase, unit: material.unit, baseQty: qtyBase, baseUnit: material.unit, converted: false };
  }
  const qty = Math.round((qtyBase / f) * 100) / 100;
  return {
    qty,
    unit: material.supplier_unit || 'batang',
    baseQty: qtyBase,
    baseUnit: material.unit,
    converted: true,
  };
}

/**
 * THE ingest entry point: normalize an input quantity to the material's base
 * unit. Batang-denominated input needs a factor; without one it is an error
 * routed to review — never treated as kg, never guessed.
 */
export function toBaseQty(
  qty: number,
  rawUnit: string | null | undefined,
  material: MaterialUnitInfo,
): { ok: true; qtyBase: number; converted: boolean } | { ok: false; error: string } {
  const unit = normalizeUnit(rawUnit);
  if (unit !== 'batang') {
    return { ok: true, qtyBase: qty, converted: false };
  }
  const f = factorOrNull(material.base_qty_per_supplier_unit);
  if (f == null) {
    return {
      ok: false,
      error: `qty dalam batang tapi material "${material.unit}" tidak punya faktor kg/batang — perlu review manual`,
    };
  }
  return { ok: true, qtyBase: qty * f, converted: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/materialUnitConversion.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/materialUnitConversion.ts tools/__tests__/materialUnitConversion.test.ts
git commit -m "feat(catalog): kg↔batang boundary conversion module (displayQty/toBaseQty)"
```

---

### Task 3: Catalog data — migration 052, seed patch, CSV, sync tool, types

**Files:**
- Create: `supabase/migrations/052_rebar_batang_unit.sql`
- Modify: `supabase/migrations/003_seed.sql:318-331`
- Modify: `assets/mock/material_master.csv` (header + rows 35-47)
- Modify: `tools/syncMaterialCatalog.mjs:168-201` (readMaterialRows), `:414`, `:442`, `:477` (selects + diff)
- Modify: `tools/types.ts:136-143` (`Material`), `tools/baseline.ts:332-341` (`ParsedMaterialRow`), `tools/materialNaming.ts:1-9` (`MaterialNamingCatalogEntry`)

**Interfaces:**
- Consumes: factor values — copy verbatim from Global Constraints (they equal `REBAR_CATALOG_FACTORS` in Task 1).
- Produces: DB column `material_catalog.base_qty_per_supplier_unit NUMERIC NULL`; every catalog TS type gains `base_qty_per_supplier_unit?: number | null`.

- [ ] **Step 1: Write migration 052 (idempotent — Dashboard-applied)**

```sql
-- 052_rebar_batang_unit.sql
-- Rebar is ordered in batang (12 m lonjor), estimated in kg. This adds the
-- fixed kg-per-batang factor and flips rebar supplier_unit to 'batang'.
-- Factors = SNI kg/m × 12 m (see tools/rebarBatang.ts). Idempotent.

ALTER TABLE material_catalog
  ADD COLUMN IF NOT EXISTS base_qty_per_supplier_unit NUMERIC;

COMMENT ON COLUMN material_catalog.base_qty_per_supplier_unit IS
  'Base units (unit) per ONE supplier_unit. NULL = 1:1. Rebar: kg per 12 m batang (SNI kg/m × 12).';

UPDATE material_catalog SET supplier_unit = 'batang', base_qty_per_supplier_unit = v.factor
FROM (VALUES
  ('REB-PL06', 2.66),
  ('REB-PL08', 4.74),
  ('REB-DE10', 7.40),
  ('REB-PL12', 10.66),
  ('REB-DE13', 12.50),
  ('REB-DE16', 18.94),
  ('REB-DE19', 26.71),
  ('REB-DE22', 35.81),
  ('REB-DE25', 46.24),
  ('REB-DE32', 75.76)
) AS v(code, factor)
WHERE material_catalog.code = v.code;

-- Remove never-used rows. Guarded: skip (and surface via NOTICE) any row that
-- is referenced somewhere — never force-delete data.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, code FROM material_catalog
    WHERE code IN ('REB-CHR06', 'REB-CHR08', 'AUTO-BESI-BETON-BJTP-U24-BJTD-U40-STANDARD-SNI')
  LOOP
    BEGIN
      -- material_aliases / material_specs cascade by FK; everything else is NO ACTION.
      DELETE FROM material_catalog WHERE id = r.id;
      RAISE NOTICE 'Deleted unused material %', r.code;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'SKIPPED % — still referenced; review manually', r.code;
    END;
  END LOOP;
END $$;
```

- [ ] **Step 2: Patch the seed for fresh installs**

In `supabase/migrations/003_seed.sql`, the rebar rows sit inside `INSERT INTO material_catalog (code, name, category, tier, unit, supplier_unit) VALUES ...` (line 283). Do NOT restructure that INSERT. Instead: (a) delete lines 330-331 (`REB-CHR06`, `REB-CHR08`); (b) append this after that INSERT's terminating `;`, guarded exactly like the surrounding seed blocks:

```sql
  -- Rebar orders in batang (kept in sync with 052 + tools/rebarBatang.ts)
  UPDATE material_catalog SET supplier_unit = 'batang', base_qty_per_supplier_unit = v.factor
  FROM (VALUES
    ('REB-PL06', 2.66), ('REB-PL08', 4.74), ('REB-DE10', 7.40), ('REB-PL12', 10.66),
    ('REB-DE13', 12.50), ('REB-DE16', 18.94), ('REB-DE19', 26.71), ('REB-DE22', 35.81),
    ('REB-DE25', 46.24), ('REB-DE32', 75.76)
  ) AS v(code, factor)
  WHERE material_catalog.code = v.code;
```

Note: 003 runs before 052 on a fresh install, so 052's `ADD COLUMN IF NOT EXISTS`... does NOT yet exist when 003 runs. Fix: also add the `ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS base_qty_per_supplier_unit NUMERIC;` line immediately before the UPDATE in 003 (idempotent, harmless when 052 already ran).

- [ ] **Step 3: Update `assets/mock/material_master.csv`**

Header becomes: `Kode Material,Nama Material,Kategori,Tier,Satuan Unit,Supplier Unit,Base Qty per Supplier Unit,Harga Satuan (Rp)` — insert the two new columns BEFORE the price column, leave every existing row's new cells empty (sync falls back `supplier_unit = unit`). Then:
- Rows 35-45 (REB-DE10…REB-PL12): set `Supplier Unit = batang` and the row's factor (7.40, 12.50, 18.94, 26.71, 35.81, 46.24, 75.76, 2.66, 4.74, 7.40 wait — set per code, copying from Global Constraints; e.g. line 35 `REB-DE10` gets `batang,7.40`).
- Delete rows 46-47 (`REB-CHR06`, `REB-CHR08`).

Verify: `grep -c ',' assets/mock/material_master.csv`-style spot check is unreliable; instead run `node -e "const l=require('fs').readFileSync('assets/mock/material_master.csv','utf8').split(/\r?\n/); console.log(l[0]); console.log(l.filter(x=>x.includes('REB-')).join('\n'))"` and confirm 11 REB rows (10 bars + REB-WR01 bendrat unchanged) with correct factors.

- [ ] **Step 4: Teach the sync tool the new column**

In `tools/syncMaterialCatalog.mjs`:

`readMaterialRows()` (after `supplierUnitIndex`, line ~180):

```js
  const baseQtyIndex = findHeaderIndex(map, ['Base Qty per Supplier Unit', 'base_qty_per_supplier_unit']);
```

and in the returned object (after `supplier_unit: supplierUnit,`):

```js
        base_qty_per_supplier_unit: (() => {
          const raw = optionalValue(row, baseQtyIndex);
          if (!raw) return null;
          const n = Number(raw);
          if (!isFinite(n) || n <= 0) throw new Error(`Base Qty per Supplier Unit tidak valid: "${raw}"`);
          return n;
        })(),
```

Both `.select('id, code, name, category, tier, unit, supplier_unit')` calls (lines ~414, ~477) gain `, base_qty_per_supplier_unit`. The change-diff (line ~442) gains:

```js
      (existing.base_qty_per_supplier_unit ?? null) !== (material.base_qty_per_supplier_unit ?? null) ||
```

- [ ] **Step 5: Extend the catalog TS types**

Add `base_qty_per_supplier_unit?: number | null;` after each type's `supplier_unit` field: `Material` (`tools/types.ts:142`), `ParsedMaterialRow` (`tools/baseline.ts:338`), `MaterialNamingCatalogEntry` (`tools/materialNaming.ts:8`).

- [ ] **Step 6: Verify nothing broke**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20` (expect no NEW errors vs `git stash && npx tsc --noEmit | head -20 && git stash pop` baseline if the repo has pre-existing ones) and `npm test -- --testPathPattern='rebarBatang|materialUnitConversion'`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/052_rebar_batang_unit.sql supabase/migrations/003_seed.sql \
  assets/mock/material_master.csv tools/syncMaterialCatalog.mjs tools/types.ts tools/baseline.ts tools/materialNaming.ts
git commit -m "feat(catalog): rebar supplier_unit=batang + kg-per-batang factor column (052)"
```

---

### Task 4: Ingest flexibility — batang-denominated workbooks at publish

**Files:**
- Modify: `tools/publishBaselineV2.ts` (CatalogRow ~line 10-15, catalog select ~401, component loop ~594-630)
- Test: `tools/__tests__/publishComponentUnit.test.ts` (new; tests the extracted pure helper)

**Interfaces:**
- Consumes: `toBaseQty`, `normalizeUnit` (Task 2).
- Produces: `normalizeComponentQty(component: { quantityPerUnit: number; unit?: string }, mat: { unit: string; supplier_unit?: string | null; base_qty_per_supplier_unit?: number | null } | null): { coefficient: number; unit: string; error: string | null }` — exported from `tools/publishBaselineV2.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/__tests__/publishComponentUnit.test.ts
import { normalizeComponentQty } from '../publishBaselineV2';

const D10 = { unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 };

describe('normalizeComponentQty', () => {
  it('kg-denominated rebar passes through untouched', () => {
    expect(normalizeComponentQty({ quantityPerUnit: 75.26, unit: 'kg' }, D10))
      .toEqual({ coefficient: 75.26, unit: 'kg', error: null });
  });

  it('batang-denominated rebar converts to kg via the factor', () => {
    const r = normalizeComponentQty({ quantityPerUnit: 2, unit: 'btg' }, D10);
    expect(r.error).toBeNull();
    expect(r.coefficient).toBeCloseTo(14.8, 10);
    expect(r.unit).toBe('kg');
  });

  it('batang-denominated with unresolved material errors (→ review), never guesses', () => {
    const r = normalizeComponentQty({ quantityPerUnit: 2, unit: 'batang' }, null);
    expect(r.error).toMatch(/batang/i);
  });

  it('batang-denominated with no factor errors (→ review)', () => {
    const r = normalizeComponentQty(
      { quantityPerUnit: 2, unit: 'batang' },
      { unit: 'kg', supplier_unit: 'kg', base_qty_per_supplier_unit: null },
    );
    expect(r.error).toMatch(/faktor/i);
  });

  it('non-batang non-rebar unit passes through (usuk in btg has factor? no → error is correct)', () => {
    // A 'btg' component whose material has no factor MUST go to review — e.g.
    // kayu usuk is genuinely sold per batang but has no kg factor; its base
    // unit IS btg, so pass through when base unit itself is batang.
    const usuk = { unit: 'btg', supplier_unit: 'btg', base_qty_per_supplier_unit: null };
    expect(normalizeComponentQty({ quantityPerUnit: 9, unit: 'btg' }, usuk))
      .toEqual({ coefficient: 9, unit: 'btg', error: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/publishComponentUnit.test.ts`
Expected: FAIL — `normalizeComponentQty` is not exported

- [ ] **Step 3: Implement the helper + wire it into the component loop**

In `tools/publishBaselineV2.ts`, import at top: `import { normalizeUnit, toBaseQty } from './materialUnitConversion';`. Add the exported helper near `resolveCatalogId`:

```ts
/**
 * Normalize a parsed component's quantity to the linked material's BASE unit.
 * Handles future batang-denominated workbooks: 'btg/batang/lonjor' × factor →
 * kg. If the component is batang-denominated but the material's own base unit
 * is (b)atang, it IS base — pass through. Batang input with no resolvable
 * factor returns an error string (caller routes the line to review).
 */
export function normalizeComponentQty(
  component: { quantityPerUnit: number; unit?: string },
  mat: { unit: string; supplier_unit?: string | null; base_qty_per_supplier_unit?: number | null } | null,
): { coefficient: number; unit: string; error: string | null } {
  const rawUnit = component.unit || '';
  if (normalizeUnit(rawUnit) !== 'batang') {
    return { coefficient: component.quantityPerUnit, unit: rawUnit, error: null };
  }
  if (mat == null) {
    return {
      coefficient: component.quantityPerUnit,
      unit: rawUnit,
      error: 'qty dalam batang tapi material tidak dikenali di katalog — perlu review manual',
    };
  }
  if (normalizeUnit(mat.unit) === 'batang') {
    // Material's base unit IS batang (e.g. kayu usuk) — already base.
    return { coefficient: component.quantityPerUnit, unit: rawUnit, error: null };
  }
  const res = toBaseQty(component.quantityPerUnit, rawUnit, mat);
  if (!res.ok) return { coefficient: component.quantityPerUnit, unit: rawUnit, error: res.error };
  return { coefficient: res.qtyBase, unit: mat.unit, error: null };
}
```

Catalog plumbing: extend the select at line ~401 to `.select('id, code, name, category, tier, unit, supplier_unit, base_qty_per_supplier_unit')` and add both fields to the local `CatalogRow` type. In the component loop (~line 599-630), after `materialId` is resolved, look up the full catalog row (build a `Map<string, CatalogRow>` by id right after the catalog loads: `const catalogById = new Map(catalog.map(c => [c.id, c]));`) and replace the two `coefficient: c.quantityPerUnit` / `unit: c.unit || ''` usages:

```ts
      const matRow = materialId != null ? catalogById.get(materialId) ?? null : null;
      const norm = normalizeComponentQty(
        { quantityPerUnit: c.quantityPerUnit, unit: c.unit },
        matRow,
      );
      if (norm.error) {
        unresolvedComponents.push(`${pd.code}: ${name} — ${norm.error}`);
        continue; // review, never a guessed number
      }
```

then use `norm.coefficient` for `coefficient`/`usage_rate` and `norm.unit` for `unit` in BOTH `ahsLineInserts` and `masterLineInputs`.

Unit-price note: when a component is batang-denominated its `unitPrice` is per-batang; after converting qty to kg the price must convert too or line totals lie. Add to the wired code, before pushing inserts:

```ts
      const unitPrice = norm.error == null && norm.unit !== (c.unit || '') && norm.coefficient > 0
        ? c.unitPrice * (c.quantityPerUnit / norm.coefficient) // Rp/batang → Rp/kg (total invariant)
        : c.unitPrice;
```

and use `unitPrice` instead of `c.unitPrice`.

- [ ] **Step 4: Run tests**

Run: `npx jest tools/__tests__/publishComponentUnit.test.ts` then `npm test -- --testPathPattern='publish'`
Expected: PASS; existing publish tests unchanged (kg components hit the pass-through branch).

- [ ] **Step 5: Commit**

```bash
git add tools/publishBaselineV2.ts tools/__tests__/publishComponentUnit.test.ts
git commit -m "feat(publish): accept batang-denominated workbook components, normalize to kg at link"
```

---

### Task 5: PermintaanScreen — supervisor orders in batang

**Files:**
- Modify: `workflows/screens/PermintaanScreen.tsx` (`MaterialOption` :34-42, `RequestLine` :44-57, select :288, `applyMaterialSelection` :413-437, `linesWithResults` :437-520, `handleSubmit` :549-650, line/picker renders ~:761, ~:1080)

**Interfaces:**
- Consumes: `supplierToBase`, `supplierUnitPrice`, `displayQty` from `tools/materialUnitConversion` (Task 2).
- Produces: UI behavior only. Persisted rows: `material_request_lines.quantity` in BASE kg, `unit` = base unit (`'kg'`), so triggers 048/049 and allocations stay correct.

- [ ] **Step 1: Extend the line/material state with the factor**

Add to `MaterialOption` and `RequestLine`: `base_qty_per_supplier_unit?: number | null;` (and to `RequestLine` also `baseUnit: string;` defaulting to `unit`). Extend the select at :288 to `.select('id, name, unit, supplier_unit, tier, code, category, base_qty_per_supplier_unit')`. In `applyMaterialSelection` (:417-427) add `base_qty_per_supplier_unit: material.base_qty_per_supplier_unit ?? null, baseUnit: material.unit,` next to the existing `unit: material.supplier_unit || material.unit,` (which already labels the input 'batang' for rebar). Where new empty lines are constructed (`{ id: …, quantity: '', unit: '', … }` — grep `unit: ''` in this file), add `base_qty_per_supplier_unit: null, baseUnit: ''`.

- [ ] **Step 2: Convert typed batang → kg BEFORE the gates**

In `linesWithResults` (:439-441), immediately after `const requestedQty = parseFloat(line.quantity);` and its NaN guard, add:

```ts
      // Supervisor types SUPPLIER units (batang for rebar); every gate,
      // envelope and allocation below is BASE-unit (kg) math.
      const requestedBaseQty = supplierToBase(requestedQty, line.base_qty_per_supplier_unit);
```

then replace every downstream use of `requestedQty` inside this callback (`computeWorkGroupGate1Flag(envelope, requestedQty, group.label)`, `buildWorkGroupAllocations(breakdown, group.itemIds, requestedQty)`, `buildTier2Result(envelope, requestedQty)`, `buildTier2Allocations(…, requestedQty)`, `buildTier3Result(requestedQty, line.unit)`, and the Tier-3 `allocatedQuantity: roundQty(requestedQty)`) with `requestedBaseQty`. For `buildTier3Result(requestedBaseQty, line.baseUnit || line.unit)` pass the base unit label.

- [ ] **Step 3: Persist kg-canonical**

In `handleSubmit`'s line insert (:602-617) replace:

```ts
            quantity: parseFloat(line.quantity),
            unit: sanitizeText(line.unit),
```

with:

```ts
            // BASE-unit canonical: triggers 048/049 compare quantity against
            // per-kg benchmarks/envelopes. Batang exists only in the UI.
            quantity: supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit),
            unit: sanitizeText(line.base_qty_per_supplier_unit ? (line.baseUnit || line.unit) : line.unit),
```

The `activity_log` label (:638-640) keeps `line.quantity`/`line.unit` — human copy stays in batang as typed. Add the kg equivalent for auditability:

```ts
      const materialSummary = validLines
        .map(line => {
          const base = supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit);
          const kgNote = line.base_qty_per_supplier_unit ? ` (≈ ${base.toFixed(1)} ${line.baseUnit || 'kg'})` : '';
          return `${line.materialName} ×${line.quantity} ${line.unit}${kgNote}`.trim();
        })
        .join(', ');
```

- [ ] **Step 4: Show the kg equivalent next to the input + per-batang price hint**

Wherever the line's qty input row renders the unit (the `TextInput` for quantity with `{line.unit}` beside it — grep `line.unit` in the render JSX), add under it, only when `line.base_qty_per_supplier_unit` is set and quantity is a positive number:

```tsx
{line.base_qty_per_supplier_unit != null && isPositiveNumber(line.quantity) && (
  <Text style={styles.hint}>
    ≈ {supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit).toFixed(1)} {line.baseUnit || 'kg'} · 1 batang = {line.base_qty_per_supplier_unit} kg
  </Text>
)}
```

(reuse the screen's existing muted hint style; if none is named `hint`, use the nearest existing muted text style). The picker row at ~:1080 already renders `item.supplier_unit || item.unit` — after Task 3's data change this shows `batang` with no code change; verify visually.

- [ ] **Step 5: Type-check, run the app-level tests, commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i permintaan` (expect nothing) and `npm test -- --testPathPattern='workflows|screens' 2>&1 | tail -5`
Expected: no new failures.

```bash
git add workflows/screens/PermintaanScreen.tsx
git commit -m "feat(permintaan): order rebar in batang; gates and persistence stay kg"
```

---

### Task 6: Gate2Screen — PO drafting in batang

**Files:**
- Modify: `workflows/screens/Gate2Screen.tsx` (MaterialOption-ish picker :270-345, draft validation/submit :420-470, line displays :564, :905)

**Interfaces:**
- Consumes: `supplierToBase`, `supplierUnitPrice`, `displayQty` (Task 2).
- Produces: `purchase_order_lines.quantity` stays BASE kg; `unit_price` stays per-kg; the Gate-2 RPC (`p_quantity`, `p_unit_price` :461-463) receives kg + per-kg.

- [ ] **Step 1: Carry the factor in the picker**

Extend the material query/type used at :276/:339 with `supplier_unit` and `base_qty_per_supplier_unit` (mirror Task 5 Step 1). At :339 set `unit: material.supplier_unit || material.unit` (currently `material.unit`) and store `base_qty_per_supplier_unit` + `baseUnit: material.unit` on the draft line type (:50-56).

- [ ] **Step 2: Convert at the submit boundary**

At :438-463, quantities and prices are aggregated then sent to the RPC and inserted. For each populated line compute:

```ts
const baseQty = supplierToBase(parseFloat(line.quantity), line.base_qty_per_supplier_unit);
// Office types price per SUPPLIER unit (Rp/batang) when a factor exists;
// convert to Rp/kg so the benchmark comparison stays truthful.
const basePrice = line.base_qty_per_supplier_unit
  ? parseFloat(line.unit_price) / line.base_qty_per_supplier_unit
  : parseFloat(line.unit_price);
```

Use `baseQty`/`basePrice` for `totalQuantity` (:438), `headerPrice` (:442), the persisted line `quantity`/`unit_price` (:448-450, with `unit: line.baseUnit || line.unit`), and the RPC params (:461-463). Total is invariant (batang × Rp/batang = kg × Rp/kg) so Gate-2 totals don't shift.

- [ ] **Step 3: Display existing PO lines in batang**

Lines :564 and :905 render `{line.quantity} {line.unit}` from stored (kg) rows. These rows don't carry the factor — fetch it: wherever PO lines are loaded in this screen, join/augment `material_id → material_catalog(unit, supplier_unit, base_qty_per_supplier_unit)` (follow the screen's existing select pattern), then render via:

```tsx
{(() => { const d = displayQty(line.quantity, line.material ?? { unit: line.unit ?? '' });
  return `${d.qty} ${d.unit}${d.converted ? ` (≈ ${d.baseQty.toFixed(1)} ${d.baseUnit})` : ''}`; })()}
```

For :905 also convert the price label: when converted, show `@ Rp{supplierUnitPrice(line.unit_price, factor)} /batang`.

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i gate2` (expect nothing).

```bash
git add workflows/screens/Gate2Screen.tsx
git commit -m "feat(gate2): PO drafting/display in batang; RPC and rows stay kg per-kg"
```

---

### Task 7: Display sweep — Approvals, Terima, catalog screens, RecipeView

**Files:**
- Modify: `office/screens/ApprovalsScreen.tsx` (:160-170 select, :434, :545, :552-553)
- Modify: `workflows/screens/TerimaScreen.tsx` (:64 select, :123-125 totals, received-qty input)
- Modify: `workflows/screens/MaterialCatalogScreen.tsx` (:24, :213-215, :348)
- Modify: `office/screens/MaterialCatalogScreen.tsx` (:92-99 insert, :229 hint, unit fields)
- Modify: `workflows/screens/components/RecipeView.tsx` (:71-72)

**Interfaces:**
- Consumes: `displayQty`, `supplierToBase`, `baseToSupplierExact` (Task 2); `rebarFactorByCode` (Task 1, RecipeView only).

- [ ] **Step 1: ApprovalsScreen** — extend the request-line select (:160-170) to embed `material_catalog(unit, supplier_unit, base_qty_per_supplier_unit)` via the existing `material_id` FK; at :434 and :545 render through `displayQty(line.quantity, mat)` with the `(≈ N kg)` suffix when converted; pass the converted pair to :552-553 (`requestedQuantity={d.qty} requestedUnit={d.unit}`) ONLY if that child is display-only — check `<child>`'s usage first; if it feeds math, keep passing base values and convert inside the child's render instead.

- [ ] **Step 2: TerimaScreen** — receiving happens in physical rods. Extend the PO/mtn select (:64) with the same embedded catalog fields. Display `quantity`, `totalReceived`, `remainingQty` (:123-125) via `displayQty`. The received-qty input: supervisor types batang when the material has a factor; convert with `supplierToBase` before writing `quantity_actual` (locate the insert writing `quantity_actual` in this screen and wrap the parsed input). Show the `≈ kg` hint under the input exactly as in Task 5 Step 4.

- [ ] **Step 3: workflows/MaterialCatalogScreen** — add `base_qty_per_supplier_unit` to the row type (:24). Detail view after :215:

```tsx
{selectedMaterial.base_qty_per_supplier_unit != null && (
  <Text style={styles.detailMetaItem}>
    1 {selectedMaterial.supplier_unit} = {selectedMaterial.base_qty_per_supplier_unit} {selectedMaterial.unit}
  </Text>
)}
```

List row (:348): render `{mat.supplier_unit || mat.unit}` instead of `{mat.unit}`.

- [ ] **Step 4: office/MaterialCatalogScreen** — decouple supplier unit: replace the forced `supplier_unit: cleanUnit` (:98) with a second optional input field `supplierUnit` (defaulting to the unit value) plus an optional numeric `baseQtyPerSupplierUnit` field; insert both (`supplier_unit: cleanSupplierUnit || cleanUnit, base_qty_per_supplier_unit: parsedFactor ?? null`). Replace the hint at :229 ("Satuan supplier otomatis mengikuti satuan unit.") with "Satuan supplier boleh beda (mis. besi: kg → batang). Isi faktor konversi bila beda." Show price rows (:296) per supplier unit when a factor exists: `Rp {supplierUnitPrice(latestPrice.unit_price, m.base_qty_per_supplier_unit).toLocaleString('id-ID')} / {m.supplier_unit}` with the per-kg value in parentheses.

- [ ] **Step 5: RecipeView** — recipe components come from workbooks (kg/m³ for rebar), with `comp.materialName` like "Besi D8"; there is no catalog id here. Use Task 1's name-free path: add to `tools/rebarBatang.ts` a `rebarFactorByName(name: string): number | null` that matches `/\b[DPØ]\s?-?\s?(6|8|10|12|13|16|19|22|25|32)\b/i` and returns the diameter's factor (with its own test case in the Task 1 test file — add it now if skipped earlier). Then at :71:

```tsx
const batangFactor = rebarFactorByName(comp.materialName);
const coeffFormatted = batangFactor != null
  ? `${formatQuantity(comp.quantityPerUnit / batangFactor, 2)} batang (${formatQuantity(comp.quantityPerUnit, 2)} kg)`
  : formatQuantity(comp.quantityPerUnit, 4);
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "approvals|terima|catalog|recipe"` (expect nothing) and `npm test -- --testPathPattern='RecipeView|components' 2>&1 | tail -3`.

```bash
git add office/screens/ApprovalsScreen.tsx workflows/screens/TerimaScreen.tsx \
  workflows/screens/MaterialCatalogScreen.tsx office/screens/MaterialCatalogScreen.tsx \
  workflows/screens/components/RecipeView.tsx tools/rebarBatang.ts tools/__tests__/rebarBatang.test.ts
git commit -m "feat(ui): batang front-facing across approvals, receiving, catalog, recipe views"
```

---

### Task 8: Takeoff export — batang column in procurement rollups

**Files:**
- Modify: `tools/materialTakeoff.ts` (rollup sheet writer — locate the XLSX row-building section that writes material name/unit/qty columns)
- Test: extend `tools/__tests__/` alongside existing takeoff tests if present (`ls tools/__tests__ | grep -i takeoff` — if none exist, add `tools/__tests__/materialTakeoffBatang.test.ts` for the helper only)

**Interfaces:**
- Consumes: `rebarFactorByName` (Task 7 Step 5), `baseToSupplierOrder` (Task 2).

- [ ] **Step 1:** In the takeoff writer, for each material row whose `rebarFactorByName(name)` is non-null AND unit is `kg`, append two extra columns: `Batang (12m)` = `baseToSupplierOrder(totalQty, factor)` and `Faktor (kg/btg)` = the factor. kg columns stay exactly as-is (the canonical numbers). Add a header note row: `Rebar dipesan per batang 12 m — kolom kg tetap acuan kebenaran.`
- [ ] **Step 2:** Test the pure decision: a row `('Besi D8', 'kg', 100)` yields batang `22` (100/4.74=21.1→22); `('Semen', 'zak', 10)` yields no batang column value.
- [ ] **Step 3:** Run `npx jest tools/__tests__ --testPathPattern='akeoff'` → PASS, then commit:

```bash
git add tools/materialTakeoff.ts tools/__tests__/materialTakeoffBatang.test.ts
git commit -m "feat(takeoff): batang order column for rebar rows (kg stays canonical)"
```

---

### Task 9: Guard test + full verification

**Files:**
- Test: run existing suites; no new files unless a regression appears.

- [ ] **Step 1: Reconciliation guard** — `npm test -- --testPathPattern='normalizer|boqParserV2'`
Expected: PASS with zero changes — proves the kg-based ±1 Rp path is untouched.
- [ ] **Step 2: Full suite** — `npm test 2>&1 | tail -15`
Expected: same pass/fail set as `git stash`-baseline (record baseline first if unsure).
- [ ] **Step 3: Commit anything outstanding**; do NOT push.

---

### Task 10: Apply + sync + regenerate (requires user's Dashboard step)

**Files:**
- Modify: `tmp/export-material-catalog.mjs` (add `base_qty_per_supplier_unit` to the select :28-32 and a `Base Qty per Supplier Unit` column to the sheet :44-52)
- Regenerate: `assets/BOQ/Material Catalog.xlsx`

- [ ] **Step 1:** Update the export script columns (code only — safe before migration).
- [ ] **Step 2:** **STOP — hand to user:** apply `052_rebar_batang_unit.sql` via the Supabase Dashboard SQL editor (db push is broken per MEMORY.md). Wait for confirmation.
- [ ] **Step 3:** After confirmation: `node tools/syncMaterialCatalog.mjs` (pushes CSV factors; requires `SUPABASE_SERVICE_KEY` in `.env`), then `node tmp/export-material-catalog.mjs` to regenerate the xlsx. Verify the xlsx rebar rows read `kg | batang | <factor>` and chair bars + the AUTO-BJTP row are gone.
- [ ] **Step 4:** Commit the regenerated xlsx + export script.

```bash
git add tmp/export-material-catalog.mjs "assets/BOQ/Material Catalog.xlsx"
git commit -m "chore(catalog): export factor column; regenerate catalog xlsx post-052"
```

---

## Self-review notes

- Spec §4 (column) → Task 3; §5 (module) → Tasks 1-2; §6.1 → Task 5; §6.2 → Tasks 6-8; §6.3 → Task 7 Step 4; §6.4 → Task 4; §7 (deletions) → Task 3 Step 1; §8 (mechanics) → Tasks 3, 10; §9 (types/tests) → Tasks 1-4, 9. No orphan requirements found.
- Type names consistent: `base_qty_per_supplier_unit` everywhere; `displayQty`/`toBaseQty`/`supplierToBase`/`baseToSupplierOrder` match between Task 2 definitions and Tasks 4-8 usages; `rebarFactorByName` introduced in Task 7 and reused in Task 8.
- Screen-edit steps cite grep-anchors + exact replacement code because render-section line numbers drift; implementer must verify each anchor before editing.
