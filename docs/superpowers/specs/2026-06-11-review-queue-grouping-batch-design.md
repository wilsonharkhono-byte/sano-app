# Review-Queue Grouping + Batch Actions — Design

> Make a 100+ row import review queue triable: group the flagged rows by *why*
> they were flagged, let the estimator batch-decide the bulk "unused recipe"
> cases from a group header, and sub-group the rest by the recipe they belong
> to — so clearing the queue doesn't mean tapping through a flat wall of cards.

- **Date:** 2026-06-11
- **Status:** Approved design, ready for implementation plan
- **Scope:** the "Perlu review" (exceptions) view only. Out of scope: the "Semua" view (stays flat), the clean-row bulk-approve (already exists), publish-gate changes, anomaly-tab changes.
- **Surfaces:** new `tools/flagGroups.ts` (pure), `workflows/screens/BaselineScreen.tsx` (render + batch handler). Reuses existing `bulkReviewStagingRows`.
- **Builds on:** `2026-06-08-review-card-why-flagged-design.md` (the `flag_reason` codes this groups by).

---

## 1. Problem

The review queue shows flagged rows as a flat list. Measured on the real
`SPH 4 Sonny Citraland Selat Golf` workbook: **102 of 581 rows are flagged** —
**33 orphan AHS blocks** (`flag_reason: orphan_ahs_block`) and **69 literal
components** (`literal_component`). The user-lens evaluation captured the pain:
*"30+ kartu semuanya 'AHS_BLOCK, tidak dipakai BoQ manapun' — apakah saya harus
Tolak semua?"* There is no way to triage by reason or to batch the repetitive
"unused template" rejections, so the estimator taps Tolak 33 times.

## 2. Data reality (measured, not assumed)

- **No flagged row has a BoQ chapter.** Chapter is a BoQ-row field; flagged rows
  are AHS blocks/components. Only 17 of 102 are even *derivable* to a chapter
  (via a literal component's linked parent block). So chapter sub-grouping would
  put 83% of the queue in one "Tanpa bab" bucket — rejected.
- **Every literal component already carries its parent recipe** in
  `raw_data.blockTitle`. Grouping the 69 components by parent block is meaningful
  ("Bekisting Balok (5)", "Pengecoran… (3)") and needs no extra lookup.
- **Orphan blocks are 33 distinct unused templates** — sub-grouping them yields
  33 groups of one. They stay flat; the estimator batch-rejects them.

## 3. Design

### 3.1 Top-level grouping (by `flag_reason`)

In the exceptions view, the flagged rows (`visibleReviewRows`) are bucketed into
ordered groups by `raw_data.flag_reason`:

| Order | key | label | batchable |
|---|---|---|---|
| 1 | `orphan_ahs_block` | "Blok harga tidak dipakai BoQ" | yes |
| 2 | `literal_component` | "Komponen angka langsung (tanpa rumus)" | no |
| 3 | `__other__` | "Lainnya" | no |

`__other__` catches any flagged/REJECTED row without a recognized reason (e.g. a
manually-rejected clean row). A group with zero rows is not rendered.

### 3.2 Collapse behavior

Each group header is tappable to collapse/expand. A group with **more than 10
rows auto-collapses by default** (so the estimator sees the headers + batch
buttons without scrolling past 33 cards); groups with ≤10 rows start expanded.
Collapse state is per-group UI state (`useState<Set<string>>` of collapsed
group keys), seeded once from the >10 rule.

### 3.3 Orphan group — batch actions

The orphan group header shows, besides the collapse toggle and count:

- **"Tolak semua {N}"** and **"Setujui semua {N}"** where `N` = the number of
  **PENDING** rows in the group (already-decided rows are excluded from both the
  count and the action).
- Tapping either opens a confirm dialog (`Alert.alert`), e.g. *"Tolak 33 blok
  tidak terpakai? Tindakan ini bisa diubah lagi sebelum publish."* Only on
  confirm does it call the batch handler.

### 3.4 Literal group — parent-block sub-grouping

When expanded, the literal-component group renders **sub-sections by parent
block** (`raw_data.blockTitle`): a sub-header `"{blockTitle} ({count})"` followed
by that block's component cards. Sub-sections preserve first-appearance order.
Components with no `blockTitle` fall under a `"Tanpa nama blok"` sub-header.
**No batch actions** here — each literal component is a hardcoded number the
estimator must verify per-row (truth-correctness).

### 3.5 Card render

The existing per-row card (source location, why-flagged callout, Setuju / Tolak /
Koreksi) is reused unchanged inside every group/sub-group. Nothing about an
individual card changes.

### 3.6 Batch handler

`handleBatchReview(ids: string[], status: 'APPROVED' | 'REJECTED')`:

1. Filters `ids` to rows currently PENDING (defensive — the buttons already pass
   PENDING ids).
2. Calls the existing `bulkReviewStagingRows(ids, status)` (single `.in()`
   update; already supports both directions).
3. On success, optimistically updates local `stagingRows` (sets `review_status`
   on those ids) — same pattern as the existing clean-row bulk-approve.
4. Toasts the count; re-checks the publish gate as today.

The publish gate is unchanged: it already requires every `needs_review` row to
leave PENDING, so batch-approving orphan blocks can't slip an unreviewed
exception into the baseline.

## 4. Components / units

| Unit | Where | Responsibility | Depends on |
|---|---|---|---|
| `FLAG_GROUP_LABELS`, `groupReviewRows(rows)` | `tools/flagGroups.ts` | rows → ordered `{ key, label, rows, batchable }[]`, empty groups dropped | `ImportStagingRow` (type), `flag_reason` |
| `subGroupByParentBlock(rows)` | `tools/flagGroups.ts` | rows → `{ title, rows }[]` by `blockTitle`, order-preserving | `ImportStagingRow` |
| grouped render + collapse state | `BaselineScreen.tsx` | render headers/sub-headers/cards, collapse toggles, batch buttons | the helpers |
| `handleBatchReview` | `BaselineScreen.tsx` | confirm → `bulkReviewStagingRows` → optimistic update | existing bulk API |

`tools/flagGroups.ts` is pure (no React/IO), so the grouping logic is unit-tested
independently of the screen.

## 5. Testing

- **`groupReviewRows`:** mixed rows → three groups in fixed order; `batchable`
  true only for `orphan_ahs_block`; empty groups omitted; a flagged row with an
  unknown/absent `flag_reason` lands in `__other__`; non-flagged rows are not
  included (caller passes the already-filtered exceptions list, but the helper
  must not crash on them).
- **`subGroupByParentBlock`:** components grouped by `blockTitle` with counts;
  first-appearance order preserved; missing `blockTitle` → "Tanpa nama blok".
- **Batch PENDING-filtering:** `handleBatchReview` logic — given a mix of PENDING
  and already-decided ids, only PENDING ones are sent (unit-test the filter, or
  assert the count passed to a stubbed `bulkReviewStagingRows`).
- **UI:** verified by running the app — orphan header batch-rejects 33 in one
  tap behind a confirm; literal group shows parent-block sub-headers; large
  groups start collapsed.

## 6. Risks

- **Accidental mass reject:** mitigated by the confirm dialog and by acting only
  on PENDING rows; the action is reversible before publish.
- **Group state vs. live edits:** after a batch action, counts/headers recompute
  from `stagingRows` (the source of truth), so the optimistic update keeps the
  headers consistent.
- **Vertical density:** auto-collapsing >10 groups keeps the screen short; the
  estimator expands a group only when reviewing it individually.
