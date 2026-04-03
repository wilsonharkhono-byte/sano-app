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
}
