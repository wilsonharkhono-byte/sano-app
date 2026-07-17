# Client Progress Report — white paper, A4-locked footer, auto-justified photos

*Design spec · 2026-07-16*

## Problem

The SANO Client Progress Report ("Blueprint Precision" template, rendered by
`tools/clientReportHtml.ts` and printed via `exportClientReportPdf`) has three
issues the design owner wants fixed:

1. **Paper is a cream tint** (`--paper:#FDFCF9`), not pure white — worse for
   printing.
2. **The footer is not reliably locked to A4.** It is pinned with
   `min-height:100vh`, which is browser-dependent in print, and the running
   footer is hardcoded `Hal. 1 / 1`. Pages 2+ (if any) also lose their top
   margin because `@page { margin:0 }` relies on the sheet's own padding, which
   only applies at the very start/end of the box.
3. **The first (hero) photo is always cropped.** It is forced into a fixed
   `50mm`-tall full-width band with `object-fit:cover` (~4:1 aspect), so a phone
   photo (typically 4:3 or portrait) gets its top/bottom sliced off. Thumbs are
   likewise `object-fit:cover` cropped into a fixed `26mm` grid.

The owner wants photo cropping minimised **automatically** — supervisors and
estimators must keep uploading exactly as they do now, with no per-photo manual
control.

## Constraints

- **No upload/DB changes.** Photos carry only `{url, caption, date}`
  (`ClientReportPhoto`). Dimensions are NOT stored. `exportClientReportPdf`
  already awaits every `<img>` load before printing, so true aspect ratios can
  be measured in the print window at render time — no schema migration, no
  capture step on upload.
- The report is only ever produced through `exportClientReportPdf` (writes the
  HTML into a popup, awaits fonts + images, calls `print()`), plus the stored
  `snapshot` re-rendered through the same path. The HTML should be
  **self-contained** (justifies itself on load) so it also prints correctly if
  opened standalone.
- Screen appearance stays the same as today except the paper turns white; all
  print/layout changes are scoped to `@media print` where possible.

## Decisions (owner-approved)

- **Photo layout:** *Justified gallery.* Every photo keeps its true shape,
  arranged in flush, edge-aligned rows of varying widths. Near-zero cropping.
- **First photo:** *orientation-aware.* Landscape → full-width feature row at
  true aspect (the hero look, uncropped). Portrait/square → joins the justified
  rows (never crushed into a wide banner).
- **Overflow:** *flow onto additional A4 pages.* Photos stay large; each page is
  true A4; the footer prints on the final page.
- This intentionally overrides the "verbatim blueprint CSS" fidelity note in the
  `clientReportHtml.ts` header — a deliberate owner request, to be recorded in
  the updated header comment.

## Design

### 1. Perfectly white paper

- Sheet background and print `body` background → pure `#FFFFFF`.
- Ink/sand accent colours (headings, rules, sand kicker, dark caption bars) are
  unchanged — only the *paper* goes white.
- Update the `clientReportHtml.ts` header comment to note the deliberate
  deviation from verbatim blueprint values.

### 2. A4 lock + footer (multi-page safe)

All in `@media print`; screen view unchanged.

- `@page { size:A4; margin: 13mm 14mm 15mm }` — every page is true A4 with real
  margins on *all* pages (fixes the lost top-margin on pages 2+). The `15mm`
  bottom margin reserves space for the fixed running footer.
- The thin **running footer** (`SANcontractor © · {project · reportTag} ·
  Hal. X / Y`) becomes `position:fixed; bottom; left/right` in print, using CSS
  `counter(page) / counter(pages)` so it locks to the A4 bottom on **every**
  page with correct page numbers. On screen it stays in normal flow (the page
  counter text is emitted only in print via `::after`, harmless on screen).
- The **sheet gets a one-A4-page `min-height`** in print
  (`297 − 13 − 15 = 269mm`) so on a normal short report the closing block
  (§03 Rencana + Keselamatan, via the existing `margin-top:auto`) still pins to
  the page bottom exactly as today; when photos overflow it flows to page 2+ and
  lands at the end, above the fixed footer.
- Corner **registration marks** become `position:fixed` in print so they reframe
  each A4 page. The `dimline` flourish stays in the closing block.

### 3. Auto-justified photo gallery

Replace the fixed hero band + cover-cropped thumb grid with one justified
gallery.

- **Markup:** `renderClientReportHtml` emits all photos into a single
  `<div class="gallery">`, each as
  `<figure class="gitem"><img.../><figcaption>…</figcaption></figure>`. The first
  photo is marked so the layout pass can decide feature-vs-flow. Captions:
  feature keeps the overlaid dark caption bar (current hero look); flowed photos
  get a thin caption line underneath (current thumb look).
- **Layout math — pure, testable function** in new `tools/justifiedGallery.ts`:

  ```
  layoutJustified(aspects: number[], opts: {
    containerWidth: number;   // px of the gallery content box
    targetRowHeight: number;  // px, desired row height
    gap: number;              // px between items
    maxRowHeight?: number;    // clamp so a sparse last row isn't huge
  }): Array<{ height: number; items: Array<{ index: number; width: number }> }>
  ```

  Greedy row-filling: accumulate images into a row until adding another would
  drop the justified row height below `targetRowHeight`, then justify that row so
  item widths + gaps exactly fill `containerWidth` (`rowHeight =
  (containerWidth − gaps) / Σ aspect`). No cropping — items keep their aspect.
  The function is closure-free (references only its args/locals) so it can be
  embedded via `.toString()` (see below) with a single source of truth.

- **Feature decision:** if the first photo's aspect ≥ ~1.3 (landscape) it is
  rendered as its own full-width feature row at true aspect, height-capped
  (e.g. ≤ ~95mm-equivalent); otherwise it is included in the justified rows like
  the rest.

- **Self-contained execution:** `renderClientReportHtml` embeds a small
  `<script>` that, on load, reads each `img.naturalWidth/naturalHeight`, calls
  the embedded `layoutJustified` (injected as source so the pure function is the
  single source of truth), applies row heights + item widths to the DOM, then
  sets `window.__galleryReady = true`. `exportClientReportPdf` awaits image load
  (as today) **and** `__galleryReady` (bounded poll/timeout) before `print()`, so
  the layout is applied before printing and cannot race.

### Files touched

- `tools/clientReportHtml.ts` — CSS (white paper, `@page`/A4, fixed running
  footer with page counters, gallery styles), gallery markup, embedded layout
  script, header-comment update, `exportClientReportPdf` awaits `__galleryReady`.
- `tools/justifiedGallery.ts` *(new)* — pure `layoutJustified` + edge cases.
- `tools/__tests__/justifiedGallery.test.ts` *(new)* — unit tests for the math.
- `tools/__tests__/clientReportHtml.test.ts` — add assertions: pure-white paper
  (`#fff`, no `#FDFCF9` sheet bg), A4 lock (`@page … A4`, `min-height` in mm,
  page counters), gallery structure (`class="gallery"`, `gitem`, script present),
  still contains img `src` + captions.

## Verification

Render a report with a mix of portrait + landscape photos and print to PDF;
confirm: pure-white A4 paper; footer pinned to the A4 bottom with correct
`Hal. X / Y` page numbers; photos uncropped and flush; overflow paginating as
additional true-A4 pages with the footer on the last page. Unit tests green for
the justified math; existing `clientReportHtml` tests green.

## Out of scope / YAGNI

- No per-photo manual crop/reorder controls (owner explicitly wants
  upload-and-done).
- No storing image dimensions on upload / DB migration (measured at print time).
- No changes to the native builder form beyond what the above requires (none).
- Strict single-page shrinking was rejected in favour of multi-page flow.
