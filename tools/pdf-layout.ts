// tools/pdf-layout.ts
// SANO — PDF Layout Engine
// Shared primitives for generating print-ready PDF reports with consistent branding.

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb, PDFImage } from 'pdf-lib';

// ── Design Tokens (mapped from workflows/theme.ts for PDF context) ────

export const PDF = {
  // A4 dimensions in points
  PAGE_W: 595.28,
  PAGE_H: 841.89,

  // Margins
  ML: 40,   // margin left
  MR: 40,   // margin right
  MT: 50,   // margin top
  MB: 40,   // margin bottom

  // Derived
  get CW() { return this.PAGE_W - this.ML - this.MR; },   // content width = 515.28
  get TOP() { return this.PAGE_H - this.MT; },             // top of content
  get BOTTOM() { return this.MB + 20; },                   // bottom safety (above footer)
} as const;

export const C = {
  primary:    rgb(0.078, 0.071, 0.063),
  accent:     rgb(0.698, 0.624, 0.525),
  accentDark: rgb(0.478, 0.420, 0.337),
  bg:         rgb(1, 1, 1),
  surface:    rgb(0.992, 0.980, 0.965),
  surfaceAlt: rgb(0.961, 0.953, 0.937),
  text:       rgb(0.078, 0.071, 0.063),
  textSec:    rgb(0.322, 0.306, 0.286),
  border:     rgb(0.824, 0.816, 0.784),
  borderLight:rgb(0.910, 0.902, 0.882),
  ok:         rgb(0.239, 0.545, 0.251),
  okBg:       rgb(0.926, 0.969, 0.928),
  info:       rgb(0.082, 0.396, 0.753),
  infoBg:     rgb(0.914, 0.941, 0.980),
  warning:    rgb(0.902, 0.318, 0.000),
  warningBg:  rgb(0.992, 0.941, 0.914),
  critical:   rgb(0.776, 0.157, 0.157),
  criticalBg: rgb(0.984, 0.926, 0.926),
  white:      rgb(1, 1, 1),
};

// ── Font sizes ────────────────────────────────────────────────────────

export const FS = {
  xs:    7.5,
  sm:    8.5,
  base:  10,
  md:    11,
  lg:    12,
  xl:    14,
  xxl:   18,
  title: 16,
};

// ── SanoDoc: PDF document wrapper with page/cursor management ─────────

export interface SanoDocFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export class SanoDoc {
  doc: PDFDocument;
  fonts!: SanoDocFonts;
  page!: PDFPage;
  y: number = 0;
  pageNum: number = 0;
  totalPages: number = 0;

  // Report metadata
  reportTitle: string = '';
  projectName: string = '';
  generatedAt: string = '';

  private pages: PDFPage[] = [];

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create(opts: {
    title: string;
    projectName: string;
    generatedAt: string;
  }): Promise<SanoDoc> {
    const doc = await PDFDocument.create();
    doc.setTitle(opts.title);
    doc.setProducer('SANO Construction Management');
    doc.setCreator('SANO');

    const sd = new SanoDoc(doc);
    sd.fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    sd.reportTitle = opts.title;
    sd.projectName = opts.projectName;
    sd.generatedAt = opts.generatedAt;

    sd.addPage();
    return sd;
  }

  // ── Page management ──────────────────────────────────────────────

  addPage(): PDFPage {
    this.page = this.doc.addPage([PDF.PAGE_W, PDF.PAGE_H]);
    this.pageNum += 1;
    this.pages.push(this.page);
    this.y = PDF.TOP;

    // White background (explicit for PDF viewers that default to gray)
    this.page.drawRectangle({
      x: 0, y: 0,
      width: PDF.PAGE_W, height: PDF.PAGE_H,
      color: C.white,
    });

    this._drawHeader();
    this.y -= 12; // gap after header
    return this.page;
  }

  /** Ensure at least `needed` points of vertical space; add page if not. */
  ensureSpace(needed: number): void {
    if (this.y - needed < PDF.BOTTOM) {
      this.addPage();
    }
  }

  /** Finalize: draw footers on all pages (needs total page count). */
  finalize(): void {
    this.totalPages = this.pages.length;
    for (let i = 0; i < this.pages.length; i++) {
      this._drawFooter(this.pages[i], i + 1);
    }
  }

  async save(): Promise<Uint8Array> {
    this.finalize();
    return this.doc.save();
  }

  // ── Header ───────────────────────────────────────────────────────

  private _drawHeader(): void {
    const p = this.page;
    const topY = PDF.PAGE_H - 30;

    // "SANO" wordmark
    p.drawText('SANO', {
      x: PDF.ML,
      y: topY,
      size: FS.title,
      font: this.fonts.bold,
      color: C.primary,
    });

    // Report title (after wordmark)
    const sanoWidth = this.fonts.bold.widthOfTextAtSize('SANO', FS.title);
    p.drawText(`  ·  ${this.reportTitle}`, {
      x: PDF.ML + sanoWidth,
      y: topY,
      size: FS.lg,
      font: this.fonts.bold,
      color: C.primary,
    });

    // Page number (right-aligned) — placeholder, updated in finalize
    const pageLabel = `Hal. ${this.pageNum}`;
    const pageLabelWidth = this.fonts.regular.widthOfTextAtSize(pageLabel, FS.sm);
    p.drawText(pageLabel, {
      x: PDF.PAGE_W - PDF.MR - pageLabelWidth,
      y: topY + 2,
      size: FS.sm,
      font: this.fonts.regular,
      color: C.textSec,
    });

    // Accent divider line
    const lineY = topY - 10;
    p.drawLine({
      start: { x: PDF.ML, y: lineY },
      end: { x: PDF.PAGE_W - PDF.MR, y: lineY },
      thickness: 1,
      color: C.accent,
    });

    // Project name + date
    const fmtDate = new Date(this.generatedAt).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    p.drawText(`${this.projectName}  ·  ${fmtDate}`, {
      x: PDF.ML,
      y: lineY - 13,
      size: FS.sm,
      font: this.fonts.regular,
      color: C.textSec,
    });

    this.y = lineY - 30;
  }

  // ── Footer ───────────────────────────────────────────────────────

  private _drawFooter(page: PDFPage, pageNumber: number): void {
    const footerY = PDF.MB - 5;

    // Divider
    page.drawLine({
      start: { x: PDF.ML, y: footerY + 12 },
      end: { x: PDF.PAGE_W - PDF.MR, y: footerY + 12 },
      thickness: 0.5,
      color: C.border,
    });

    // Left: branding
    const fmtDate = new Date(this.generatedAt).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    page.drawText(`Digenerate oleh SANO  ·  ${fmtDate}`, {
      x: PDF.ML,
      y: footerY,
      size: FS.xs,
      font: this.fonts.regular,
      color: C.textSec,
    });

    // Right: page numbers
    const label = `Halaman ${pageNumber} dari ${this.totalPages}`;
    const w = this.fonts.regular.widthOfTextAtSize(label, FS.xs);
    page.drawText(label, {
      x: PDF.PAGE_W - PDF.MR - w,
      y: footerY,
      size: FS.xs,
      font: this.fonts.regular,
      color: C.textSec,
    });
  }

  // ── Text primitives ──────────────────────────────────────────────

  /** Draw a single line of text at current Y, advance cursor. */
  text(
    str: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      x?: number;
      maxWidth?: number;
      lineGap?: number;
    } = {},
  ): void {
    const size = opts.size ?? FS.base;
    const font = opts.font ?? this.fonts.regular;
    const color = opts.color ?? C.text;
    const x = opts.x ?? PDF.ML;
    const maxWidth = opts.maxWidth ?? PDF.CW;
    const lineGap = opts.lineGap ?? 4;

    const lines = this._wrapText(str, font, size, maxWidth);
    for (const line of lines) {
      this.ensureSpace(size + lineGap);
      this.page.drawText(line, { x, y: this.y, size, font, color });
      this.y -= size + lineGap;
    }
  }

  /** Sanitize text for pdf-lib (which cannot render control characters). */
  _sanitize(text: string): string {
    return text.replace(/[\r\n\t]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  /** Word-wrap text to fit within maxWidth. Handles embedded newlines. */
  _wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    if (!text) return [''];
    // Split on newlines first, then wrap each paragraph
    const paragraphs = text.split(/\r?\n/);
    const lines: string[] = [];

    for (const para of paragraphs) {
      const clean = para.replace(/\t/g, ' ').trim();
      if (!clean) { lines.push(''); continue; }
      const words = clean.split(' ').filter(Boolean);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, size);
        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
  }

  /** Measure text width. */
  measureText(str: string, font?: PDFFont, size?: number): number {
    return (font ?? this.fonts.regular).widthOfTextAtSize(str, size ?? FS.base);
  }

  /**
   * Truncate text so it fits within maxWidth (in points).
   * Appends '…' when text is clipped. Returns the original string if it fits.
   */
  _truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
    if (!text) return '';
    text = this._sanitize(text);
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    // Binary search for the longest prefix that fits with an ellipsis
    const ellipsis = '…';
    let lo = 0;
    let hi = text.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = text.substring(0, mid) + ellipsis;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.substring(0, lo) + ellipsis;
  }

  // ── Section titles & spacing ─────────────────────────────────────

  /** Draw an uppercase section heading with accent underline. */
  sectionTitle(title: string): void {
    this.ensureSpace(28);
    this.y -= 8;
    this.page.drawText(title.toUpperCase(), {
      x: PDF.ML,
      y: this.y,
      size: FS.md,
      font: this.fonts.bold,
      color: C.primary,
    });
    this.y -= 5;
    this.page.drawLine({
      start: { x: PDF.ML, y: this.y },
      end: { x: PDF.ML + 80, y: this.y },
      thickness: 2,
      color: C.accent,
    });
    this.y -= 10;
  }

  /** Small label text (like subsection eyebrow). */
  label(str: string): void {
    this.ensureSpace(14);
    this.page.drawText(str.toUpperCase(), {
      x: PDF.ML,
      y: this.y,
      size: FS.xs,
      font: this.fonts.bold,
      color: C.textSec,
    });
    this.y -= 14;
  }

  /** Vertical spacing. */
  gap(pts: number = 10): void {
    this.y -= pts;
  }

  /** Full-width horizontal rule. */
  hr(color = C.border, thickness = 0.5): void {
    this.ensureSpace(6);
    this.page.drawLine({
      start: { x: PDF.ML, y: this.y },
      end: { x: PDF.PAGE_W - PDF.MR, y: this.y },
      thickness,
      color,
    });
    this.y -= 6;
  }

  // ── KPI Tiles ────────────────────────────────────────────────────

  /** Draw a row of KPI stat tiles (up to 4). */
  kpiRow(tiles: Array<{ value: string; label: string; color: ReturnType<typeof rgb> }>): void {
    const tileCount = tiles.length;
    const gutter = 10;
    const tileW = (PDF.CW - gutter * (tileCount - 1)) / tileCount;
    const tileH = 48;
    const accentBarW = 3;

    this.ensureSpace(tileH + 8);

    tiles.forEach((tile, i) => {
      const x = PDF.ML + i * (tileW + gutter);
      const tileY = this.y - tileH;

      // Background
      this.page.drawRectangle({
        x, y: tileY, width: tileW, height: tileH,
        color: C.surface,
        borderColor: C.borderLight,
        borderWidth: 0.5,
      });

      // Left accent bar
      this.page.drawRectangle({
        x, y: tileY, width: accentBarW, height: tileH,
        color: tile.color,
      });

      // Value — auto-shrink font until it fits inside the tile
      const valStr = String(tile.value);
      const valInnerX = x + accentBarW + 10;
      const valAvailW = tileW - accentBarW - 16;
      let valSize = FS.xxl;
      while (valSize > FS.base && this.fonts.bold.widthOfTextAtSize(valStr, valSize) > valAvailW) {
        valSize -= 1;
      }
      this.page.drawText(valStr, {
        x: valInnerX,
        y: tileY + tileH - 20,
        size: valSize,
        font: this.fonts.bold,
        color: C.text,
      });

      // Label — truncate if it overflows the tile
      const labelAvailW = tileW - accentBarW - 16;
      const labelStr = this._truncateToWidth(tile.label.toUpperCase(), this.fonts.bold, FS.xs, labelAvailW);
      this.page.drawText(labelStr, {
        x: x + accentBarW + 10,
        y: tileY + 8,
        size: FS.xs,
        font: this.fonts.bold,
        color: C.textSec,
      });
    });

    this.y -= tileH + 8;
  }

  // ── Progress Bar ─────────────────────────────────────────────────

  /** Draw a horizontal progress bar with percentage label. */
  progressBar(
    value: number,
    opts: { width?: number; x?: number; label?: string } = {},
  ): void {
    const barW = opts.width ?? PDF.CW;
    const barH = 14;
    const x = opts.x ?? PDF.ML;

    this.ensureSpace(barH + 6);

    const pct = Math.max(0, Math.min(100, value));
    const fillColor = pct >= 80 ? C.ok : pct >= 50 ? C.warning : C.critical;

    // Background track
    this.page.drawRectangle({
      x, y: this.y - barH, width: barW, height: barH,
      color: C.surfaceAlt,
    });

    // Fill
    if (pct > 0) {
      this.page.drawRectangle({
        x, y: this.y - barH,
        width: barW * (pct / 100), height: barH,
        color: fillColor,
      });
    }

    // Label
    const labelStr = opts.label ?? `${pct}%`;
    const labelW = this.fonts.bold.widthOfTextAtSize(labelStr, FS.sm);
    const labelX = pct > 15 ? x + barW * (pct / 100) - labelW - 4 : x + barW * (pct / 100) + 4;
    const labelColor = pct > 15 ? C.white : C.text;
    this.page.drawText(labelStr, {
      x: labelX,
      y: this.y - barH + 3,
      size: FS.sm,
      font: this.fonts.bold,
      color: labelColor,
    });

    this.y -= barH + 6;
  }

  // ── Metric Rows ──────────────────────────────────────────────────

  /** Draw a label — value row, optionally colored. */
  metricRow(
    label: string,
    value: string,
    opts: { valueColor?: ReturnType<typeof rgb>; divider?: boolean } = {},
  ): void {
    const rowH = 18;
    this.ensureSpace(rowH);

    const valW = this.fonts.bold.widthOfTextAtSize(value, FS.base);
    // Leave a minimum 12pt gap between label and right-aligned value
    const maxLabelW = PDF.CW - valW - 12;
    const truncLabel = this._truncateToWidth(label, this.fonts.regular, FS.base, maxLabelW);

    this.page.drawText(truncLabel, {
      x: PDF.ML,
      y: this.y - 11,
      size: FS.base,
      font: this.fonts.regular,
      color: C.textSec,
    });

    this.page.drawText(value, {
      x: PDF.PAGE_W - PDF.MR - valW,
      y: this.y - 11,
      size: FS.base,
      font: this.fonts.bold,
      color: opts.valueColor ?? C.text,
    });

    if (opts.divider !== false) {
      this.page.drawLine({
        start: { x: PDF.ML, y: this.y - rowH + 2 },
        end: { x: PDF.PAGE_W - PDF.MR, y: this.y - rowH + 2 },
        thickness: 0.5,
        color: C.borderLight,
      });
    }

    this.y -= rowH;
  }

  // ── Table ────────────────────────────────────────────────────────

  /**
   * Draw a data table with styled header row, alternating row colors,
   * and automatic page breaks.
   *
   * @param columns - Array of { header, width (fraction of CW), align? }
   * @param rows    - 2D string array of cell values
   */
  table(
    columns: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center' }>,
    rows: string[][],
  ): void {
    const headerH = 20;
    const rowH = 18;
    const cellPadX = 6;
    const cellPadY = 5;

    // Resolve absolute widths from fractions
    const colWidths = columns.map(c => c.width * PDF.CW);

    // ── Draw header ──
    const drawHeader = () => {
      this.ensureSpace(headerH + rowH); // header + at least 1 data row

      let hx = PDF.ML;
      // Header background
      this.page.drawRectangle({
        x: PDF.ML, y: this.y - headerH,
        width: PDF.CW, height: headerH,
        color: C.primary,
      });

      columns.forEach((col, ci) => {
        const textW = this.fonts.bold.widthOfTextAtSize(col.header, FS.sm);
        let tx = hx + cellPadX;
        if (col.align === 'right') tx = hx + colWidths[ci] - textW - cellPadX;
        else if (col.align === 'center') tx = hx + (colWidths[ci] - textW) / 2;

        this.page.drawText(col.header, {
          x: tx,
          y: this.y - headerH + cellPadY + 1,
          size: FS.sm,
          font: this.fonts.bold,
          color: C.white,
        });
        hx += colWidths[ci];
      });

      this.y -= headerH;
    };

    drawHeader();

    // ── Draw data rows ──
    rows.forEach((row, ri) => {
      // Page break check: if not enough space, add page + re-draw header
      if (this.y - rowH < PDF.BOTTOM) {
        this.addPage();
        drawHeader();
      }

      const rowBg = ri % 2 === 0 ? C.white : C.surfaceAlt;
      this.page.drawRectangle({
        x: PDF.ML, y: this.y - rowH,
        width: PDF.CW, height: rowH,
        color: rowBg,
      });

      // Bottom border
      this.page.drawLine({
        start: { x: PDF.ML, y: this.y - rowH },
        end: { x: PDF.PAGE_W - PDF.MR, y: this.y - rowH },
        thickness: 0.3,
        color: C.borderLight,
      });

      let rx = PDF.ML;
      columns.forEach((col, ci) => {
        const rawText = this._sanitize(row[ci] ?? '—');
        const availW = colWidths[ci] - cellPadX * 2;
        const cellText = this._truncateToWidth(rawText, this.fonts.regular, FS.sm, availW);
        const textW = this.fonts.regular.widthOfTextAtSize(cellText, FS.sm);
        let tx = rx + cellPadX;
        if (col.align === 'right') tx = rx + colWidths[ci] - textW - cellPadX;
        else if (col.align === 'center') tx = rx + (colWidths[ci] - textW) / 2;

        this.page.drawText(cellText, {
          x: tx,
          y: this.y - rowH + cellPadY,
          size: FS.sm,
          font: this.fonts.regular,
          color: C.text,
        });
        rx += colWidths[ci];
      });

      this.y -= rowH;
    });
  }

  // ── Status Badge ─────────────────────────────────────────────────

  /** Draw an inline colored status badge at a specific position. */
  badge(
    text: string,
    x: number,
    y: number,
    color: ReturnType<typeof rgb>,
    bgColor: ReturnType<typeof rgb>,
  ): void {
    text = this._sanitize(text);
    const padX = 6;
    const padY = 3;
    const textW = this.fonts.bold.widthOfTextAtSize(text, FS.xs);
    const badgeW = textW + padX * 2;
    const badgeH = FS.xs + padY * 2;

    this.page.drawRectangle({
      x, y: y - padY,
      width: badgeW, height: badgeH,
      color: bgColor,
    });

    this.page.drawText(text, {
      x: x + padX,
      y: y,
      size: FS.xs,
      font: this.fonts.bold,
      color,
    });
  }

  // ── Photo embedding ──────────────────────────────────────────────

  /** Embed a photo from a URL. Returns the PDFImage or null on failure. */
  async embedPhoto(url: string): Promise<PDFImage | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Detect format from magic bytes
      if (bytes[0] === 0x89 && bytes[1] === 0x50) {
        return await this.doc.embedPng(bytes);
      }
      return await this.doc.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  /** Draw a grid of photos (fetched from URLs). Max 4 per row. */
  async photoGrid(
    urls: Array<string | null | undefined>,
    opts: { size?: number; perRow?: number } = {},
  ): Promise<void> {
    const validUrls = urls.filter(Boolean) as string[];
    if (validUrls.length === 0) return;

    const thumbSize = opts.size ?? 90;
    const perRow = opts.perRow ?? 4;
    const gap = 8;
    const rowH = thumbSize + gap;

    for (let i = 0; i < validUrls.length; i += perRow) {
      this.ensureSpace(rowH + 4);
      const batch = validUrls.slice(i, i + perRow);

      for (let j = 0; j < batch.length; j++) {
        const img = await this.embedPhoto(batch[j]);
        const x = PDF.ML + j * (thumbSize + gap);

        if (!img) {
          // Placeholder for failed photo
          this.page.drawRectangle({
            x, y: this.y - thumbSize,
            width: thumbSize, height: thumbSize,
            color: C.surfaceAlt,
            borderColor: C.border,
            borderWidth: 0.5,
          });
          this.page.drawText('Foto tidak tersedia', {
            x: x + 6,
            y: this.y - thumbSize / 2 - 4,
            size: FS.xs,
            font: this.fonts.regular,
            color: C.textSec,
          });
          continue;
        }

        // Scale to fit within thumbSize × thumbSize, preserving aspect ratio
        const scale = Math.min(thumbSize / img.width, thumbSize / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        // Center the image within the square cell
        const offsetX = (thumbSize - drawW) / 2;
        const offsetY = (thumbSize - drawH) / 2;
        this.page.drawImage(img, {
          x: x + offsetX,
          y: this.y - thumbSize + offsetY,
          width: drawW,
          height: drawH,
        });
      }

      this.y -= rowH;
    }
  }
}

// Re-export rgb for builder files
export { rgb } from 'pdf-lib';
