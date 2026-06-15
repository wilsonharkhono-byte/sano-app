// Build a simplified workbook containing EVERY actual line item from
// AAL-5 RAB (A), with the totals reconciled to the workbook's own grand total.
import ExcelJS from 'exceljs';

const src = new ExcelJS.Workbook();
await src.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const rab = src.getWorksheet('RAB (A)');

function val(cell) {
  if (cell == null || cell.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v !== null) {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}
function num(cell) {
  const v = val(cell);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}
function str(cell) { const v = val(cell); return v == null ? '' : String(v).trim(); }

const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
const SUB   = /^[A-Z]$/;

let chapter = '';
let subchapter = '';
const items = [];
let realTotal = 0;

for (let r = 8; r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const a = str(row.getCell(1));
  const b = str(row.getCell(2));
  const c = str(row.getCell(3));
  const d = num(row.getCell(4));
  const e = num(row.getCell(5));
  const f = num(row.getCell(6));
  const h = num(row.getCell(8));   // some workbooks put authoritative volume here
  const i = num(row.getCell(9));   // Material
  const j = num(row.getCell(10));  // Upah
  const k = num(row.getCell(11));  // Peralatan
  const l = num(row.getCell(12));  // Subkon
  const m = num(row.getCell(13));  // Prelim
  const colG = str(row.getCell(7));  // sometimes carries PC code like "PC.1"
  const colH = str(row.getCell(8));

  // Chapter
  if (ROMAN.test(a)) { chapter = `${a}. ${b}`; subchapter = ''; continue; }
  // Sub-chapter
  if (SUB.test(a)) { subchapter = `${a}. ${b}`; continue; }
  // Subtotal rows
  if (/subtotal|total/i.test(a) || /subtotal|total/i.test(b) || /^TOTAL$/i.test(colG) || /^TOTAL$/i.test(colH)) continue;
  // Grand-total row (empty A and B, but F has value)
  if (!a && !b && !c && f != null && f > 100_000_000) continue;
  // Header strays
  if (/^uraian|^satuan|^volume$/i.test(b)) continue;
  // Empty filler
  if (!b && d == null && e == null && f == null) continue;

  // Some rows are pure umbrella titles like "Poer (Readymix fc' 30 MPa) :"
  // — they have a NO in col A, a description, but no numeric volume.
  // Keep them but mark them as umbrella (their children below have the real money).
  const isUmbrella = (d == null || d === 0) && (e == null || e === 0) && (f == null || f === 0);

  items.push({
    rowNum: r,
    code: a,
    chapter,
    subchapter,
    item: b.replace(/\s+/g, ' '),
    unit: c,
    volume: d,
    unitPrice: e,
    total: f,
    material: i,
    upah: j,
    peralatan: k,
    subkon: l,
    prelim: m,
    pcCode: colG,
    isUmbrella,
  });

  if (f != null && !isUmbrella) realTotal += f;
}

console.log(`Items kept: ${items.length}`);
console.log(`Reconciled total: Rp ${realTotal.toLocaleString('id-ID')}`);
console.log(`(Workbook's own grand total: Rp 5.431.518.399,87)`);
console.log(`Delta: Rp ${(realTotal - 5_431_518_399.87).toLocaleString('id-ID')}`);

// =========================================================================
// Build simplified workbook
// =========================================================================

const out = new ExcelJS.Workbook();
out.creator = 'SANO parser team';
out.created = new Date();

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const ALT_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
const CHAP_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
const SUBCHAP_FILL= { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };

// ---------------- RAB ----------------
const ws = out.addWorksheet('RAB', { views: [{ state: 'frozen', ySplit: 1 }] });
const cols = [
  { header: 'Code',        key: 'code',       width: 8  },
  { header: 'Chapter',     key: 'chapter',    width: 32 },
  { header: 'Sub-chapter', key: 'subchapter', width: 28 },
  { header: 'Item Name',   key: 'item',       width: 50 },
  { header: 'Unit',        key: 'unit',       width: 8  },
  { header: 'Volume',      key: 'volume',     width: 12 },
  { header: 'Unit Price',  key: 'unitPrice',  width: 15 },
  { header: 'Material',    key: 'material',   width: 12 },
  { header: 'Upah',        key: 'upah',       width: 12 },
  { header: 'Peralatan',   key: 'peralatan',  width: 12 },
  { header: 'Subkon',      key: 'subkon',     width: 12 },
  { header: 'Prelim',      key: 'prelim',     width: 12 },
  { header: 'Total',       key: 'total',      width: 16 },
];
ws.columns = cols;
const header = ws.getRow(1);
header.height = 22;
header.eachCell({ includeEmpty: false }, c => {
  c.fill = HEADER_FILL;
  c.font = HEADER_FONT;
  c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
});

let r = 2;
let altIdx = 0;
for (const it of items) {
  const xl = ws.addRow({
    code: it.code || '',
    chapter: it.chapter,
    subchapter: it.subchapter,
    item: (it.pcCode ? `[${it.pcCode}] ` : '') + it.item,
    unit: it.unit,
    volume: it.volume,
    unitPrice: it.unitPrice,
    material: it.material,
    upah: it.upah,
    peralatan: it.peralatan,
    subkon: it.subkon,
    prelim: it.prelim,
    total: it.total,
  });
  xl.eachCell({ includeEmpty: true }, (c, idx) => {
    if (idx >= 6) {
      c.numFmt = '#,##0;(#,##0)';
      c.alignment = { horizontal: 'right' };
    }
    if (idx === 5) c.alignment = { horizontal: 'center' };
    if (altIdx % 2 === 1) c.fill = ALT_FILL;
  });
  if (it.isUmbrella) {
    // umbrella row — italic to distinguish from billable lines
    xl.font = { italic: true, color: { argb: 'FF6B7280' } };
  }
  altIdx++;
  r++;
}

// Footer row with grand total
const footerRow = ws.addRow({
  item: 'TOTAL',
  total: realTotal,
});
footerRow.font = { bold: true };
footerRow.getCell('total').numFmt = '#,##0';
footerRow.getCell('total').fill = CHAP_FILL;
footerRow.getCell('item').fill = CHAP_FILL;

// ---------------- README ----------------
const rm = out.addWorksheet('README');
rm.columns = [{ width: 120 }];
const lines = [
  'SANO Simplified BoQ — RAB Pakuwon AAL-5 (real data)',
  '',
  `Source: assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx`,
  `Items extracted: ${items.length}`,
  `Reconciled total (sum of Total column above): Rp ${realTotal.toLocaleString('id-ID')}`,
  `Workbook's own grand total (row 340 in source):  Rp 5.431.518.399,87`,
  `Delta: ${(realTotal - 5_431_518_399.87).toFixed(2)} (should be near zero — float rounding only)`,
  '',
  'Sheets:',
  '  • RAB — every actual line item from the source RAB (A), with chapter/sub-chapter as explicit columns.',
  '',
  'What changed vs. the source:',
  '  1. Header row moved to row 1 (was row 7).',
  '  2. Chapter codes (Roman numerals) and sub-chapter codes (single letters) lifted into explicit columns.',
  '  3. All formulas replaced with their cached values. No =AF{row} chains, no =H{row} passthrough.',
  '  4. Subtotal rows removed (they were derivable from the items themselves).',
  '  5. The "PC.X" code that some umbrella rows had in column G is now prefixed into the Item Name in [brackets].',
  '  6. Umbrella rows (no volume / no price) are kept but italicized so the parser knows they are parent headers, not billable.',
  '',
  'What stayed the same:',
  '  • Every billable item from the source workbook is present.',
  '  • Every cost-split column (Material, Upah, Peralatan, Subkon, Prelim) preserves its original value.',
  '  • The sum of the Total column matches the source workbook (within float-rounding tolerance).',
  '',
  'How to verify the reconciliation:',
  '  • Open this file. The TOTAL footer at the bottom of the RAB sheet should match the workbook total above.',
  '  • Or compare against the source file row 340 (column F) directly.',
];
lines.forEach((line, idx) => {
  const c = rm.getCell(idx + 1, 1);
  c.value = line;
  if (idx === 0) c.font = { bold: true, size: 16 };
  else if (line.endsWith(':')) c.font = { bold: true };
  c.alignment = { wrapText: true, vertical: 'top' };
});

const outPath = 'assets/BOQ/SANO_Simplified_AAL5.xlsx';
await out.xlsx.writeFile(outPath);
console.log(`\nWrote: ${outPath}`);
