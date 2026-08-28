# Two-Signal Material Over-Allocation Control — Design Spec

*Date: 2026-07-10. Status: approved in brainstorm (user confirmed two-signal model + option 2 principal gate). Companion to `docs/superpowers/plans/2026-07-10-sano-flow-audit-remediation.md` Phase 2.*

## 1. Context and goal

SANO's material flow is: supervisor requests → estimator approves → admin creates the SANO PO (the field's "what's been ordered" record; the accounting PO lives in external software, out of SANO's scope) → supervisor receives. Per the confirmed ordering model, **"ordered" = SANO purchase orders**, requests are demand awaiting approval, and the hard quantity gate sits at PO creation.

Goal of this feature: when cumulative ordering for a material is about to exceed what was allocated in the BoQ, **both the supervisor and the estimator must see that explicitly**, the signal must survive BoQ re-publishes instead of being silently erased by them, and retroactive ceiling-raises must carry the right authority (principal).

## 2. Locked decisions

1. **Ordered = SANO PO.** Envelope burn counts non-cancelled SANO PO lines, not requests. Requests appear separately as `total_requested`.
2. **Request-time gate is a soft heads-up** (never a hard quantity block); **PO-time gate is the hard check**.
3. **Two signals, two anchors:**
   - **Signal 1 — Ordering overage (operational):** cumulative ordered (+ in-flight requests, at request/approval time) vs the **current** published plan. Re-publish overrides this — by design.
   - **Signal 2 — Plan drift (estimate integrity):** current planned qty vs the **first-published baseline**, snapshotted immutably per material. Re-publish can never erase it; it can only move overage from Signal 1 into Signal 2.
4. **Re-publish gets a diff-and-acknowledge step** with a persisted revision record and notifications.
5. **Principal gate, narrowly scoped:** a re-publish that raises the planned qty of a material **currently in overage** (ordered > current planned) holds until the principal approves. All other re-publishes flow with warning + acknowledgment only.
6. **Optional request→PO link** (`purchase_order_lines.request_line_id`), manual, non-blocking.

## 3. Signal 1 — ordering overage

**Definition per material (base units, always):**

- At **request time** (supervisor, PermintaanScreen): `projected = total_ordered_PO + other_open_request_qty + this_request_qty`, compared against current `total_planned`. Shown as a running total, never as "this request is over": *"Sudah di-PO 900 kg + permintaan berjalan 60 kg + permintaan ini 50 kg = 1.010 kg dari rencana 1.000 kg (101%)."* Severity: >100% WARNING, >120% stays WARNING but copy escalates ("jauh melebihi alokasi") — request-time never hard-blocks on quantity.
- At **approval time** (estimator, office ApprovalsScreen): the **same computation, recomputed fresh at render** — never the cached request-time figure. Displayed as an overage panel on the request card: planned / ordered / other-open-requests / this request / projected %. This is the second half of the dual visibility requirement.
- At **PO time** (admin, Gate2Screen): hard gate — `existing_non_cancelled_PO_qty + this_PO_line_qty > current_planned` → CRITICAL, requires principal override via the existing `approval_tasks` Gate-2 escalation. Within envelope → passes.
- **Envelope grain is named in the UI:** Tier-1 shows the work-group envelope ("Grup: Bekisting Balok Lt. 2"), Tier-2/3 show the project envelope ("Proyek"). The same material may be over in one grain and fine in another; the label must say which is being measured.

**Rules:**

- **No baseline → explicit unknown.** A free-text or catalog-unlinked material renders *"Tidak ada alokasi pembanding"* (grey/INFO), never a silent OK. Unmapped materials are where the worst overages hide.
- **Recompute at every stage; never persist-and-trust** a prior stage's number. What IS persisted: the computed snapshot at decision moments (in `line_check_details` on the request line at submit, and in the PO-gate `approval_tasks` payload) — as *audit evidence of what was known then*, not as input to later stages.
- **Overage ≠ early buying.** The signal measures *over the total*, not *ahead of schedule*. Copy must not accuse bulk purchases: "melebihi total alokasi", not "terlalu cepat". Pace remains the separate advisory `progressPaceFlag`.
- **Cancelled POs don't count**; `CLOSED_SHORT` POs count only their received/committed quantity going forward (their ordered qty stops inflating the total once short-closed — use `LEAST(po_line_qty, received)` for closed-short POs).

**Reason capture:** when a request's projected cumulative crosses 100%, the supervisor must pick a reason before submit: `WASTE` (kerusakan/susut lapangan), `REWORK` (bongkar-pasang), `PLAN_UNDERESTIMATE` (volume RAB kurang), `VARIATION` (perubahan pekerjaan), `OTHER` + free text. Stored on the request line. This is what turns overage data into estimator feedback instead of noise the team learns to click past.

## 4. Signal 2 — plan drift

**Baseline snapshot:** at the **first publish in which a material appears** in `project_material_master_lines`, write one immutable row to `material_baseline_snapshots`:

```
material_baseline_snapshots(
  id, project_id, material_id,
  baseline_planned_qty NUMERIC,   -- base units
  unit TEXT,
  source_master_id UUID,          -- the master that established it
  snapshotted_at TIMESTAMPTZ
) UNIQUE (project_id, material_id)
```

Inserts only; no UPDATE/DELETE path (no RLS write policy beyond the publish path; app never updates). Materials first appearing in a *later* publish get their snapshot then — their "first published" is the first publish that contains them.

**Drift per material:** `drift_pct = (current_planned − baseline_planned) / baseline_planned`. Displayed as a badge wherever the material's envelope appears: *"Rencana direvisi +20% dari baseline awal"*. Zero drift → no badge.

**Project rollup (office side):** *"Rencana material proyek ini bergeser +8% dari baseline awal (14 material direvisi naik, 2 turun)"* — a tile on the office dashboard/report. This reframes systematic overage from "supervisor is wasteful" to "our estimates run low", which is the honest reading when many materials drift the same direction.

**Visibility:** supervisor sees the drift badge as context (no Rp values); estimator and principal see per-material drift and the rollup.

## 5. Re-publish flow — diff, acknowledge, gate

On publish over an existing version, before anything is written:

1. **Compute the diff** for every material **with activity** (any non-rejected request line, non-cancelled PO line, or receipt): planned-before vs planned-after, current ordered/requested totals, current overage state. Materials without activity are listed in a collapsed summary only.
2. **Classify each diff line:**
   - **Raise absolving an overage** (ordered > planned-before AND planned-after > planned-before): → **principal gate** (step 4).
   - **Raise, no overage**: warning, acknowledge to proceed.
   - **Lower below already-ordered** (planned-after < ordered): warning — *"Ini akan membuat material X tercatat 118% melebihi alokasi baru"* — acknowledge to proceed. Conservative and honest; no principal needed to *create* an overage flag.
   - **Removal with activity** (material/BoQ rows absent from new workbook but has requests/POs/receipts): strongest warning — orphaned commitments; acknowledge to proceed. (Superseded `boq_items` handling per remediation plan Task 3.1.)
3. **Persist the revision:** `plan_revisions` (id, project_id, ahs_version_id_new/old, published_by, acknowledged_at, summary jsonb) + `plan_revision_lines` (revision_id, material_id, planned_before, planned_after, ordered_at_time, requested_at_time, classification). This is the auditor's answer to "who raised which ceiling, when, and what was in flight."
4. **Principal gate (narrow):** if any line classified *raise-absolving-overage*, the publish **holds** — an `approval_tasks` row (new task type `PLAN_CEILING_RAISE`) is created for the principal listing those materials; the whole publish waits (single-version model: no partial publish). The estimator's alternatives: wait for approval, or revert those planned values in the workbook and re-run publish immediately. Principal APPROVE → publish proceeds; REJECT → publish aborts, nothing written.
5. **Notifications:** principal gets the approval task notification (or, when no gate, an FYI on any ceiling-raise with activity); the assigned supervisors get *"Baseline diperbarui"* when a publish that changed materials-with-activity completes (they finally learn re-publishes happened at all).

**Acknowledgment UX:** the diff renders in BaselineScreen's publish step as a blocking checklist — each warning class needs an explicit tick; the publish button stays disabled until all are acknowledged. Acknowledgment identity + timestamp go into `plan_revisions`.

## 6. Who sees what (summary)

| Moment | Supervisor | Estimator | Admin | Principal |
|---|---|---|---|---|
| Request | Soft heads-up: running total vs current plan, envelope grain named, reason required >100%, drift badge | — | — | — |
| Approval | — | Same overage panel, recomputed fresh; drift badge | — | — |
| PO creation | — | — | Hard quantity gate vs current plan; escalation on breach | Gate-2 override on breach |
| Re-publish | "Baseline diperbarui" notification | Diff-and-acknowledge checklist | — | `PLAN_CEILING_RAISE` approval when absolving overage; FYI otherwise |
| Always | Envelope: requested / ordered / received; drift badge (no Rp) | Drift per material + project rollup | Remaining-to-order vs current plan | Project drift rollup |

## 7. Explicitly out of scope / known limits

- **The external accounting PO is invisible to SANO.** SANO's overage control is authoritative only for SANO POs; if the admin orders more in the accounting system than in SANO, SANO won't see it. The signal is a *control on the SANO record*, and office copy should say so ("berdasarkan PO SANO").
- No automated request→PO conversion (confirmed design: manual PO creation, optional link).
- `actual_unit_price` admin override stays dormant (separate decision).
- Rp-denominated drift (price drift) — quantity drift only, for now.

## 8. Acceptance criteria

1. Supervisor submitting a request that projects 101% sees the running-total warning and must pick a reason; the request still submits and reaches approval.
2. Estimator opening that request sees the same panel with fresh numbers (changing other requests between submit and review changes the panel, not the stored `line_check_details` evidence).
3. Admin creating a PO that would exceed current planned is blocked into the principal-override path; within plan, it passes and the envelope's `total_ordered` moves only then.
4. Re-publishing a workbook that raises a currently-overage material's planned qty holds the entire publish behind a `PLAN_CEILING_RAISE` principal approval; rejection aborts with zero rows written.
5. After an approved ceiling-raise publish: Signal 1 for that material recomputes green against the new plan AND the material shows a permanent drift badge vs its unchanged baseline snapshot; `plan_revisions` holds the full diff with acknowledgment identity.
6. A material first appearing in publish #3 gets its baseline snapshot from publish #3; later publishes never modify any snapshot row.
7. A catalog-unlinked request line shows "Tidak ada alokasi pembanding", never OK.
8. All comparisons are base-unit (kg) — a batang-input request compares in kg on both sides.
