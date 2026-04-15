# Jadwal & Milestone Authoring Foundation — Design

**Date:** 2026-04-15
**Status:** Design approved, ready for implementation planning
**Scope:** Spec 1 of 2. Spec 2 (schedule intelligence / BaRF-MC forecasting) is a separate follow-up.

---

## 1. Context

SAN already has a `milestones` table, a `MilestonePanel` rendered inside `Laporan → Jadwal`, a rule-based `deriveMilestoneStatus` helper, and a `reviseMilestone` flow backed by `milestone_revisions`. What it does **not** have is any way to create milestones in the first place. The existing empty state — *"Belum ada milestone. Akan tersedia setelah baseline import"* — is aspirational. Neither baseline publish nor any other code path inserts milestone rows. Grep confirms: zero `milestones` insert statements exist in `tools/schedule.ts`, `tools/baseline*.ts`, or anywhere else in the codebase.

This spec designs the authoring foundation: the schema changes, UI surfaces, and data flows needed for an estimator to create milestones for a project, link them to BoQ items, express dependencies between them, and optionally have Claude draft an initial set from the published BoQ.

The forecasting engine described in `SAN_Forecasting_Research.md` (Bayesian hierarchical S-curve + Kalman tracker + Monte Carlo rollup) is a separate spec and depends on this one — you cannot forecast milestones that do not exist.

### What the forecasting research doc contributes to this spec

Three direct inputs from the research doc shaped the design:

1. **DAG data model is mandatory.** §3.6 notes *"SAN's milestone graph is currently light... would need a small dependency-capture upgrade."* The Monte Carlo rollup layer requires *"dependency edges (even just serial chains)."* That upgrade is this spec.
2. **AI draft-assist is sanctioned as Claude Role 7 (prior elicitation).** §5 explicitly places structural prior elicitation in Claude's role set and separates it from forecasting math. This legitimizes including AI draft-assist in Spec 1 without needing the full Bayesian engine.
3. **§26.3 output contract: every Claude artifact must carry `confidence + explanation + reviewer-if-below-threshold`.** This directly drives the draft-review screen design and the `author_status: draft | confirmed` lifecycle below.

## 2. Goals and non-goals

### Goals
- Allow estimators to create, edit, and delete milestones in `Laporan → Jadwal`.
- Support dependencies between milestones (DAG) with validation, topological sort, and cycle detection.
- Link milestones to BoQ items via a grouped-by-chapter picker with filter chips.
- Offer a one-shot AI draft-assist flow that reads published BoQ + reference-class data and produces a draft milestone set for estimator review.
- Preserve the existing `reviseMilestone` + `milestone_revisions` flow as the sole channel for post-commit schedule slips with history.
- Keep supervisors read-only. Edit/delete/create is gated to `estimator | admin | principal`.

### Non-goals
- Forecasting, critical-path analysis, completion-date projection, stall detection (all Spec 2).
- Gantt/timeline visualization of milestones (deferred; the list view with predecessor chips is sufficient for v1).
- Milestone splitting as a single action (`⊟ Pisah`) — estimators can achieve the same result with Edit + new milestone manually. Dropped from v1 to control scope.
- Multi-turn chat interview for AI draft-assist (Question 5 decision: Level B — one-shot + structured parameters form, not Level C — chat).
- Auto-cascading date shifts when a predecessor slips. Revision stays manual per milestone. Auto-cascade belongs in Spec 2 because it requires forecast math.
- Internationalization (app is Indonesian-only per existing convention).
- Optimistic locking for concurrent edits (last-write-wins is acceptable given low edit frequency).

## 3. Placement and entry points

### Where it lives
`Laporan → Jadwal` tab, rendered by the existing `MilestonePanel` in [workflows/screens/MilestoneScreen.tsx](../../../workflows/screens/MilestoneScreen.tsx). No new top-level tab, no new screen in the app shell. The form and AI draft flow open as full-screen takeovers from this panel.

### Permissions
Create, edit, and delete are gated to roles `estimator | admin | principal`. This matches the existing `canRevise` pattern at [MilestoneScreen.tsx:35](../../../workflows/screens/MilestoneScreen.tsx#L35). Supervisors see the list, the predecessor chips, and the AI provenance badge — all read-only.

### Baseline prerequisite
Authoring is locked until the project's baseline is published. When unpublished, the Jadwal tab shows: *"Publikasikan baseline dulu untuk mengaktifkan jadwal"*. Once published, the entry points appear. Existing milestones (from prior baseline versions, if any) stay visible.

### Entry points
Two buttons at the top of the Jadwal panel, visible to `canRevise` users when baseline is published:
1. `+ Tambah Milestone` (primary) — opens the manual authoring form.
2. `✨ Saran Jadwal AI` (secondary) — opens the AI draft-assist wizard.

### Empty state
Replaces today's hint at [MilestoneScreen.tsx:172-174](../../../workflows/screens/MilestoneScreen.tsx#L172-L174). Shows a hero card:
> **Belum ada jadwal**
> Mulai dengan menambah milestone manual, atau biarkan AI menyusun draf awal dari BoQ yang sudah dipublikasi.
> `[ + Tambah Milestone ]` `[ ✨ Saran Jadwal AI ]`

### Cross-screen shortcut
When `publishBaseline` succeeds at [BaselineScreen.tsx:434](../../../workflows/screens/BaselineScreen.tsx#L434), append an `Atur Jadwal →` action to the existing success toast/banner that navigates directly to `Laporan → Jadwal`. This is the only cross-screen coupling added by this spec.

## 4. Data model changes

### `milestones` table — additive columns

| Column | Type | Default | Purpose |
|---|---|---|---|
| `depends_on` | `uuid[]` | `'{}'` | Predecessor milestone IDs. Empty array = no dependencies. |
| `proposed_by` | `text` | `'human'` | `'human'` \| `'ai'`. Provenance marker. |
| `confidence_score` | `numeric(4,3)` | `NULL` | 0.000–1.000 for AI proposals; `NULL` for human entries. |
| `ai_explanation` | `text` | `NULL` | Rationale text from Claude for AI proposals; `NULL` for human entries. |
| `author_status` | `text` | `'confirmed'` | `'draft'` \| `'confirmed'`. AI proposals land as `draft`; estimator confirmation flips to `confirmed`. |
| `deleted_at` | `timestamptz` | `NULL` | Soft-delete marker. Preserves `milestone_revisions` audit trail across deletions. |

### Existing columns untouched
`label`, `planned_date`, `revised_date`, `revision_reason`, `status`, `boq_ids`, `project_id`, `created_at`. The existing `reviseMilestone` flow at [tools/schedule.ts:126](../../../tools/schedule.ts#L126) and the `milestone_revisions` table remain the authoritative revision channel for post-commit date changes.

### Indexes
- `CREATE INDEX ON milestones USING GIN (depends_on)` — fast predecessor lookups for topological sort.
- `CREATE INDEX ON milestones (project_id, author_status) WHERE deleted_at IS NULL` — filters drafts and deleted rows from standard project queries.

### Soft-delete behavior
All read paths — `MilestonePanel`, `syncMilestoneStatuses`, `generateScheduleVariance`, `computeProjectHealth`, and `useProject` — add `.is('deleted_at', null)` to their queries. A soft-deleted milestone disappears from UI and computations but remains for audit.

### Constraints enforced in app logic (not DB)
Postgres cannot cleanly express DAG acyclicity as a constraint. These run in application code instead:
- **Cycle detection**: pure function `validateNoCycle(milestones, updatedMilestone): boolean` in `tools/schedule.ts`. Runs client-side before save and server-side in the `createMilestone` / `updateMilestone` RPCs as a defensive guard.
- **Date validation**: `planned_date >= max(depends_on.planned_date)` at save time. Hard block with a specific error message pointing to the conflicting predecessor.
- **Project scoping**: every entry in `depends_on` must reference a milestone in the same `project_id`.

### Cascade cleanup on delete
When a milestone is deleted (soft), the RPC removes that ID from every other milestone's `depends_on` array in the same transaction. Dependent milestones retain their other predecessors. A confirmation dialog surfaces the affected list to the user before delete: *"Milestone berikut tergantung pada ini: [X, Y]. Mereka akan kehilangan dependensi tersebut. Lanjutkan?"*

### New RPC surface in `tools/schedule.ts`
- `createMilestone(projectId, input: CreateMilestoneInput): Promise<Result<Milestone>>`
- `updateMilestone(id, patch: UpdateMilestoneInput): Promise<Result<Milestone>>`
- `deleteMilestone(id): Promise<Result<{ cleanedReferences: number }>>`
- `createMilestonesBulk(projectId, drafts: CreateMilestoneInput[]): Promise<Result<Milestone[]>>` — used by AI draft commit to transition drafts to confirmed in a single transaction.
- `topologicalSort(milestones): Milestone[]` — pure utility for display ordering.
- `validateNoCycle(milestones, updated): boolean` — pure utility used by RPCs and by the client before submit.

Existing `reviseMilestone` and `syncMilestoneStatuses` stay unchanged except for adding the `deleted_at IS NULL` filter to their reads.

## 5. Manual authoring form

### New screen: `MilestoneFormScreen`
File: `workflows/screens/MilestoneFormScreen.tsx`. Full-takeover pattern matching `AttendanceScreen` / `BaselineScreen` in [LaporanScreen.tsx:228](../../../workflows/screens/LaporanScreen.tsx#L228). Handles both create and edit modes via an optional `milestoneId` prop. Refuses to mount if the role is not `estimator | admin | principal`.

### Fields

1. **`Nama Milestone`** — `TextInput`, required. Validated: non-empty, trimmed, unique-per-project (case-insensitive).
2. **`Target Tanggal`** — existing `DateSelectField` component, required. Validated: `≥ today` on create; `≥ max(predecessors.planned_date)` always.
3. **`Item BoQ`** — opens a `BoqPickerSheet` modal (the picker itself is specified in §7 below). Displayed in the form as a tappable summary row: *"4 item BoQ dipilih →"*. Empty selection is allowed with helper text: *"Kosongkan jika milestone tidak terhubung ke item BoQ"*.
4. **`Tergantung Pada`** — multi-select chip picker over existing confirmed non-deleted milestones in the project, minus self and minus descendants (to prevent cycles at selection time). Flat searchable list (dependency count per project is expected to stay under ~50). Selected predecessors render as chips below the field with tap-to-remove.
5. **Hint under the date field** (edit mode only): *"Untuk revisi tanggal setelah milestone dikomit, gunakan tombol Revisi di daftar."*

No notes field in v1. The existing `revision_reason` field covers post-commit context; a separate `notes` column would need schema we do not need yet.

### Validation timing
- **Inline** (as the user types): required, format, length.
- **On submit**: cross-field checks (date vs predecessors, cycle detection, uniqueness). Failures surface as toasts pointing to the specific conflict — e.g., *"Target tanggal harus setelah 18 Mei 2026 (target milestone 'Pondasi & Sloof')"*.

### Save flow
- **Create mode**: `createMilestone` RPC with `author_status: 'confirmed'`, `proposed_by: 'human'`. On success, navigate back to `MilestoneScreen` and toast *"Milestone dibuat"*.
- **Edit mode**: `updateMilestone` with the patched fields. Date changes here are pre-commit corrections and are **not** tracked in `milestone_revisions`. Post-commit date slips must use the existing `Revisi` button on the list view.

### Delete action
Only rendered in edit mode. A destructive button at the bottom of the form:
`[ Hapus Milestone ]`
Triggers a confirmation dialog that enumerates affected dependents. On confirm, calls `deleteMilestone` (soft-delete) with cascade cleanup of `depends_on` references.

## 6. AI draft-assist flow

Per Question 5 decision: **Level B — one-shot + structured parameters form**. No chat, no multi-turn interview. Three-step wizard in a new screen `MilestoneAiDraftScreen`, followed by a review screen `MilestoneAiReviewScreen`.

### Step 1 — Parameters form

One screen capturing the minimal prior elicitation needed for a useful draft:

| Field | Type | Required |
|---|---|---|
| `Jenis Proyek` | Dropdown: `Rumah Tinggal`, `Ruko`, `Gedung Bertingkat`, `Renovasi`, `Lainnya` | yes |
| `Durasi Target Proyek (bulan)` | number input | yes |
| `Jumlah Mandor Aktif` | number input | yes |
| `Shift Kerja` | radio: `1 shift`, `2 shift`, `Harian/Borongan` | yes |
| `Catatan Kondisi Site` | multiline text, optional | no |

A context card below the form shows what Claude will receive:
> AI akan membaca **{N} item BoQ** dari baseline yang dipublikasi + mencocokkan dengan **{M} proyek serupa** di katalog.

`{M}` comes from a synchronous cross-project BoQ/AHS similarity lookup (Claude Role 1, reference-class matcher, from the research doc §5). If `M = 0`, the card reads: *"Tidak ada proyek serupa — AI akan mengandalkan parameter yang Anda isi"*. This sets honest expectations about confidence.

Submit button: `Buat Draf Jadwal →`.

### Step 2 — Edge function call

New Supabase edge function: `supabase/functions/ai-draft-milestones/index.ts`. Follows the existing `ai-assist` pattern.

**Model pinned to `claude-sonnet-4-6`** regardless of project default. Sonnet follows structured-output schemas more reliably than Opus for this kind of work, and it is ~5× cheaper. Override via env var if needed.

**No rate limiting.** A 30s client-side debounce prevents accidental double-taps; no server-side throttle. Cost analysis shows even heavy usage (50 projects/year, 3 retries each) runs ~$4/year at Sonnet pricing — not worth throttling against. Server-side idempotency is achieved via the `ai_draft_runs` audit row check described below.

**Flow:**
1. Fetch published BoQ items for the project.
2. Run reference-class lookup: query confirmed, non-deleted `milestones` from other projects where AHS/BoQ catalog overlap exceeds a threshold. Return top-3 similar past project milestone sets.
3. Build a prompt with: parameters from Step 1, BoQ grouped by chapter, reference-class examples, and the §26.3 output contract.
4. Call Claude with this strict structured-output schema:
   ```ts
   {
     milestones: Array<{
       label: string;
       planned_date: string;             // ISO date
       boq_ids: string[];                // must reference published BoQ
       depends_on_labels: string[];      // references other draft labels
       confidence: number;               // 0..1
       explanation: string;
     }>
   }
   ```
5. Validate the response:
   - `boq_ids` filtered against real published BoQ; invalid IDs silently dropped, counted.
   - `depends_on_labels` resolved to array indices; cycle-detected before persist.
   - `planned_date` parseable and ≥ today.
   - `confidence` clamped to `[0, 1]`.
   - Rows missing `confidence` or `explanation` fully rejected. On any rejection, server retries Claude once with a reinforced system prompt (`Output MUST match the schema exactly`). On second failure, return a user-facing error.
6. Persist the drafts as `author_status: 'draft'`, `proposed_by: 'ai'`, with `depends_on` converted from label references to the newly-inserted milestone IDs.
7. Record an `ai_draft_runs` audit row (see §10).
8. Return draft milestone IDs.

**Timeout:** 60s max. On timeout, show a retry screen with the original parameters pre-filled. No partial drafts persisted.

**Loading UX:** multi-stage progress indicator while the call is in flight:
1. *"Mencocokkan dengan proyek serupa…"*
2. *"Menganalisis struktur BoQ…"*
3. *"Menyusun urutan milestone…"*

### Step 3 — Review screen

New screen: `workflows/screens/MilestoneAiReviewScreen.tsx`. Loads draft milestones for this project (`author_status = 'draft'`, not soft-deleted) and renders them as the card list design from Question 7 Option A.

**Card shape per draft:**
- Confidence-colored left border: `≥ 0.8` green, `0.5–0.8` blue, `< 0.5` orange.
- Checkbox (pre-checked for medium+, unchecked for low confidence).
- Label, target date, BoQ chip count, predecessor chip(s).
- Inline explanation text from `ai_explanation`.
- Per-card actions: `✎ Edit` (opens `MilestoneFormScreen` on that draft row, stays `draft`), `✕ Buang` (soft-delete the draft).

**Top warning bar:** *"{N} milestone dengan confidence rendah — perlu review ekstra"*, only shown when N > 0.

**Bottom bar:** `Buat {N} Milestone` where N is the count of currently-checked cards. Commits checked drafts in one transaction via `createMilestonesBulk` — flips `author_status` to `confirmed`. Unchecked drafts remain as drafts; the user can revisit or discard them.

**Cancel action:** `Batal — Buang Semua Draf` (confirmation required) soft-deletes all draft rows for this project.

### Exit behavior
If the estimator navigates away mid-review, drafts persist. Returning to Jadwal shows a banner:
> 🟠 Ada **{N}** draf AI belum dikonfirmasi
> `[ Lanjutkan Review ]` `[ Buang Semua ]`

Tap `Lanjutkan Review` jumps back to `MilestoneAiReviewScreen`. This matches the §26.3 reviewer-required contract.

### Safety guardrails tied to research doc §5 and §26.3
- **Claude suggests structure only**, never commits. Enforced by `author_status: draft` lifecycle.
- **Every draft carries confidence + explanation.** Enforced by schema validation. Missing either → row rejected.
- **Low-confidence items are flagged, not auto-excluded.** Estimator decides. Matches §15.4.
- **Audit trail:** `ai_draft_runs` row records parameters, prompt hash, response summary, committed IDs, rejected count, timestamp. Spec 2 can use this to measure draft-assist accuracy.

## 7. BoQ picker sub-component

New reusable component: `workflows/components/BoqPickerSheet.tsx`. Per Question 6 decision: **grouped by chapter + filter chips**.

### Structure
- Modal sheet (full-screen on phone, centered on tablet).
- Header: title, search input (live-filters across `code` and `label`).
- Chip row: chapters from the project's BoQ, plus an `Semua` chip. Multi-select filter — tapping chapter chips narrows the list.
- List body: items grouped by chapter with sticky chapter headers. Each row shows `code`, `label`, and `unit`. Rows render with a checkbox on the left.
- Footer: selected count + `Simpan` button.

### Behavior
- Backed by an in-memory copy of the project's BoQ fetched once on mount.
- Search is client-side (debounced 150ms) — BoQ item count per project is typically under ~500.
- Chapters are derived from the `chapter` column of `boq_items`, sorted by the first `sort_order` encountered.
- Selection state is held locally and returned to the parent on `Simpan`. No writes from inside the picker.

### Used by
- `MilestoneFormScreen` for the `Item BoQ` field.
- `MilestoneAiReviewScreen` when the user taps `Edit` on an AI draft and re-opens the BoQ selection.

## 8. Display and integration with existing `MilestonePanel`

Surgical additions to [workflows/screens/MilestoneScreen.tsx](../../../workflows/screens/MilestoneScreen.tsx). Two new small sub-components — `MilestoneEntryRow` and `DraftReviewBanner` — are extracted for clarity. Core render logic stays intact.

### Entry row at the top
Replaces the current empty-state hint when `canRevise` is true and baseline is published:
```
[ + Tambah Milestone ]  [ ✨ Saran Jadwal AI ]
```
Hidden when baseline is unpublished (show the gate hint instead).

### Draft banner
Rendered above the list when the project has any draft milestones:
> 🟠 Ada **{N}** draf AI belum dikonfirmasi
> `[ Lanjutkan Review ]` `[ Buang Semua ]`

### Topological sort
Replaces the current implicit date ordering. Uses the new `topologicalSort(milestones)` utility (Kahn's algorithm over `depends_on`, tie-broken by `planned_date` ascending). Cycle-safe: falls back to date order on detection and logs a warning. Never crashes the panel.

### New visual elements on each milestone card
- **Predecessor chips row** below the existing BoQ count line at [MilestoneScreen.tsx:211](../../../workflows/screens/MilestoneScreen.tsx#L211):
  > `Tergantung pada: [Pondasi & Sloof] [Pembesian Lt.1]`

  Chips resolved from `depends_on` IDs → labels on render. Missing references render as `[dihapus]` in muted color (defensive — cascade cleanup should prevent this).

- **AI provenance badge**: when `proposed_by === 'ai'`, render a small `✨ AI` chip next to the label, showing `confidence_score * 100` as a percentage. Tapping opens a sheet with the stored `ai_explanation`.

### Per-card actions (for `canRevise` users)
Current behavior at [MilestoneScreen.tsx:194-206](../../../workflows/screens/MilestoneScreen.tsx#L194-L206) shows only `Revisi`. Add two more in an action row:
```
[ ✎ Edit ]  [ Revisi ]  [ ✕ Hapus ]
```

- **Edit**: opens `MilestoneFormScreen` in edit mode. For pre-commit corrections. Date changes here are not tracked in `milestone_revisions`.
- **Revisi**: unchanged. Existing flow at [MilestoneScreen.tsx:64-80](../../../workflows/screens/MilestoneScreen.tsx#L64-L80). The correct channel for post-commit date slips with history.
- **Hapus**: calls `deleteMilestone` (soft-delete) with the cascade-cleanup confirmation dialog.

### Supervisor read-only view
Existing `canRevise` gating already hides action buttons. Supervisors will see: topological sort, predecessor chips, AI badge, tap-to-read explanation. No create/edit/delete buttons. No AI draft entry point. No draft banner.

### Hooks data layer
[workflows/hooks/useProject.tsx](../../../workflows/hooks/useProject.tsx): split the current `milestones` fetch into two queries:
- `milestones`: `author_status = 'confirmed' AND deleted_at IS NULL`
- `milestoneDrafts`: `author_status = 'draft' AND deleted_at IS NULL`

The draft banner consumes `milestoneDrafts.length`; the panel list consumes `milestones`. Zero changes to any other caller of `milestones` (reports, health, sync) because they now only see confirmed, non-deleted rows.

## 9. Error handling and edge cases

### Network and Supabase failures
- `createMilestone` / `updateMilestone` / `deleteMilestone` return `{ success, error }` results matching the existing `reviseMilestone` pattern. UI surfaces errors via the existing `useToast` hook.
- `ai-draft-milestones` edge function failures show a full-screen retry card with parameters pre-filled. No partial state persisted on failure.
- Topological sort never crashes — falls back to date order on cycle detection and logs a warning.

### Claude output validation failures
Handled inside the edge function. One retry with a reinforced system prompt. On second failure, surface:
> *"AI tidak dapat membuat draf. Silakan coba lagi atau buat milestone manual."*

Per-row invalids: filtered and counted. Surfaced in the review screen as:
> *"{N} usulan AI dibuang karena data tidak valid"*

### Concurrency
- Two estimators editing the same milestone: last-write-wins. No optimistic locking in v1.
- AI draft generation triggered twice in parallel: server-side idempotency via the `ai_draft_runs` audit row. If an active run exists for `(project_id, user_id)` within the last 30s, return the existing run's result instead of creating a new one.

### Baseline republished after milestones exist
Milestones persist across baseline republishes. If any milestone's `boq_ids` reference items not present in the latest published version, surface a banner in the panel:
> *"Baseline dipublish ulang — {K} milestone mungkin perlu ditinjau"*

In v1, tapping the banner is a no-op placeholder; the estimator manually reviews affected milestones. A proper stale-BoQ review screen is deferred. The existing `syncMilestoneStatuses` already filters missing BoQ IDs defensively, so nothing breaks.

### Empty BoQ selection
Allowed. Not every milestone needs BoQ links (handover, site prep, permit gates). Existing `syncMilestoneStatuses` treats empty `boq_ids` as 0% progress — unchanged. Form helper text documents this.

### Abandoned drafts
If drafts sit un-reviewed indefinitely, a passive cleanup runs on project load: drafts older than 14 days are auto-soft-deleted and logged to `activity_log`. No user notification — janitorial.

### Cycle detection with transitive edits
`validateNoCycle(milestones, updatedMilestone): boolean` takes the projected post-edit graph (not the current DB state) and does DFS. Runs client-side before save and server-side inside the RPCs.

### Soft-delete across the stack
All read paths across `tools/schedule.ts`, `tools/reports.ts`, `workflows/hooks/useProject.tsx`, and `MilestoneScreen` must include `.is('deleted_at', null)`. This is an audit item for the implementation phase.

## 10. Audit and observability

### `ai_draft_runs` table (new)
```sql
CREATE TABLE ai_draft_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  parameters jsonb NOT NULL,
  prompt_hash text NOT NULL,
  response_summary jsonb NOT NULL,       -- counts: proposed, rejected, committed
  committed_milestone_ids uuid[],
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
```

Used for:
- Idempotency check (recent active run detection).
- Draft-assist accuracy measurement once Spec 2 is in place.
- Cost observability.

### Existing `activity_log` entries
Following the pattern at [tools/schedule.ts:149](../../../tools/schedule.ts#L149), emit entries for:
- `milestone_created` (human and AI paths)
- `milestone_updated` (Edit action)
- `milestone_deleted` (soft-delete)
- `ai_draft_generated`, `ai_draft_committed`, `ai_draft_abandoned`, `ai_draft_auto_purged`

## 11. Testing

### Unit — `tools/schedule.test.ts`
- `topologicalSort`: linear chain, parallel branches, diamond dependency, cycle fallback, empty input.
- `validateNoCycle`: self-reference, 2-cycle, 3-cycle, no cycle, edit that creates a cycle via transitive path.
- `validatePlannedDate`: date before any predecessor, equal, after, no predecessors.
- `cascadeCleanupDependsOn`: 0 dependents, 1 dependent, multiple dependents, confirm direct references only (no transitive cleanup).

### Integration — `tools/schedule.integration.test.ts` (test Supabase)
- Create manual milestone end-to-end.
- Create → edit → soft-delete lifecycle.
- Soft-delete with cascade cleanup.
- Draft creation → confirm → visible in confirmed queries.
- Draft creation → abandon → not visible in confirmed queries.
- Baseline republish → stale BoQ reference banner triggers.

### Edge function — `supabase/functions/ai-draft-milestones/test.ts`
- Mock Claude response matching schema → all rows persist as drafts.
- Mock Claude response with invalid `boq_ids` → invalid rows filtered, counter incremented.
- Mock Claude response with malformed JSON → retry once, then fail gracefully.
- Mock Claude timeout → 60s enforced, no partial state.

### Manual QA
- BoQ picker with 100+ items, 5+ chapters — scrolling and filter chips.
- Predecessor picker with 20+ existing milestones.
- AI draft review with mixed confidence tiers — visual sort and warning bar.
- Real-device test iOS + Android — content density check.

## 12. Out-of-scope for v1 (explicit)

- Milestone split action (`⊟ Pisah`) — defer indefinitely; manual two-step achieves it.
- Gantt/timeline visualization — defer; list with chips is sufficient.
- Auto-cascading date shifts on predecessor slips — belongs in Spec 2.
- Critical path highlighting, completion forecasting, stall detection, narrative generation — all Spec 2.
- Stale BoQ review screen — banner-only in v1; full review flow deferred.
- Internationalization — Indonesian-only per existing app convention.
- Optimistic locking for concurrent edits — last-write-wins is acceptable.

## 13. Implementation surface summary

**New files:**
- `workflows/screens/MilestoneFormScreen.tsx`
- `workflows/screens/MilestoneAiDraftScreen.tsx`
- `workflows/screens/MilestoneAiReviewScreen.tsx`
- `workflows/components/BoqPickerSheet.tsx`
- `supabase/functions/ai-draft-milestones/index.ts`
- `supabase/functions/ai-draft-milestones/test.ts`
- `tools/schedule.test.ts`
- `tools/schedule.integration.test.ts`
- `supabase/migrations/NNNN_jadwal_authoring.sql`

**Modified files:**
- `tools/schedule.ts` — new RPCs and utilities (createMilestone, updateMilestone, deleteMilestone, createMilestonesBulk, topologicalSort, validateNoCycle). Existing functions extended with `deleted_at IS NULL` filter.
- `tools/reports.ts` — add `deleted_at IS NULL` to milestone queries.
- `tools/types.ts` — extend `Milestone` interface with new columns.
- `workflows/screens/MilestoneScreen.tsx` — entry row, draft banner, topological sort, predecessor chips, AI badge, Edit/Hapus actions.
- `workflows/screens/LaporanScreen.tsx` — route takeovers for the new screens.
- `workflows/screens/BaselineScreen.tsx` — append `Atur Jadwal →` action to publish success banner.
- `workflows/hooks/useProject.tsx` — split milestones / milestoneDrafts queries with `deleted_at IS NULL`.

## 14. Handoff notes to Spec 2 (Schedule Intelligence)

When Spec 2 lands, these pieces from Spec 1 are load-bearing:
- The DAG edges (`depends_on`) are the graph Monte Carlo will sample over.
- `author_status = 'confirmed'` is the filter Spec 2 reads from; never forecast drafts.
- `ai_draft_runs` is the source for draft-assist accuracy metrics.
- `milestone_revisions` remains the only place where post-commit date slips with history are recorded — Spec 2's forecaster should read both `planned_date` and `revised_date` and treat the delta as a realized schedule variance signal.
- The seven Claude roles in research doc §5: Role 7 (prior elicitation) is satisfied by Spec 1's AI draft-assist; Roles 1–6 are Spec 2 territory.
