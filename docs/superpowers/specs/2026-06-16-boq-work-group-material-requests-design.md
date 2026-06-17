# BoQ Work-Group Material Requests — Design

*Date: 2026-06-16 · Branch: feat/boq-normalizer*

## 1. Problem

Pengawas lapangan (field supervisors) never order materials for a single BoQ row
(e.g. "Poer PC.2"). They order in **bulk for a whole work-group** — "all
foundation rebar", "first-floor column concrete", "first-floor beams + plate".
Today the Gate 1 "Item BoQ Tujuan" selector (`PermintaanScreen`, Tier 1) forces
picking one BoQ row from a flat dropdown of every item. That's the wrong unit of
work for the supervisor and makes progress control harder.

## 2. Goal

In `PermintaanScreen`, the Tier 1 target becomes a **work-group**. The gate
validates the requested material against the group's aggregate planned demand
(sum across the group's rows), and the order is allocated proportionally across
those rows.

## 3. Decisions (locked with the user)

- **Target = envelope of the group's rows.** A Tier 1 line targets a work-group;
  the gate sums the material's planned demand across every BoQ row in the group.
  Burn rolls up to the group. (Not navigation-only; not redefining Tier 2.)
- **Category source = client-side classifier.** Computed in-app from each
  `BoqItem`'s label/chapter — no DB column, no re-import.
- **Taxonomy:**
  - **Pondasi merge** — Poer + Sloof + pile cap/footplate → one `Struktur Pondasi`.
  - **Element family + floor** — `Kolom {floor}` separate from `Balok & Plat {floor}`.
  - Other archetypes by type + floor (masonry, plaster, finishes, MEP, atap…).
  - **Finish-work guard** — `Kolom`/`Balok & Plat` exclude `pasangan, bata,
    batako, praktis, plester, acian, pengecatan, keramik, granit, waterproof`
    so masonry/finish rows that mention "kolom praktis" don't get miscategorised.
  - **No floor threading** — if the source has no floor (e.g. Nusa Golf's
    element-organized type sheets), the group stays floorless. Never invent a floor.
  - **Total coverage** — every row lands in exactly one group; unmatched rows go
    to their chapter name, else `Lainnya`. Always visible, never silently dropped.
- **Selection mode = group-only (full replace).** Tier 1 always targets a group;
  per-row targeting is removed from this screen.
- **Approach A (server RPC).** A `get_workgroup_envelope` RPC mirrors
  `get_material_envelope` but filters to the group's rows. Keeps the gate
  server-authoritative and consistent with existing envelope infra.

Validated against AAL-5, Sonny Citraland, Nusa Golf, PD3, Ernawati
(1,387 rows). Preview: `assets/BOQ/WorkGroup Categorization Preview.xlsx`.

## 4. Components

| Piece | Type | Responsibility |
|---|---|---|
| `tools/boqWorkGroups.ts` | new | Pure classifier. `classifyBoqWorkGroup(item)` + `buildWorkGroups(items): WorkGroup[]`. Ported archetypes + finish guard + floor extraction. Deterministic; full partition. |
| `tools/boqWorkGroups.test.ts` | new | Jest unit tests: partition invariant, taxonomy decisions, finish-work guard, floorless behaviour, determinism. |
| migration `037_work_group_envelopes.sql` | new | `get_workgroup_envelope(project, material, boq_item_ids[])` RPC; add `WORKGROUP_ENVELOPE` to allocation_basis CHECK; add `work_group_label TEXT` to `material_request_lines`. |
| `tools/types.ts` | changed | `WorkGroup` interface; `MaterialRequestAllocationBasis` += `'WORKGROUP_ENVELOPE'`. |
| `tools/envelopes.ts` | changed | `getWorkGroupEnvelope(projectId, materialId, boqItemIds)`; reuse `get_envelope_boq_breakdown` filtered+renormalized to group rows for allocations. |
| `workflows/gates/gate1.ts` | changed | Work-group order reuses the existing Tier-2 burn-threshold branch (accepts a `materialEnvelope`). No new threshold logic. |
| `workflows/screens/PermintaanScreen.tsx` | changed | Tier 1 selector → work-group picker; recompute group envelope + allocation preview; submit writes `WORKGROUP_ENVELOPE` allocations + `work_group_label`. |

## 5. Data flow

`boqItems` → `buildWorkGroups()` → user picks **group + catalog material + qty**
→ `getWorkGroupEnvelope(material, group.itemIds)` → gate flag (Tier-2 burn path)
+ allocation preview (proportional across the group's rows that use the material)
→ submit: header (`boq_item_id` null) → `material_request_lines` (+`work_group_label`)
→ per-row `material_request_line_allocations` with basis `WORKGROUP_ENVELOPE`.

## 6. Envelope RPC (Approach A)

```sql
CREATE OR REPLACE FUNCTION get_workgroup_envelope(
  p_project_id UUID, p_material_id UUID, p_boq_item_ids UUID[]
) RETURNS TABLE (...same shape as get_material_envelope...) AS $$
  -- planned = SUM(pmml.planned_quantity) for material across the passed rows
  -- ordered = SUM(alloc.allocated_quantity) on those rows for the material,
  --           excluding REJECTED requests
  -- burn_pct = ordered / planned * 100
$$;
```

Identical math to the Tier 2 envelope, narrowed to a row subset — so the
burn/tolerance semantics already trusted carry over unchanged.

## 7. Gate

Work-group Tier 1 needs a **catalog material** (planned demand is keyed by
`material_id` in `project_material_master_lines`). With a material, the gate runs
the existing Tier-2 branch over the group envelope (OK/WARNING/HIGH/CRITICAL at
80/100/120% burn). Custom (non-catalog) material on a work-group line → soft
`INFO` "no baseline to validate against" (mirrors the Tier 2 no-envelope fallback).

## 8. UI

Tier 1 selector replaced by a work-group picker (grouped, searchable sheet
consistent with `BoqPickerSheet` styling — single-select). Shows the chosen
group, its item count, and the live group-envelope burn + per-row allocation
preview. Per-row dropdown removed.

## 8a. Workbook granularity — shipped scope (decided)

Validation surfaced two BoQ shapes:
- **Element-level** (AAL-5, Sonny): row label names the element ("Poer PC.1").
  Classifies correctly from `label` + `chapter`. **This is the shipped scope.**
- **Component-level** (Ernawati, Nusa's RAB (C)/(D)/(E) type-sheets): each row is
  a component ("- Beton", "- Besi D13") with the element only in the sub-chapter,
  which `boq_items` does not persist. ~30% of such rows fall to a generic chapter
  bucket at runtime.

**Decision:** ship element-level now; no import-pipeline change. The classifier
already accepts an optional `sub_chapter` and uses it when present (verified to
recover the component-level case), so persisting `sub_chapter` later is a drop-in
improvement requiring no classifier change. Component-level grouping is a
documented known limitation until then. See [[project-boq-workgroup-subchapter]].

## 9. Edge cases / correctness

- **Empty group / zero planned** → no envelope; soft flag, block submit with a
  clear message rather than a fake-correct number (truth-correctness contract).
- **Material not used by any row in the group** → `total_planned = 0`; warn.
- **Allocation rounding** → last row absorbs the residual (same as `buildTier2Allocations`).
- **Floorless groups** are valid targets.

## 10. Testing

- Classifier: jest unit tests (runnable in CI) — partition, taxonomy, guards,
  determinism. Re-run the workbook preview as a manual sanity artifact.
- Envelope/gate/UI: typecheck (`tsc`), plus manual verification against a real
  project once deployed (DB + RN runtime not available in unit env).
