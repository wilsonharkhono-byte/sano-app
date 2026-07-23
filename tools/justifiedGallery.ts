// SANO — justified photo-gallery layout (shared source of truth)
//
// The Client Progress Report packs uploaded site photos into a "justified"
// gallery (flush, edge-aligned rows where every photo keeps its true aspect
// ratio, à la Google Photos / Flickr) so nothing is cropped into a fixed band.
//
// The row-grouping math runs inside the PRINT WINDOW (it needs each <img>'s
// measured naturalWidth/naturalHeight), so it ships as a self-contained JS
// source string embedded in the report HTML. Exporting it as a string — rather
// than a live function embedded via `.toString()` — means the exact code the
// browser runs is the exact code the unit tests exercise (tools/__tests__/
// justifiedGallery.test.ts materialises it with `new Function`), with no risk
// of a bundler rewriting the function body into helper calls the popup can't
// resolve. The app itself never eval()s this — only the test does.
//
// Written in plain, closure-free ES so it is valid on its own in any browser:
// no `??`, no `?.`, no spread, references only its args and locals.

export interface JustifiedItem {
  index: number; // index into the input `aspects` array
  width: number; // laid-out width, in the same unit as containerWidth
}
export interface JustifiedRow {
  height: number; // row height, in the same unit as containerWidth
  items: JustifiedItem[];
}
export interface JustifiedOptions {
  containerWidth: number; // width of the gallery content box
  targetRowHeight: number; // desired row height; rows commit at or below this
  gap?: number; // space between photos in a row (default 0)
  maxRowHeight?: number; // clamp so a sparse last row isn't blown up (default target * 1.33)
  maxItemsPerRow?: number; // legibility cap: commit a row at this count even above target height (0/absent = unlimited)
}

export const LAYOUT_JUSTIFIED_JS = `function layoutJustified(aspects, opts) {
  var gap = (opts.gap === undefined || opts.gap === null) ? 0 : opts.gap;
  var target = opts.targetRowHeight;
  var maxH = (opts.maxRowHeight === undefined || opts.maxRowHeight === null) ? target * 1.33 : opts.maxRowHeight;
  var maxN = (opts.maxItemsPerRow === undefined || opts.maxItemsPerRow === null) ? 0 : opts.maxItemsPerRow;
  var W = opts.containerWidth;
  var rows = [];
  var rowIdx = [];      // input indices in the current row
  var rowAspects = [];  // their aspect ratios
  var sumAspect = 0;

  function rowHeight(aspSum, count) {
    var gaps = gap * (count > 1 ? count - 1 : 0);
    return aspSum > 0 ? (W - gaps) / aspSum : 0;
  }
  function commit(idxs, asps, height) {
    var items = [];
    for (var k = 0; k < idxs.length; k++) {
      items.push({ index: idxs[k], width: asps[k] * height });
    }
    rows.push({ height: height, items: items });
  }

  for (var i = 0; i < aspects.length; i++) {
    var a = aspects[i];
    if (!(a > 0)) continue; // skip zero / negative / NaN aspects
    rowIdx.push(i);
    rowAspects.push(a);
    sumAspect += a;
    var h = rowHeight(sumAspect, rowIdx.length);
    if (h <= target || (maxN > 0 && rowIdx.length >= maxN)) {
      commit(rowIdx, rowAspects, h < maxH ? h : maxH);
      rowIdx = [];
      rowAspects = [];
      sumAspect = 0;
    }
  }
  if (rowIdx.length > 0) {
    var natural = rowHeight(sumAspect, rowIdx.length);
    commit(rowIdx, rowAspects, natural < maxH ? natural : maxH);
  }
  return rows;
}`;

// ---------------------------------------------------------------------------
// Shared layout constants (used by the print-window glue in clientReportHtml.ts).
// Grouping is computed against a fixed print-tuned reference width so it is
// independent of the transient popup window's size; the DOM is then rendered
// resolution-independently (flex-grow + aspect-ratio) so it scales flush at the
// real A4 print width.
// ---------------------------------------------------------------------------

// A4 content width: 210mm − 2×14mm side margins ≈ 182mm ≈ 688px at 96dpi.
export const GALLERY_REF_WIDTH_PX = 688;
export const GALLERY_TARGET_ROW_PX = 200;
export const GALLERY_MAX_ROW_PX = 300;
export const GALLERY_GAP_PX = 8;
// A first photo at least this wide (landscape) earns the full-width feature row;
// portrait/square first photos join the justified rows instead of being crushed.
export const GALLERY_FEATURE_MIN_ASPECT = 1.3;
// Legibility floor: site photos are often dense (progress-report collages,
// portrait phone shots), so never pack more than this many into one A4 row —
// 3 portraits still print ≥ ~56mm wide. Overflow rows simply flow onto the
// next printed page.
export const GALLERY_MAX_ITEMS_PER_ROW = 3;
