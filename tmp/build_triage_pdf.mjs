// Render BOQ_TRIAGE.md to a PDF for easy distribution to staff.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('docs/BOQ_TRIAGE.md', 'utf8');

const doc = await PDFDocument.create();
const fontReg = await doc.embedFont(StandardFonts.Helvetica);
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
const fontMono = await doc.embedFont(StandardFonts.Courier);
const fontMonoBold = await doc.embedFont(StandardFonts.CourierBold);

const PAGE_W = 595, PAGE_H = 842;
const MARGIN_L = 50, MARGIN_R = 50, MARGIN_T = 60, MARGIN_B = 50;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const NAVY = rgb(0.07, 0.16, 0.27);
const SLATE = rgb(0.39, 0.44, 0.52);
const ACCENT = rgb(0.04, 0.59, 0.41);
const LIGHT = rgb(0.93, 0.96, 0.98);
const RED = rgb(0.86, 0.15, 0.15);

let page = doc.addPage([PAGE_W, PAGE_H]);
let y = PAGE_H - MARGIN_T;

function newPage() { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN_T; }
function ensureSpace(n) { if (y - n < MARGIN_B) newPage(); }

function asciiSafe(s) {
  return String(s)
    .replace(/[²]/g, '2').replace(/[³]/g, '3')
    .replace(/[→←↑↓]/g, '->').replace(/[•]/g, '-')
    .replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[…]/g, '...').replace(/[≤≥]/g, '<=').replace(/[×]/g, 'x')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function drawWrapped(s, opts = {}) {
  s = asciiSafe(s);
  const size = opts.size ?? 10;
  const font = opts.bold ? fontBold : (opts.mono ? (opts.bold ? fontMonoBold : fontMono) : fontReg);
  const color = opts.color ?? rgb(0, 0, 0);
  const indent = opts.indent ?? 0;
  const charW = size * (opts.mono ? 0.6 : 0.5);
  const maxChars = Math.floor((CONTENT_W - indent) / charW);
  const lines = s.split('\n');
  for (const rawLine of lines) {
    if (rawLine === '') { y -= size; continue; }
    const words = rawLine.split(/(\s+)/);
    let line = '';
    const wrapped = [];
    for (const w of words) {
      if ((line + w).length > maxChars && line.length > 0) {
        wrapped.push(line);
        line = w.trimStart();
      } else {
        line += w;
      }
    }
    if (line) wrapped.push(line);
    for (const ln of wrapped) {
      ensureSpace(size + 4);
      page.drawText(ln, { x: MARGIN_L + indent, y: y - size, size, font, color });
      y -= size * 1.35;
    }
  }
  y -= opts.gap ?? 3;
}

function drawHeading(s, level) {
  s = asciiSafe(s);
  ensureSpace(level === 1 ? 34 : (level === 2 ? 26 : 20));
  if (level === 1) {
    y -= 6;
    page.drawText(s, { x: MARGIN_L, y: y - 20, size: 20, font: fontBold, color: NAVY });
    y -= 28;
    page.drawLine({ start: { x: MARGIN_L, y }, end: { x: MARGIN_L + CONTENT_W, y }, thickness: 1, color: NAVY });
    y -= 14;
  } else if (level === 2) {
    y -= 4;
    page.drawText(s, { x: MARGIN_L, y: y - 14, size: 14, font: fontBold, color: NAVY });
    y -= 22;
  } else if (level === 3) {
    y -= 2;
    page.drawText(s, { x: MARGIN_L, y: y - 12, size: 12, font: fontBold, color: ACCENT });
    y -= 18;
  } else {
    page.drawText(s, { x: MARGIN_L, y: y - 10, size: 10, font: fontBold, color: SLATE });
    y -= 14;
  }
}

function drawCodeBlock(text) {
  text = asciiSafe(text);
  const lines = text.split('\n');
  const blockH = lines.length * 13 + 14;
  ensureSpace(blockH + 6);
  page.drawRectangle({
    x: MARGIN_L, y: y - blockH, width: CONTENT_W, height: blockH,
    color: LIGHT, borderColor: SLATE, borderWidth: 0.5,
  });
  let yi = y - 14;
  for (const ln of lines) {
    page.drawText(ln, { x: MARGIN_L + 8, y: yi, size: 8.5, font: fontMono, color: rgb(0.1, 0.1, 0.1) });
    yi -= 13;
  }
  y -= blockH + 8;
}

function drawTableHeader(cells, widths) {
  ensureSpace(20);
  const heights = 18;
  let xCursor = MARGIN_L;
  page.drawRectangle({ x: MARGIN_L, y: y - heights, width: CONTENT_W, height: heights, color: NAVY });
  for (let i = 0; i < cells.length; i++) {
    const cell = asciiSafe(cells[i]);
    page.drawText(cell, { x: xCursor + 4, y: y - 13, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    xCursor += widths[i];
  }
  y -= heights;
}

function drawTableRow(cells, widths) {
  // Wrap each cell, find tallest, then draw
  const wrappedCells = cells.map((c, i) => {
    const safe = asciiSafe(c);
    const charW = 9 * 0.5;
    const maxChars = Math.floor((widths[i] - 8) / charW);
    const words = String(safe).split(/(\s+)/);
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + w).length > maxChars && line.length > 0) { lines.push(line); line = w.trimStart(); }
      else line += w;
    }
    if (line) lines.push(line);
    return lines;
  });
  const maxLines = Math.max(...wrappedCells.map(c => c.length));
  const h = maxLines * 12 + 6;
  ensureSpace(h);
  let xC = MARGIN_L;
  for (let i = 0; i < cells.length; i++) {
    let yi = y - 12;
    for (const ln of wrappedCells[i]) {
      page.drawText(ln, { x: xC + 4, y: yi, size: 8.5, font: fontReg, color: rgb(0, 0, 0) });
      yi -= 12;
    }
    xC += widths[i];
  }
  page.drawLine({ start: { x: MARGIN_L, y: y - h }, end: { x: MARGIN_L + CONTENT_W, y: y - h }, thickness: 0.3, color: rgb(0.85, 0.87, 0.91) });
  y -= h;
}

// Cover
y -= 50;
page.drawText('SANO BoQ Triage Helper', { x: MARGIN_L, y, size: 28, font: fontBold, color: NAVY });
y -= 32;
page.drawText('For estimator staff: get an AI second opinion on confusing BoQ rows', { x: MARGIN_L, y, size: 12, font: fontReg, color: SLATE });
y -= 24;
page.drawRectangle({ x: MARGIN_L, y: y - 4, width: CONTENT_W, height: 2, color: NAVY });
y -= 28;

drawWrapped('This document is a self-contained guide. Print it, keep it at your desk, or save the PDF on your phone. When you hit a BoQ row in Excel that you\'re not sure how SANO will parse, follow the 3 steps on the next page.', { size: 11 });
y -= 12;
drawWrapped('You do not need access to the SANO codebase. You only need a browser and the AI chat tool (claude.ai). The PDF tells the AI everything it needs to know.', { size: 11, color: SLATE });

newPage();

// Body — parse markdown and render
const sections = md.split(/^---$/m);
for (const section of sections) {
  const lines = section.split('\n');
  let inCode = false;
  let codeBuf = [];
  let inTable = false;
  let tableRows = [];
  let tableWidths = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      if (inCode) {
        drawCodeBlock(codeBuf.join('\n'));
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // Tables
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(s => s.trim());
      // skip separator rows like "|---|---|"
      if (cells.every(c => /^:?-+:?$/.test(c) || c === '')) continue;
      if (!inTable) {
        // First row = header
        tableRows = [];
        // approximate widths based on column count
        const n = cells.length;
        tableWidths = Array(n).fill(Math.floor(CONTENT_W / n));
        drawTableHeader(cells, tableWidths);
        inTable = true;
      } else {
        drawTableRow(cells, tableWidths);
      }
      continue;
    } else if (inTable) {
      // table ended
      inTable = false;
      y -= 8;
    }

    // Headings
    if (/^# /.test(line)) { drawHeading(line.replace(/^#\s+/, ''), 1); continue; }
    if (/^## /.test(line)) { drawHeading(line.replace(/^##\s+/, ''), 2); continue; }
    if (/^### /.test(line)) { drawHeading(line.replace(/^###\s+/, ''), 3); continue; }
    if (/^#### /.test(line)) { drawHeading(line.replace(/^####\s+/, ''), 4); continue; }

    // Blockquote
    if (/^> /.test(line)) {
      drawWrapped(line.replace(/^>\s+/, ''), { size: 10, color: SLATE, indent: 12 });
      continue;
    }

    // Bullet
    if (/^[\-\*] /.test(line)) {
      const txt = line.replace(/^[\-\*]\s+/, '');
      ensureSpace(14);
      page.drawText('-', { x: MARGIN_L, y: y - 10, size: 10, font: fontReg, color: NAVY });
      drawWrapped(txt, { size: 10, indent: 14 });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const m = line.match(/^(\d+)\.\s+(.*)$/);
      if (m) {
        ensureSpace(14);
        page.drawText(m[1] + '.', { x: MARGIN_L, y: y - 10, size: 10, font: fontBold, color: NAVY });
        drawWrapped(m[2], { size: 10, indent: 22 });
        continue;
      }
    }

    // Plain paragraph
    if (line.trim()) {
      // Strip simple markdown emphasis for clean PDF
      const stripped = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1');
      drawWrapped(stripped, { size: 10 });
    } else {
      y -= 6;
    }
  }
  if (inCode && codeBuf.length) { drawCodeBlock(codeBuf.join('\n')); codeBuf = []; inCode = false; }
  if (inTable) inTable = false;
}

const bytes = await doc.save();
writeFileSync('docs/SANO_BOQ_TRIAGE.pdf', bytes);
console.log('Wrote docs/SANO_BOQ_TRIAGE.pdf  (' + (bytes.length / 1024).toFixed(1) + ' KB, ' + doc.getPageCount() + ' pages)');
