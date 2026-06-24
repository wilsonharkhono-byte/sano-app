# Material Tier Budget Control — Design

> Status: approved design, pending implementation plan.
> Date: 2026-06-24.
> Supersedes the flat Tier-3 per-request spend cap with a real Rupiah budget envelope,
> and introduces a Tier 4 for untracked consumables.

---

## 1. Goal

Today SANO controls material spend on two quantity-based tiers (1 = direct 1:1
to a BoQ row, 2 = aggregated quantity envelope) plus a flat Tier-3 tripwire
(reject any single request over Rp 5,000,000). The flat cap is not real budget
control — it does not know the project's budget, does not deplete, and is not
reflected in the material balance report.

We replace it with **budget-price control**:

- **Tier 3 (new):** a per-material **Rupiah budget envelope** that depletes as
  POs are ordered, anchored to a benchmark price from the AHS template. Works
  even when the admin enters no price on the PO.
- **Tier 4 (new):** consumables that are not tracked or calculated at all
  (the genuine "don't bother" bucket the old 5-juta cap was standing in for).

The material balance report becomes a **mixed-control** view: some materials
gated on quantity (Tier 1/2), some on Rupiah cap (Tier 3), some untracked
(Tier 4).

### 1.1 Truth-correctness contract (inherited, non-negotiable)

Consistent with the BoQ normalizer's contract (`CLAUDE.md` §1.1): **never emit a
confident-looking number we can't stand behind.**

- A material the parser cannot match to the AHS price book goes to an
  **Unresolved** list — we do not invent a price.
- A Tier-3 material with **no benchmark price** produces a **blocking gate
  flag** ("cannot evaluate budget"), never a silent pass and never a fabricated
  budget.

---

## 2. Tier model (redefined)

| Tier | Control dimension | Gate basis |
|---|---|---|
| 1 | Quantity, 1:1 to a BoQ row | ordered qty vs row planned (unchanged) |
| 2 | Quantity, aggregated across rows | ordered qty vs material qty envelope (unchanged) |
| **3 (new)** | **Rupiah budget** | ordered × price vs material budget envelope |
| **4 (new)** | **None** — consumables | always passes; visible but untracked |

Tier is declared **once, in the AHS template**, per material. The catalog and
the budget envelope inherit it on import. The old `checkTier3SpendCap` and
`TIER3_PER_REQUEST_CAP` are deleted.

---

## 3. Parser input (two files)

The estimator provides two Excel inputs. The exact **simplified BoQ column
layout is pending a template from the user** — this spec defines the parser's
*output contract*; the column mapping is filled in when the template arrives.

### 3.1 AHS price book (the price + tier authority)

One row per material. The **absolute** source of price and tier.

| material | unit | unit_price | tier |
|---|---|---|---|
| Besi D8 | kg | 9,000 | 1 |
| Bata Merah | pcs | 1,200 | 2 |
| Cat tembok | ltr | 85,000 | 3 |
| Lakban | roll | 15,000 | 4 |

### 3.2 Simplified BoQ (1 sheet) — format TBD

Conceptually: `boq_item | material | volume | quantity`. No prices, no AHS
blocks. The parser **joins BoQ → price book by material name** using fuzzy
matching (per the catalog-overlap reality: catalog has duplicate/overlapping
names during transition, so matching must be fuzzy, not exact).

### 3.3 Parser contract (what it must produce)

- Populate `project_material_master_lines` with `planned_quantity` per
  `(boq_item, material)` — the existing staging shape, reused unchanged.
- Populate / upsert `ahs_price_book` with `(material, unit, unit_price, tier)`.
- Emit an **Unresolved list** of BoQ materials with no price-book match. These
  are NOT staged with a guessed price.
- Ships as a **new parser path beside `parseBoqV2`** (which stays live and
  untouched), so the existing AHS-block workbooks keep working while the
  simplified format is proven.

---

## 4. Schema changes

All migrations **idempotent** and applied via the Dashboard SQL Editor (remote
migration history is out of sync; `supabase db push` is unreliable).

### 4.1 New table `ahs_price_book`

```sql
CREATE TABLE IF NOT EXISTS ahs_price_book (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id    UUID REFERENCES material_catalog(id),
  material_name  TEXT NOT NULL,
  unit           TEXT NOT NULL,
  unit_price     NUMERIC NOT NULL,
  tier           SMALLINT NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`unit_price` is the **pre-markup base price** (markup is applied at quote/billing
time, not at envelope evaluation — consistent with the existing envelope note).

### 4.2 Tier widening

```sql
-- material_catalog.tier currently CHECK (tier IN (1,2,3)); widen to 4.
ALTER TABLE material_catalog DROP CONSTRAINT IF EXISTS <tier_check_name>;
ALTER TABLE material_catalog ADD CONSTRAINT material_catalog_tier_check
  CHECK (tier IN (1, 2, 3, 4));
```

(Find the existing constraint by shape, not by a hardcoded name — same defensive
pattern as migration 046's FK repair.)

### 4.3 Actual-price override on PO/allocation

```sql
-- Allow an admin to override the benchmark for a specific order line.
ALTER TABLE material_request_lines
  ADD COLUMN IF NOT EXISTS actual_unit_price NUMERIC;  -- null => use benchmark
```

(If the ordered-quantity allocation lives on
`material_request_line_allocations` rather than `material_request_lines`, the
column goes there instead — confirm the allocation grain during implementation.)

### 4.4 RLS

`ahs_price_book` gets an **authenticated read policy** mirroring the existing
catalog / price_history policies. Without it the app's authenticated role loads
zero rows and the budget silently reads empty — the exact failure mode that hit
`material_aliases`. Test under the authenticated role, not just service role.

### 4.5 Reused as-is

`project_material_master_lines` (planned quantity) and the allocation rows
feeding `v_material_envelope_status` are reused unchanged.

---

## 5. Budget envelope (Approach A — SQL view, prices live)

New view **`v_material_budget_status`**, one row per `(project_id, material_id)`,
mirroring `v_material_envelope_status` but in Rupiah:

```
benchmark_unit_price = ahs_price_book.unit_price            -- the authority
budget_total_rupiah  = SUM(pmml.planned_quantity) * benchmark_unit_price
committed_rupiah     = SUM(alloc.ordered_qty * COALESCE(alloc.actual_unit_price, benchmark_unit_price))
remaining_rupiah     = budget_total_rupiah - committed_rupiah
burn_pct             = committed_rupiah / NULLIF(budget_total_rupiah, 0) * 100
```

- **Deplete at order:** `committed_rupiah` sums the same non-rejected allocation
  set the quantity envelope already uses, so a PO depletes the budget the moment
  it is placed — no admin price required.
- **Actual overrides benchmark per line:** `COALESCE(actual_unit_price,
  benchmark)`.
- **Prices stay live:** correcting a price in `ahs_price_book` reflows every
  envelope. No materialized snapshot, so no re-publish double-counting (the trap
  that the v2 publish material-link work already hit — avoided here by computing
  on read).

### 5.1 Why a view, not a snapshot

Considered (B) a materialized budget column written at publish time and (C)
computing entirely in TypeScript. (B) drifts on re-publish — the known
double-counting failure. (C) duplicates the envelope logic that already lives in
SQL, creating two sources of truth. (A) keeps one source of truth and live
prices; data volume is small enough that on-read recompute is fine.

---

## 6. Gate changes (`tools/envelopes.ts` + `workflows/gates/`)

`checkMaterialTier()` dispatch:

- **Tier 1** → `checkTier1Direct` (unchanged).
- **Tier 2** → `checkTier2Envelope` (unchanged, quantity).
- **Tier 3** → **new `checkTier3Budget`**: reads `v_material_budget_status`,
  computes prospective `committed_rupiah + (thisOrderQty * effectivePrice)` vs
  `budget_total_rupiah`. effectivePrice = entered actual price, else benchmark.
- **Tier 4** → **new `checkTier4Untracked`**: returns `OK` with an
  informational note; no cap, no envelope.

Thresholds for Tier 3 reuse the existing envelope burn bands, in Rupiah:
80% = WARNING, 100% = HIGH (overage), 120% = CRITICAL.

Deleted: `checkTier3SpendCap`, `TIER3_PER_REQUEST_CAP`.

**Truth-correctness:** a Tier-3 material with no benchmark price in
`ahs_price_book` returns a **blocking WARNING** ("no budget benchmark — cannot
evaluate"), never a silent pass.

---

## 7. Material balance report (unified table, both columns)

One row per material, both quantity and Rupiah columns present, with a
**control column** marking which dimension is authoritative for the gate.

| material | tier | ctrl | qty plan/ord/recv | Rp budget/committed | burn% | flag |
|---|---|---|---|---|---|---|
| Besi D8 | 1 | QTY | 1000 / 300 / 280 kg | 9.0M / 2.7M | 30% | OK |
| Bata Merah | 2 | QTY | 5000 / 4800 / 4600 pc | 6.0M / 5.76M | 96% | ⚠ |
| Cat tembok | 3 | **RP** | — / 40 ltr | 9.0M / 6.3M | 70% | OK |
| Keramik | 3 | **RP** | — / 410 m² | 4.0M / 4.1M | 103% | ⚠ |
| Lakban | 4 | — | — | — | — | — |

- `burn%` and `flag` are driven by the **ctrl dimension**: quantity burn for
  Tier 1/2, Rupiah burn for Tier 3, none for Tier 4.
- The report query **UNIONs** `v_material_envelope_status` (qty) and
  `v_material_budget_status` (Rp), keyed by material; each material shows the
  columns it has data for.
- Implemented in the `reports.ts` material-balance builder plus the report UI
  (`BaselineScreen` / material balance view).
- Planned figures read from `coefficient`-derived `planned_quantity`, **not**
  `usage_rate` (usage_rate is left 0 by v2 publish; reading it yields planned=0).

---

## 8. Out of scope (YAGNI)

- Per-vendor preferred-price lists and effective-dated price curves. The AHS
  template is the single absolute price authority for now. (`ahs_price_book`
  carries `effective_from` so this can grow later without a schema break, but no
  resolution logic is built now.)
- Re-baselining the envelope to actual ordered prices. The budget stays anchored
  to the AHS benchmark; variance against actuals is visible (committed vs budget)
  but does not move the budget.
- `price_history` / `vendor_scorecards` continue to inform Gate 2 (price
  deviation) separately; they do **not** feed the Tier-3 budget.

---

## 9. Open items to resolve at implementation time

1. **Simplified BoQ column layout** — pending the estimator's template. Blocks
   only the new parser's column mapping, not the schema/gate/report work.
2. **Allocation grain** — confirm whether `ordered_qty` and the new
   `actual_unit_price` live on `material_request_lines` or
   `material_request_line_allocations`; the budget view must sum at the same
   grain the quantity envelope sums.
3. **Existing tier-check constraint name** on `material_catalog` — discover by
   shape before dropping.
