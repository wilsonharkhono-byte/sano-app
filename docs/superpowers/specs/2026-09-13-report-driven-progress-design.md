# Report-Driven Progress — Design Spec

**Date:** 2026-09-13
**Status:** approved in conversation (claim unit, verifier, weight source); awaiting written review
**Branch:** `feat/report-driven-progress` (off `main` at 1a0e631)

---

## 1. Context and goal

Supervisors on the two live projects report through **Laporan Progres Klien (Blueprint)** — the report builder in `workflows/screens/ClientReportBuilderScreen.tsx` — and nothing else. Live data on 2026-09-13:

| | Citraland Selat Golf K2-7 | Gading Serpong Golf 87 |
|---|---|---|
| `client_progress_reports` issued (all `harian`) | 19 (2026-08-22 → 09-13) | 16 (2026-08-27 → 09-12) |
| `daily_site_logs` | 1 | 0 |
| `progress_entries`, `opname_headers`, `purchase_orders`, `receipts`, `site_events`, `rooms` | 0 | 0 |
| live `boq_items` (`superseded_at IS NULL`, `planned > 0`) | 16 work areas, all m³ except one `ls` | none published |

An issued report is a frozen `snapshot` JSON: free-text `updates[] {area, note, date}`, `hero` + `thumbs` photos, crew, weather, a typed `statusLabel`, `nextPlan`. It links to no BoQ row, carries no quantity, and nobody reviews it. Project progress (`tools/progressMath.ts computeOverallProgress`) reads only `boq_items.installed`, which is fed only by `progress_entries` from the Progres screen, which nobody uses. So the one stream of site truth never reaches progress.

**Goal.** Make the Blueprint report the standard daily procedure *and* the source of a verified weekly progress claim per work area, attributed to the published BoQ rows, with every number owned by a person and every claim carrying its evidence (report lines, photos, material receipts, opname variance). AI proposes; humans decide; the verify step is the only writer of progress.

Decisions taken with the owner on 2026-09-13:

1. **Claim unit:** weekly stage claim per work area (not daily quantities, not AI-only estimates).
2. **Verifier:** the estimator, mirroring opname's submit → verify chain. The principal reads the result.
3. **Stage weights** come from the BoQ itself (the RAB prices bekisting, pembesian and pengecoran separately per element), with an easy per-project adjustment so site reporting can actually fill progress up.

## 2. Non-goals

- No change to what the client sees in the daily PDF beyond photos that keep loading (§5.2). The weekly (`mingguan`) report already prints a progress delta from `progress_entries`; verified claims flow into it unchanged.
- No replacement of `progress_entries`, `computeOverallProgress`, milestones, or the opname chain. The claim writes *through* them.
- No automatic quantity extraction from narrative. One update in 107 contains a number; the text supports element + stage + state, not m³.
- No room (Papan Ruangan) integration in this spec. Rooms are 0 on both projects; the existing `room_id`/`gate_code` columns on daily-log tables are untouched. A Finishing-phase claim model is a later spec.
- Gading Serpong gets nothing from this until a BoQ is published for it (§14).

## 3. Principles (truth-correctness contract)

- **The model never writes a percent into progress.** It writes suggestions into `ai_*` columns. Only `verify_progress_claim` (SECURITY DEFINER) writes `progress_entries` / `boq_items.installed`, and only from `verified_pct` typed or accepted by the estimator.
- **Every suggestion cites literal evidence.** Quotes must be substrings of the report line they come from, exactly as `supabase/functions/site-event-analyze/validate.ts` enforces (`isLiteralQuote`).
- **Weights are never guessed.** Each row's weights carry a `source` (`rab`, `input_sheet`, `reference`, `manual`). `reference` is visibly flagged in every screen that shows a percent derived from it.
- **Frozen at verify.** A verified claim line stores the weights it was computed with (`weights_snapshot`), so later weight edits never move history.
- **Issuing a client report is never blocked** by a missing link. Unlinked lines are allowed and show up as gaps in the weekly prefill.

## 4. Vocabulary

**Weight-bearing stages** (per concrete work-area row, in site vocabulary):

| code | Indonesian label | RAB source (per m³) |
|---|---|---|
| `BEKISTING` | Bekisting | ratio V (m²/m³) × price W (Rp/m²) |
| `PEMBESIAN` | Pembesian | kg/m³ Z × price AA (Rp/kg) |
| `PENGECORAN` | Pengecoran | beton material R |

Upah S and alat T are one borongan line in every RAB seen and are apportioned across the three stages (§7.1).

**Recognized activities** the linker may tag on a line, evidence-only, no weight: `GALIAN`, `LANTAI_KERJA`, `MARKING`, `STEK`, `BONGKAR_BEKISTING`, `CURING`, `PERSIAPAN`, `LAINNYA`. On a full-RAB project galian / lantai kerja / urugan are their own BoQ rows (chapter Pekerjaan Tanah) and are claimed as single-stage rows (§7.3); on a simplified-input project they have no cost representation and stay evidence-only. This is stated on the claim screen ("Galian tidak berbobot pada BoQ proyek ini").

**Activity state** per line: `MULAI`, `LANJUT`, `SELESAI`.

**Week:** Monday 00:00 → Sunday 23:59 `Asia/Jakarta`; `week_start` is the Monday date. Reports whose `period_end` falls in the week feed that week's claim.

## 5. Data model

Migration numbers are provisional (main was at 100; renumbered 2026-09-14 after main's PR #67 took 101 for gate labels).

### 5.1 `client_report_lines` — migration 102

One row per `(report_id, line_index)` of an issued report; the snapshot stays frozen.

```
id uuid pk
report_id uuid not null references client_progress_reports(id) on delete cascade
line_index int not null                      -- index into snapshot.updates[]
line_text text not null                      -- area + ' :: ' + note, frozen copy (quotes validate against this)
boq_item_id uuid references boq_items(id)    -- CONFIRMED link (null = "tidak terkait")
stage text check (stage in (…weight-bearing + activities…))
activity_state text check (in ('MULAI','LANJUT','SELESAI'))
status text not null check (status in ('SUGGESTED','CONFIRMED','DISMISSED')) default 'SUGGESTED'
confirmed_by uuid, confirmed_at timestamptz
ai_boq_item_id uuid, ai_stage text, ai_activity_state text,
ai_confidence text check (in ('high','medium','low')), ai_quote text, ai_model text, ai_run_id uuid
unique (report_id, line_index)
```

`progress_ai_runs` — also migration 102, the audit ledger for both stages, same shape as `site_event_ai_runs`: `stage in ('link','prefill')`, `model, prompt_hash, input_summary, output, tokens_in, tokens_out, cost_usd, latency_ms, status, error, created_at`, keyed by `report_id` or `claim_id` (exactly one non-null; `claim_id` is a plain uuid until 104 adds the FK).

A re-issued report (`revision + 1`) copies CONFIRMED lines forward by `line_index` where `line_text` is unchanged; changed lines re-enter SUGGESTED via a fresh link run.

### 5.2 Photo paths on the snapshot — code only, no migration

`ClientReportPhoto` gains `path?: string | null` (the Storage object path, `site-media:`-prefixed when pulled from a site event). Builder-uploaded photos store both `url` and `path`. Rendering (`tools/clientReportHtml.ts`, `ReportPreview.tsx`, the viewer) resolves `path` through `resolvePhotoUrl` at render time and falls back to `url`. For the 35 already-issued snapshots, a pure helper `photoPathFromSignedUrl(url)` (`/storage/v1/object/sign/photos/<path>?token=…` → `<path>`; returns null if the shape differs) recovers the path lazily; no backfill write. This closes the 7-day expiry defect: today every issued report older than a week re-renders without photos.

### 5.3 `boq_stage_weights` — migration 103

```
project_id uuid not null, boq_item_id uuid not null references boq_items(id)
weights jsonb not null        -- {"BEKISTING": 0.53, "PEMBESIAN": 0.33, "PENGECORAN": 0.14}; sums to 1 (±0.001) or {"SINGLE": 1}
source text not null check (source in ('rab','input_sheet','reference','manual'))
reference_class text          -- e.g. 'KOLOM', 'BALOK_PLAT', when source = 'reference'
basis jsonb                   -- the Rp figures the weights were derived from, for audit
updated_by uuid, updated_at timestamptz
primary key (project_id, boq_item_id)
```

Rows without an entry are treated as `SINGLE` (one stage, 100 %). Derivation rules in §7.

### 5.4 `progress_claims` / `progress_claim_lines` — migration 104

```
progress_claims
  id, project_id, week_start date, status check (in ('DRAFT','SUBMITTED','RETURNED','VERIFIED'))
  submitted_by, submitted_at, returned_by, returned_at, return_note,
  verified_by, verified_at, verifier_note, ai_run_id, created_at
  unique (project_id, week_start)

progress_claim_lines
  id, claim_id, boq_item_id
  prev_verified jsonb          -- {stage: pct} at the last VERIFIED claim (or 0s)
  ai_pct jsonb, ai_confidence text, ai_quotes jsonb, ai_flags jsonb
  claimed_pct jsonb            -- supervisor's numbers (0..100 per stage)
  verified_pct jsonb           -- estimator's numbers; null until verified
  weights_snapshot jsonb       -- frozen copy of boq_stage_weights at verify
  row_pct_prev numeric, row_pct_new numeric, delta_quantity numeric
  evidence jsonb               -- {report_line_ids[], photo_refs[], receipt_refs[], opname_variance_pct}
  flags jsonb                  -- advisory cross-check flags (§9), computed at submit and re-computed at verify
  unique (claim_id, boq_item_id)
```

`progress_claim_lines.ai_run_id` and `client_report_lines.ai_run_id` reference `progress_ai_runs` (§5.1).

### 5.5 Notifications — migration 104

`notifications_type_check` re-created with three new types: `PROGRESS_CLAIM_SUBMITTED` (to the project's estimators; admins as fallback when none), `PROGRESS_CLAIM_VERIFIED` and `PROGRESS_CLAIM_RETURNED` (to `submitted_by`). Fan-out follows migration 092's targeted pattern. **Paste-order caveat:** 104 must be pasted after 098; re-pasting 098 later would drop these types — 104's self-check block asserts the 16-type list.

## 6. Flows

### 6.1 Daily — link at issue time

1. Supervisor presses **Terbitkan & Simpan** as today. `issueClientReport` inserts the report row (unchanged).
2. The client then calls `report-progress-analyze` with `{stage: 'link', report_id}`. The function writes `client_report_lines` rows in `SUGGESTED` status (or with all-null suggestion when the model returns none).
3. The builder shows the issued report's lines with a chip under each: `T1-002 · Bekisting · Lanjut` (+ confidence). One button **Konfirmasi semua** confirms every `high`/`medium` suggestion; a tap on a chip opens the row/stage/state picker; **Tidak terkait** dismisses. Confirming is optional and can be done later from the report list.
4. If the function fails or times out, the report stays issued; lines are created empty; a retry button appears. Nothing about the client PDF depends on this step.

### 6.2 Weekly — claim, submit, verify

1. Every Monday (and on demand) the supervisor opens **Klaim Progres Minggu Lalu** on the Laporan screen. If the week has confirmed lines, **Isi dari laporan** calls the function with `{stage: 'prefill', claim_id}`; otherwise the form opens with `prev_verified` copied into `claimed_pct`.
2. The form lists work-area rows (live `boq_items`, ordered by `sort_order`) with one slider/number per weight-bearing stage, the previous verified value, the AI proposal with its quotes, and the row's linked lines and photos as evidence. Rows with no activity this week are collapsed.
3. **Kirim** → status `SUBMITTED`, flags computed (§9), notification to estimators.
4. Estimator opens **Verifikasi Klaim Progres** (office), sees each line with claimed vs previous, evidence, flags, and the weights (with `source`). They can edit any `verified_pct`, **Kembalikan** with a note (→ `RETURNED`, supervisor edits and resubmits), or **Verifikasi**.
5. `verify_progress_claim(p_claim_id, p_lines jsonb, p_note text)` — SECURITY DEFINER, caller must be `estimator` or `admin` (principal read-only), claim must be `SUBMITTED`. Per line: validate `verified_pct` ∈ [0,100] per stage; `row_pct = Σ weights[s] × verified_pct[s] / 100`; `delta_quantity = boq.planned × (row_pct_new − row_pct_prev)`.
   - `delta_quantity > 0`: insert one `progress_entries` row (`reported_by = claim.submitted_by`, `quantity = delta`, `unit = boq.unit`, `work_status = COMPLETE` when `row_pct_new = 100` else `IN_PROGRESS`, `note = 'Klaim progres minggu <week_start> · diverifikasi'`, `location = null`).
   - `delta_quantity < 0` (regression): allowed only with a non-empty per-line `regress_reason`; no entry is inserted (`progress_entries.quantity` is `> 0` by CHECK); `boq_items.installed` is set directly and an `activity_log` row records it.
   - Then `boq_items.installed = planned × row_pct_new`, `progress = round(row_pct_new × 100)`, freeze `weights_snapshot`, set claim `VERIFIED`, notify the submitter. All in one transaction.
6. `tools/derivation.ts syncBoqInstalledFromDerived` (client-side cache rebuild from `progress_entries`) must not undo a regression: it skips rows whose latest `VERIFIED` claim line is at or after the row's last `progress_entries` row (a regression inserts no entry, so the claim is always newer there). `progressMath.ts`'s documented cached-vs-derived divergence note is updated to name this rule.

### 6.3 What the principal sees

Home: overall progress (unchanged math), a card **Klaim minggu ini** with status per project (Belum ada / Menunggu verifikasi / Terverifikasi + date) and the count of `reference`-weighted rows behind the number. Nothing to approve.

## 7. Stage weights — derived from the BoQ

### 7.1 Full-RAB projects (published through `parseBoqV2`, `boq_items.cost_breakdown` populated)

Per published row, from the normalizer's component groups on the row's Breakdown (or, equivalently, the RAB columns):

```
bekisting_rp  = Σ (vol × V × W)          -- material bekisting
pembesian_rp  = Σ (vol × Z × AA)         -- rebar incl. waste, decking, bendrat
beton_rp      = Σ (vol × R)              -- readymix material
upah_alat_rp  = Σ (vol × (S + T))        -- borongan cor+besi+bekisting + peralatan
```

`upah_alat_rp` is not split by stage in any RAB seen (AAL-5, PD3, Citraland, Nusa, Ernawati all carry one borongan line), so it is apportioned across the three stages in proportion to their material Rp. Weights = normalized shares of `(bekisting, pembesian, beton)` after apportioning. `basis` stores the four Rp figures. Rows that are not concrete (galian, urugan, pasangan bata, plumbing, baja) get `{"SINGLE": 1}`.

Worked example, Citraland RAB (A) row 134 (Balok lt 2, 2.33 m³): bekisting 15 × 349,063 = 5,235,945; pembesian 266 × 12,049 = 3,205,034; beton 1,299,533; upah+alat 1,840,000 → shares before apportioning 53.8 / 32.9 / 13.3 → weights `{"BEKISTING": 0.54, "PEMBESIAN": 0.33, "PENGECORAN": 0.13}`.

### 7.2 Simplified-input projects (`SANO Input Tier 1`, no costs)

The `SANO Input Tier 1` sheet gains three optional columns to the right of `Mutu Beton`, detected by header text like the `Mutu Beton` column (spec 2026-07-14 §3.1.1): **`Bobot Bekisting`**, **`Bobot Pembesian`**, **`Bobot Beton`**, each the RAB subtotal in Rp (or a percentage; both accepted, Rp preferred). The estimator already aggregates each work area from the RAB when filling volumes; copying three subtotals is the same motion. The parser stores them as `source = 'input_sheet'` at publish. A row with the three columns blank publishes with **no weight row**, and the app applies the reference profile below at first use, flagged.

### 7.3 Reference profile (fallback, `source = 'reference'`)

Computed once, by script, from the RABs in `assets/BOQ/` that `parseBoqV2` reconciles (at minimum Citraland K2-7 and Pakuwon AAL-5; PD3, Nusa and Ernawati if their layouts reconcile) per element class — `KOLOM`, `BALOK_PLAT`, `DINDING`, `TANGGA`, `PILECAP_SLOOF_PLAT_DASAR`, `BOREDPILE`, `LAINNYA` — using §7.1 on every matching row and averaging by volume. Stored as a checked-in JSON (`tools/progressClaims/referenceStageWeights.json`) with the derivation script and the per-RAB numbers in a jest golden, so the profile is reproducible, not typed. A row's class is inferred from `sub_chapter` / `label` by a pure classifier with tests; unknown → `LAINNYA` → `{"SINGLE": 1}`.

### 7.4 Adjustment in-app (`source = 'manual'`)

Estimator screen **Bobot Tahapan** (office, per project): a table of rows × three stages, editable, must sum to 100, shows `source` and `basis`, one-tap **Kembalikan ke RAB/referensi**. Every screen that renders a row percent derived from `reference` weights shows a small "bobot referensi" marker until the estimator confirms or edits (which flips `source` to `manual`).

### 7.5 Row percent and overall

`row_pct = Σ_s weights[s] × pct[s] / 100`, a fraction in [0, 1]; `installed = planned × row_pct`; `boq_items.progress = round(row_pct × 100)`. Overall project progress stays volume-weighted across rows (`computeOverallProgress`) because simplified-input rows carry no price. This is a known limitation, documented in `progressMath.ts`; a value-weighted overall is a later change once `client_unit_price` is populated for every row.

## 8. AI service

`supabase/functions/report-progress-analyze/` — a copy of the `site-event-analyze` skeleton:

- **Trust order** (identical to `index.ts:191-244` there): CORS → POST only → secrets present → caller JWT → read the report/claim **through the caller's RLS** (404 if invisible) → `is_project_member` or `is_office_role` (403) → only then the service-role client.
- **Model:** `REPORT_PROGRESS_MODEL`, default `claude-opus-5`; adaptive thinking (default on Opus 5), `output_config.effort: 'high'`; one forced tool call per stage (`tool_choice: {type: 'tool', name}`), images as base64 blocks before the text block. If the model is ever switched to the Fable family, forced `tool_choice` returns 400 there — switch to `auto` + `strict: true` on the tool; the validator is the safety net either way.
- **`link` input:** the report's `updates[]` (index, area, note), up to 8 photos ≤ 3.5 MB each (hero first), the project's live rows (`code`, `label`, `chapter`, `sub_chapter`, `unit`, `planned`), the stage/activity vocabulary, and the last 14 days of CONFIRMED lines as continuity context. **Output per line:** `{line_index, boq_item_code | null, stage | null, activity_state, confidence, quote}`; `quote` must be a literal substring of that line's `line_text`; unknown codes → null with `confidence: 'low'`.
- **`prefill` input:** the week's CONFIRMED lines grouped by row, `prev_verified`, weights (with source), the hero photo of each report in the week (≤ 7), and the same continuity context. **Output per row per weight-bearing stage:** `{pct, confidence, quotes[], note}`; validator clamps to `[prev_verified, 100]` (a proposal below the previous verified value is dropped to `prev_verified` and flagged, never silently accepted), requires ≥ 1 literal quote for any increase, and strips unknown keys.
- **Controls:** `DEADLINE_MS = 110_000`, retry only on 429/500/502/503/529, per-project daily cap `REPORT_PROGRESS_DAILY_CAP` (default 60) counted from `progress_ai_runs`, claim/release column on the target row to serialize concurrent runs, one `progress_ai_runs` row per call via a single `writeRun()`, `cost_usd = null` for any unpriced model (never a made-up number). `cost.ts` is shared with the site-event function (move to `supabase/functions/_shared/`).
- **Cost, measured shape:** a daily `link` ≈ 6 photos (≈ 10k tokens) + ≈ 4k text in, ≈ 1k out → ≈ $0.10 on Opus 5 ($5 / $25 per MTok); a weekly `prefill` ≈ 7 photos + 6k text, 2k out → ≈ $0.14. Per project per month (≈ 25 links + 4 prefills) ≈ $3. Economy is not a constraint; quality is, hence Opus. OpenAI is not used (it exists in the codebase only for audio transcription).
- **Back-linking existing reports:** an admin-only action (script under `tmp/` first, office button later) runs `link` for every issued report without lines, oldest first, respecting the cap. Citraland's 19 + Gading Serpong's 16 ≈ $3 once, and gives the first weekly claim its history.

## 9. Evidence cross-checks (advisory flags)

Computed by a pure module `tools/progressClaims/flags.ts` at submit and at verify, stored in `progress_claim_lines.flags`, shown as chips to the estimator. None block.

| flag | rule |
|---|---|
| `STAGE_ORDER` | `PENGECORAN` claimed above `PEMBESIAN` or `BEKISTING` for the same row |
| `BIG_JUMP` | any stage rises > 40 points in one week |
| `NO_PHOTO` | row has an increase and no linked photo this week |
| `NO_LINES` | row has an increase and no CONFIRMED line this week |
| `MATERIAL_SHORT` | readymix received for the row's work group < 70 % of claimed poured m³; for site-mix projects the same test on cement, converting through the row's `project_material_master_lines` coefficient when one exists — only when the project has receipts; otherwise `MATERIAL_NA` |
| `OPNAME_VARIANCE` | `v_opname_progress_reconciliation.variance_flag` ∈ (WARNING, HIGH) for the row |
| `REFERENCE_WEIGHTS` | the row's weights are `reference` |
| `AI_LOW_CONFIDENCE` | the accepted claimed value equals an AI proposal marked `low` |

## 10. UI touch-points

Supervisor (`workflows/`): builder gets the chip row per line after issue (`ClientReportBuilderScreen.tsx`) and a **Konfirmasi tautan** entry on each report in the list; Laporan screen gets the **Klaim Progres** card → `ProgressClaimScreen.tsx` (form, evidence drawer per row, submit). Estimator (`office/`): `ProgressClaimVerifyScreen.tsx` reachable from the Laporan tab (not the crowded Approval tab) with a pending count badge; `StageWeightsScreen.tsx` under Baseline. Principal: the Home card (§6.3). Inline forms expand under the tapped row, never in modals (project convention).

## 11. Security / RLS

- `client_report_lines`: select for project members + office roles; insert/update by the edge function (service role) and by project members for `status`, `boq_item_id`, `stage`, `activity_state`, `confirmed_*` only (trigger rejects writes to `ai_*` from non-service roles, as `site_events_ai_columns_service_only()` does).
- `progress_claims` / `_lines`: select members + office; insert/update DRAFT by members; `submit_progress_claim`, `return_progress_claim`, `verify_progress_claim` are RPCs; human fields on a non-DRAFT claim are RPC-only (trigger like `site_events_human_fields_rpc_only()`).
- `boq_stage_weights`: select members + office; write estimator/admin only.
- No API key ever ships to the app; secrets stay in edge-function secrets.

## 12. Failure modes

- Link run fails → report issued, lines empty, retry available; the weekly form still works from `prev_verified`.
- Prefill fails → form opens with previous values; the estimator sees `AI: tidak tersedia` instead of proposals.
- Verify RPC fails mid-way → transaction rolls back; claim stays `SUBMITTED`; error copy mapped like `mapSiteEventRpcError`.
- Weights edited after submit but before verify → verify uses the weights at verify time and freezes them; the diff is shown to the estimator.
- Report re-issued after its lines were confirmed → §5.1 carry-forward.
- A BoQ re-publish supersedes rows → claims on superseded rows are read-only history; the next claim lists the new rows with `prev_verified` = 0 and a `REPUBLISHED` chip; weights for new rows re-derive.

## 13. Testing

- Pure modules with jest: `stageMath.ts` (row percent, delta, regression), `flags.ts`, `photoPathFromSignedUrl`, the element classifier, the reference-profile derivation (golden per RAB), the `SANO Input` weight columns parser.
- Edge function: validator tests (`validate.test.ts` twin: literal quotes, clamping, unknown keys), prompt snapshot, cost table.
- Migrations: self-check blocks (constraint lists, RPC existence) in the 102–104 files, following the 088/092 pattern; a 31-mutation style guard harness for `verify_progress_claim` (no write without SUBMITTED, no negative delta without reason, transaction atomicity).
- Integration (skippable without creds): issue a report on a disposable project → link → confirm → prefill → submit → verify → `computeOverallProgress` moves by the expected amount.

## 14. Rollout and preconditions

Three plans, in order, each its own worktree and PR:

- **Plan A — daily linking and photo paths.** Migration 102, `report-progress-analyze` with `link` only, builder chips, photo `path`, back-linking script. Value on day one: photos stop expiring; every report line is attributed to a work area.
- **Plan B — weekly claim and verification.** Migrations 103–104, weights derivation for both publish paths, `prefill`, the two screens, RPCs, notifications, `derivation.ts` rule. Value: progress is finally non-zero and verified.
- **Plan C — evidence cross-checks.** `flags.ts`, material and opname joins, principal card details.

Preconditions: Gading Serpong needs a published BoQ (the estimator prepares a `SANO Input` workbook, ideally with the three weight columns). Citraland's rows carry no weights today; the estimator either re-publishes with the columns or accepts the reference profile and adjusts in-app. Material corroboration on Citraland is site-mix (cement/sand/aggregate), so `MATERIAL_SHORT` uses the cement proxy there, and only once ordering runs through the app.

## 15. Open items

- Whether the estimator wants the weight columns on the `SANO Input Tier 1` sheet or a separate `SANO Input Bobot` sheet — the parser supports both header locations cheaply; default is the same sheet.
- Whether `PROGRESS_CLAIM_SUBMITTED` should also reach the principal as an FYI. Default: no; the Home card shows status.

## 16. Amendment 2026-09-13 — Tambah progres becomes the stage claim entry

Decided with the owner after the Plan A plan was written.

**Finding.** The supervisor's Progres tab ("Tambah progres", `workflows/screens/ProgresScreen.tsx`) is a quantity-per-row form that writes `progress_entries` directly, unreviewed. Nobody used it: zero entries on both live projects. On Citraland its picker works (16 simplified rows, one work group each via `buildWorkGroups`; supervisor Hendy is assigned). On Gading Serpong it is empty because no BoQ has been published for that project at all — a precondition, not a code defect.

**Decision.** The Progres tab's Tambah progres becomes the per-work-area stage claim entry of §6.2:

- The supervisor picks a work area, sees each weight-bearing stage with its last verified percent, sets today's claimed percent, and attaches photos. That saves into the CURRENT week's `progress_claims` row (status DRAFT, created on first use for the week) as the line for that row: `claimed_pct` per stage, photo references appended to `evidence.photo_refs`. Re-opening the same work area the same week edits the same line.
- The daily Blueprint links (§6.1) and the weekly AI prefill land in the same draft as suggestions and evidence; the supervisor's own figures are never overwritten by the model — the prefill only fills stages the supervisor has not touched this week and marks its proposals as AI.
- The quantity form and its direct `progress_entries` write are removed. The only writer of progress remains `verify_progress_claim` (§6.2 step 5). Rows with `{"SINGLE": 1}` weights (non-concrete rows on full-RAB projects) show one percent instead of three stages.
- Kirim (submit) stays a weekly action, reachable from the Progres tab's claim overview and from Laporan; the overview lists every work area with verified, claimed-this-week, and the count of linked lines and photos behind it.

**Plan impact.** Plan B's claim form is built once and mounted in two places (Progres tab per work area, Laporan for the weekly overview and Kirim); the Progres screen's `progress` sub-module is replaced rather than extended. Plan A is unchanged.

## 17. Amendment 2026-09-14 — weights from the RAB workbooks, numbering, revisions

Findings from the live database and a spike over the five RAB workbooks in `assets/BOQ/` (Citraland K2-7, Pakuwon AAL-5, Pakuwon PD3, Nusa Golf I4, Ernawati).

**The database cannot supply stage weights.** `boq_items.cost_breakdown` exists only on the seed projects and splits by cost category (`labor`, `material`, `equipment`, `prelim`, `subkon`), not by stage. Both live projects are simplified-input (Citraland 16 `T1-` rows, Bukit Darmo 42) with no costs or prices. §7.1 therefore applies only once a full-RAB publish persists per-row stage components; until then weights come from §7.2–§7.4.

**Reference profile method (§7.3, now specified).**

- Per concrete row of `RAB (A)` / `RAB (B)`: bekisting Rp = volume × V × W, pembesian Rp = volume × Z × AA, pengecoran Rp = volume × R; the single borongan line S + T is apportioned across the three in proportion to their material Rp.
- A row feeds the profile only when all three stages are priced on that row.
- Each workbook counts once: the profile is the mean of per-workbook stage shares, renormalized, so one large workbook cannot dominate.
- Ground floor, basement-first: when any chapter title names a basement (basement, bunker, Lt. B1), only those chapters are ground, because Lantai 1 above a basement is a suspended slab; otherwise the chapters naming Lantai 1, dasar or bawah. Chapters naming pondasi are always ground. Lean concrete (lantai kerja) priced in the earthworks chapter is its own evidence-only class and never decides the ground chapter. The same rule classifies a project's live work areas from the floor part of `<lantai> ; <elemen>`.

**Result** (bekisting / pembesian / pengecoran; spread across workbooks in brackets):

| Class | Bekisting | Pembesian | Pengecoran | Workbooks |
|---|---|---|---|---|
| `BALOK_PLAT` | 36.8% | 38.0% (36–42) | 25.2% | 5 |
| `KOLOM` | 32.6% | 48.6% (43–55) | 18.8% | 5 |
| `DINDING` | 31.2% | 35.6% | 33.2% | 5 |
| `PILECAP_SLOOF_PLAT_DASAR` | 13.1% | 47.6% (43–50) | 39.3% | 5 |

- `LAINNYA` (3 workbooks, bekisting 32–56%) is too heterogeneous to use; those rows default to `{"SINGLE": 1}`.
- `TANGGA`, `BOREDPILE` and strauss pile are package-priced (per m³ or per titik) in every workbook, so they have no stage split and default to `{"SINGLE": 1}` unless the estimator enters weights.
- Component-level workbooks (Ernawati lists "- Besi D13" in kg under each poer) are excluded, not summed; the tight spread above shows the profile is stable without them.

**Classifier coverage on live labels** (`<lantai> ; <elemen>`): Citraland 16 of 16 rows classified, including `BOREDPILE`; Bukit Darmo 38 of 42, the rest (tandon air bawah, reflecting pool, two planter boxes) fall to `LAINNYA`.

**Numbering.** Plan A's migration is 102 (main's PR #67 took 101 for gate labels). Plan B uses 103 for `boq_stage_weights` and 104 for claims and notifications. §5.5's type list must be re-derived from the latest `notifications_type_check` on main at planning time, not taken from 098.

**Revisions.** A re-issued report gets fresh line rows (the §5.1 carry-forward was not built in Plan A). Claim aggregation (§6.2) and the prefill read CONFIRMED lines from the latest revision of each `report_no` only, so an older revision never counts twice.

**Screen size.** Before Plan B adds claim entry points, `workflows/screens/ClientReportBuilderScreen.tsx` is split into a `useReportLinking` hook, a history card and an issued-report view.

## 18. Amendment 2026-09-14 — Plan B1 as built

Settled while writing and rehearsing Plan B1 (`docs/superpowers/plans/2026-09-14-report-driven-progress-plan-b.md`). Where this section and §5.4, §6.2 or §11 disagree, this section wins. Two independent reviews (database and UI) followed the first build; their confirmed findings are folded in below.

**Split.** Plan B ships in two parts. B1 (this amendment): stage weights, Tambah progres as the stage claim, weekly submit, estimator verification, notifications and the principal card, with no AI. B2: the `prefill` stage, the SANO Input weight columns, weights derived from AHS lines, and the ClientReportBuilderScreen split (§17), since B2 adds the first claim entry point there. Plan C keeps the cross-check flags.

**Weights seed themselves, from a class.** A row without weights cannot be claimed. When a supervisor, estimator or admin opens the claim screen, rows without weights receive the reference profile of their work-area class through `seed_reference_stage_weights`. The client sends only the class; the numbers live in migration 103 and a static test pins them to `referenceStageWeights.data.ts`. Seeding never overwrites a row. Estimators and admins edit, switch to one stage, or reset to the reference in Baseline › Bobot Tahapan. Once a row has a VERIFIED claim line, its weights can change value but not shape (one stage versus three). An open line is re-checked against the current weights at submit and verify instead, so an estimator can still correct a shape a supervisor seeded.

**One claim in progress per project** replaces `unique (project_id, week_start)`: a partial unique index over DRAFT, SUBMITTED and RETURNED. `week_start` is the WIB Monday of the week the claim opened, and a second claim may open in the same week once the first is verified.

**Every write is an RPC.** `progress_claims` and `progress_claim_lines` have read policies only. `save_progress_claim_line`, `remove_progress_claim_line`, `submit_progress_claim`, `return_progress_claim` and `verify_progress_claim` re-check membership, role, claim state, weights, planned volume, percents, photo paths and regressions, and raise code-prefixed refusals mapped to Indonesian copy in `claimRules.ts`. Every progress RPC needs a signed-in person; the service role can neither claim nor verify.

**Separation of duties.** Supervisors, estimators and admins may save and submit; estimators and admins verify or return; whoever submitted a claim or filled any of its lines cannot verify it (`CLAIM_SELF_VERIFY`). The principal reads.

**Corrections are negative entries.** This replaces the direct `installed` write for regressions in §6.2 step 5 and the derivation rule in §6.2 step 6. `progress_entries.quantity` may now be negative but never zero. Per line, verification writes one entry of `planned × row fraction − Σ existing entries`, so a claimed row's entries always sum to `boq_items.installed`, and every reader of either agrees: the progress report, the client report's installed-as-of history and the screens. A figure below the verified one needs a reason, at save and at verify. A lower quantity needs a reason even when no stage percent dropped, because the weights or the planned volume changed since the last verification. When `boq_items.installed` differs from the entries (legacy data), verification follows the entries and logs the difference to `activity_log`. `syncBoqInstalledFromDerived` is removed; it had no caller once the quantity form went.

**Row fraction** is divided by the weights' own sum, so weights of 0.333 / 0.333 / 0.333 still reach 100 % when every stage is complete (§7.5). `boq_items.progress` keeps one decimal.

**Progress has one writer.** Migration 104 drops the supervisor insert policies on `progress_entries` and `progress_photos` (002) and `boq_items_assigned_progress_update` (059); turns 036's office FOR ALL policies on `progress_entries` and `progress_photos` into read-only ones; revokes 002's `sync_boq_progress()`; and adds a trigger that refuses any change to `boq_items.installed` or `progress` unless `verify_progress_claim` marked its own transaction (`sano.progress_writer`). Office roles still edit every other `boq_items` column, which publishing needs, and a session without a JWT (the Dashboard SQL editor) stays trusted. Re-pasting 036 after 104 restores the office write policies: re-paste 104 afterwards.

**Evidence in B1.** Claim photos are storage paths under `progress/<project id>/`, at most 12 per line, replaced as a set on each save; the app asks for at least one photo when a row's figure rises. Verification copies a line's photos to `progress_photos` for a positive entry. The overview counts confirmed Blueprint lines per row since the claim's week start, from the latest revision of each report only. Two security-invoker views, `progress_claim_latest_verified` and `progress_entry_totals`, give the screens one row per BoQ item, so a long claim history never meets PostgREST's row cap; previews compute the quantity exactly as verification will, from the entry totals.

**Notifications.** `PROGRESS_CLAIM_SUBMITTED` goes to the project's estimators other than the submitter (its admins when there are none, and its principals when there are neither, because notifications are readable only by project members and a principal can assign a verifier) and deeplinks `ProgressClaimVerify` (office Reports › Klaim). `PROGRESS_CLAIM_RETURNED` and `PROGRESS_CLAIM_VERIFIED` go to the submitter and deeplink `ProgressClaim` (the supervisor's Progres tab; Reports on an office navigator). The type list is 098's thirteen plus these three.

**Entry points.** Progres tab: Tambah progres opens the claim panel, and "Tambah progres untuk item ini" opens that row. Laporan: a Klaim Progres Mingguan card opens the same panel, without a fifth tab, so the tab row cannot overflow at 360 dp. Office Reports: a Klaim tab with a pending badge; the principal sees it read-only. Baseline: Bobot Tahapan. Principal home: Klaim Progres Minggu Ini, next to Progres vs Jadwal. Route params apply once per navigation and reload the claim panels and the Klaim badge, and the app keeps its navigator mounted during a refresh or a project switch, so a notification tap lands on the claim instead of the first tab.

**Audit.** The "no progress in 7 days" anomaly counts claim lines created and draft or returned claims edited or submitted in the window, never verification activity, and raises nothing when the tables cannot be read.

**Rehearsal.** `supabase/tests/progress_claims_rehearsal/run.sh` applies 001–102 to a disposable local `supabase/postgres` container, pastes 103 and 104 twice, and runs 153 behaviour checks as a supervisor, two estimators, an admin, the principal and an outsider, including every confirmed review finding.
