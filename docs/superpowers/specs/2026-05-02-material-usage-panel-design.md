# Material Usage Panel — Design Spec

**Date:** 2026-05-02
**Status:** Design approved, pending implementation plan
**Touches:** `office/screens/ApprovalsScreen.tsx`, new `MaterialUsagePanel` component

## Problem

Estimator (and admin/principal) reviewing Permintaan and MTN cards in the Approvals screen has no visibility into the **remaining material capacity** before approving. They can only see:

- Material name + requested quantity + destination project
- Pengaju + reason + date

To decide whether to approve, they need to know: *"Setelah saya approve ini, berapa sisa material yang masih bisa dipakai?"* Today this requires manually opening another screen, querying the envelope, and mental math. The result is either:

- Approving blindly (often), with downstream surprise when an envelope blows out
- Pinging supervisor for context ("apakah masih ada budget?"), creating coordination overhead

The data already exists in `v_material_envelope_status` for Tier 2 and in `boq_items.planned/installed` for Tier 1, but it's not surfaced where the decision happens.

## Goals

- Surface usage/remaining material data **inline on every Permintaan and MTN card** in `ApprovalsScreen`, visible to estimator + admin + principal roles.
- Different displays per material tier:
  - **Tier 1** (Precise — concrete, rebar): show BoQ-bound quantity remaining
  - **Tier 2** (Bulk — bata, semen, pasir): show envelope quantity AND Rupiah equivalent
  - **Tier 3** (Consumables — paku, oli): show spend cap status
- Always-visible (no expand-to-see), so the data is in the estimator's eyeline at decision time.
- Conservative when data is missing: warn but don't block; estimator can still approve based on judgment.

## Non-goals

- No changes to MTN/Permintaan approval flow itself (TOLAK/SETUJUI buttons + reasons stay as-is).
- No new database tables. Reuses `v_material_envelope_status` (already in migration 004), `boq_items`, `material_catalog`.
- No real-time updates — refresh-driven, single round trip per screen open.
- No advanced analytics (burn rate trends, forecasted depletion, etc.). Single-snapshot view.
- No mobile-specific layout optimization beyond the existing responsive Approval card layout (the screen is already responsive).

## Core principle

**Data where the decision is made.** A Permintaan card is the moment of approval; the usage data lives one screen away today. Bringing it onto the card removes friction and bad approvals.

---

## Section 1 — Scope & Phasing

### Phase 1 — Permintaan tab (priority)

The "Permintaan" tab in `office/screens/ApprovalsScreen.tsx` shows `MaterialRequest` records. Each request has 1+ `material_request_lines`, each with:
- `material_id` (FK to `material_catalog`) ✓ already linked
- `tier: 1 | 2 | 3` ✓
- `quantity`, `unit` ✓
- `material_request_line_allocations[]` with `boq_item_id` for Tier 1 ✓

All required data is in scope without DB changes. Phase 1 is the high-value implementation.

### Phase 2 — MTN tab

The "MTN" tab shows `MTNRequest` records that today have `material_name` (free text) but **no `material_id` FK**. To show envelope data on MTN cards we need a migration:

```sql
ALTER TABLE mtns ADD COLUMN material_id UUID REFERENCES material_catalog(id);
```

Plus a backfill pass (using existing `tools/boqParserV2/aiAssist/matchMaterialName.ts` fuzzy matcher) that links existing MTN rows to catalog entries by name similarity. Phase 2 reuses the same `MaterialUsagePanel` once the FK is in place.

### Phase 3 (out of scope MVP)

- Burn-rate analytics, forecasted depletion timelines, historical ordering trends.
- Tier 3 spend cap detail/breakdown.
- Tap-to-drill-down into BoQ-by-BoQ envelope allocation breakdown.

---

## Section 2 — UI per Tier

The component renders one of four states based on the line's tier and link status.

### Tier 1 (BoQ-bound)

```
┌─────────────────────────────────────────────────────┐
│ Beton K-225 — 2.5 m³                  Tier 1 [chip] │
│                                                     │
│ BoQ III.A.1 — Sloof S24-1                           │
│ Volume rencana:   10.2 m³                           │
│ Sudah dipasang:    3.2 m³                           │
│ Sisa BoQ:          7.0 m³                           │
│ Setelah request:   4.5 m³ tersisa                   │
└─────────────────────────────────────────────────────┘
```

If `requested > remaining`: red highlight on "Setelah request" row with warning text *"⚠ Akan melampaui BoQ rencana"*.

### Tier 2 (Bulk envelope)

```
┌─────────────────────────────────────────────────────┐
│ Bata ringan 7.5 cm — 200 pcs          Tier 2 [chip] │
│                                                     │
│ Envelope kuantitas:                                 │
│   Terpakai: 200 / 5,000 pcs (4%)                    │
│   Sisa: 4,800 pcs                                   │
│                                                     │
│ Anggaran:                                           │
│   Terpakai: Rp 1.2 jt / Rp 30 jt                    │
│   Sisa: Rp 28.8 jt                                  │
│                                                     │
│ Melayani 8 item BoQ                                 │
└─────────────────────────────────────────────────────┘
```

Burn% color rules:
- < 50% → neutral text
- 50–80% → orange highlight
- 80–100% → red highlight
- > 100% → red highlight + warning *"⚠ Envelope sudah terlampaui"*

### Tier 3 (Consumables, spend cap)

```
┌─────────────────────────────────────────────────────┐
│ Paku 7 cm — 5 kg                      Tier 3 [chip] │
│                                                     │
│ Estimasi biaya: Rp 75rb                             │
│ Spend cap per request: Rp 5 jt (1.5% terpakai)      │
└─────────────────────────────────────────────────────┘
```

Tier 3 cap is per-request, not cumulative — simple multiplication × catalog reference price.

### Material tidak ter-link / Envelope kosong

```
┌─────────────────────────────────────────────────────┐
│ Material X (custom) — 50 unit                       │
│                                                     │
│ ⚠ Material tidak terdaftar di katalog.              │
│ Tambahkan di Material Catalog untuk tracking        │
│ envelope.                                           │
└─────────────────────────────────────────────────────┘
```

---

## Section 3 — Architecture

### New component

`office/screens/components/MaterialUsagePanel.tsx` — reusable, self-contained, ~250 LOC.

```typescript
interface MaterialUsagePanelProps {
  materialId: string | null;          // null when not linked
  customMaterialName?: string | null; // shown when materialId is null
  tier: 1 | 2 | 3 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;          // present for Tier 1
  // Optional: pre-fetched envelope data (avoids per-component fetch)
  envelope?: MaterialEnvelopeStatus | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
}
```

The component:
1. Renders one of the four states based on `tier` and link status.
2. If `envelope` / `boqItem` not pre-fetched, falls back to internal fetch via the supabase client. (Pre-fetched is preferred for batch performance.)
3. Stateless from a domain perspective — no mutations, no side effects beyond initial fetch.

### Batch fetcher

`tools/envelopes.ts` gets a new helper:

```typescript
export async function getEnvelopesByMaterialIds(
  projectId: string,
  materialIds: string[],
): Promise<Map<string, MaterialEnvelopeStatus>>;
```

Single round trip, returns a Map keyed by `material_id` for O(1) lookup at render.

### ApprovalsScreen integration

In `ApprovalsScreen.tsx`, after the existing data load:

1. Collect all unique `material_id`s from rendered `material_request_lines` (and Phase 2: from MTN rows).
2. Call `getEnvelopesByMaterialIds(projectId, ids)` once.
3. For Tier 1 lines: also batch-fetch the BoQ items in one query.
4. Pass pre-fetched data to each `MaterialUsagePanel` instance.

Result: 2 extra queries per screen open (envelopes + BoQ items), regardless of how many cards.

### Rupiah calculation

Rupiah is computed at render time:
```
envelope_total_rupiah  = total_planned_quantity × material_catalog.reference_price
envelope_used_rupiah   = total_ordered × material_catalog.reference_price
envelope_remaining_rp  = envelope_total_rupiah - envelope_used_rupiah
```

`reference_price` already lives on `material_catalog`. The `v_material_envelope_status` view doesn't expose it. **MVP approach: no view migration — `getEnvelopesByMaterialIds` fetches both `v_material_envelope_status` AND `material_catalog.reference_price` in a single round trip via PostgREST embedding (`select=*,material_catalog(reference_price)`).** Client-side merge is trivial. A view extension can be added later as polish if profiling shows the embedded fetch is slow.

### Data flow

```
ApprovalsScreen mounts
  ├─ Existing: fetch MTNs + MaterialRequests (with lines + allocations)
  ├─ NEW: collect unique material_ids from lines
  ├─ NEW: batch-fetch envelopes for those ids → Map<material_id, envelope>
  ├─ NEW: batch-fetch BoQ items referenced by Tier 1 allocations → Map<boq_id, boq>
  └─ Render cards
       └─ Each line → <MaterialUsagePanel envelope={...} boqItem={...} />
            ├─ Tier 1: read boqItem.planned/installed, compute remaining
            ├─ Tier 2: read envelope.total_planned/total_ordered, compute Rp via reference_price
            └─ Tier 3: requestedQty × reference_price vs cap
```

---

## Section 4 — Edge Cases

| Case | Handling |
|---|---|
| `material_id = null` (custom_material_name only) | Render warning state with "ke Material Catalog" CTA. Do not block approval. |
| `tier = null` or invalid | Treat as no-tier state, render warning *"Material tier tidak terdefinisi"*. |
| Envelope row missing for material_id | Render *"Envelope belum ada di baseline. Material ini belum dipakai di AHS manapun."* — usually means baseline not published or material not in any AHS recipe yet. |
| `reference_price = null` di catalog (Tier 2) | Render quantity envelope only; replace Rupiah block with note *"Anggaran tidak tersedia (harga acuan kosong di katalog)"*. |
| BoQ item soft-deleted (Tier 1, allocation orphan) | Defensive fallback: render envelope-style display only (treat like Tier 2). Log warning to telemetry but don't break the card. |
| Request causes envelope >100% | Highlight red, warning text *"⚠ Akan melampaui envelope (XX%)"*. Mirroring Gate 1's existing logic at `workflows/gates/gate1.ts`. |
| Multiple lines reference same material | Each line shows its own panel (independent context). The envelope `total_ordered` already aggregates across all approved orders project-wide, so no double-counting at the data layer. |
| Pre-existing approved orders from other users | `total_ordered` aggregates from the view's LATERAL join on `material_request_lines` for non-REJECTED requests — view stays accurate regardless of who approved. |
| Loading state | Skeleton placeholder (~80px high gray block) per panel slot, matching final panel layout. |
| Network/RPC error fetching envelopes | Show *"Gagal memuat data envelope — refresh halaman"* per affected line, but keep TOLAK/SETUJUI buttons functional (don't block decisions on data fetch). |
| Estimator approves while envelope at 95% | No special blocking. The panel shows the warning; the human decides. (Existing Gate 1 logic enforces hard limits if any; the panel is informational.) |
| Tier 3 with `reference_price = null` | Hide the spend-cap calculation, show *"Estimasi biaya tidak tersedia"*. |

---

## Section 5 — Testing

### Unit tests — `MaterialUsagePanel.test.tsx` (~150 LOC)

- **Tier 1 happy path**: renders BoQ planned/installed/remaining math correctly given `boqItem` prop.
- **Tier 1 warning state**: when `requested > remaining`, red highlight present.
- **Tier 2 happy path**: envelope quantity and Rupiah both rendered, format correct (juta/ribu).
- **Tier 2 burn % thresholds**: < 50% neutral; 50-80% orange; > 80% red; > 100% extra warning.
- **Tier 2 reference_price null**: Rupiah block hidden, fallback text shown.
- **Tier 3 happy path**: cap math correct.
- **Material not linked**: warning state, link to catalog CTA.
- **Envelope missing**: empty state message.

### Integration tests — `ApprovalsScreen.integration.test.tsx` (~120 LOC)

- Permintaan with 3 lines (Tier 1 + Tier 2 + Tier 3) → all 3 panels render with correct content.
- Batch envelope fetch: only 1 RPC call to `getEnvelopesByMaterialIds` regardless of card count.
- Approve flow: clicking SETUJUI works as before; panel doesn't break the action.
- Multiple cards with shared material_id: panels render independently, data consistent.
- Network error simulation: panels degrade gracefully, approve buttons stay functional.

### Manual QA (Vercel preview)

- Login estimator → Approvals → Permintaan tab → see card with mixed tiers
- Verify Tier 1 BoQ remaining math against direct DB query
- Verify Tier 2 burn % against direct query: `SELECT total_ordered, total_planned FROM v_material_envelope_status WHERE material_id = X`
- Approve a Permintaan → refresh → verify envelope `total_ordered` increased by request amount
- Test with workbook that has 0 published baselines → empty state shown gracefully

---

## Section 6 — File Layout & Effort

```
office/screens/
  ApprovalsScreen.tsx                    ← modified (envelope + BoQ batch fetch + render)
  components/
    MaterialUsagePanel.tsx               ← NEW (~250 LOC)
    __tests__/
      MaterialUsagePanel.test.tsx        ← NEW (~150 LOC)
      ApprovalsScreen.integration.test.tsx ← NEW (~120 LOC)

tools/
  envelopes.ts                           ← modified (add getEnvelopesByMaterialIds)
```

No DB migration in MVP — `reference_price` joined via PostgREST embedding in the batch fetcher.

### Effort estimate

| Task | Effort |
|---|---|
| `MaterialUsagePanel` component + 4 state variants | 1 day |
| Batch envelope fetch helper (with embedded reference_price) | 0.5 day |
| ApprovalsScreen integration | 0.5 day |
| Unit + integration tests | 0.5 day |
| Manual QA + visual iteration on Vercel preview | 0.5 day |
| **Phase 1 total** | **~3 days** |

Phase 2 (MTN material_id migration + backfill): ~1 day, separate spec/plan if needed.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| `reference_price` stale or wrong → misleading Rupiah figures | Show note *"Berdasarkan harga acuan katalog"* below Rupiah; estimator knows it's an estimate, not actual spend |
| Batch envelope fetch slow on large projects | Pre-fetched once at screen open, cached in component state; subsequent renders are O(1). View has indexes on project_id + material_id from migration 004. |
| Card height blows up on cards with many lines (multi-line Permintaan) | Each panel is ~80-120px; 5+ lines = visible scrolling but acceptable. Future iteration could add collapse for very dense cards. |
| Estimators ignore warnings and approve anyway | Out of scope. The panel is informational — gate enforcement is a separate Gate 1 concern. |
| PostgREST embedding adds latency vs. flat view | Single round trip; PostgreSQL planner handles the join efficiently. If profiling shows >100ms overhead, a view migration is the polish step. |

---

## Open questions

None blocking. Phase 2 (MTN) is separately scoped; Phase 3 features (analytics, drill-down) are out of MVP.
