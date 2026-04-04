# PDF Export for All Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a professional, print-ready PDF export option alongside the existing Excel export for every report in the Export Center (OfficeReportsScreen + LaporanScreen), with consistent SANO branding, tables, progress bars, and embedded photos.

**Architecture:** Use `pdf-lib` (MIT, pure JavaScript) to generate PDFs directly in the React Native/Expo app runtime — same pattern as the existing `excel.ts`. A shared layout engine (`tools/pdf-layout.ts`) provides page management, header/footer, table rendering, and visual primitives. Per-report builders in `tools/pdf.ts` mirror the existing Excel builders. The layout uses A4 portrait, white background (print-friendly), with SANO brand colors for accents, headers, and semantic indicators.

**Tech Stack:** pdf-lib (JavaScript PDF creation), React Native Platform API, expo-file-system + expo-sharing (native), Blob download (web)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `tools/pdf-layout.ts` | Shared PDF layout engine: page setup, header/footer, Y-tracker, table drawing, progress bars, KPI tiles, section titles, photo embedding |
| Create | `tools/pdf.ts` | Main `exportReportToPdf()` + per-report builder functions (mirrors `excel.ts`) |
| Modify | `office/screens/OfficeReportsScreen.tsx` | Add PDF button next to Excel in preview modal |
| Modify | `workflows/screens/LaporanScreen.tsx` | Add PDF button next to Excel in preview modal |

---

## Design Specification

### Page Layout (A4 Portrait)
- **Page size:** 595.28 × 841.89 points (A4)
- **Margins:** 40pt left/right, 50pt top, 40pt bottom
- **Content width:** 515.28pt
- **Background:** White (#FFFFFF) — print-friendly

### Header (every page)
```
┌────────────────────────────────────────────────────┐
│  SANO  ·  [Report Title]                    Page N │
│  ─────────────────────── (1pt accent line) ─────── │
│  [Project Name]  ·  [Generated date]               │
└────────────────────────────────────────────────────┘
```
- "SANO" wordmark: Helvetica-Bold 16pt, `#141210`
- Report title: Helvetica-Bold 12pt, `#141210`
- Accent divider: 1pt line, `#B29F86`
- Project/date: Helvetica 9pt, `#524E49`
- Header total height: ~52pt

### Footer (every page)
```
┌────────────────────────────────────────────────────┐
│  ─────────────── (0.5pt border line) ──────────── │
│  Digenerate oleh SANO · [date]         Halaman N  │
└────────────────────────────────────────────────────┘
```
- Divider: 0.5pt, `#B5AFA8`
- Text: Helvetica 8pt, `#524E49`

### Table Styling
- **Header row:** bg `#141210`, text white, Helvetica-Bold 8.5pt
- **Even rows:** bg `#FFFFFF`
- **Odd rows:** bg `#F5F3EF` (warm light gray)
- **Cell padding:** 5pt vertical, 6pt horizontal
- **Borders:** 0.5pt `#D2D0C4` horizontal only (clean modern look)
- **Auto page break** when table row would overflow bottom margin

### KPI Tile Row
- Rounded-corner rectangles side by side
- Large value (18pt bold), small label below (8pt)
- Left color accent bar (3pt wide)
- Background: white with subtle border

### Progress Bar
- Background: `#E8E5E0` rectangle, 12pt tall
- Fill: colored rectangle (green/orange/red based on %)
- Percentage text overlaid: Helvetica-Bold 8pt

### Color Palette (RGB for pdf-lib)
```typescript
const PDF_COLORS = {
  primary:    rgb(0.078, 0.071, 0.063),  // #141210
  accent:     rgb(0.698, 0.624, 0.525),  // #B29F86
  bg:         rgb(1, 1, 1),              // #FFFFFF (white for print)
  surface:    rgb(0.992, 0.980, 0.965),  // #FDFAF6
  surfaceAlt: rgb(0.961, 0.953, 0.937),  // #F5F3EF
  text:       rgb(0.078, 0.071, 0.063),  // #141210
  textSec:    rgb(0.322, 0.306, 0.286),  // #524E49
  border:     rgb(0.824, 0.816, 0.784),  // #D2D0C4
  ok:         rgb(0.239, 0.545, 0.251),  // #3D8B40
  info:       rgb(0.082, 0.396, 0.753),  // #1565C0
  warning:    rgb(0.902, 0.318, 0.000),  // #E65100
  critical:   rgb(0.776, 0.157, 0.157),  // #C62828
  white:      rgb(1, 1, 1),
};
```

---

## Task 1: Install pdf-lib Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdf-lib**

```bash
npm install pdf-lib
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const { PDFDocument } = require('pdf-lib'); console.log('pdf-lib OK');"
```
Expected: `pdf-lib OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdf-lib for PDF report export"
```

---

## Task 2: Create PDF Layout Engine — Page Management

**Files:**
- Create: `tools/pdf-layout.ts`

- [ ] **Step 1: Create the layout engine with page management, header, footer, and Y-tracker**

```typescript
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
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit tools/pdf-layout.ts 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add tools/pdf-layout.ts
git commit -m "feat: add PDF layout engine — page management, header/footer"
```

---

## Task 3: PDF Layout Engine — Drawing Primitives

**Files:**
- Modify: `tools/pdf-layout.ts` (append to SanoDoc class)

- [ ] **Step 1: Add text drawing helpers with word-wrap support**

Append these methods to the `SanoDoc` class:

```typescript
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

  /** Word-wrap text to fit within maxWidth. */
  _wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    if (!text) return [''];
    const words = text.split(' ');
    const lines: string[] = [];
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
    return lines.length > 0 ? lines : [''];
  }

  /** Measure text width. */
  measureText(str: string, font?: PDFFont, size?: number): number {
    return (font ?? this.fonts.regular).widthOfTextAtSize(str, size ?? FS.base);
  }
```

- [ ] **Step 2: Add section title, spacing, and separator helpers**

```typescript
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
```

- [ ] **Step 3: Add KPI tile row drawing**

```typescript
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

      // Value
      this.page.drawText(String(tile.value), {
        x: x + accentBarW + 10,
        y: tileY + tileH - 20,
        size: FS.xxl,
        font: this.fonts.bold,
        color: C.text,
      });

      // Label
      this.page.drawText(tile.label.toUpperCase(), {
        x: x + accentBarW + 10,
        y: tileY + 8,
        size: FS.xs,
        font: this.fonts.bold,
        color: C.textSec,
      });
    });

    this.y -= tileH + 8;
  }
```

- [ ] **Step 4: Add progress bar drawing**

```typescript
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
```

- [ ] **Step 5: Add metric row (label-value pair) drawing**

```typescript
  // ── Metric Rows ──────────────────────────────────────────────────

  /** Draw a label — value row, optionally colored. */
  metricRow(
    label: string,
    value: string,
    opts: { valueColor?: ReturnType<typeof rgb>; divider?: boolean } = {},
  ): void {
    const rowH = 18;
    this.ensureSpace(rowH);

    this.page.drawText(label, {
      x: PDF.ML,
      y: this.y - 11,
      size: FS.base,
      font: this.fonts.regular,
      color: C.textSec,
    });

    const valW = this.fonts.bold.widthOfTextAtSize(value, FS.base);
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
```

- [ ] **Step 6: Add table drawing with auto page-break**

```typescript
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
        const cellText = (row[ci] ?? '—').substring(0, 60); // truncate long cells
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
```

- [ ] **Step 7: Add status badge and photo embedding helpers**

```typescript
  // ── Status Badge ─────────────────────────────────────────────────

  /** Draw an inline colored status badge at a specific position. */
  badge(
    text: string,
    x: number,
    y: number,
    color: ReturnType<typeof rgb>,
    bgColor: ReturnType<typeof rgb>,
  ): void {
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

        this.page.drawImage(img, {
          x,
          y: this.y - thumbSize,
          width: thumbSize,
          height: thumbSize,
        });
      }

      this.y -= rowH;
    }
  }
```

- [ ] **Step 8: Close the class and add the rgb re-export**

At the bottom of the file, after the class closing brace:

```typescript
// Re-export rgb for builder files
export { rgb } from 'pdf-lib';
```

- [ ] **Step 9: Verify file compiles**

```bash
npx tsc --noEmit tools/pdf-layout.ts 2>&1 | head -20
```

- [ ] **Step 10: Commit**

```bash
git add tools/pdf-layout.ts
git commit -m "feat: PDF layout engine — text, tables, KPI tiles, progress bars, photos"
```

---

## Task 4: Create Main PDF Export Function

**Files:**
- Create: `tools/pdf.ts`

- [ ] **Step 1: Create the file with imports, helpers, and main export function**

```typescript
// tools/pdf.ts
// SANO — PDF Export Utility
// Generates print-ready PDF reports from ReportPayload objects.
// On web: triggers a browser file download.
// On native: writes to a temp file and opens the system share dialog.

import { Platform } from 'react-native';
import { encode } from 'base64-arraybuffer';
import type { ReportPayload } from './reports';
import { SanoDoc, C, FS, PDF } from './pdf-layout';

// ── Helpers ───────────────────────────────────────────────────────────

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('id-ID');
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function statusColor(status: string) {
  switch (status) {
    case 'APPROVED': case 'RECEIVED': case 'VERIFIED': case 'ON_TRACK': case 'AHEAD':
      return C.ok;
    case 'REJECTED': case 'CRITICAL': case 'DELAYED':
      return C.critical;
    case 'REVIEWED': case 'UNDER_REVIEW': case 'INFO':
      return C.info;
    default:
      return C.warning;
  }
}

// ── Per-report builders ───────────────────────────────────────────────
// Each builder receives a SanoDoc and the report's `data` payload,
// draws the report body, and returns void.

// (builders defined in subsequent tasks — see Tasks 5–10)

// forward declarations populated below
const BUILDERS: Partial<Record<string, (sd: SanoDoc, d: any) => Promise<void>>> = {};

// ── Main export function ──────────────────────────────────────────────

export async function exportReportToPdf(
  payload: ReportPayload,
  projectName?: string,
): Promise<void> {
  const sd = await SanoDoc.create({
    title: payload.title,
    projectName: projectName ?? payload.project_id,
    generatedAt: payload.generated_at,
  });

  const builder = BUILDERS[payload.type];
  if (builder) {
    await builder(sd, payload.data as any);
  } else {
    // Fallback: render raw JSON preview
    sd.sectionTitle('Data Laporan');
    sd.text(JSON.stringify(payload.data, null, 2).substring(0, 3000), { size: FS.xs });
  }

  const pdfBytes = await sd.save();
  const fileName = `SANO_${payload.type}_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS === 'web') {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    const FileSystem = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');
    const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
    const buffer = pdfBytes.buffer as ArrayBuffer;
    await FileSystem.writeAsStringAsync(fileUri, encode(buffer), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Export ${payload.title}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: main PDF export function with platform-aware output"
```

---

## Task 5: Build progress_summary PDF

**Files:**
- Modify: `tools/pdf.ts` (add builder function + register in BUILDERS)

This is the most complex report and serves as the template for all others.

- [ ] **Step 1: Add the progress_summary builder**

Add above the `BUILDERS` declaration:

```typescript
async function buildProgressSummary(sd: SanoDoc, d: any): Promise<void> {
  // KPI row
  sd.kpiRow([
    { value: fmtPct(d.overall_progress ?? 0), label: 'Progress', color: C.accent },
    { value: String(d.total_items ?? 0), label: 'Total Item', color: C.info },
    { value: String(d.completed_items ?? 0), label: 'Selesai', color: C.ok },
    { value: String(d.not_started_items ?? 0), label: 'Belum Mulai', color: C.warning },
  ]);

  // Overall progress bar
  sd.gap(4);
  sd.label('Progress Keseluruhan');
  sd.progressBar(d.overall_progress ?? 0);

  // Summary metrics
  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Item BoQ', String(d.total_items ?? 0));
  sd.metricRow('Selesai (100%)', String(d.completed_items ?? 0), { valueColor: C.ok });
  sd.metricRow('Sedang Berjalan', String(d.in_progress_items ?? 0), { valueColor: C.info });
  sd.metricRow('Belum Mulai (0%)', String(d.not_started_items ?? 0), { valueColor: C.warning });

  // Item detail table
  if ((d.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Item BoQ');
    sd.table(
      [
        { header: 'Kode', width: 0.12 },
        { header: 'Item Pekerjaan', width: 0.35 },
        { header: 'Satuan', width: 0.10 },
        { header: 'Vol. Rencana', width: 0.14, align: 'right' },
        { header: 'Vol. Terpasang', width: 0.14, align: 'right' },
        { header: 'Progress', width: 0.15, align: 'right' },
      ],
      (d.items ?? []).map((item: any) => [
        item.code ?? '—',
        item.label ?? '—',
        item.unit ?? '—',
        String(item.planned ?? 0),
        String(item.installed ?? 0),
        fmtPct(item.progress ?? 0),
      ]),
    );
  }

  // Progress log
  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Log Progres Terbaru');
    sd.table(
      [
        { header: 'Tanggal', width: 0.13 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item', width: 0.28 },
        { header: 'Qty', width: 0.08, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Status', width: 0.14 },
        { header: 'Lokasi', width: 0.17 },
      ],
      (d.entries ?? []).slice(0, 50).map((entry: any) => [
        fmtDate(entry.created_at),
        entry.boq_code ?? '—',
        entry.boq_label ?? '—',
        String(entry.quantity ?? 0),
        entry.unit ?? '—',
        (entry.work_status ?? '—').replace(/_/g, ' '),
        entry.location ?? '—',
      ]),
    );
  }

  // Photos (first 12)
  const photoUrls = (d.entries ?? []).flatMap((e: any) =>
    (e.photos ?? []).map((p: any) => p.photo_url),
  ).slice(0, 12);

  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}
```

- [ ] **Step 2: Register the builder**

Add to the BUILDERS object:

```typescript
BUILDERS['progress_summary'] = buildProgressSummary;
```

- [ ] **Step 3: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builder for progress_summary report"
```

---

## Task 6: Build material_balance + receipt_log PDFs

**Files:**
- Modify: `tools/pdf.ts`

- [ ] **Step 1: Add material_balance builder**

```typescript
async function buildMaterialBalance(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_materials ?? 0), label: 'Total Material', color: C.info },
    { value: String(d.over_received ?? 0), label: 'Over-Received', color: C.warning },
    { value: String(d.under_received ?? 0), label: 'Under-Received', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Material', String(d.total_materials ?? 0));
  sd.metricRow('Over-Received', String(d.over_received ?? 0), { valueColor: C.warning });
  sd.metricRow('Under-Received', String(d.under_received ?? 0), { valueColor: C.critical });

  if ((d.balances ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Material');
    sd.table(
      [
        { header: 'Material', width: 0.25 },
        { header: 'Satuan', width: 0.08 },
        { header: 'Rencana', width: 0.13, align: 'right' },
        { header: 'Diterima', width: 0.13, align: 'right' },
        { header: 'Terpasang', width: 0.13, align: 'right' },
        { header: 'On-Site', width: 0.13, align: 'right' },
        { header: 'Status', width: 0.15 },
      ],
      (d.balances ?? []).map((b: any) => {
        const received = b.received ?? b.total_received ?? 0;
        const planned = b.planned ?? 0;
        const installed = b.installed ?? 0;
        const onSite = b.on_site ?? received - installed;
        const status = onSite < 0 ? 'Defisit' : received < planned * 0.8 ? 'Perlu Pengadaan' : 'Aman';
        return [
          b.material_name ?? b.name ?? '—',
          b.unit ?? '—',
          String(planned),
          String(received),
          String(installed),
          String(onSite),
          status,
        ];
      }),
    );
  }
}
BUILDERS['material_balance'] = buildMaterialBalance;
```

- [ ] **Step 2: Add receipt_log builder**

```typescript
async function buildReceiptLog(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_pos ?? 0), label: 'Total PO', color: C.info },
    { value: String(d.fully_received ?? 0), label: 'Fully Received', color: C.ok },
    { value: String((d.total_pos ?? 0) - (d.fully_received ?? 0)), label: 'Open/Parsial', color: C.warning },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total PO', String(d.total_pos ?? 0));
  sd.metricRow('Fully Received', String(d.fully_received ?? 0), { valueColor: C.ok });
  sd.metricRow('Open / Parsial', String((d.total_pos ?? 0) - (d.fully_received ?? 0)), { valueColor: C.warning });

  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Log Penerimaan');
    sd.table(
      [
        { header: 'No. PO', width: 0.12 },
        { header: 'Material', width: 0.20 },
        { header: 'Supplier', width: 0.15 },
        { header: 'Dipesan', width: 0.10, align: 'right' },
        { header: 'Diterima', width: 0.10, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Harga/Unit', width: 0.12, align: 'right' },
        { header: 'Status', width: 0.13 },
      ],
      (d.entries ?? []).map((e: any) => [
        e.po_number ?? e.po_ref ?? '—',
        e.material ?? '—',
        e.supplier ?? '—',
        String(e.ordered_qty ?? 0),
        String(e.received_qty ?? 0),
        e.unit ?? '—',
        e.unit_price != null ? fmtRp(e.unit_price) : '—',
        (e.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }

  // Photos
  const photoUrls = (d.receipts ?? []).flatMap((r: any) =>
    (r.photos ?? []).map((p: any) => p.photo_url),
  ).slice(0, 12);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto Penerimaan');
    await sd.photoGrid(photoUrls, { size: 110, perRow: 4 });
  }
}
BUILDERS['receipt_log'] = buildReceiptLog;
```

- [ ] **Step 3: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builders for material_balance + receipt_log"
```

---

## Task 7: Build punch_list + vo_summary PDFs

**Files:**
- Modify: `tools/pdf.ts`

- [ ] **Step 1: Add punch_list builder**

```typescript
async function buildPunchList(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_defects ?? 0), label: 'Total Cacat', color: C.info },
    { value: String(d.critical_open ?? 0), label: 'Critical Open', color: C.critical },
    { value: String(d.major_open ?? 0), label: 'Major Open', color: C.warning },
    { value: String(d.minor_open ?? 0), label: 'Minor Open', color: C.accent },
  ]);

  // Handover eligibility
  sd.gap(4);
  const eligible = d.handover_eligible;
  sd.metricRow(
    'Status Serah Terima',
    eligible ? 'ELIGIBLE' : 'BELUM ELIGIBLE',
    { valueColor: eligible ? C.ok : C.critical },
  );

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Cacat', String(d.total_defects ?? 0));
  sd.metricRow('Masih Open', String(d.open ?? 0), { valueColor: C.warning });
  sd.metricRow('Critical Open', String(d.critical_open ?? 0), { valueColor: C.critical });
  sd.metricRow('Major Open', String(d.major_open ?? 0), { valueColor: C.warning });

  if ((d.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar Cacat');
    sd.table(
      [
        { header: 'Deskripsi', width: 0.28 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'BoQ Ref', width: 0.12 },
        { header: 'Severity', width: 0.12 },
        { header: 'Status', width: 0.15 },
        { header: 'PIC', width: 0.10 },
        { header: 'Tanggal', width: 0.08 },
      ],
      (d.items ?? []).map((item: any) => [
        item.description ?? '—',
        item.location ?? '—',
        item.boq_ref ?? '—',
        item.severity ?? '—',
        (item.status ?? '—').replace(/_/g, ' '),
        item.responsible_party ?? '—',
        fmtDate(item.reported_at),
      ]),
    );
  }

  // Photos
  const photoUrls = (d.items ?? []).flatMap((item: any) => [
    ...(item.report_photos ?? []).map((p: any) => p.photo_url),
    ...(item.repair_photos ?? []).map((p: any) => p.photo_url),
  ]).slice(0, 16);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 100, perRow: 4 });
  }
}
BUILDERS['punch_list'] = buildPunchList;
```

- [ ] **Step 2: Add vo_summary builder**

```typescript
async function buildVoSummary(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_vos ?? 0), label: 'Total VO', color: C.info },
    { value: String(d.total_reworks ?? 0), label: 'Total Rework', color: C.warning },
    { value: fmtRp(d.total_est_cost ?? 0), label: 'Est. Biaya VO', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total VO', String(d.total_vos ?? 0));
  sd.metricRow('Total Rework', String(d.total_reworks ?? 0));
  sd.metricRow('Estimasi Biaya VO', fmtRp(d.total_est_cost ?? 0), { valueColor: C.critical });
  sd.metricRow('Estimasi Dampak Rework', fmtRp(d.total_rework_cost ?? 0), { valueColor: C.warning });

  // By cause breakdown
  if (d.by_cause) {
    sd.gap(6);
    sd.sectionTitle('Distribusi Penyebab');
    Object.entries(d.by_cause).forEach(([cause, count]: any) => {
      sd.metricRow(cause.replace(/_/g, ' '), String(count));
    });
  }

  // VO table
  if ((d.vos ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar VO');
    sd.table(
      [
        { header: 'No. VO', width: 0.09 },
        { header: 'Tanggal', width: 0.10 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'Deskripsi', width: 0.22 },
        { header: 'Pemohon', width: 0.12 },
        { header: 'Est. Biaya', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.10 },
        { header: 'Tipe', width: 0.08 },
      ],
      (d.vos ?? []).map((v: any) => [
        v.entry_code ?? 'VO-000',
        fmtDate(v.created_at),
        v.location ?? '—',
        v.description ?? '—',
        v.requested_by_name ?? '—',
        v.est_cost != null ? fmtRp(v.est_cost) : '—',
        (v.status ?? '—').replace(/_/g, ' '),
        v.is_micro ? 'Mikro' : 'Standar',
      ]),
    );
  }

  // Rework table
  if ((d.reworks ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Daftar Rework');
    sd.table(
      [
        { header: 'No. RE', width: 0.10 },
        { header: 'Tanggal', width: 0.10 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item BoQ', width: 0.20 },
        { header: 'Deskripsi', width: 0.20 },
        { header: 'Penyebab', width: 0.14 },
        { header: 'Biaya', width: 0.14, align: 'right' },
      ],
      (d.reworks ?? []).map((r: any) => [
        r.entry_code ?? 'RE-000',
        fmtDate(r.created_at),
        r.boq_code ?? '—',
        r.boq_label ?? '—',
        r.description ?? '—',
        (r.cause ?? '—').replace(/_/g, ' '),
        r.cost_impact != null ? fmtRp(r.cost_impact) : '—',
      ]),
    );
  }

  // Photos (VO + rework combined)
  const photoUrls = [
    ...(d.vos ?? []).flatMap((v: any) => (v.photos ?? []).map((p: any) => p.photo_url)),
    ...(d.reworks ?? []).flatMap((r: any) => (r.photos ?? []).map((p: any) => p.photo_url)),
  ].slice(0, 16);
  if (photoUrls.length > 0) {
    sd.gap(6);
    sd.sectionTitle('Lampiran Foto');
    await sd.photoGrid(photoUrls, { size: 100, perRow: 4 });
  }
}
BUILDERS['vo_summary'] = buildVoSummary;
```

- [ ] **Step 3: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builders for punch_list + vo_summary"
```

---

## Task 8: Build schedule_variance + weekly_digest PDFs

**Files:**
- Modify: `tools/pdf.ts`

- [ ] **Step 1: Add schedule_variance builder**

```typescript
async function buildScheduleVariance(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_milestones ?? 0), label: 'Total Milestone', color: C.info },
    { value: String(d.on_track ?? 0), label: 'On Track', color: C.ok },
    { value: String(d.at_risk ?? 0), label: 'At Risk', color: C.warning },
    { value: String(d.delayed ?? 0), label: 'Delayed', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Milestone', String(d.total_milestones ?? 0));
  sd.metricRow('On Track / Ahead', String(d.on_track ?? 0), { valueColor: C.ok });
  sd.metricRow('At Risk', String(d.at_risk ?? 0), { valueColor: C.warning });
  sd.metricRow('Delayed', String(d.delayed ?? 0), { valueColor: C.critical });

  if ((d.milestones ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Milestone');
    sd.table(
      [
        { header: 'Milestone', width: 0.30 },
        { header: 'Tgl Rencana', width: 0.15 },
        { header: 'Tgl Revisi', width: 0.15 },
        { header: 'Sisa Hari', width: 0.22, align: 'right' },
        { header: 'Status', width: 0.18 },
      ],
      (d.milestones ?? []).map((m: any) => [
        m.label ?? '—',
        fmtDate(m.planned_date),
        fmtDate(m.revised_date),
        m.days_remaining >= 0
          ? `${m.days_remaining} hari lagi`
          : `Terlambat ${Math.abs(m.days_remaining)} hari`,
        (m.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }
}
BUILDERS['schedule_variance'] = buildScheduleVariance;
```

- [ ] **Step 2: Add weekly_digest builder**

```typescript
async function buildWeeklyDigest(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_activities ?? 0), label: 'Total Aktivitas', color: C.info },
    { value: fmtPct(d.overall_progress ?? 0), label: 'Progress', color: C.accent },
  ]);

  sd.sectionTitle('Ringkasan Minggu');
  sd.metricRow('Periode', `${d.week_start ?? '—'} — ${d.week_end ?? '—'}`);
  sd.metricRow('Total Aktivitas', String(d.total_activities ?? 0));
  sd.metricRow('Progress Keseluruhan', fmtPct(d.overall_progress ?? 0));

  if (d.by_flag) {
    sd.gap(6);
    sd.sectionTitle('Aktivitas per Flag');
    Object.entries(d.by_flag).forEach(([flag, count]: any) => {
      const color = flag === 'CRITICAL' ? C.critical : flag === 'WARNING' ? C.warning : flag === 'OK' ? C.ok : C.info;
      sd.metricRow(flag, String(count), { valueColor: color });
    });
  }

  if (d.by_type) {
    sd.gap(6);
    sd.sectionTitle('Aktivitas per Tipe');
    Object.entries(d.by_type).forEach(([type, count]: any) => {
      sd.metricRow(type, String(count));
    });
  }
}
BUILDERS['weekly_digest'] = buildWeeklyDigest;
```

- [ ] **Step 3: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builders for schedule_variance + weekly_digest"
```

---

## Task 9: Build payroll, client_charge, audit_list PDFs

**Files:**
- Modify: `tools/pdf.ts`

- [ ] **Step 1: Add payroll_support_summary builder**

```typescript
async function buildPayrollSupportSummary(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_entries ?? 0), label: 'Total Entri', color: C.info },
    { value: String(d.total_qty ?? 0), label: 'Total Qty', color: C.accent },
    { value: String((d.by_reporter ?? []).length), label: 'Jumlah Pelapor', color: C.ok },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Tujuan', d.purpose ?? '—');
  sd.metricRow('Total Entri', String(d.total_entries ?? 0));
  sd.metricRow('Total Qty', String(d.total_qty ?? 0));

  if ((d.by_reporter ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Rekap per Pelapor');
    sd.table(
      [
        { header: 'Pelapor', width: 0.50 },
        { header: 'Jumlah Entri', width: 0.25, align: 'right' },
        { header: 'Total Qty', width: 0.25, align: 'right' },
      ],
      (d.by_reporter ?? []).map((g: any) => [
        g.reporter_name ?? '—',
        String(g.entry_count ?? 0),
        String(g.total_qty ?? 0),
      ]),
    );
  }

  if ((d.entries ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Detail Entri');
    sd.table(
      [
        { header: 'Tanggal', width: 0.12 },
        { header: 'Pelapor', width: 0.15 },
        { header: 'Kode BoQ', width: 0.10 },
        { header: 'Item', width: 0.20 },
        { header: 'Qty', width: 0.08, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Lokasi', width: 0.12 },
        { header: 'Catatan', width: 0.15 },
      ],
      (d.entries ?? []).slice(0, 100).map((e: any) => [
        fmtDate(e.created_at),
        e.reporter_name ?? '—',
        e.boq_code ?? '—',
        e.boq_label ?? '—',
        String(e.quantity ?? 0),
        e.unit ?? '—',
        e.location ?? '—',
        e.note ?? '—',
      ]),
    );
  }
}
BUILDERS['payroll_support_summary'] = buildPayrollSupportSummary;
```

- [ ] **Step 2: Add client_charge_report builder**

```typescript
async function buildClientChargeReport(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: fmtRp(d.grand_total_est_cost ?? 0), label: 'Est. Tagihan VO', color: C.critical },
    { value: String(d.vo_charges?.items?.length ?? 0), label: 'VO Klien', color: C.warning },
    { value: String(d.progress_support?.total_entries ?? 0), label: 'Support Entries', color: C.info },
  ]);

  sd.sectionTitle('Ringkasan Tagihan');
  sd.metricRow('Tujuan', d.purpose ?? '—');
  sd.metricRow('Estimasi VO Tagih', fmtRp(d.grand_total_est_cost ?? 0), { valueColor: C.critical });
  sd.metricRow('Jumlah VO Terkait Klien', String(d.vo_charges?.items?.length ?? 0));
  sd.metricRow('Support Progress Entries', String(d.progress_support?.total_entries ?? 0));

  if ((d.vo_charges?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('VO Tagihan Klien');
    sd.table(
      [
        { header: 'Tanggal', width: 0.10 },
        { header: 'Lokasi', width: 0.15 },
        { header: 'Deskripsi', width: 0.22 },
        { header: 'Pemohon', width: 0.13 },
        { header: 'Penyebab', width: 0.12 },
        { header: 'Est. Biaya', width: 0.14, align: 'right' },
        { header: 'Status', width: 0.14 },
      ],
      (d.vo_charges.items ?? []).map((item: any) => [
        fmtDate(item.created_at),
        item.location ?? '—',
        item.description ?? '—',
        item.requested_by_name ?? '—',
        (item.cause ?? '—').replace(/_/g, ' '),
        item.est_cost != null ? fmtRp(item.est_cost) : '—',
        (item.status ?? '—').replace(/_/g, ' '),
      ]),
    );
  }

  if ((d.progress_support?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Support Progress');
    sd.table(
      [
        { header: 'Tanggal', width: 0.12 },
        { header: 'Pelapor', width: 0.15 },
        { header: 'Kode BoQ', width: 0.12 },
        { header: 'Item', width: 0.22 },
        { header: 'Qty', width: 0.10, align: 'right' },
        { header: 'Satuan', width: 0.08 },
        { header: 'Lokasi', width: 0.12 },
        { header: 'Catatan', width: 0.09 },
      ],
      (d.progress_support.items ?? []).slice(0, 80).map((item: any) => [
        fmtDate(item.created_at),
        item.reporter_name ?? '—',
        item.boq_code ?? '—',
        item.boq_label ?? '—',
        String(item.quantity ?? 0),
        item.unit ?? '—',
        item.location ?? '—',
        item.note ?? '—',
      ]),
    );
  }
}
BUILDERS['client_charge_report'] = buildClientChargeReport;
```

- [ ] **Step 3: Add audit_list builder**

```typescript
async function buildAuditList(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.anomalies?.total ?? 0), label: 'Total Anomali', color: C.warning },
    { value: String(d.audit_cases?.total ?? 0), label: 'Audit Case', color: C.info },
    { value: String(d.audit_cases?.open ?? 0), label: 'Case Open', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan');
  sd.metricRow('Total Anomali', String(d.anomalies?.total ?? 0));
  sd.metricRow('Total Audit Case', String(d.audit_cases?.total ?? 0));
  sd.metricRow('Audit Case Open', String(d.audit_cases?.open ?? 0), { valueColor: C.critical });

  if ((d.anomalies?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Anomali');
    sd.table(
      [
        { header: 'Tanggal', width: 0.12 },
        { header: 'Event', width: 0.16 },
        { header: 'Entity', width: 0.12 },
        { header: 'Entity ID', width: 0.18 },
        { header: 'Severity', width: 0.12 },
        { header: 'Deskripsi', width: 0.30 },
      ],
      (d.anomalies.items ?? []).map((item: any) => [
        fmtDate(item.created_at),
        item.event_type ?? '—',
        item.entity_type ?? '—',
        item.entity_id ?? '—',
        item.severity ?? '—',
        item.description ?? '—',
      ]),
    );
  }

  if ((d.audit_cases?.items ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Audit Case');
    sd.table(
      [
        { header: 'Tanggal', width: 0.14 },
        { header: 'Trigger', width: 0.18 },
        { header: 'Entity', width: 0.14 },
        { header: 'Entity ID', width: 0.18 },
        { header: 'Status', width: 0.14 },
        { header: 'Catatan', width: 0.22 },
      ],
      (d.audit_cases.items ?? []).map((item: any) => [
        fmtDate(item.created_at),
        item.trigger_type ?? '—',
        item.entity_type ?? '—',
        item.entity_id ?? '—',
        (item.status ?? '—').replace(/_/g, ' '),
        item.notes ?? '—',
      ]),
    );
  }
}
BUILDERS['audit_list'] = buildAuditList;
```

- [ ] **Step 4: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builders for payroll, client_charge, audit_list"
```

---

## Task 10: Build Principal-Only Report PDFs

**Files:**
- Modify: `tools/pdf.ts`

These 5 reports are only visible to the principal role. They follow the same patterns.

- [ ] **Step 1: Add ai_usage_summary builder**

```typescript
async function buildAIUsageSummary(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_chats ?? 0), label: 'Total Chat', color: C.info },
    { value: String(d.active_users ?? 0), label: 'User Aktif', color: C.ok },
    { value: `${Math.round((d.total_tokens ?? 0) / 1000)}k`, label: 'Total Token', color: C.accent },
  ]);

  sd.sectionTitle('Ringkasan Penggunaan AI');
  sd.metricRow('Total Chat (30 hari)', String(d.total_chats ?? 0));
  sd.metricRow('User Aktif', String(d.active_users ?? 0));
  sd.metricRow('Total Token', `${Math.round((d.total_tokens ?? 0) / 1000)}k`);
  sd.metricRow('Chat Sonnet', String(d.sonnet_chats ?? 0));

  if ((d.by_user ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Penggunaan per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Jumlah Chat', width: 0.20, align: 'right' },
        { header: 'Total Token', width: 0.25, align: 'right' },
        { header: 'Chat Sonnet', width: 0.25, align: 'right' },
      ],
      (d.by_user ?? []).map((u: any) => [
        u.user_name ?? '—',
        String(u.chat_count ?? 0),
        String(u.total_tokens ?? 0),
        String(u.sonnet_count ?? 0),
      ]),
    );
  }

  if ((d.daily_trend ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Tren Harian');
    sd.table(
      [
        { header: 'Tanggal', width: 0.30 },
        { header: 'Jumlah Chat', width: 0.35, align: 'right' },
        { header: 'Token', width: 0.35, align: 'right' },
      ],
      (d.daily_trend ?? []).slice(0, 30).map((row: any) => [
        fmtDate(row.date),
        String(row.chat_count ?? 0),
        String(row.tokens ?? 0),
      ]),
    );
  }
}
BUILDERS['ai_usage_summary'] = buildAIUsageSummary;
```

- [ ] **Step 2: Add approval_sla_user builder**

```typescript
async function buildApprovalSLAUser(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_queued ?? 0), label: 'Total Queued', color: C.info },
    { value: String(d.avg_hours ?? 0), label: 'Avg Hours', color: C.accent },
    { value: String(d.breached ?? 0), label: 'SLA Breached', color: C.critical },
  ]);

  sd.sectionTitle('Ringkasan SLA Approval');
  sd.metricRow('Total Di-Queue', String(d.total_queued ?? 0));
  sd.metricRow('Rata-rata Jam Respons', String(d.avg_hours ?? 0));
  sd.metricRow('SLA Breach', String(d.breached ?? 0), { valueColor: C.critical });

  if ((d.by_user ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('SLA per User');
    sd.table(
      [
        { header: 'User', width: 0.25 },
        { header: 'Queued', width: 0.15, align: 'right' },
        { header: 'Approved', width: 0.15, align: 'right' },
        { header: 'Rejected', width: 0.15, align: 'right' },
        { header: 'Avg Hours', width: 0.15, align: 'right' },
        { header: 'Breach', width: 0.15, align: 'right' },
      ],
      (d.by_user ?? []).map((u: any) => [
        u.user_name ?? '—',
        String(u.queued ?? 0),
        String(u.approved ?? 0),
        String(u.rejected ?? 0),
        String(u.avg_hours ?? 0),
        String(u.breached ?? 0),
      ]),
    );
  }
}
BUILDERS['approval_sla_user'] = buildApprovalSLAUser;
```

- [ ] **Step 3: Add operational_entry_discipline, tool_usage_summary, exception_handling_load builders**

```typescript
async function buildOperationalEntryDiscipline(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: fmtPct(d.photo_coverage_pct ?? 0), label: 'Foto Coverage', color: C.accent },
    { value: String(d.total_entries ?? 0), label: 'Total Entri', color: C.info },
    { value: String(d.entries_with_photo ?? 0), label: 'Dengan Foto', color: C.ok },
  ]);

  sd.sectionTitle('Disiplin Entry Operasional');
  sd.metricRow('Total Entri', String(d.total_entries ?? 0));
  sd.metricRow('Entri dengan Foto', String(d.entries_with_photo ?? 0), { valueColor: C.ok });
  sd.metricRow('Photo Coverage', fmtPct(d.photo_coverage_pct ?? 0));
  sd.gap(4);
  sd.progressBar(d.photo_coverage_pct ?? 0, { label: `Foto coverage: ${fmtPct(d.photo_coverage_pct ?? 0)}` });

  if ((d.by_user ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Coverage per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Total Entri', width: 0.20, align: 'right' },
        { header: 'Dengan Foto', width: 0.25, align: 'right' },
        { header: 'Coverage', width: 0.25, align: 'right' },
      ],
      (d.by_user ?? []).map((u: any) => [
        u.user_name ?? '—',
        String(u.total ?? 0),
        String(u.with_photo ?? 0),
        fmtPct(u.coverage_pct ?? 0),
      ]),
    );
  }
}
BUILDERS['operational_entry_discipline'] = buildOperationalEntryDiscipline;

async function buildToolUsageSummary(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_exports ?? 0), label: 'Total Export', color: C.info },
    { value: String(d.ai_chats ?? 0), label: 'AI Chat', color: C.accent },
    { value: String(d.active_exporters ?? 0), label: 'User Export', color: C.ok },
  ]);

  sd.sectionTitle('Penggunaan Laporan & AI');
  sd.metricRow('Total Export Laporan', String(d.total_exports ?? 0));
  sd.metricRow('Total AI Chat', String(d.ai_chats ?? 0));
  sd.metricRow('User yang Pernah Export', String(d.active_exporters ?? 0));

  if ((d.by_report_type ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Export per Tipe Laporan');
    sd.table(
      [
        { header: 'Tipe Laporan', width: 0.50 },
        { header: 'Jumlah Export', width: 0.50, align: 'right' },
      ],
      (d.by_report_type ?? []).map((r: any) => [
        r.report_type ?? '—',
        String(r.count ?? 0),
      ]),
    );
  }
}
BUILDERS['tool_usage_summary'] = buildToolUsageSummary;

async function buildExceptionHandlingLoad(sd: SanoDoc, d: any): Promise<void> {
  sd.kpiRow([
    { value: String(d.total_holds ?? 0), label: 'Hold', color: C.warning },
    { value: String(d.total_rejects ?? 0), label: 'Reject', color: C.critical },
    { value: String(d.total_overrides ?? 0), label: 'Override', color: C.info },
  ]);

  sd.sectionTitle('Beban Penanganan Exception');
  sd.metricRow('Total Hold', String(d.total_holds ?? 0), { valueColor: C.warning });
  sd.metricRow('Total Reject', String(d.total_rejects ?? 0), { valueColor: C.critical });
  sd.metricRow('Total Override', String(d.total_overrides ?? 0));

  if ((d.anomaly_breakdown ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Anomali per Tipe');
    sd.table(
      [
        { header: 'Tipe Anomali', width: 0.40 },
        { header: 'Jumlah', width: 0.30, align: 'right' },
        { header: 'Severity Avg', width: 0.30, align: 'right' },
      ],
      (d.anomaly_breakdown ?? []).map((a: any) => [
        a.type ?? '—',
        String(a.count ?? 0),
        a.avg_severity ?? '—',
      ]),
    );
  }

  if ((d.by_user ?? []).length > 0) {
    sd.gap(6);
    sd.sectionTitle('Beban per User');
    sd.table(
      [
        { header: 'User', width: 0.30 },
        { header: 'Hold', width: 0.17, align: 'right' },
        { header: 'Reject', width: 0.18, align: 'right' },
        { header: 'Override', width: 0.18, align: 'right' },
        { header: 'Total', width: 0.17, align: 'right' },
      ],
      (d.by_user ?? []).map((u: any) => [
        u.user_name ?? '—',
        String(u.holds ?? 0),
        String(u.rejects ?? 0),
        String(u.overrides ?? 0),
        String((u.holds ?? 0) + (u.rejects ?? 0) + (u.overrides ?? 0)),
      ]),
    );
  }
}
BUILDERS['exception_handling_load'] = buildExceptionHandlingLoad;
```

- [ ] **Step 4: Commit**

```bash
git add tools/pdf.ts
git commit -m "feat: PDF builders for all 5 principal-only reports"
```

---

## Task 11: Wire PDF Button into OfficeReportsScreen

**Files:**
- Modify: `office/screens/OfficeReportsScreen.tsx`

- [ ] **Step 1: Add import for PDF export**

At the top of the file, add:

```typescript
import { exportReportToPdf } from '../../tools/pdf';
```

- [ ] **Step 2: Add PDF exporting state**

Next to the existing `exporting` state:

```typescript
const [exportingPdf, setExportingPdf] = useState(false);
```

- [ ] **Step 3: Add the PDF button in the preview modal button row**

Find the `modalBtnRow` section (around line 246). Replace the existing button row with both Excel and PDF buttons:

```tsx
<View style={styles.modalBtnRow}>
  <TouchableOpacity
    style={[styles.excelBtn, exportingPdf && { opacity: 0.6 }]}
    disabled={exportingPdf}
    onPress={async () => {
      if (!reportPreview) return;
      setExportingPdf(true);
      try {
        await exportReportToPdf(reportPreview, project?.name);
        toast('File PDF siap', 'ok');
      } catch (err: any) {
        toast(err.message ?? 'Gagal export PDF', 'critical');
      } finally {
        setExportingPdf(false);
      }
    }}
  >
    <Ionicons name="document-outline" size={16} color={COLORS.critical} />
    <Text style={[styles.excelBtnText, { color: COLORS.critical }]}>
      {exportingPdf ? 'Exporting...' : 'PDF'}
    </Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={[styles.excelBtn, exporting && { opacity: 0.6 }]}
    disabled={exporting}
    onPress={async () => {
      setExporting(true);
      try {
        await exportReportToExcel(reportPreview!, project?.name);
        toast('File Excel siap', 'ok');
      } catch (err: any) {
        toast(err.message ?? 'Gagal export Excel', 'critical');
      } finally {
        setExporting(false);
      }
    }}
  >
    <Ionicons name="download-outline" size={16} color={COLORS.primary} />
    <Text style={styles.excelBtnText}>{exporting ? 'Exporting...' : 'Excel'}</Text>
  </TouchableOpacity>
  <TouchableOpacity style={[styles.closeFullBtn, { flex: 1 }]} onPress={() => setReportPreview(null)}>
    <Text style={styles.closeFullBtnText}>Tutup Preview</Text>
  </TouchableOpacity>
</View>
```

- [ ] **Step 4: Commit**

```bash
git add office/screens/OfficeReportsScreen.tsx
git commit -m "feat: add PDF export button to OfficeReportsScreen"
```

---

## Task 12: Wire PDF Button into LaporanScreen

**Files:**
- Modify: `workflows/screens/LaporanScreen.tsx`

- [ ] **Step 1: Add import for PDF export**

```typescript
import { exportReportToPdf } from '../../tools/pdf';
```

- [ ] **Step 2: Add PDF exporting state**

```typescript
const [exportingPdf, setExportingPdf] = useState(false);
```

- [ ] **Step 3: Add PDF button in the preview modal button row**

Find the `modalBtnRow` View inside the preview modal in LaporanScreen. Add the PDF button before the existing Excel button, using the same pattern:

```tsx
<View style={styles.modalBtnRow}>
  <TouchableOpacity
    style={[styles.excelBtn, exportingPdf && { opacity: 0.6 }]}
    disabled={exportingPdf}
    onPress={async () => {
      if (!reportPreview) return;
      setExportingPdf(true);
      try {
        await exportReportToPdf(reportPreview, project?.name);
        toast('File PDF siap', 'ok');
      } catch (err: any) {
        toast(err.message ?? 'Gagal export PDF', 'critical');
      } finally {
        setExportingPdf(false);
      }
    }}
  >
    <Ionicons name="document-outline" size={16} color={COLORS.critical} />
    <Text style={[styles.excelBtnText, { color: COLORS.critical }]}>
      {exportingPdf ? 'Exporting...' : 'PDF'}
    </Text>
  </TouchableOpacity>
  {/* Keep existing Excel button unchanged */}
  <TouchableOpacity
    style={[styles.excelBtn, exporting && { opacity: 0.6 }]}
    disabled={exporting}
    onPress={async () => { /* existing Excel export logic stays the same */ }}
  >
    <Ionicons name="download-outline" size={16} color={COLORS.primary} />
    <Text style={styles.excelBtnText}>{exporting ? 'Exporting...' : 'Excel'}</Text>
  </TouchableOpacity>
  <TouchableOpacity style={[styles.closeFullBtn, { flex: 1 }]} onPress={() => setReportPreview(null)}>
    <Text style={styles.closeFullBtnText}>Tutup Preview</Text>
  </TouchableOpacity>
</View>
```

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/LaporanScreen.tsx
git commit -m "feat: add PDF export button to LaporanScreen"
```

---

## Task 13: End-to-End Test

**Files:**
- Test: manual testing via Expo web

- [ ] **Step 1: Start the dev server**

```bash
npx expo start --web
```

- [ ] **Step 2: Navigate to Reports tab → generate any report → click PDF**

Verify:
- PDF downloads in browser
- File opens correctly in PDF viewer
- Header shows "SANO · [Report Title]" with accent line
- Project name and date appear below header
- KPI tiles render with colored accent bars
- Tables have dark header row with white text
- Alternating row colors (white / warm gray)
- Footer shows "Digenerate oleh SANO" + page numbers
- Multiple pages break correctly with repeated headers/footers

- [ ] **Step 3: Test at least 3 different report types**

Test progress_summary, punch_list, and schedule_variance to cover:
- Progress bars
- Photo grids
- Status-colored metrics
- Multi-page tables

- [ ] **Step 4: Test on mobile (optional)**

If Expo Go / dev client is available, verify PDF opens share dialog on iOS/Android.

- [ ] **Step 5: Commit any test-discovered fixes**

```bash
git add -A
git commit -m "fix: PDF export adjustments from testing"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Install pdf-lib | 2 min |
| 2 | Layout engine — page management | 5 min |
| 3 | Layout engine — drawing primitives | 10 min |
| 4 | Main export function | 5 min |
| 5 | progress_summary builder | 5 min |
| 6 | material_balance + receipt_log | 5 min |
| 7 | punch_list + vo_summary | 5 min |
| 8 | schedule_variance + weekly_digest | 4 min |
| 9 | payroll + client_charge + audit_list | 5 min |
| 10 | 5 principal-only reports | 5 min |
| 11 | Wire PDF button — OfficeReportsScreen | 4 min |
| 12 | Wire PDF button — LaporanScreen | 4 min |
| 13 | End-to-end test | 10 min |
| **Total** | | **~69 min** |
