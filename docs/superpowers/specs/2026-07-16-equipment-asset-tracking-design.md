# Equipment Asset Tracking — Scaffolding Pool (Design)

**Date:** 2026-07-16
**Status:** Approved design → implementation
**Owner decision trail:** count per part type · single central yard · loss captured
at each hand-over · dispositions must be flexible (not hardcoded) · no Rupiah
loss column · part list + opening counts provided later by the user.

---

## 1. Problem

Scaffolding (frames, jack bases, U-heads, tie rods, …) is **company property
rolled from project to project** — today tracked outside the system. The
material logic can't model it as-is: Tiers 1–3 assume *consumption* (order →
receive → install → gone; budgets deplete). Equipment is the opposite: a fixed
pool that circulates and slowly attrits (lost / broken).

Requesting scaffolding as a Tier-3 consumable "spends" budget on gear the
company already owns. Wrong model.

## 2. Approach (approved: "Hybrid — asset ledger + reuse UX")

Reuse SANO's spine — **append-only events → server-derived totals** (the same
philosophy as `derivation.ts` / receipts / progress entries) — and the existing
MTN transfer concept, but give equipment its own ledger so it never
contaminates budgets, envelopes, or Material Balance.

### 2.1 Data model

```
material_catalog.is_asset BOOLEAN NOT NULL DEFAULT false
  -- true routes the item OUT of tier/budget/envelope/consumption logic.
  -- Seeded true for FMW-SCAF, FMW-JACK, FMW-TIE01 (more parts later, as data).

equipment_dispositions           -- VOCABULARY IS DATA, NOT CODE (user req B)
  id, name (unique, e.g. 'Hilang', 'Rusak — bisa perbaikan'),
  ledger_effect CHECK IN ('RETURN_OK','RETURN_HOLD','WRITE_OFF'),
  active, sort_order
  -- Admins add rows anytime ("tertinggal di site", "karat berat", …).
  -- Only the 3 ledger effects are fixed, so derived math stays deterministic.

equipment_ledger                 -- append-only source of truth
  id, material_id → material_catalog (is_asset),
  event_type CHECK IN ('OPENING','DEPLOY','TRANSFER','RETURN','WRITE_OFF','REPAIRED'),
  from_project_id NULL = yard,   to_project_id NULL = yard,
  qty > 0,
  disposition_id → equipment_dispositions (required for RETURN/WRITE_OFF),
  yard_bucket CHECK IN ('READY','REPAIR')  -- only for WRITE_OFF from yard,
  reconciliation_group UUID,     -- ties the lines of one count-&-close together
  note, photo_path, moved_by → profiles, created_at
```

### 2.2 Event semantics (single yard = NULL project)

| event | from → to | effect |
|---|---|---|
| `OPENING` | yard → yard | seeds owned + yard-ready (one-time count; admin) |
| `DEPLOY` | yard → project | yard-ready ↓, deployed(project) ↑ |
| `TRANSFER` | project → project | deployed moves (this is the MTN concept) |
| `RETURN` + disposition `RETURN_OK` | project → yard | deployed ↓, yard-ready ↑ |
| `RETURN` + disposition `RETURN_HOLD` | project → yard | deployed ↓, yard-REPAIR ↑ (not deployable) |
| `WRITE_OFF` + disposition `WRITE_OFF` | project or yard → ∅ | leaves owned pool; from yard requires `yard_bucket` |
| `REPAIRED` | yard → yard | yard-REPAIR ↓, yard-ready ↑ |

Derived per part (never stored, always recomputable):
`owned = Σopening − Σwritten_off` · `yard_ready` · `yard_repair` ·
`deployed[project]` · `written_off[disposition]`.

### 2.3 Request flow

A project requests equipment as a **deployment**, not a purchase:

1. Request "40 jack bases" → gate = **availability** (yard_ready ≥ 40), not budget.
2. Approve → `DEPLOY` event; site counts them in.
3. Roll onward to the next project → `TRANSFER` (MTN semantics).
4. Hand-over / project close → **count & close**: SANO shows *expected*
   on-hand; supervisor allocates the full quantity across **disposition lines**
   (qty + disposition + note + photo). Rule: lines must sum to expected —
   everything accounted for, nothing silently disappears. Counted-OK quantity
   `RETURN`s; the rest becomes `RETURN_HOLD` / `WRITE_OFF` per line.

### 2.4 Guard rails (dual-layer, like the tier gates)

- **Client:** `evaluateEquipmentAvailability` (pure fn) flags shortages before
  submit; reconciliation UI enforces sum-to-expected.
- **DB trigger (server twin):** BEFORE INSERT on `equipment_ledger` recomputes
  the from-location balance and rejects overdraw (deploy more than yard-ready,
  return/transfer/write-off more than deployed, repair more than in-repair).
  Races and buggy clients cannot corrupt the pool.

### 2.5 Reporting

**Equipment Balance** (company-wide, quantities only — no Rupiah column):
per part → Owned · Yard ready · In repair · Deployed per project · Written off
by disposition. Lives on the Equipment screen (PDF/Excel export = follow-up).

### 2.6 Separation from consumables

- `is_asset` materials are **excluded** from the consumable request picker and
  from Material Balance (they'd otherwise double-report via published BoQ
  perancah lines).
- Existing tier gates / triggers / envelopes untouched — equipment never enters
  `material_request_lines`.

## 3. Out of scope / follow-ups

- Real part-type list + `OPENING` counts (user provides later; enters as data).
- PDF/Excel Equipment Balance export.
- Rupiah replacement-cost on losses (explicitly declined for v1).
- Per-set or serial-number tracking (design supports adding later).

## 4. Files

- `supabase/migrations/083_equipment_asset_tracking.sql` — idempotent (pasted
  into Dashboard per project convention) + applied to live DB.
- `tools/equipment.ts` + `tools/__tests__/equipment.test.ts` — pure derived
  math, availability, reconciliation validation, movement writers.
- `workflows/screens/EquipmentScreen.tsx` + navigation entry.
- Small touches: Permintaan picker filter, Material Balance exclusion.
