// SANO — Client Progress Report HTML render
// Ports the "Blueprint Precision" template (assets/Client Progress Report
// Template/SANO_Laporan_Harian-Mingguan_Blueprint.html). The screen-only
// .toolbar is removed and placeholders are substituted.
//
// The template's verbatim-CSS contract is deliberately overridden in three
// places at the design owner's explicit request (spec 2026-07-16):
//   1. Paper is pure #FFFFFF (was the cream tint #FDFCF9) for clean printing.
//   2. Print pagination is A4-locked on EVERY page — @page margins on all
//      pages + a position:fixed running footer with real page counters — rather
//      than a single-page min-height:100vh.
//   3. Photos render as an auto-justified gallery (see tools/justifiedGallery.ts)
//      instead of a fixed-height crop band, so nothing is force-cropped. Rows
//      are capped at GALLERY_MAX_ITEMS_PER_ROW photos so each stays legible;
//      extra rows flow onto further A4 pages.
//   4. The corner registration marks are screen-only: Chrome cannot paint them
//      at the paper edge (see the print CSS note inside BLUEPRINT_CSS).

import { Platform } from 'react-native';
import type { ClientReportDraft } from './clientReport';
import {
  LAYOUT_JUSTIFIED_JS,
  GALLERY_REF_WIDTH_PX,
  GALLERY_TARGET_ROW_PX,
  GALLERY_MAX_ROW_PX,
  GALLERY_GAP_PX,
  GALLERY_FEATURE_MIN_ASPECT,
  GALLERY_MAX_ITEMS_PER_ROW,
} from './justifiedGallery';

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// VERBATIM from the blueprint HTML <style> block (lines 11–148). Do not edit values.
const BLUEPRINT_CSS = `
  /* ============================================================
     SANO — Laporan Harian / Mingguan · "Blueprint Precision"
     Base: variant A. Monochrome + sand accent, near-white paper,
     corner registration marks, A4 single page.
     ============================================================ */
  :root{
    --ink:#16130f; --ink-2:#57514a; --ink-3:#8c857a;
    --paper:#FFFFFF; --paper-2:#F4F1EA;
    --sand:#7A6B56; --sand-lt:#C9B79A;
    --line:#16130f; --line-sub:#dcd6ca;
  }
  *{box-sizing:border-box}
  html{ -webkit-text-size-adjust:100%; }
  body{
    margin:0; background:#cfccc2; color:var(--ink);
    font-family:"Space Grotesk", system-ui, sans-serif;
    font-size:12px; line-height:1.4; font-weight:400; -webkit-font-smoothing:antialiased;
  }

  /* ---- screen-only toolbar ----------------------------------- */
  .toolbar{
    position:sticky; top:0; z-index:50; display:flex; align-items:center; justify-content:space-between;
    gap:14px; padding:9px 18px; background:rgba(207,204,194,.94);
    backdrop-filter:saturate(120%) blur(4px); border-bottom:1px solid #b9b5a9; font-size:12px; color:var(--ink-2);
  }
  .toolbar .grp{ display:flex; align-items:center; gap:10px; }
  .seg{ display:inline-flex; border:1px solid var(--ink); border-radius:7px; overflow:hidden; }
  .seg button{
    appearance:none; border:0; background:transparent; color:var(--ink); font-family:inherit;
    font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; padding:6px 12px; cursor:pointer;
  }
  .seg button.on{ background:var(--ink); color:var(--paper); }
  .btn{
    appearance:none; border:1px solid var(--ink); background:var(--ink); color:var(--paper); font-family:inherit;
    font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; padding:8px 16px; border-radius:7px; cursor:pointer;
  }
  .btn:hover{ opacity:.88 }

  /* ---- A4 sheet ---------------------------------------------- */
  .sheet{
    position:relative; width:210mm; min-height:297mm; max-width:calc(100% - 24px); margin:20px auto;
    background:var(--paper); color:var(--ink);
    box-shadow:0 2px 6px rgba(70,58,44,.08), 0 18px 50px rgba(70,58,44,.12);
    padding:16mm 15mm 12mm; display:flex; flex-direction:column;
  }
  /* corner registration marks */
  .mark{ position:absolute; width:13px; height:13px; pointer-events:none; }
  .mark.tl{ top:9mm; left:9mm; border-left:1.4px solid var(--ink); border-top:1.4px solid var(--ink); }
  .mark.tr{ top:9mm; right:9mm; border-right:1.4px solid var(--ink); border-top:1.4px solid var(--ink); }
  .mark.bl{ bottom:9mm; left:9mm; border-left:1.4px solid var(--ink); border-bottom:1.4px solid var(--ink); }
  .mark.br{ bottom:9mm; right:9mm; border-right:1.4px solid var(--ink); border-bottom:1.4px solid var(--ink); }

  /* ---- masthead --------------------------------------------- */
  .top{ display:flex; align-items:flex-start; justify-content:space-between; }
  .brand{ display:flex; align-items:center; gap:9px; }
  .brand .logo{ font-weight:700; font-size:19px; letter-spacing:.14em; }
  .top .hdrmeta{ text-align:right; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); line-height:1.7; }
  .top .hdrmeta b{ color:var(--ink-2); font-weight:600; }

  .kicker{ margin-top:14px; font-size:10px; letter-spacing:.26em; text-transform:uppercase; color:var(--sand); font-weight:600; }
  h1{ font-size:34px; font-weight:700; letter-spacing:-.015em; line-height:1; margin:6px 0 0; }
  .subtitle{ margin-top:5px; font-size:13px; color:var(--ink-2); }

  /* ---- metadata strip --------------------------------------- */
  .strip{
    margin-top:13px; border-top:1.4px solid var(--line); border-bottom:1.4px solid var(--line);
    display:grid; grid-template-columns:1.15fr 1.15fr .8fr 1.5fr 1.1fr;
  }
  .strip .cell{ padding:9px 13px; border-right:1px solid var(--line-sub); }
  .strip .cell:last-child{ border-right:0; }
  .strip .lab{ font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); }
  .strip .val{ margin-top:4px; font-size:13px; font-weight:600; }
  .strip .val.accent{ color:var(--sand); }
  .strip .crew{ margin-top:3px; font-size:9.5px; font-weight:400; color:var(--ink-2); line-height:1.45; }

  /* ---- sections --------------------------------------------- */
  section{ margin-top:13px; }
  .sec-head{ display:flex; align-items:baseline; gap:9px; }
  .sec-head .no{ font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sand); }
  .sec-head h2{ font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; margin:0; }

  /* update list */
  .updates{ margin-top:7px; }
  .row{ display:grid; grid-template-columns:64px 200px 1fr; gap:14px; align-items:baseline;
        padding:6px 0; border-bottom:1px solid var(--line-sub); }
  .row:first-child{ border-top:1px solid var(--line-sub); }
  .row .date{ font-size:9.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--sand); }
  .row .area{ font-size:12.5px; font-weight:600; }
  .row .note{ font-size:12px; color:var(--ink-2); }

  /* documentation */
  .hero{ margin-top:9px; position:relative; border:1px solid var(--ink); }
  .ph{ display:flex; align-items:center; justify-content:center; width:100%;
    background:repeating-linear-gradient(135deg, rgba(122,107,86,.06) 0 11px, rgba(122,107,86,.12) 11px 22px), var(--paper-2);
    color:var(--sand); letter-spacing:.22em; text-transform:uppercase; }
  .hero .ph{ height:50mm; font-size:10px; }
  .hero .cap{ position:absolute; left:0; right:0; bottom:0; background:var(--ink); color:var(--paper);
    font-size:10.5px; padding:7px 12px; display:flex; gap:9px; align-items:center; }
  .hero .cap .d{ color:var(--sand-lt); font-weight:600; letter-spacing:.08em; text-transform:uppercase; font-size:9px; }
  .thumbs{ margin-top:9px; display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
  figure{ margin:0; }
  figure .ph{ height:26mm; font-size:8.5px; border:1px solid var(--line-sub); }
  figcaption{ margin-top:5px; font-size:9.5px; color:var(--ink-2); }
  figcaption .d{ color:var(--sand); font-weight:600; letter-spacing:.08em; text-transform:uppercase; }

  /* ---- footer block ----------------------------------------- */
  .closing{ margin-top:auto; padding-top:14px; }
  .plan{ display:flex; justify-content:space-between; align-items:flex-start; gap:30px;
    border-top:1.4px solid var(--line); padding-top:11px; }
  .plan .body{ max-width:74%; }
  .plan .body .no{ font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sand); }
  .plan .body h2{ display:inline; font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; margin:0 0 0 6px; }
  .plan .body p{ margin:7px 0 0; font-size:12px; color:var(--ink-2); }
  .plan .safety{ text-align:right; white-space:nowrap; }
  .plan .safety .lab{ font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3); }
  .plan .safety .num{ font-size:20px; font-weight:700; margin-top:2px; }
  .plan .safety .sub{ font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); }

  .runfoot{ margin-top:12px; border-top:1px solid var(--line-sub); padding-top:7px;
    display:flex; justify-content:space-between; font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); }
  .dimline{ text-align:center; margin-top:4px; font-size:8px; letter-spacing:.3em; text-transform:uppercase; color:var(--ink-3); }

  /* ---- print ------------------------------------------------- */
  @media print{
    /* Every printed page is true A4 with real margins on ALL pages (not just
       page 1, which the old sheet-padding approach could not guarantee). */
    @page{ size:A4; margin:12mm 14mm 13mm; }
    html, body{ background:#fff; }
    .toolbar{ display:none !important; }
    /* @page supplies the margins now, so the sheet itself is padding-free. Its
       min-height is ~one A4 content page so a SHORT report pins the closing
       block — footer and all — to the page bottom (via .closing margin-top:auto),
       while a LONG report grows past it and paginates onto further A4 pages, the
       closing block landing on the final page. The footer stays in normal flow
       (no position:fixed) so it can never overlap the closing content. */
    .sheet{ width:auto; max-width:none; margin:0; padding:0; box-shadow:none; min-height:270mm; }
    /* NO registration marks on print. Chrome anchors position:fixed to the
       page CONTENT box (inside the @page margins) and clips anything painted
       into the margin area (verified with a headless print repro, 2026-07-23).
       So paper-edge marks are impossible: placed at 7mm they land ~19-21mm
       into the paper and strike through the masthead/footer text on every
       page ("cut off" text in the PDF). Screen keeps the marks — the sheet's
       own padding hosts them there. */
    .mark{ display:none; }
    /* No CSS page counter: Chrome (the browser the app prints through) renders
       the printed-page counters as 0, and there is no reliable cross-browser CSS
       page number. Rather than print a wrong number, the footer carries no page
       count; a user who needs page numbers can enable the browser print dialog's
       own headers/footers. */
    /* Avoid splitting individual photos, justified rows, update rows and the
       closing block across a page break — but NOT the documentation <section>
       itself: it must be free to start on page 1 and flow across pages, else a
       photo-heavy report leaves page 1 half-empty. The WHOLE .closing block
       (03 plan + runfoot + dimline) moves as one unit, so a tight fit can
       never orphan the footer lines alone on the last page. */
    .gitem, .grow-row, .feature, .row, .closing{ break-inside:avoid; }
  }
  @media (max-width:680px){
    .sheet{ min-height:0; padding:18px 16px; }
    .strip{ grid-template-columns:1fr 1fr; }
    .strip .cell{ border-bottom:1px solid var(--line-sub); }
    h1{ font-size:30px; } .row{ grid-template-columns:54px 1fr; } .row .note{ grid-column:1 / -1; }
    .thumbs{ grid-template-columns:1fr 1fr; }
  }
`;

export function fmtPeriodLong(kind: string, start: string, end: string): string {
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${months[a.m - 1]} ${a.y} – ${b.d} ${months[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${months[a.m - 1]} – ${b.d} ${months[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${months[b.m - 1]} ${b.y}`;
}

export function fmtPeriodShort(kind: string, start: string, end: string): string {
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const a = p(start), b = p(end);
  if (kind === 'harian' || start === end) return `${a.d} ${months[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${months[a.m - 1]} ${a.y}–${b.d} ${months[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${months[a.m - 1]}–${b.d} ${months[b.m - 1]} ${b.y}`;
  return `${a.d}–${b.d} ${months[b.m - 1]} ${b.y}`;
}

// The real SANO logotype — same paths as workflows/components/SanoBrand.tsx
// (source: assets/LOGO SANO.svg, viewBox 315.66 × 87.26). Replaces the
// blueprint's placeholder text wordmark per the design owner's direction.
const SANO_LOGO_SVG = `<svg viewBox="0 0 315.66 87.26" width="76" height="21" style="display:block" aria-label="SANO">
  <g fill="#16130f">
    <path d="M26.17,45.71c-4.05,0-7.85-1.58-10.71-4.44-2.86-2.86-4.44-6.67-4.44-10.71s1.58-7.85,4.44-10.71,6.67-4.44,10.71-4.44h52.29v7.32H26.17c-4.32,0-7.83,3.51-7.83,7.83s3.51,7.83,7.83,7.83h7.74l-7.32,7.32h-.41Z"/>
    <path d="M9.6,68.69l7.32-7.32h56.42c2.09,0,4.06-.81,5.54-2.29l1.92-1.92,5.84,4.52-2.58,2.58c-2.86,2.86-6.67,4.44-10.71,4.44H9.6Z"/>
    <path d="M166.3,68.69l-43.34-43.34-22.36,22.36-5.84-4.52,28.2-28.2,53.7,53.7h-10.36Z"/>
    <path d="M110.91,68.69c-3.34,0-6.63-1.12-9.27-3.17l-23.51-18.18c-1.36-1.05-3.06-1.64-4.79-1.64h-40.06l7.32-7.32h32.74c3.34,0,6.63,1.12,9.27,3.17l23.51,18.18c1.36,1.05,3.06,1.64,4.79,1.64h38.69v7.32h-38.69Z"/>
    <path d="M214.33,68.69c-2.76,0-5.36-1.07-7.31-3.03l-41.96-41.96c-.57-.57-1.32-.88-2.13-.88-.4,0-.78.08-1.15.23-1.13.47-1.86,1.56-1.86,2.78v18.25l-7.32-7.32v-10.92c0-4.19,2.5-7.94,6.38-9.55,1.26-.52,2.59-.79,3.95-.79,2.76,0,5.36,1.07,7.31,3.03l41.96,41.96c.57.57,1.32.88,2.13.88.4,0,.78-.08,1.15-.23,1.13-.47,1.86-1.56,1.86-2.78V15.4h7.32v42.95c0,4.19-2.5,7.94-6.38,9.55-1.26.52-2.59.79-3.95.79Z"/>
    <path d="M242.17,68.69c-5.62-.09-10.19-4.72-10.19-10.33v-13.92l7.32,7.32v6.6c0,1.63,1.31,2.98,2.92,3.01h51.59c1.59-.03,2.9-1.38,2.91-3.01V25.74c0-.87-.38-1.7-1.04-2.27-.53-.46-1.22-.73-1.92-.74h-51.52c-.69.01-1.37.27-1.9.74-.66.57-1.04,1.4-1.04,2.27v19.34l-7.32-7.32v-12.02c0-2.99,1.3-5.84,3.56-7.8,1.83-1.59,4.17-2.49,6.59-2.53h51.74c2.44.04,4.78.94,6.61,2.53,2.26,1.96,3.56,4.81,3.56,7.8v32.62c0,5.61-4.56,10.24-10.17,10.33h-51.7Z"/>
  </g>
</svg>`;

// Additive media overrides — NOT part of the verbatim blueprint CSS block.
// Justified photo gallery: the embedded layout script (GALLERY_SCRIPT below)
// measures each photo and groups the non-feature photos into flush rows. Rows
// are sized with flex-grow (∝ each photo's aspect) + a per-row `aspect-ratio`,
// so the layout scales flush at ANY width — the transient screen popup and the
// real A4 print width alike — with no fixed-height crop band. Before the script
// runs (or if it fails), the fallback below simply stacks each photo full-width
// at its true aspect: larger, but still never cropped.
// All sizing lives here (not inline) so no numeric % leaks into the report body.
const REPORT_MEDIA_CSS = `
  .gallery{ margin-top:9px; }
  .gitem{ position:relative; margin:0; min-width:0; overflow:hidden;
    border:1px solid var(--line-sub); background:var(--paper-2); }
  .gitem img{ display:block; width:100%; height:auto; object-fit:cover; } /* fallback: true aspect */
  /* justified row: figures fill the row width in proportion to their aspect,
     the row's height comes from its inline aspect-ratio. */
  .grow-row{ display:flex; gap:8px; align-items:stretch; margin-top:8px; }
  .grow-row .gitem{ flex-basis:0; }
  .grow-row .gitem img{ height:100%; }
  .grow-row .gspace{ flex-basis:0; min-width:0; }
  /* full-width feature (a landscape first photo), shown at its TRUE aspect */
  .feature{ margin-top:0; border:1px solid var(--ink); }
  .feature img{ width:100%; height:auto; }
  /* caption overlay — one treatment for feature and flowed photos */
  .gcap{ position:absolute; left:0; right:0; bottom:0; background:var(--ink); color:var(--paper);
    font-size:10px; padding:6px 10px; display:flex; gap:8px; align-items:center; }
  .gcap .d{ color:var(--sand-lt); font-weight:600; letter-spacing:.08em; text-transform:uppercase;
    font-size:9px; white-space:nowrap; }
  .gcap .t{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
`;

// Self-contained gallery layout, embedded in the report so it justifies itself
// on load (works even if the HTML is printed standalone). Runs on window 'load'
// (all <img> measured), assigns the landscape first photo a full-width feature
// row, greedily groups the rest into justified rows, then flags __galleryReady
// so exportClientReportPdf knows the layout settled before it prints. Any error
// leaves the never-cropped full-width fallback in place. NOTE: keep this free of
// literal "<digits>%" — the report-body renders no numeric percentage.
const GALLERY_SCRIPT = `<script>
${LAYOUT_JUSTIFIED_JS}
(function(){
  function build(){
    try{
      var gallery = document.getElementById('gallery');
      if(!gallery){ window.__galleryReady = true; return; }
      var kids = gallery.children, figs = [];
      for(var i=0;i<kids.length;i++){ if(kids[i].tagName === 'FIGURE') figs.push(kids[i]); }
      if(figs.length === 0){ window.__galleryReady = true; return; }
      var aspects = [];
      for(var j=0;j<figs.length;j++){
        var im = figs[j].getElementsByTagName('img')[0];
        aspects.push((im && im.naturalWidth > 0 && im.naturalHeight > 0) ? (im.naturalWidth / im.naturalHeight) : 1.3333);
      }
      var start = 0;
      if(aspects[0] >= ${GALLERY_FEATURE_MIN_ASPECT}){ figs[0].className = 'gitem feature'; start = 1; }
      var rowFigs = figs.slice(start), rowAspects = aspects.slice(start);
      var rows = layoutJustified(rowAspects, { containerWidth:${GALLERY_REF_WIDTH_PX}, targetRowHeight:${GALLERY_TARGET_ROW_PX}, gap:${GALLERY_GAP_PX}, maxRowHeight:${GALLERY_MAX_ROW_PX}, maxItemsPerRow:${GALLERY_MAX_ITEMS_PER_ROW} });
      for(var r=0;r<rows.length;r++){
        var rowDiv = document.createElement('div');
        rowDiv.className = 'grow-row';
        var sum = 0, items = rows[r].items;
        for(var c=0;c<items.length;c++){ sum += rowAspects[items[c].index]; }
        // A row the model clamped to maxRowHeight (count-capped, or a sparse
        // last row) must NOT be stretched flush — that would inflate the
        // photos far past the clamp. Pad it with a flex spacer instead so the
        // photos keep the clamped height and the row ends ragged.
        var gaps = ${GALLERY_GAP_PX} * (items.length > 1 ? items.length - 1 : 0);
        var flushH = (${GALLERY_REF_WIDTH_PX} - gaps) / sum;
        var padSum = flushH > rows[r].height + 0.5 ? (${GALLERY_REF_WIDTH_PX} - gaps) / rows[r].height : 0;
        rowDiv.style.aspectRatio = String(padSum > 0 ? padSum : sum);
        for(var d=0;d<items.length;d++){
          var idx = items[d].index, f = rowFigs[idx];
          f.style.flexGrow = String(rowAspects[idx]);
          rowDiv.appendChild(f);
        }
        if(padSum > 0){
          var pad = document.createElement('div');
          pad.className = 'gspace';
          pad.style.flexGrow = String(padSum - sum);
          rowDiv.appendChild(pad);
        }
        gallery.appendChild(rowDiv);
      }
      window.__galleryReady = true;
    }catch(e){ window.__galleryReady = true; }
  }
  if(document.readyState === 'complete'){ build(); }
  else { window.addEventListener('load', build); }
  setTimeout(function(){ if(!window.__galleryReady){ build(); } }, 2500);
})();
</script>`;

export function renderClientReportHtml(draft: ClientReportDraft): string {
  const kicker = draft.kind === 'harian' ? 'Laporan Harian' : 'Laporan Mingguan';
  const periodeLong = fmtPeriodLong(draft.kind, draft.periodStart, draft.periodEnd);
  const periodeShort = fmtPeriodShort(draft.kind, draft.periodStart, draft.periodEnd);
  const revisionTag = (draft.revision ?? 1) > 1 ? ` · R${draft.revision}` : '';
  const reportTag = `Laporan #${String(draft.reportNo).padStart(2, '0')}${revisionTag}`;

  const crewCell = draft.crewTotal != null
    ? `<div class="val">${esc(draft.crewTotal)} orang</div>${draft.crewBreakdown ? `<div class="crew">${esc(draft.crewBreakdown)}</div>` : ''}`
    : `<div class="val">—</div>`;

  const updateRows = draft.updates.map((u) => `
      <div class="row"><span class="date">${esc(u.date)}</span><span class="area">${esc(u.area)}</span><span class="note">${esc(u.note)}</span></div>`).join('');

  // All photos (hero first, then the rest) go into one gallery. Each renders as
  // a real <img> (not CSS background-image), which prints reliably — browsers
  // omit background images from PDF output by default. The embedded
  // GALLERY_SCRIPT measures them at load and arranges the justified rows;
  // sizing lives in REPORT_MEDIA_CSS so no inline % leaks into the body.
  const photos = draft.hero ? [draft.hero, ...draft.thumbs] : draft.thumbs;
  const gallery = photos.length
    ? `<div class="gallery" id="gallery">${photos.map((p) => `
        <figure class="gitem"><img src="${esc(p.url)}" alt="" /><figcaption class="gcap"><span class="d">${esc(p.date)}</span><span class="t">${esc(p.caption)}</span></figcaption></figure>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SANO · ${esc(draft.projectName)} — ${esc(reportTag)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<style>${BLUEPRINT_CSS}</style>
<style>${REPORT_MEDIA_CSS}</style></head>
<body>
  <div class="sheet">
    <span class="mark tl"></span><span class="mark tr"></span><span class="mark bl"></span><span class="mark br"></span>
    <div class="top">
      <div class="brand">${SANO_LOGO_SVG}</div>
      <div class="hdrmeta">Konfidensial<br><b>${esc(reportTag)}</b><br><span>${esc(periodeShort)}</span></div>
    </div>
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(draft.projectName)}</h1>
    <div class="subtitle">${esc(draft.subtitle)}</div>
    <div class="strip">
      <div class="cell"><div class="lab">Klien</div><div class="val">${esc(draft.clientName ?? '—')}</div></div>
      <div class="cell"><div class="lab">Periode</div><div class="val">${esc(periodeLong)}</div></div>
      <div class="cell"><div class="lab">Cuaca</div><div class="val">${esc(draft.weather ?? '—')}</div></div>
      <div class="cell"><div class="lab">Tenaga Kerja</div>${crewCell}</div>
      <div class="cell"><div class="lab">Status</div><div class="val accent">${esc(draft.statusLabel)}</div></div>
    </div>
    <section>
      <div class="sec-head"><span class="no">01</span><h2>Update Lapangan</h2></div>
      <div class="updates">${updateRows}</div>
    </section>
    <section>
      <div class="sec-head"><span class="no">02</span><h2>Dokumentasi Lapangan</h2></div>
      ${gallery}
    </section>
    <div class="closing">
      <div class="plan">
        <div class="body"><span class="no">03</span><h2>Rencana Periode Berikutnya</h2><p>${esc(draft.nextPlan)}</p></div>
        <div class="safety"><div class="lab">Keselamatan</div><div class="num">${esc(draft.safetyIncidents)} Insiden</div><div class="sub">Lingkungan Aman</div></div>
      </div>
      <div class="runfoot">
        <span>SANcontractor © 2026 · Konfidensial</span>
        <span>${esc(draft.projectName)} · ${esc(reportTag)}</span>
        <span>${esc(periodeShort)}</span>
      </div>
      <div class="dimline">A4 · 210 × 297 mm</div>
    </div>
  </div>
  ${GALLERY_SCRIPT}
</body></html>`;
}

export async function exportClientReportPdf(draft: ClientReportDraft): Promise<void> {
  if (Platform.OS !== 'web') {
    throw new Error('Export PDF laporan klien hanya tersedia di versi web untuk saat ini.');
  }
  const html = renderClientReportHtml(draft);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup diblokir. Izinkan popup untuk mencetak laporan.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Fidelity safeguard: wait for Space Grotesk before printing (spec §1.2).
  try {
    // @ts-ignore - document.fonts exists in browsers
    if (win.document.fonts?.ready) await win.document.fonts.ready;
  } catch { /* ignore font API gaps */ }
  // Wait for photos to finish loading, else print() fires on blank <img>s.
  try {
    const imgs = Array.from(win.document.images);
    await Promise.all(imgs.map((img) => (img.complete
      ? Promise.resolve()
      : new Promise<void>((res) => { img.addEventListener('load', () => res()); img.addEventListener('error', () => res()); }))));
  } catch { /* ignore */ }
  // Wait for the justified-gallery layout pass (GALLERY_SCRIPT, runs on the
  // popup's load event) to arrange the photos before the print snapshot is
  // taken. Bounded poll so a script hiccup can never hang the print action.
  try {
    const deadline = Date.now() + 3000;
    // @ts-ignore - __galleryReady is set by the embedded layout script
    while (!win.__galleryReady && Date.now() < deadline) {
      await new Promise<void>((res) => setTimeout(res, 50));
    }
  } catch { /* ignore */ }
  win.focus();
  win.print();
}
