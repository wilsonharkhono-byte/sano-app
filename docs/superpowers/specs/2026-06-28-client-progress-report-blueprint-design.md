# Client Progress Report (Blueprint) — Design Spec

> Auto-generate the **SANO "Laporan Harian / Mingguan — Blueprint Precision"**
> A4 client report from the Report tab, fed by a new **Daily Site Log** capture
> surface in the Progress tab. Curated-draft model: SANO fills everything it
> knows, a human edits the narrative, then exports a pixel-faithful PDF.

- **Date:** 2026-06-28
- **Branch context:** `feat/boq-normalizer` (current); feature is independent of the BoQ normalizer.
- **Status:** Approved design, pending implementation plan.

---

## 1. Goal

Today SANO's Report tab (`workflows/screens/LaporanScreen.tsx` → "Export Center")
generates structured internal reports via `generateReport()` (in `tools/reports.ts`),
previewed in `ReportPreview` and exported to PDF/Excel through the `pdf-lib`-based
`SanoDoc` pipeline (`tools/pdf.ts`, `tools/pdf-layout.ts`).

We want a **new, client-facing report** that renders the approved
**Blueprint Precision** layout — the single-page A4 design in
`assets/Client Progress Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html`
(rendered reference: `daily_blueprint.pdf`; variant comparison: `Daily Report - TEMPLATE.pdf`,
where the chosen design is "A · Blueprint Precision", not "B · Typographic Statement").

The report has fields SANO does not fully capture yet (weather, crew narrative,
prose field-updates, next-period plan, photo curation). Rather than invent them,
we add a **Daily Site Log** — a once-a-day site diary in the Progress tab — that
captures the narrative and links to real BoQ progress. The client report
aggregates these logs plus existing structured data into a curated draft a human
signs off before export.

### 1.1 Truth-correctness contract (inherited from CLAUDE.md §12)

Every field in the exported report is either **derived from real data** or
**typed by the user** in the draft editor. Nothing is fabricated. On issue, the
exact rendered content is **frozen as a snapshot** so the PDF the client received
is reproducible even if underlying logs change later. Re-issuing creates a new
revision rather than silently mutating an already-sent report number.

### 1.2 Visual fidelity contract (non-negotiable acceptance criterion)

The generated HTML report MUST render **exactly to A4 (210 × 297 mm)** and match
the **Blueprint Precision** PDF reference pixel-for-pixel in template and graphic
standard. Specifically:

- **A4 sizing:** `@page { size: A4; margin: 0 }`; the sheet is `210mm × 297mm`
  with the template's exact print padding. One page, no overflow, no second page.
- **Graphic standard:** Space Grotesk only (weights 300–700); the blueprint's
  exact CSS tokens (`--ink #16130f`, `--paper #FDFCF9`, `--sand #7A6B56`,
  `--sand-lt #C9B79A`, sub-lines, etc.); the four corner registration marks; the
  metadata strip grid; numbered section heads (01/02/03) with sand numbers; the
  black-bar photo captions; the running footer + `A4 · 210 × 297 mm` dimension
  line. No pure black/white/cold gray.
  - **Note on tokens (deviation is intentional):** these blueprint tokens differ
    from `SANO_Brand_Graphic_Standard.md` (which lists `primary #141210`,
    `surface #FDFAF6`, `accent #B29F86`, `accentDark #7A6B56`). For this report
    the **blueprint PDF reference is the source of truth and wins** — the
    blueprint HTML is ported verbatim, not reconciled to the app token set. Do
    not "correct" the blueprint tokens toward the brand-standard hexes.
- **Source of truth:** the template HTML/CSS is **ported verbatim** from
  `assets/Client Progress Report Template/SANO_Laporan_Harian-Mingguan_Blueprint.html`.
  Only the screen-only `.toolbar` is removed and placeholders are substituted with
  data. CSS values are **not** re-authored or "cleaned up" — drift from the
  reference is a defect.
- **Font embedding (fidelity safeguard):** the blueprint loads Space Grotesk via
  a Google Fonts `<link>`. For reliable print-to-PDF, **self-host / base64-embed
  Space Grotesk** in the rendered HTML (or block `window.print()` on
  `document.fonts.ready`), so a slow/unavailable CDN cannot fall the PDF back to a
  system font and break the pixel-for-pixel contract.
- **Reference artifacts:** the chosen design is variant **A · Blueprint Precision**
  (`daily_blueprint.pdf`), NOT variant B (Typographic Statement) shown in
  `Daily Report - TEMPLATE.pdf`.
- **Template corrections (2026-07-02, directed by the design owner after the
  first live print):** two deliberate amendments to the blueprint reference —
  (1) the masthead's placeholder text wordmark is replaced with the **real SANO
  logotype SVG** (same paths as `workflows/components/SanoBrand.tsx` /
  `assets/LOGO SANO.svg`, filled `--ink`); (2) the running footer credits
  **`SANcontractor © 2026 · Konfidensial`**, not WHAstudio. These supersede the
  older reference PDFs on those two elements; everything else stays verbatim.
  Additionally, a revision of an issued report renders its number as
  `Laporan #NN · R{n}` (first issues stay `Laporan #NN`).

**Verification:** export the populated report to PDF and visually diff it against
`daily_blueprint.pdf` (same layout, fonts, colors, spacing, section order, A4
bounds). Any deviation in size or graphic standard fails acceptance.

---

## 2. Design decisions (locked during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Assembly model | **Curated draft** — auto-fill + human edit before export. |
| 2 | Narrative capture surface | **New Daily Site Log** in the Progress tab (not scattered on BoQ entries, not report-time-only). |
| 3 | PDF render engine | **HTML template + browser print** — the blueprint HTML is the single source of truth; injected with data; exported via print-to-PDF. Separate from the `pdf-lib` pipeline. |
| 4 | Daily-log highlight structure | **`{ area, note }` rows** (optionally linked to a BoQ row), mapping 1:1 to the template's "Update Lapangan" rows. |

---

## 3. Architecture overview

```
Progress tab (ProgresScreen)                Report tab (LaporanScreen → Export Center)
┌─────────────────────────────┐             ┌───────────────────────────────────────────┐
│  "Log Harian Hari Ini" card │             │  Row: "Laporan Progres Klien (Blueprint)" │
│   → Daily Site Log form     │             │   → ClientReportBuilderScreen (curated)   │
└──────────────┬──────────────┘             └──────────────────────┬────────────────────┘
               │ writes                                            │ reads/aggregates
               ▼                                                    ▼
   daily_site_logs / _highlights / _photos  ──────────────►  tools/clientReport.ts
   progress_entries / progress_photos (existing)  ─────────►  (assemble draft + numbering + freeze)
   milestones / defects / projects (existing)     ─────────►            │
                                                                        ▼ on export
                                                          tools/clientReportHtml.ts
                                                          (inject data → blueprint HTML → print PDF)
                                                                        │
                                                                        ▼ persists
                                                          client_progress_reports (header + frozen snapshot)
                                                          report_exports (existing audit, via recordReportExport)
```

The new path is **fully separate** from the `pdf-lib` `SanoDoc` pipeline; existing
reports are untouched.

---

## 4. Data model

New migration `supabase/migrations/050_client_progress_report.sql` (latest applied
is `049`). Written **idempotent** (`create table if not exists`, `do $$ ... $$`
guards for policies) because remote migration history is divergent and migrations
are pasted into the Dashboard SQL Editor (see memory: migration-history-divergence).
RLS enabled on every new table with an authenticated-role policy (see memory:
material_aliases-rls — test under the authenticated role, not just service role).

### 4.1 `daily_site_logs`

One row per project per day (uniqueness: `(project_id, log_date)`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `project_id` | uuid fk → projects | on delete cascade |
| `log_date` | date | the diary date |
| `weather` | text | "Cuaca" — e.g. "Cerah" (nullable) |
| `crew_total` | int | "Tenaga Kerja" headline number (nullable) |
| `crew_breakdown` | text | e.g. "3 tukang · 2 kenek · 1 mandor" (nullable) |
| `safety_incidents` | int | default 0 → "Keselamatan" |
| `author_id` | uuid fk → profiles | who logged it |
| `created_at` / `updated_at` | timestamptz | `default now()` |

### 4.2 `daily_log_highlights`

The "Update Lapangan" rows. Many per log.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `log_id` | uuid fk → daily_site_logs | on delete cascade |
| `area` | text | e.g. "Tangga" |
| `note` | text | e.g. "Finishing anak tangga berjalan; railing menyusul." |
| `boq_item_id` | uuid fk → boq_items | **nullable — the link to software progress tracking** |
| `sort_order` | int | display order |

### 4.3 `daily_log_photos`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `log_id` | uuid fk → daily_site_logs | on delete cascade |
| `storage_path` | text | resolved to URL via `resolvePhotoUrl()` (tools/storage.ts) |
| `caption` | text | e.g. "Mock-up keramik KM utama" (nullable) |
| `is_featured` | boolean | default false — "show to client"; report builder pool |
| `captured_at` | timestamptz | defaults to log timestamp |

### 4.4 `client_progress_reports`

The issued/issuable report header + frozen content.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk → projects | |
| `report_no` | int | per-project sequence (#07). Assigned on create. |
| `revision` | int | default 1; re-issue bumps this, keeps `report_no`. |
| `kind` | text | `'harian'` \| `'mingguan'` |
| `period_start` | date | (== `period_end` for harian) |
| `period_end` | date | |
| `status_label` | text | e.g. "Sesuai Jadwal" (default derived from milestones) |
| `weather` | text | editable override |
| `crew_total` | int | editable override |
| `crew_breakdown` | text | editable override |
| `safety_incidents` | int | period total (editable) |
| `next_plan` | text | "Rencana Periode Berikutnya" (report-level) |
| `snapshot` | jsonb | **frozen** rendered data on issue (highlights chosen, photo refs + captions, hero, derived progress %) |
| `issued_at` | timestamptz | null until exported/issued |
| `issued_by` | uuid fk → profiles | |
| `created_at` | timestamptz | `default now()` |

**Why a frozen snapshot:** honors the truth-correctness contract — the artifact
sent to the client is reproducible. Re-deriving from live logs would let a sent
report silently change.

---

## 5. Capture surface — Daily Site Log (Progress tab)

### 5.1 Discoverability ("obvious where to submit")

Add a card at the top of `ProgresScreen` home (the `'home'` submodule):
**"Log Harian — {today}"**. States:
- No log today → prominent **+ Catat Log Harian** CTA.
- Log exists → summary (weather, crew, # highlights, # featured photos) + **Edit**.

This sits beside the existing recent-progress list, so the daily diary and the
quantitative BoQ entries share one timeline.

### 5.2 Daily Site Log form

A submodule/screen reached from the card. Fields:
- Date (defaults today; one log per date — opening an existing date edits it).
- Weather (free text or small chip set).
- Crew total + crew breakdown text.
- Safety incidents (default 0).
- **Highlights (narrative-first)**: repeatable `{ area, note, optional BoQ row }`
  rows. In practice **most highlights are free narrative** (site color, prep,
  coordination, deliveries) that maps to no single BoQ row, so the BoQ link is a
  **secondary, optional** affordance — never required to save a highlight. When
  the work *does* map to a line item, the BoQ row is picked via the same
  work-group → row picker used in the progress form (`buildWorkGroups` from
  `tools/boqWorkGroups`), which is what enables the cross-prompt link (§5.4).
- **Photos**: `PhotoGalleryField` + per-photo caption and an `is_featured`
  ("tampilkan ke klien") toggle. Upload via `pickAndUploadPhoto('daily-log/{projectId}')`.

### 5.3 Logic module — `tools/dailySiteLogs.ts`

- `getDailyLog(projectId, date)` / `listDailyLogs(projectId, range)`
- `upsertDailyLog(...)`, `saveHighlights(...)`, `saveLogPhotos(...)`
- `aggregatePeriod(projectId, start, end)` → highlights, featured photos,
  weather/crew (most-recent in range), summed safety incidents.

### 5.4 Cross-prompt linkage (progress ⇄ narrative)

The quantitative and narrative streams stay separate models but are **stitched at
the input moment** so field staff keep them in sync without double work:

- **Progress entry → highlight:** after a supervisor logs a `progress_entry`
  (qty installed on a BoQ row) in the progress form, offer *"Tambahkan ke Log
  Harian?"* — pre-filling a highlight with that BoQ row + a starter note. One tap
  promotes a measured event into a client-facing highlight, already linked.
- **Highlight → progress entry:** when a highlight is linked to a BoQ row, the log
  form may optionally capture a qty, which writes a `progress_entry` (the source
  of truth stays `progress_entries`; the highlight never stores qty).
- **Builder verification aid (not client-rendered):** while curating the draft, a
  linked highlight shows the row's live installed/planned beside it (e.g.
  *"Railing tangga · 12/20 m"*) so the estimator can check the narrative against
  the measured record. This readout is **internal to the builder**; the exported
  PDF stays number-free per §1.2.

---

## 6. Report builder (Report tab)

### 6.1 Entry point

A new row in the Export Center list (`LaporanScreen` overview, the array around
the current `progress_summary`/`material_balance`/… rows): **"Laporan Progres
Klien (Blueprint)"**. Opens `ClientReportBuilderScreen` as a full takeover
(same pattern as the existing `baseline`/`gate2`/`katalog` section takeovers).

### 6.2 Flow

1. **Pick kind + period.** Harian (single date) or Mingguan (range). Maps to the
   blueprint's Harian/Mingguan toggle. Suggest next `report_no`.
2. **Auto-assemble draft** via `tools/clientReport.ts`. Each field is either
   *derived* (D) or *pre-filled blank for the curator* (C):
   - (D) Update Lapangan ← `aggregatePeriod` highlights (all pre-selected).
   - (D) Dokumentasi ← featured `daily_log_photos` (pre-selected; first = hero).
   - (D) Keselamatan ← summed `safety_incidents`.
   - (D) Cuaca / Tenaga Kerja ← from period log (range → most recent; editable).
   - (D, **not rendered**) Weekly progress delta ← computed from
     `progress_entries.created_at` (installed-as-of `period_end` minus
     installed-as-of `period_start`, reusing the `progress_summary` derivation).
     The template has **no percentage field**; the delta is an **internal input
     that backs the Status label only** — never shown as a number (§1.2 fidelity).
     Daily reports skip it entirely (a one-day % is noise).
   - (D) Project **title** ← `projects.name`; **Klien** ← `projects.client_name`
     (nullable — if null, curator types it). Both confirmed columns on `projects`.
   - (C/D) **Status label** ← milestones for daily; milestones + the weekly delta
     for weekly. **No `MilestoneStatus`→Indonesian mapping exists today**
     (`MilestoneStatus` = `ON_TRACK | AT_RISK | DELAYED | AHEAD | COMPLETE`;
     `MilestoneScreen` renders English via `status.replace('_',' ')`). A mapping
     (e.g. `ON_TRACK → 'Sesuai Jadwal'`) must be authored in
     `tools/clientReport.ts`; the curator can override. **No numeric % renders
     anywhere.**
   - (C) **Subtitle** (template "Finishing Interior") — **`projects` has no
     subtitle/scope column**, so this is a **curator-typed field** in step 3 (a
     small optional `migration-050` column is a possible future enhancement, not MVP).
3. **Curated-draft editor** (`ClientReportBuilderScreen`): edit/reorder/deselect
   highlights; edit weather/crew/status/safety; pick hero + edit captions; write
   `next_plan`; confirm `report_no`.
4. **Preview + export:**
   - In-app: a lightweight RN preview (new `ClientReportPreview` component) for a
     quick sanity look.
   - Faithful export: **"Cetak / PDF"** → `tools/clientReportHtml.ts` injects the
     draft into the blueprint HTML/CSS and prints to PDF.
5. **Issue:** persist `client_progress_reports` row with frozen `snapshot`, set
   `issued_at`/`issued_by`, and record the export for the audit trail.
   **Do NOT call the typed `recordReportExport`** — its `reportType` param is the
   `ReportType` union, which deliberately does **not** include
   `'client_progress_report'`. Instead add a dedicated helper in
   `tools/clientReport.ts`, e.g. `recordClientProgressReportExport(projectId,
   userId, filters)`, that inserts into `report_exports` with
   `report_type = 'client_progress_report'` as a plain string (the column is
   `text`, not the TS enum). This keeps the new path fully separate and avoids
   touching `tools/reports.ts`.

### 6.3 Render module — `tools/clientReportHtml.ts`

- **Hard separation:** the client report MUST NOT flow through `generateReport()`
  or `exportReportToPdf()`. Those are the `pdf-lib`/`ReportType` pipeline;
  routing through them would hit `exportReportToPdf`'s `default` case and silently
  emit a raw-JSON PDF instead of the blueprint. This module is the only render path.
- Holds the blueprint HTML/CSS as a template (ported verbatim from
  `SANO_Laporan_Harian-Mingguan_Blueprint.html`, screen-only toolbar removed,
  print CSS `@page { size:A4; margin:0 }` retained, Space Grotesk **embedded** per
  §1.2 rather than CDN-linked).
- `renderClientReportHtml(data)` → full HTML string with placeholders filled and
  photos resolved to URLs via `resolvePhotoUrl()` (`tools/storage.ts`), embedded
  as `<img>`.
  - **Photo URL trade-off:** `resolvePhotoUrl` returns **signed URLs that expire
    (~7 days)**. For the frozen-snapshot reproducibility goal (§1.1/§4.4), prefer
    **base64 data-URL inlining** at issue time so the snapshot/print is
    self-contained and does not rot. The inlining helper is new work (none exists
    today); list it as a sub-task.
- Export: **web** (primary — SANO is Expo-web on Vercel) opens a new window,
  writes the HTML, waits for `document.fonts.ready`, calls `window.print()`.
  **Native** is out of MVP scope (would need `expo-print`, not currently a
  dependency); document as a follow-up.

### 6.4 Daily vs weekly semantics

Same template, two behaviors:

- **Harian (daily):** narrative-first — highlights + photos + safety + a Status
  from milestones. **No progress number** (a one-day delta is noise). Expect many
  free-narrative highlights per day; this is the primary content, not an edge case.
- **Mingguan (weekly):** aggregates the week's daily logs; the week-over-week
  progress delta (§6.2) backs a more considered Status. Highlights are curated
  down from the week's accumulation to the ~6 the template shows. Still number-free.

---

## 7. Roles & permissions

Existing roles: `supervisor`, `estimator`, `admin`, `principal` (`ROLE_LABELS`
in `tools/projectManagement.ts`). "Mandor" is a contract concept, not a profile role.

- **Daily Site Log:** create/edit by `supervisor` (field role). Estimator/admin
  may also edit. RLS: members of the project can read; author/supervisor+ can write.
- **Client report builder/issue:** `supervisor`, `estimator`, `admin`,
  `principal` — mirrors the Export Center visibility (`isEstimatorOrAdmin` +
  supervisor).

---

## 8. Module / file plan

| File | New? | Responsibility |
|---|---|---|
| `supabase/migrations/050_client_progress_report.sql` | new | 3 log tables + `client_progress_reports`, RLS, indexes. Idempotent. |
| `tools/dailySiteLogs.ts` | new | Daily-log CRUD + `aggregatePeriod`. |
| `tools/clientReport.ts` | new | Assemble draft, `MilestoneStatus`→Indonesian status mapping, report numbering, freeze snapshot, `recordClientProgressReportExport` audit helper. |
| `tools/clientReportHtml.ts` | new | Blueprint HTML template population + print/export. |
| `workflows/screens/DailyLogScreen.tsx` | new | Daily Site Log form (or a submodule inside `ProgresScreen`). |
| `workflows/screens/ClientReportBuilderScreen.tsx` | new | Curated-draft editor + preview + export trigger. |
| `workflows/components/ClientReportPreview.tsx` | new | Lightweight in-app RN preview. |
| `workflows/screens/ProgresScreen.tsx` | edit | Add "Log Harian Hari Ini" card + route to the form. |
| `workflows/screens/LaporanScreen.tsx` | edit | Add Export Center row + builder takeover wiring. |

No changes to `tools/pdf.ts` / `tools/pdf-layout.ts` / `tools/reports.ts` or the
`ReportType` union: `'client_progress_report'` is intentionally kept **out** of
the union (it is only ever written to the `report_exports.report_type` text
column as a plain string via the dedicated helper), so `generateReport`'s
exhaustive switch and `exportReportToPdf`'s `default` JSON fallback are untouched.

---

## 9. Build phasing (each independently shippable)

1. **DB migration** (§4) — tables + RLS.
2. **Daily Site Log** (§5) — `tools/dailySiteLogs.ts` + Progress-tab card & form.
   Usable on its own immediately as a site diary.
3. **Report assembly** (§6.2 steps 1–3) — `tools/clientReport.ts` + numbering + freeze.
4. **Builder + render** (§6.2 steps 4–5, §6.3) — builder screen +
   `tools/clientReportHtml.ts` + Export Center entry.
5. **Polish** — in-app preview refinements, report revisions, native export
   (`expo-print`).

---

## 10. Scope boundaries (YAGNI)

- **In:** single-page A4 Blueprint Precision (variant A), harian + mingguan,
  curated draft, web print-to-PDF, frozen snapshot + numbering. **Number-free
  report** (qualitative Status backed by an internal weekly delta);
  narrative-first highlights with optional BoQ links + cross-prompt stitching.
- **Out (now):** variant B (Typographic Statement); multi-page reports; native
  PDF export; automatic emailing/sending to clients; the existing
  `weekly_digest` is kept as the internal digest and is **not** replaced.

---

## 11. Open questions resolved

- Overlap with `weekly_digest`: kept separate (internal vs client-facing).
- Photos source: dedicated `daily_log_photos` (not reusing `progress_photos`,
  which are bound to quantitative `progress_entries`).
- Safety source: per-log manual `safety_incidents` count (truthful daily diary),
  summed for the period; defects remain a separate concern.
- Report-type plumbing: `'client_progress_report'` stays **out** of the
  `ReportType` union; a dedicated audit helper writes the `report_exports`
  text column (keeps the path separate, avoids breaking the exhaustive switches).
- Status label: needs a new `MilestoneStatus`→Indonesian mapping in
  `tools/clientReport.ts` (none exists today).
- Subtitle: curator-typed (no `projects` column); Klien ← `projects.client_name`
  (confirmed), title ← `projects.name` (confirmed).
- Print fidelity: embed Space Grotesk (no CDN reliance) and inline photos as
  base64 at issue time (signed URLs expire vs. frozen-snapshot reproducibility).
- Progress metric: **no percentage is rendered** (template has no slot). Daily
  skips it; weekly computes a week-over-week delta only to back the qualitative
  Status label.
- Highlight coupling: **narrative-first** (BoQ link optional; most highlights
  unlinked). The two streams are stitched via cross-prompt at input time (§5.4),
  not merged into one model.

## 12. Verification provenance

This spec was adversarially verified against the codebase (5 parallel checks over
56 claims + synthesis, 2026-06-28). Confirmed: FK targets (`projects`/`profiles`/
`boq_items`), migration sequencing (049→050), idempotent RLS patterns,
`ProgresScreen`/`LaporanScreen` integration points, `PhotoGalleryField` +
`buildWorkGroups` reuse, the blueprint HTML structure/A4 sizing/templating hooks,
and the progress/milestone derivation sources. Corrected from findings: the
ReportType contradiction (§6.2 step 5, §6.3, §8), the brand-token misattribution
(§1.2), the non-derivable status/subtitle fields (§6.2 step 2), the Klien vs.
title field mapping, the font-embedding and signed-URL fidelity risks.
