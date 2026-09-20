# Material vs Progres: the Procurement–Installation Chart — Design

Date: 2026-09-20. Follows `2026-09-17-diary-status-board-and-analytics-design.md`
(live in PR #71). This replaces that spec's §5.3.2 card ("Material vs progres" meters)
with a chart that relates, per material group, what was requested and approved to what
the daily reports and the verified claims say is installed. The approved mockup is
`2026-09-20-material-vs-progress-chart-mockup.html` (open it in a browser; the chips,
legend switches and the expander work; installed and diary figures in it are
illustrative, the besi requests and approvals are Bukit Darmo's real ones).

## 1. Why

The owner asked for a graph relating the type of work, the material ordered and the
progression of that work, and for a "smart relation" between them. The literature
(earned value, quantity-based progress, procurement vs installation S-curves, material
reconciliation, days-of-supply) reduces to a small set of cumulative curves per material
whose vertical gap is stock, whose horizontal gap is lead, and whose slopes are pace.
The BoQ recipe is the bridge: it says how much of each material every work area needs,
so a verified stage percentage becomes a material quantity without estimating anything.
Statistical lag detection (cross-correlation, Granger) needs 30+ paired periods and is
out of scope; a villa project has 5–15 weeks.

Decisions taken with the owner on 2026-09-18 and 2026-09-20:

1. The graph answers the lead/lag question first: material against the work it feeds.
2. One chain per material group: besi (Struktur, kg) → Pembesian; kayu & bekisting
   (lbr) → Bekisting; material beton (zak / m³) → Pengecoran; dinding (pcs) → Pasangan.
   Only groups with a plan in the published BoQ get a chip.
3. The progress implied by the daily reports is drawn too, labelled unverified, with the
   status board's rule (Berjalan 50 / Selesai 100).
4. Main view: a radial snapshot of this week (mockup C, revised). Detail: the weekly
   line chart with the stock ribbon, the lead bracket and the cover run (mockup B), opened
   inline under the radial. Series and groups can be switched on and off.
5. No dashes in the radial. Requests still waiting for a decision are a lighter tint of
   the approved ring, not a separate dashed ring. In the line chart only the projection is
   dotted.
6. The small-multiples compare view (mockup D) is not built; work types are compared by
   switching chips. The radial's sparkline (mockup C) is dropped; the detail chart
   replaces it.

## 2. Non-goals

- No database migration and no new table. Every read uses existing tables through RLS.
- No deliveries. The real projects record no receipts, so "disetujui" is the upper bound
  of material on site. When receipts exist, a "diterima" series slots in between
  Disetujui and Terpasang without changing the rules below.
- No per-area flowline (line of balance), no cross-correlation or Granger statistics, no
  learning curves. These need data the projects do not have yet.
- No change to the claim flow, to `MATERIAL_BEHIND`, or to the S-curve card.

## 3. Truth-correctness rules

- Every figure is arithmetic on recorded rows and the published BoQ: material requests,
  their decisions, confirmed report lines, verified claim lines, and
  `project_material_master_lines`. Nothing is estimated.
- Each series names its rule in the legend or the hint. The diary series is labelled
  "belum diverifikasi" wherever it appears.
- A relation number that cannot be computed shows "—" and the reason ("belum ada progres
  terverifikasi", "belum ada laju", "belum bisa dihitung", "tidak ada stok tersisa"). Every
  note names what it measured (the projection note states the window it used). Nothing is
  extrapolated from a single point.
- The projection needs verified progress in two different weeks, states its window, and
  extends the last four weeks' pace, as the S-curve does.
- A work area with no planned quantity of the group's material contributes nothing to
  the installed series, whatever the diary or the claim says about it.

## 4. The card

One card in `ProjectAnalytics`, section "Material vs Progres", on every Beranda
(supervisor, admin, estimator, principal). Top to bottom:

1. Title "Material vs progres", subtitle "Posisi minggu ini, % dari rencana BoQ".
2. Group chips, single-select, horizontally scrolling: "Besi (kg) → Pembesian",
   "Bekisting (lbr) → Bekisting", "Semen (zak) → Pengecoran", … The label is the group's
   short name (§5.1), the unit, and the work it feeds. The first chip (largest plan) is
   selected when the card opens.
3. **Radial** (`RadialRings`): three concentric rings, open at the bottom (270° sweep
   from lower-left, 0 % at the start, 100 % at the end, square caps, a track under each):
   - Outer, procurement: Disetujui in solid `CHART.procurement` from 0 to the approved
     share; then, after a 2px surface gap, Diminta-not-yet-decided as the same colour at
     40 % opacity, from the approved share to the requested share (absent when requested
     ≤ approved).
   - Middle, Terpasang (terverifikasi): `CHART.installed`, with an end dot (r 4) ringed
     in the surface colour.
   - Inner, Menurut laporan harian: `CHART.diary`, solid.
   - Hero figure in the centre: Terpasang this week ("13,0 %") over "terpasang,
     terverifikasi"; "—" over "belum ada progres terverifikasi" when nothing is verified.
   - Beneath: four value rows with a 10×10 swatch each — Diminta, Disetujui, Terpasang
     (terverifikasi), Menurut laporan harian (belum diverifikasi) — text in ink colours.
4. **Legend switches** for the four ring segments (swatch + label). Tapping hides that
   segment; a hidden item shows at 40 % opacity with a diagonal strike across its swatch.
   Switch state is kept while the card is mounted and applies to every group.
5. **Relation tiles** (wrap 2 + 1 on a phone, never truncated):
   - "Stok teoretis": `41,8 t` · "disetujui − terpasang · 17,9 poin".
   - "Jeda material → pekerjaan": `~4 minggu` · "disetujui sebelum terpasang".
   - "Cukup untuk": `~9 minggu` · "pada laju 2,05 poin/minggu".
   Nulls per §5.7 (four reasons).
6. Warnings, when they apply, as `a.warn` lines: "Pekerjaan melebihi material yang
   disetujui: terpasang 35 %, disetujui 20 %." and the existing "Material diminta N hari
   lalu, pembesian belum muncul di laporan harian (batas 14 hari)."
7. Ghost button "LIHAT TREN MINGGUAN" / "SEMBUNYIKAN TREN" toggling an inline **trend
   chart** (`LineChart`, extended): x = weeks, y = 0–100 % of plan, series Diminta
   (procurement colour at 40 % opacity, solid), Disetujui (solid), Terpasang (solid,
   dots with surface ring), Menurut laporan harian (`CHART.diary`, 1.5px solid), Proyeksi
   (installed colour, dotted "2 4"). A "minggu ini" rule. The ribbon between Disetujui and
   Terpasang filled with the procurement colour at 10 % and labelled "stok teoretis" once,
   where it is at least 16px tall. A bracket at this week's Terpasang level from the week
   Disetujui first reached it to this week, labelled "~4 minggu". A dotted run at the
   Disetujui level from this week to the week the projection meets it, labelled "cukup
   ~9 minggu". Its own legend switches; Diminta and Menurut laporan harian start off,
   the rest on. Direct end labels for Disetujui and Terpasang only.
8. The lag sentence from `buildMaterialCoverage` ("Diminta pertama 27 Jul; pembesian
   muncul di laporan harian 7 hari kemudian."), the caption "Rencana 233.700 kg per area
   kerja" — with " · 150 kg tanpa area kerja (tidak digambar)" appended when the group has
   plan lines without a work area — the notes "Belum pernah diminta: …" (planned groups
   without a request), "Rencana hanya di tingkat proyek: Plumbing (btg) 300 btg" (groups
   with no plan tied to a work area, which get no chip) and "Diminta tanpa rencana di BoQ
   terbit: …" (requested groups with no plan of either kind), and the hint:
   "Diminta dan disetujui dari permintaan material; terpasang dari klaim terverifikasi ×
   rencana material per area; laporan harian: Berjalan 50 · Selesai 100, belum
   diverifikasi. Permintaan yang ditolak tidak dihitung."

Colours are new theme tokens `CHART = { procurement: '#D9662B', installed: COLORS.info,
diary: '#1baf7a', track: COLORS.trackBg }`, validated with the dataviz palette checker on
the app surface (all-pairs CVD ΔE 8.9, normal-vision 25.9; the aqua sits at 2.71:1, so
its label is always present beside it). Text never wears a series colour. Accessibility:
the radial and the chart carry an `accessibilityLabel` that reads the four values;
legend switches are `accessibilityRole="switch"` with `checked`; chips are
`accessibilityRole="button"` with `selected`.

## 5. The numbers (`tools/analytics/materialChain.ts`, pure)

### 5.1 Groups

A group is a catalogue category plus a unit, as in `materialCoverage.ts` (assets,
Peralatan and custom materials without a catalogue id excluded). `CATEGORY_WORK` maps the group to a work type; a second map gives the claim stage
it feeds: Struktur → PEMBESIAN, Kayu & Bekisting → BEKISTING, Material Beton →
PENGECORAN; Dinding and Plumbing feed rows priced as a single stage. The short chip name
is the category's common word: Struktur → "Besi", Kayu & Bekisting → "Bekisting",
Material Beton → "Beton" (zak: "Semen", m³: "Readymix"), Dinding → "Bata", Plumbing →
"Pipa"; unmapped categories keep their name. A group gets a chip when its plan **tied to
work areas** is > 0. Plan lines without a work area (project-level lines from the Others
sheet) never enter the chart: their quantity is reported beside the caption as "tanpa area
kerja"; a group planned only that way is listed under "Rencana hanya di tingkat proyek" and
gets no chip; a requested group with no plan of either kind is listed under "Diminta tanpa
rencana".

### 5.2 Weeks

WIB Monday buckets (`weekBuckets.ts`). The axis runs from the earliest of: the first
request, the first confirmed diary line, the first verified claim; to the later of this
week and the projection's end (at most 16 weeks past this week). Every series is
cumulative and read at each week's end.

### 5.3 Diminta and Disetujui

For the group's request lines (`material_request_lines` joined to their header):

- Diminta(w) = Σ quantity of lines whose header `created_at` ≤ end of w and whose
  header status is not REJECTED.
- Disetujui(w) = Σ quantity of lines whose header status is APPROVED and whose decision
  time ≤ end of w; the decision time is `reviewed_at`, or `created_at` when the row
  predates `reviewed_at`.

Both divided by the group's plan tied to work areas (Σ_r q_r of §5.4), so every curve shares
one denominator. Approvals that also cover project-level material can exceed 100 %: the
figure is printed as it is and drawn at the end of the scale.

### 5.4 Terpasang (terverifikasi)

For every work area r with a planned quantity q_r of the group's material:

- pct_r(w) = the stage figure in `verified_pct` of the latest claim line for r whose
  claim is VERIFIED with `verified_at` ≤ end of w; the group's stage when the row's
  weights are split, `SINGLE` otherwise; 0 when no such line exists.
- Terpasang(w) = Σ_r q_r × pct_r(w) / 100, divided by Σ_r q_r.

Rows are keyed by `boq_item_id`; a claim line for a row not in the material master is
ignored. Stage weights come from `boq_stage_weights` (`listStageWeights`); a row without a
weights row is treated as `SINGLE`. A line is read with the weights it was verified under
(`progress_claim_lines.weights_snapshot`): a row now split whose line was claimed as a whole
takes the line's SINGLE figure; a row now single whose line carries stage figures combines
them with the snapshot's weights (`rowFraction`); a line with neither the expected figure nor
a usable snapshot counts 0, never a guess. A split row in a category that feeds no stage
counts `rowFraction × 100`.

### 5.5 Menurut laporan harian

For every work area r as above, using confirmed lines (`listDiaryLines`, latest revision
per report):

- For a split row, the lines on the group's stage; for a single-stage row, all its lines.
- The latest line by (`period_end`, `issued_at`, `line_index`) with `period_end` ≤ end of
  w decides: MULAI or LANJUT → 50, SELESAI → 100; no line → 0. This is the status board's
  own comparator (`diaryEvidence.ts`); `report_no` is not consulted.
- diary_r(w) = max(that credit, pct_r(w)) — never below the verified figure.
- Laporan(w) = Σ_r q_r × diary_r(w) / 100, divided by Σ_r q_r. The series is drawn only
  when the group has at least one confirmed diary line; otherwise it is absent (it would
  only trace the verified line).

When the diary cannot be read, the inner ring and the diary line are absent and the hint
says "Laporan harian belum bisa dibaca."

### 5.6 Proyeksi

As the S-curve: pace = (Terpasang(this week) − Terpasang(this week − n)) / n with
n = min(4, weeks since the first verified week), needing verified figures in two
different weeks and pace > 0; the line starts at this week's verified point and rises by
the pace per week to 100 or to 16 weeks, whichever comes first. The note for a flat pace
names the window it measured ("dalam 3 minggu terakhir"); a group at 100 % says "Sudah
100 % terverifikasi.".

### 5.7 The relation

Let A = Disetujui(this week), T = Terpasang(this week), D = Diminta(this week), P = the
group's plan.

- Stok teoretis: A − T in points; in the group's unit it is the approved quantity minus the
  installed quantity, from the unrounded sums (a tonne when kg ≥ 1 000).
  Null with the reason "belum ada progres terverifikasi" when nothing is verified for the
  group; shown as a negative stock ("−3,2 t") when T > A.
- Jeda: the first week w₀ with Disetujui(w₀) ≥ T; jeda = weeks from w₀ to this week. Null
  ("belum bisa dihitung") when T = 0 or A < T.
- Cukup untuk: (A − T) / pace in weeks, rounded; null with "belum ada laju" without a
  projection, and with "tidak ada stok tersisa" when A ≤ T; shown as "> 52 minggu" past a
  year.
- Warning "Pekerjaan melebihi material yang disetujui" when T − A > 10 points (the claim
  flag's tolerance).
- The radial shows D, A, T and Laporan(this week).

`buildMaterialChain(input)` returns `{ groups, unplannedRequested, planWithoutAreaOnly }`
where each group carries `plannedWithoutArea` and
its weeks, labels, five series arrays (null where undefined), `today` values,
`relation`, `warnings`, and `projectionNote`. `buildMaterialCoverage` stays for the lag sentence, the
"belum pernah diminta" note and `coverageByRow`.

## 6. Reads (`tools/analytics/data.ts`)

- `loadMaterialData` also selects the header's `reviewed_at`; `RequestedLine` gains
  `reviewed_at: string | null`.
- New `loadVerifiedClaimLines(projectId)`: `progress_claims` with status VERIFIED
  (`id, verified_at`), then `progress_claim_lines` (`claim_id, boq_item_id, verified_pct,
  weights_snapshot`) in id chunks of 100, paged; returns `{ boq_item_id, verified_pct,
  weights_snapshot, verified_at }[]`.
- `loadChainSupport(projectId)` returns `{ diary, weights, verified }` from
  `listDiaryLines` and `listStageWeights` (`tools/progressClaims/claims.ts`) and
  `loadVerifiedClaimLines`, read together, so the `ProjectAnalytics` cache holds one
  promise per kind (`material`, `diary`, `chain`).
- Read errors throw; the card shows them with "Coba lagi" as the other cards do. A diary
  read failure is the one soft case (§5.5).

## 7. Components

- `workflows/components/charts/chartGeometry.ts`: `arcPath(cx, cy, r, a0, a1)` for a
  clockwise arc in degrees from 12 o'clock.
- `workflows/components/charts/RadialRings.tsx`: rings `{ key, color, value, tint?:
  { value, opacity }, endDot?, hidden? }[]`, `size`, `hero { value, label }`, tracks, the
  0 % / 100 % end labels, `accessibilityLabel`.
- `workflows/components/charts/LineChart.tsx` gains: per-series `width` and `opacity`;
  `bands: { between: [keyA, keyB], color, opacity, label }[]`; `annotations:
  { kind: 'bracket' | 'run', level, fromIndex, toIndex, label, color }[]`; `endLabels:
  string[]` (series keys to label at their last point); `hidden: Set<string>` +
  `onToggle(key)` so the legend is the switch row; dots get the surface ring. The
  S-curve card keeps working unchanged (new props optional).
- `workflows/components/analytics/MaterialChainCard.tsx` replaces
  `MaterialCoverageCard.tsx` (deleted) in `ProjectAnalytics`. State: selected group,
  hidden ring keys, hidden line keys, expanded. The three reads are passed in as today.
- `workflows/theme.ts`: the `CHART` tokens.

## 8. Failure modes

- No plan for any mapped group: "Belum ada rencana material untuk proyek ini." (no chips).
- Requests without a plan: not charted; listed in the hint as today.
- Diary unreadable: inner ring and diary line absent, hint line, everything else drawn.
- Claim lines unreadable: the card's error state (RLS grants project members and office
  roles, so this is a real error, not a role gap).
- Re-issued reports: latest revision only (`latestRevisionLines`).
- A verified correction downwards: the verified series follows it; the diary series is
  floored at the new figure.

## 9. Testing

- `tools/__tests__/analyticsMaterialChain.test.ts`: groups and chip names; week axis
  bounds; requested/approved cumulation with REJECTED excluded and `reviewed_at` fallback;
  verified as-of-week with split and SINGLE rows and a row outside the master; diary
  latest-line rule, stage filter, floor, unreadable diary; projection guards; stock, lead,
  cover and warning with nulls; today values.
- `chartGeometry.test.ts`: `arcPath` end points at 0 %, 50 %, 100 %.
- `RadialRings.test.tsx`, `LineChart.test.tsx`: render with tint, hidden keys, bands,
  annotations, end labels; toggles call back.
- `MaterialChainCard.test.tsx`: loading, error with retry, no plan, chips switch group,
  ring and line switches, expander, warnings, nulls in tiles.
- `analyticsData.test.ts`: `loadVerifiedClaimLines` chunks and pages; `reviewed_at`
  selected.
- `ProjectAnalytics.test.tsx` updated for the new card.
- `npx tsc --noEmit`, the full jest run, `npx expo export --platform web`. No SQL.

## 10. Rollout

One pull request on `feat/material-progress-chart`. JS only: web deploys from main;
phones get `eas update --branch preview` after the OTA-safety check (no dependency
change; `react-native-svg` is already in binary 0c1d61ff).
