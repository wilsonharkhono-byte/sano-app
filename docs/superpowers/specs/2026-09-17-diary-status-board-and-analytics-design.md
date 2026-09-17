# Progress from the Diary: Status Board and Project Analytics — Design

Date: 2026-09-17. Follows `2026-09-13-report-driven-progress-design.md` (Plan A and
Plan B1 are live). This replaces that spec's AI `prefill` stage (§6.2 step 1, §8)
and its Plan B2.

## 1. Why

Supervisors file a Blueprint report almost every day (Bukit Darmo 19, Citraland 22,
Gading Serpong 20 on 2026-09-17). The AI links each report line to a work area, a
stage and a state (Mulai / Lanjut / Selesai), and a person confirms it. Those links
reach nothing that moves progress: the weekly claim still asks the supervisor to type
stage percentages by hand.

The owner rejected an AI that estimates percentages from photos and text: a made-up
number. The diary does carry one honest signal: the **status of each stage** per work
area, with a date. This design turns that status into progress with a fixed rule, and
adds graphs that correlate the dated data the projects already produce.

Decisions taken with the owner on 2026-09-17:

1. No AI-estimated percentage anywhere. The AI reads and classifies; people confirm.
2. **Status credit 50/100**: a stage earns 50 % of its weight while it runs and 100 %
   when it is finished.
3. The supervisor's weekly claim is a status board, pre-filled from the diary; an
   exact percentage stays optional.
4. Graphs live on the project Beranda of every role (supervisor, admin, estimator,
   principal), the same block with the same numbers for everyone.
5. The planned line is a typical S-curve between the project's start and end date.
6. All four analyses are built: S-curve, material vs progress, diary activity and
   crew, approval flow. A small editor sets the project dates.

## 2. Non-goals

- No AI call at claim time, and no `prefill` stage in `report-progress-analyze`.
- No database migration. Every read uses existing tables through RLS; project dates
  are written through the existing `projects_manager_update` policy (036).
- No stored evidence ids or stored flags: both are computed when a screen opens.
- No PO, receipt, opname, defect or weather analysis yet: the real projects have no
  such rows. The approval-flow module is shaped so PO and delivery lead times can be
  added when that data exists.

## 3. Truth-correctness rules

- A number on screen is either typed or tapped by a person, verified by the estimator,
  or computed from recorded rows by a rule stated on the card. Nothing is estimated.
- Every chart names its source and how many records it used. With too little data it
  says what is missing and draws nothing.
- The planned S-curve is labelled "Rencana (asumsi kurva-S)". A project without an end
  date shows "Isi tanggal selesai rencana", never an invented curve.
- The projection states the pace and the window it used, needs at least two verified
  points, and otherwise says "Belum cukup data".
- Diary lines sorted by keyword (no confirmed link yet) are labelled "perkiraan kata
  kunci" and never feed the status board.

## 4. Part 1 — Status board

### 4.1 Status and credit

`tools/progressClaims/statusCredit.ts` (pure):

- `StageStatus = 'BELUM' | 'BERJALAN' | 'SELESAI'`; credit 0 / 50 / 100.
- `statusOfPct(pct)`: 0 → BELUM, 100 → SELESAI, anything between → BERJALAN, with
  `exact: true` when the figure is not 50 (someone typed it).
- `pctOfStatus(status)`: 0 / 50 / 100.

The board writes those figures into the existing `claimed_pct` per stage. Row and
project percentages, verification and corrections work exactly as in Plan B1.

### 4.2 What the diary says

`tools/progressClaims/diaryEvidence.ts` (pure) and `listDiaryLines(projectId)` in
`claims.ts`:

- Input: CONFIRMED `client_report_lines` of the project, joined to their report
  (`report_no`, `revision`, `period_end`), latest revision of each `report_no` only
  (spec 2026-09-13 §17), paged.
- Window per work area: lines whose report `period_end` is after the area's last
  verification date (`progress_claim_latest_verified.verified_at`); all lines when it
  was never verified. A week without a claim is never lost, and nothing verified is
  counted again.
- Per work area and weight-bearing stage, the **latest** line by report date decides:
  MULAI or LANJUT → BERJALAN, SELESAI → SELESAI. A later "Lanjut" after a "Selesai"
  therefore reads BERJALAN (rework), but see the floor below.
- A row with `{"SINGLE": 1}` weights takes the state of its latest confirmed line,
  whatever that line's stage.
- Lines on stages without weight (galian, curing, bongkar bekisting, ...) are listed
  as context and propose nothing.
- Floor: a proposal is never below the row's verified status for that stage.

### 4.3 Supervisor screens

- `StageClaimForm`: each stage shows three chips, Belum / Berjalan / Selesai, as the
  primary input. "Angka persis" reveals today's percent field for that stage; a typed
  figure shows as "Berjalan · 35 %". The preview, reason and save rules are unchanged.
- The form opens pre-filled with: the saved claim line, else the diary proposal, else
  the verified figures. A pre-fill from the diary is announced in the form ("Dari
  laporan #14: Bekisting selesai · Pembesian berjalan") and nothing is saved before
  Simpan.
- `ProgressClaimPanel`: a row with diary lines shows "N baris laporan" as today plus
  the proposed status summary; rows with a proposal that differs from what is verified
  sort first under a "Ada kegiatan di laporan" heading.
- Evidence rule on a phone: a rise needs at least one photo **or** one confirmed diary
  line for that work area in the window. The daily report counts.

### 4.4 Estimator screen

`ProgressClaimVerifyPanel` shows, under each claimed row:

- The diary lines in the window: date, report number, text, stage and state.
- Advisory chips from `tools/progressClaims/claimFlags.ts` (pure), none blocking:
  `NO_EVIDENCE` (rise with no diary line and no photo), `STAGE_ORDER` (Pengecoran
  above Pembesian or Bekisting), `DIARY_MISMATCH` (diary and claim disagree on a
  stage's status), `REFERENCE_WEIGHTS`, and `MATERIAL_BEHIND` once Part 2's coverage
  exists (claimed Pembesian credit above the share of planned besi ever requested for
  that work area).
- The "Cek" inputs stay numeric, so the estimator can verify an exact figure.

## 5. Part 2 — Analitik Proyek on every Beranda

### 5.1 Placement

One component, `workflows/components/analytics/ProjectAnalytics.tsx`, mounted on
`BerandaScreen` (supervisor), `OfficeHomeScreen` (admin, estimator) and
`PrincipalHomeScreen` (where the S-curve card replaces the Progres vs Jadwal bar).
Same cards, same numbers. The S-curve card is always open; the other three expand on
tap, start collapsed on narrow screens, and load their data when first opened. Reads
go through RLS, so each role sees the projects it already can.

### 5.2 Charts

Small SVG primitives under `workflows/components/charts/` on the installed
`react-native-svg` (no new dependency; web and Android): line chart, stacked bars,
bars, meter. One y-axis per chart; series differ by colour and dash.

### 5.3 The four analyses (pure modules under `tools/analytics/`)

1. **`sCurve.ts` — Kurva-S.** Plan: `100 × (3t² − 2t³)` with `t` the elapsed share of
   start→end. Actual: `progress_entries` summed per work area by week, capped at the
   area's planned volume, divided by total planned (the `computeOverallProgress`
   formula, as of each week). Projection: mean weekly gain over the last four weeks
   that have a verified change, extended to 100 %, reported as a date and as weeks
   from the planned end. A crew strip (average tukang per report day, per week) sits
   underneath.
2. **`materialCoverage.ts` — Material vs progres.** Per material group (besi, semen,
   readymix, bekisting sheet, pasangan) and per work area: quantity requested and
   approved (`material_request_lines`, allocations) against the plan
   (`project_material_master_lines`). Lag: days from a request to the first diary line
   of the matching work type. Flags: "material diminta, pekerjaan belum mulai" after
   14 days without a diary mention; "progres melebihi material" (feeds
   `MATERIAL_BEHIND`).
3. **`diaryActivity.ts` — Aktivitas lapangan.** Work mix per week from confirmed
   links' stages (keyword fallback for unlinked lines, labelled), crew trend, days
   without a report, and tukang-days per point of verified progress once progress
   exists.
4. **`approvalFlow.ts` — Alur persetujuan.** Days from `created_at` to `reviewed_at`
   per request, pending requests by age, rejected share.

`tools/analytics/data.ts` holds the reads (paged with `fetchAllPaged`), one function
per card so a collapsed card costs nothing.

### 5.4 Project dates

`workflows/components/analytics/ProjectDatesEditor.tsx`: start and end date, inline
under the S-curve card (project convention: no modal), shown to admin and principal
only, saved with a plain `projects` update (policy `projects_manager_update`).
Validation: both ISO dates, end after start.

## 6. Failure modes

- Diary lines unreadable (for example migration 102 missing): the board opens from the
  verified figures and says the diary could not be read. Claims still work.
- Any analytics read fails: that card shows the error with "Coba lagi"; the others and
  the rest of Beranda are unaffected.
- A re-issued report: only its latest revision counts, as everywhere else.

## 7. Testing

- Pure modules: jest, including week bucketing in WIB, the verification window, the
  latest-line rule, the floor, S-curve end points, projection guards, coverage
  arithmetic, lag, and flag rules.
- Components: render tests for the chips, the pre-fill notice, the evidence rule, the
  verify evidence and chips, each card's empty / error / data states, and the dates
  editor's role gate and validation.
- `npx tsc --noEmit`, the full jest run, and `npx expo export --platform web`.
- No SQL changes, so no rehearsal run is needed.

## 8. Rollout

Two pull requests: Part 1 (status board, verify evidence, flags), then Part 2
(analytics, dates editor, `MATERIAL_BEHIND`). JS only: web deploys from main, phones
get `eas update --branch preview` (runtime 3.1.0). The owner enters the project dates
after Part 2 ships.
