# Permintaan Redesign: BoQ-First Flow + Mode Besi (Bulk Rebar)

**Date:** 2026-08-05
**Status:** Approved design, pre-implementation
**Owner screens:** `workflows/screens/PermintaanScreen.tsx` (field app)

## Problem

1. The implemented Permintaan flow is **material-first**: each line starts from a catalog material, and only then (Tier 1) picks a "Grup Pekerjaan Tujuan". The original product intent (`SAN_DEVELOPER_BRIEF.md` §15.4, `docs/PANDUAN_SANO.md`) was **BoQ-first**: pick the work, see the materials that work needs, fill quantities. Supervisors currently hunt the catalog per line with no view of what the chosen work actually still needs.
2. **Bulk rebar ordering is painful.** Rebar (besi beton) is ordered in bulk per diameter, often across several structural work groups. Today that means one line per material per group, entered one by one. The per-diameter bulk shape already exists as an Excel import format (`SANO Input Tier 1`, columns Besi ø8–ø22) but has no in-app input UI.

Both fixes must **preserve the existing control model**: soft request-time gates (WARNING-capped, overage reason required above 100% burn — `docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md`), hard quantity gate at PO creation (`071_po_quantity_gate.sql`), allocation ledger in `material_request_line_allocations`.

## Core architectural decision

Both new flows are **input-UX layers that expand into the existing header + lines + allocations model** before submit. `submit_material_request` (RPC 073), the gate functions (069/073), server triggers (033), RLS, ApprovalsScreen, and Gate-2 PO linking are untouched. The Mode Besi matrix expands client-side to **one request line per (diameter × work group)** with standard `WORKGROUP_ENVELOPE` allocations. The only backend addition is one read-only RPC (§6).

`request_basis` stays `'MATERIAL'` for all paths (header-level `boq_item_id` stays NULL); group identity continues to travel per line via `work_group_label` + allocations, as today.

## 1. Entry point

`PermintaanScreen` gains a `mode` state: `'landing' | 'pekerjaan' | 'besi' | 'umum'`. Landing shows three tiles:

1. **Permintaan Pekerjaan (BoQ)** → group-first flow (§2). Primary path for Tier-1 materials.
2. **Pesan Besi Beton** → rebar matrix (§3).
3. **Material Umum / Lainnya** → the existing material-first multi-line form, unchanged (§4).

Back navigation returns to landing; if the active mode has unsubmitted input, show a confirm-discard prompt before leaving it.

## 2. Path 1 — Permintaan Pekerjaan (group-first)

**Step 1 — pick grup pekerjaan.** `SelectSheet` (house pattern; this retires the raw `@react-native-picker/picker` flagged in the 2026-07-07 flow audit) listing `buildWorkGroups(boqItems)` output: label + `itemCount`, meta = group progress %.

**Step 2 — fill the group's demand list.** One call to the new RPC (§6) with the group's `boq_item_id`s returns per-material planned/ordered/requested. Join client-side against the already-loaded `material_catalog` for names/units/tier/conversion factors. Render:

- **Primary list: Tier-1 materials** with `planned > 0` in this group. Row: material name, *sisa* = `max(0, planned − ordered − requested)` displayed in supplier units where a conversion factor exists ("214 batang (≈ 2.675 kg)", via `displayQty`), inline numeric quantity input (supplier units, same semantics as today's Jumlah field). Filling a quantity materializes a standard `RequestLine` (tier from catalog, `workGroupKey` = chosen group); existing gate computation, allocation preview (`buildWorkGroupAllocations`), `FlagPanel`, and overage-reason capture apply per line unchanged.
- **Collapsed section "Material terkait (Tier 2+)":** the group's non-Tier-1 materials from the same RPC result. Fillable; lines keep their normal tier semantics (Tier 2 = project-wide envelope `TIER2_ENVELOPE`, Tier 3/4 = `GENERAL_STOCK`) and are labeled "dipantau level proyek" so the group context doesn't imply a group-scoped deduction that isn't happening.
- **"Tambah material lain":** opens the existing catalog picker (full catalog). A picked Tier-1 material gets `workGroupKey` preset to the chosen group; the existing no-baseline INFO flag ("Tidak ada alokasi pembanding") appears naturally if the group has no planned demand for it.
- **Manual/custom entry:** existing `isCustom` path with `MaterialNamingAssist`, unchanged (defaults Tier 3; if the user switches the chip to Tier 1, `workGroupKey` presets to the chosen group).

**Footer:** shared Detail Permintaan card (target date, urgency, note) and submit via `submit_material_request`, exactly as today.

## 3. Path 2 — Mode Besi (rebar matrix)

Rebar identification: `material_catalog.code LIKE 'REB-%'` (the established convention; factors per `052_rebar_batang_unit.sql` / `tools/rebarBatang.ts`).

**Step 1 — scope.** Checkbox list of work groups that have rebar demand (any REB-% material with `planned > 0`), **all selected by default**. Group rows show total rebar sisa in batang as meta. Data source: the §6 RPC called once per work group (parallelized; groups are typically < 20).

**Step 2 — matrix.** One row per rebar material with planned demand anywhere in scope, sorted ulir-then-polos, diameter ascending. Row: name, aggregate *sisa* across selected groups in whole batang (+ kg equivalent), and an **integer batang input**. Materials in the catalog but with zero planned demand in scope sit collapsed under "Diameter lain" and show "tanpa baseline" when filled (never fabricated numbers — truth-correctness contract from `CLAUDE.md` §1.1).

**Step 3 — review split.** Per filled diameter, an editable per-group breakdown in whole batang:

- Default split ∝ each selected group's **remaining** demand for that diameter; if remaining is 0 everywhere, fall back to ∝ **planned**; if planned is also 0 everywhere (no-baseline diameter), the split is manual (inputs start empty, user assigns).
- Integer rounding by **largest-remainder** so group amounts sum exactly to the entered total.
- Editing a group's amount recomputes nothing silently — the total shown updates and the user owns the numbers. A group edited to 0 drops that line.
- Standard soft-gate results render per (diameter × group) line; any line projected over 100% requires an overage reason — the UI offers **one reason picker per diameter** applied to that diameter's over lines (stored per line, as the schema requires).

**Submit.** Expansion: each (diameter, group, qty > 0) → a `RequestLine` `{materialId, tier: 1, workGroupKey, quantity (batang)}`. From there the standard pipeline runs: `supplierToBase` conversion at payload build, `buildWorkGroupAllocations` per line, one header + N lines + allocations in one `submit_material_request` call. Header fields (target date, urgency, note) shared, as today.

## 4. Path 3 — Material Umum (existing form)

Today's multi-line form, functionally unchanged. One addition: selecting a **Tier-1 catalog material** here shows a non-blocking inline banner suggesting Path 1 ("Material presisi lebih mudah lewat Permintaan Pekerjaan"). Still submittable — no stranding if work-group classification misfires for some project.

## 5. What deliberately does NOT change

- Request-time gates stay soft/WARNING-capped; PO-time gate stays the hard block.
- `submit_material_request`, `compute_tier*_flag`, triggers 033, RLS, ApprovalsScreen, Gate2Screen, TerimaScreen.
- Work groups stay client-derived (`tools/boqWorkGroups.ts`), persisted per line only as `work_group_label` + allocations.
- kg-internal / batang-display convention (`tools/materialUnitConversion.ts`), round-up-to-whole-batang ordering.

## 6. Backend: one new read-only RPC

```sql
get_workgroup_material_envelopes(p_project_id uuid, p_boq_item_ids uuid[])
  RETURNS TABLE (material_id uuid, planned numeric, ordered numeric, requested numeric)
```

- New migration; `SECURITY INVOKER` (RLS-composed), read-only.
- Semantics are `get_workgroup_envelope` (039→041→054→068 lineage) generalized to *all* materials for the given item set in one call: planned from the **latest** `project_material_master` header only (the latest-master rule — 038/054 double-count bug class), ordered = SANO PO quantities, requested = other open (non-rejected, non-PO-linked) request allocations, per the same burn definitions as the single-material RPC.
- **Consistency check is part of done:** for a sample project, per-material rows from this RPC must equal `get_workgroup_envelope` called per material. Documented as a verification query in the migration comment (repo convention for DB verification).

## 7. Error handling & edge cases

- **No published baseline / group with no demand:** Path 1 Step 2 shows an empty state explaining why, with a jump to "Tambah material lain" / Material Umum. Never a dead end.
- **Simplified "SANO Input" projects** (BoQ codes `T1-…`): `buildWorkGroups` already maps each row 1:1 to its own group; both new paths work unchanged on top of that.
- **Stale caches after submit:** same `refresh()` + cache invalidation pattern as today; Mode Besi re-fetches scope envelopes on re-entry.
- **Offline/failed RPC:** same error surface as existing envelope fetches (non-blocking INFO, retry on reopen); submit remains transactional server-side.
- **Rebar catalog drift:** `tools/rebarBatang.ts` defines REB-PL10/REB-PL12 absent from the catalog CSV — reconcile in a small pre-implementation commit so the matrix's diameter list comes solely from `material_catalog`.

## 8. Testing

- **New pure modules with Jest tests** (repo convention — logic out of screens, like `tools/submitMaterialRequest.ts`):
  - `tools/workGroupDemand.ts` — RPC-result → demand rows (tier partition, sisa math, supplier-unit display).
  - `tools/rebarMatrix.ts` — scope filtering, default split (remaining → planned → manual fallback), largest-remainder integer rounding (sums exactly), matrix→`RequestLine[]` expansion.
- Screen changes stay thin over these helpers.
- RPC verified against `get_workgroup_envelope` per §6.
- Existing `submitMaterialRequest`/gate tests must pass untouched — regression guard that the write path didn't change.

## 9. Out of scope (follow-ups)

- Supervisor-facing request history/status screen (real gap — no field-app view of PENDING/APPROVED today).
- Auto-creating POs from approved requests (Gate 1→2 pipeline disconnect noted in the 2026-07-07 audit).
- Persisting work groups as DB entities.
- Office/web parity for the new flows.
