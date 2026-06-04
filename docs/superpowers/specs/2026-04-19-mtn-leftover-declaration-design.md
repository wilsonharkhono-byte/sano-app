# MTN Leftover Declaration — Design Spec

**Date:** 2026-04-19
**Problem owner:** Site supervisors + estimator team
**Related code:** [tools/derivation.ts](../../../tools/derivation.ts), [workflows/screens/LaporanScreen.tsx](../../../workflows/screens/LaporanScreen.tsx), [office/screens/ApprovalsScreen.tsx](../../../office/screens/ApprovalsScreen.tsx), [supabase/migrations/001_core_tables.sql](../../../supabase/migrations/001_core_tables.sql)

---

## Problem

The material on-site balance is computed as:

```
installed_formula = Σ(progress_entries.quantity) × ahs_lines.usage_rate × (1 + waste_factor)
on_site = received − installed_formula
```

When the estimator over-specifies `usage_rate` (generous to cover contingency) and site work reaches 100 %, `installed_formula` matches or exceeds `received`. `on_site` drops to zero, and supervisors can no longer create MTNs — even though real material is sitting on site unused.

This is the **over-spec leakage** problem. The formula assumes the AHS spec is exact. In practice, it is a planning estimate with headroom.

## Goals

1. Unblock MTNs when there is real surplus on site, regardless of progress %.
2. Correct the material ledger to reflect declared surplus, so downstream reports are accurate.
3. Capture the data needed for future estimator-variance analysis (how often and by how much AHS over-specs each material).
4. Keep the change small — no rebuild of AHS, no new continuous-tracking workflow.

## Non-goals

- Continuous material consumption tracking by site workers.
- Automatic AHS variance feedback loop.
- Estimator-facing variance report (separate spec).
- Cut-rebar tracking as a data type (treated as free-text note).

## Design

### Core idea

When a supervisor creates an MTN, they **declare the total surplus on site** alongside the **transfer quantity**. The declaration corrects the material ledger at **read time** — `derivation.ts` subtracts declared leftover from `installed_formula`. The DB is never mutated to fight the `sync_boq_progress` recompute.

### Data model

Migration `031_mtn_leftover_declaration.sql`:

```sql
ALTER TABLE mtn_requests
  ADD COLUMN leftover_total_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN leftover_reason text NULL;

ALTER TABLE mtn_requests
  ADD CONSTRAINT mtn_quantity_not_exceeds_leftover
    CHECK (quantity <= leftover_total_qty OR leftover_total_qty = 0);
```

Field semantics:
- `leftover_total_qty` (new) — total surplus on site the supervisor declares. Includes what stays on site. Drives the ledger correction.
- `quantity` (existing) — what this MTN transfers to another project. Must be ≤ `leftover_total_qty`.
- `leftover_reason` (new) — free text. Optional. Estimator reviews it during approval. Covers cut-rebar case ("sisa potongan D13, masih bisa dipakai").

**Backward compatibility:** existing MTNs get `leftover_total_qty = 0`. They continue to behave exactly as before — no ledger correction. The CHECK constraint allows `leftover_total_qty = 0` to admit historical rows. New MTNs from the new UI will always have a positive declaration.

### Balance formula change

[tools/derivation.ts:228-305](../../../tools/derivation.ts#L228-L305).

Before:
```typescript
const installed = boqInstalled * usage_rate * (1 + waste_factor);
const on_site = received - installed;
```

After (per material):
```typescript
const declaredLeftover = leftoverByMaterialId.get(material_id) ?? 0;
const effectiveInstalled = Math.max(0, installed - declaredLeftover);
const on_site = received - effectiveInstalled;
```

`leftoverByMaterialId` is built once per `deriveMaterialBalance` call via:

```sql
SELECT material_id, SUM(leftover_total_qty) AS total
FROM mtn_requests
WHERE project_id = :projectId
  AND status IN ('AWAITING', 'APPROVED', 'RECEIVED')
GROUP BY material_id
```

The no-AHS fallback path at [derivation.ts:259-262](../../../tools/derivation.ts#L259-L262) receives the same subtraction. Otherwise projects without a published AHS would skip the correction silently.

### MTN lifecycle

| Status     | Counts toward leftover correction? |
|------------|------------------------------------|
| AWAITING   | Yes — blocks a second MTN from double-claiming the same surplus |
| APPROVED   | Yes |
| RECEIVED   | Yes (source ledger stays corrected after transfer completes) |
| REJECTED   | No — subtraction naturally reverses |

Destination project is unaffected: it receives the `quantity` via the existing receipts flow when the MTN reaches `RECEIVED`. Only the source project's ledger sees the leftover correction.

### UI changes

**[LaporanScreen.tsx](../../../workflows/screens/LaporanScreen.tsx) — MTN form**

Two new inputs above the existing destination picker:

```
Kondisi di site: diperkirakan 0 sak       ← informational, shows current computed on_site

Total sisa material di site: [____] sak    ← leftover_total_qty (new input)
Yang ditransfer ke proyek lain: [____] sak ← quantity (existing input)

Alasan / catatan:                          ← leftover_reason (new, optional)
[____________________________________]
```

Validations (client-side; CHECK constraint is the DB-side backup):
- `leftover_total_qty > 0`
- `quantity > 0`
- `quantity ≤ leftover_total_qty`

Hint under the leftover field: _"Termasuk yang tetap di site, bukan hanya yang dikirim."_

Reason submit behavior: if blank, show a soft prompt — _"Beri catatan untuk estimator? (bisa dilewati)"_ — then allow submit.

**[ApprovalsScreen.tsx](../../../office/screens/ApprovalsScreen.tsx) — MTN approval card**

Two new lines above the Approve/Reject buttons:

```
Total sisa dideklarasi: 20 sak
Yang akan dikirim: 15 sak
Catatan lapangan: "Estimator over-spec, masih banyak di site"

Dampak ke ledger sumber:
  on_site saat ini:    0 sak
  setelah koreksi:    20 sak
```

The "setelah koreksi" line previews `effectiveInstalled` reduction so the estimator knows what changes downstream.

**[TerimaScreen.tsx](../../../workflows/screens/TerimaScreen.tsx)**

No change. `leftover_total_qty` is a source-side concept only.

## Out of scope

- **Estimator variance report.** The data is captured from day one; the view gets its own spec.
- **Continuous material consumption tracking.** Remains absent.
- **AHS usage_rate feedback loop.** Remains absent.
- **Cut-rebar as a structured data type.** Use the `leftover_reason` text field.

## Testing

### Unit tests
- [tools/derivation.ts](../../../tools/derivation.ts): new test cases in `derivation.test.ts`:
  - Single material with active MTN declaring leftover → `on_site` reflects correction.
  - Material with MTN in `REJECTED` status → correction NOT applied.
  - Supervisor over-declares (leftover > formula installed) → `effectiveInstalled` floors at 0, `on_site` does not exceed `received`.
  - No-AHS fallback path: leftover correction applied via `tier1_material`/`tier2_material`.

### Integration tests
- Supabase migration 031 applies cleanly; existing rows back-fill with `leftover_total_qty = 0`.
- CHECK constraint rejects `quantity > leftover_total_qty` on insert.
- Two MTNs in `AWAITING` for same material — second MTN's `on_site` preview reflects the first's correction (no double-claim).
- MTN transitions `AWAITING → REJECTED` — `on_site` for source project returns to pre-declaration value.

### Manual smoke test
1. Project A: BoQ item III.A.2 (semen), progress 100 %, computed `on_site = 0 sak`.
2. Supervisor creates MTN: leftover 20 sak, transfer 15 sak, destination Project B, reason "estimator over-spec".
3. Refresh LaporanScreen — `on_site` now shows 20 sak.
4. Estimator opens ApprovalsScreen, sees the declared 20 / transfer 15 / reason, clicks Approve.
5. MTN reaches `RECEIVED` at Project B; receipts flow creates +15 sak there.
6. Project A `on_site` stays at 20 (correction persists).
7. Supervisor creates a second MTN for same material, leftover 10, transfer 5 — allowed; ledger now shows `on_site = 20 + 10 = 30` pre-correction effective.

## Decisions log

- **Two fields over one:** supervisor declares total surplus separately from transfer amount. Captures the kept-on-site portion in the ledger, important for estimator variance study.
- **Read-time subtraction, no DB mutation of `installed`:** avoids fighting the `sync_boq_progress` recompute; the formula stays the source of truth for `boq_items.installed`, and derivation adjusts on read.
- **AWAITING counts:** prevents double-declaration between submit and approval; naturally reverses on `REJECTED`.
- **Reason optional:** soft prompt instead of hard requirement to avoid friction. Required-by-policy can be added later if abuse appears.
- **No rebar cut-pieces schema:** handled as free text in `leftover_reason`. Revisit only if operationally necessary.
