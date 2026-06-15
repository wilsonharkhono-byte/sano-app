// Material Take-Off (MTO) builder.
//
// Logic:
//   1. Parse every AHS block from the Analisa sheet. Each block has a title,
//      a Jumlah row, and component rows in between. Components have:
//        coefficient (col B), unit (col C), name (col D), unit price (col E),
//        subtotal (col F = coef × price).
//   2. Index AHS blocks by their Jumlah row number — that's what RAB
//      references via Analisa!F$XXX.
//   3. Walk every RAB (A) data row. For each row:
//        a) Look at the formulas in cols I (Material) and N (Total per unit).
//        b) If a formula references Analisa!F$XXX, look up the matching
//           AHS block. Expand each component as:
//              consumed = boqRow.volume * component.coefficient
//           credit each consumed value to the master material aggregator.
//        c) If the formula is AF-composite or absent, mark the row as
//           "no AHS expansion possible" and credit its raw cost to a
//           bucket so the totals still add up.
//   4. Reconcile: total project cost = sum of expanded material/labor
//      costs (from AHS) + sum of direct/unexpanded row costs. Should equal
//      the workbook's grand total of Rp 5,431,518,399.87.
//   5. Emit a workbook with:
//        - MaterialSchedule sheet (one row per unique material, totals)
//        - LaborSchedule sheet (one row per unique labor role, totals)
//        - BoQ-Expansion sheet (per-row breakdown for AHS-expanded rows)
//        - RAB sheet (untouched flat list, every row from the source)
//        - Reconciliation sheet (the audit trail)
//
// We intentionally include labor in the schedules because workers (mandor,
// tukang batu, etc) ARE consumables in construction planning.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';

const SOURCE = 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx';
const OUT    = 'assets/BOQ/SANO_MaterialTakeoff_AAL5.xlsx';

const src = new ExcelJS.Workbook();
await src.xlsx.readFile(SOURCE);

function val(cell) {
  if (cell?.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v != null) {
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
function formula(cell) {
  // exceljs: cells with formulas expose `.formula` directly. Also fall back
  // to .value.formula for safety.
  if (cell?.formula) return cell.formula;
  if (cell?.value == null) return null;
  if (typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value) return cell.value.formula;
  return null;
}

// =========================================================================
// 1. Parse every AHS block from Analisa
// =========================================================================

const ana = src.getWorksheet('Analisa');
const TITLE_RE = /^\s*\d+\s+(m[123²³]|kg|ls|bh|pcs|titik|set|unit)\s+\S/i;

const ahsBlocks = [];   // { title, titleRow, jumlahRow, outputUnit, outputQty, components: [{coef, unit, name, price, subtotal, type}] }
let current = null;

for (let r = 1; r <= ana.rowCount; r++) {
  const a = str(ana.getCell(r, 1));
  const b = str(ana.getCell(r, 2));
  // Title detection — only check col B since that's where Analisa puts titles
  if (TITLE_RE.test(b)) {
    if (current) ahsBlocks.push(current);
    const m = b.match(/^\s*(\d+(?:\.\d+)?)\s+(\S+)\s+(.+)$/i);
    current = {
      title: b,
      shortName: m ? m[3] : b,
      outputQty: m ? Number(m[1]) : 1,
      outputUnit: m ? m[2] : '',
      titleRow: r,
      jumlahRow: null,
      components: [],
    };
    continue;
  }
  // Jumlah row marker — "Jumlah" appears in col E
  const colE = str(ana.getCell(r, 5));
  if (current && /^jumlah\b/i.test(colE)) {
    current.jumlahRow = r;
    current.totalPerOutput = num(ana.getCell(r, 6)) ?? 0;
    ahsBlocks.push(current);
    current = null;
    continue;
  }
  // Component row inside current block
  if (current) {
    const coef = num(ana.getCell(r, 2));
    const unit = str(ana.getCell(r, 3));
    const name = str(ana.getCell(r, 4));
    const price = num(ana.getCell(r, 5));
    const subtotal = num(ana.getCell(r, 6));
    if (coef != null && coef > 0 && name) {
      // Classify type by name (more reliable than unit in Indonesian RAB)
      let type = 'material';
      if (/^(upah|ongkos|tukang|pekerja|mandor|kepala\s+tukang|pengawas)\b/i.test(name)) type = 'labor';
      else if (/^(org|oh|hari|hr)/i.test(unit)) type = 'labor';
      else if (/alat|equipment|sewa/i.test(name)) type = 'equipment';
      current.components.push({
        row: r,
        coef,
        unit,
        name,
        price: price ?? 0,
        subtotal: subtotal ?? (coef * (price ?? 0)),
        type,
      });
    }
  }
}
if (current) ahsBlocks.push(current);

// Index AHS blocks by their Jumlah row (for RAB references)
const ahsByJumlahRow = new Map();
for (const b of ahsBlocks) {
  if (b.jumlahRow != null) ahsByJumlahRow.set(b.jumlahRow, b);
}

console.log(`Parsed ${ahsBlocks.length} AHS blocks.`);
console.log(`  ${ahsByJumlahRow.size} have Jumlah rows (referenceable from RAB).`);
console.log(`  Total components across all blocks: ${ahsBlocks.reduce((s, b) => s + b.components.length, 0)}`);

// =========================================================================
// 2. Walk every RAB data row, expand via AHS where possible
// =========================================================================

const rab = src.getWorksheet('RAB (A)');
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
const SUB   = /^[A-Z]$/;

// Aggregators
const materialAgg = new Map();  // name => { name, unit, totalQty, totalCost, sources: [{boqCode, boqItem, qty}] }
const laborAgg = new Map();     // same shape

function isLabor(name, unit) {
  // Indonesian construction prices labor either per worker-day OR per unit
  // of work (m2 of plastering, m' of trench digging). Classify by NAME.
  if (/^(upah|ongkos|tukang|pekerja|mandor|kepala\s+tukang|pengawas)\b/i.test(name)) return true;
  if (unit && /^(org|oh|hari|hr|os|man)/i.test(unit)) return true;
  return false;
}
function creditMaterial(name, unit, qty, unitPrice, source) {
  const agg = isLabor(name, unit) ? laborAgg : materialAgg;
  let m = agg.get(name);
  if (!m) {
    m = { name, unit, totalQty: 0, totalCost: 0, sources: [] };
    agg.set(name, m);
  }
  m.totalQty += qty;
  m.totalCost += qty * unitPrice;
  m.sources.push({ ...source, qty, subtotal: qty * unitPrice });
}

let chapter = '';
let subchapter = '';
let expandedCost = 0;
let unexpandedCost = 0;
let unexpandedRows = 0;
let expandedRows = 0;
const rabItems = [];
const expansionLog = [];

for (let r = 8; r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const a = str(row.getCell(1));
  const b = str(row.getCell(2));
  const c = str(row.getCell(3));
  const d = num(row.getCell(4));
  const e = num(row.getCell(5));
  const f = num(row.getCell(6));
  const colG = str(row.getCell(7));

  if (ROMAN.test(a)) { chapter = `${a}. ${b}`; subchapter = ''; continue; }
  if (SUB.test(a)) { subchapter = `${a}. ${b}`; continue; }
  if (/subtotal|^total$/i.test(a) || /subtotal|^total$/i.test(b)) continue;
  if (!a && !b && !c && f != null && f > 100_000_000) continue;
  if (/^uraian|^satuan|^volume$/i.test(b)) continue;
  if (!b && d == null && e == null && f == null) continue;

  const item = {
    rowNum: r,
    code: a,
    chapter,
    subchapter,
    item: b.replace(/\s+/g, ' '),
    unit: c,
    volume: d,
    unitPrice: e,
    total: f,
    pcCode: colG,
  };

  // Detect AHS reference. Walk formulas in cols I, J, K, L, M, N.
  let ahsRef = null;
  for (const col of [9, 10, 11, 12, 13, 14]) {
    const f = formula(row.getCell(col));
    if (!f) continue;
    const m = f.match(/Analisa!?\$?[A-Z]+\$?(\d+)/);
    if (m) {
      const ref = Number(m[1]);
      if (ahsByJumlahRow.has(ref)) { ahsRef = ahsByJumlahRow.get(ref); break; }
    }
  }

  if (ahsRef && item.volume != null && item.volume > 0) {
    // EXPAND via this AHS
    item.ahsTitle = ahsRef.title;
    item.expanded = true;
    expandedRows++;
    for (const comp of ahsRef.components) {
      const consumed = item.volume * comp.coef;
      const cost = consumed * comp.price;
      creditMaterial(comp.name, comp.unit, consumed, comp.price, {
        boqCode: item.code,
        boqItem: item.item,
        boqUnit: item.unit,
        boqVolume: item.volume,
        ahsTitle: ahsRef.title,
        coef: comp.coef,
        unitPrice: comp.price,
      });
      expansionLog.push({
        boqCode: item.code,
        boqItem: item.item,
        boqVolume: item.volume,
        boqUnit: item.unit,
        ahsTitle: ahsRef.title,
        componentName: comp.name,
        componentUnit: comp.unit,
        componentType: comp.type,
        coefficient: comp.coef,
        consumedQty: consumed,
        unitPrice: comp.price,
        subtotal: cost,
      });
      expandedCost += cost;
    }
  } else {
    item.expanded = false;
    item.expandReason = ahsRef ? 'no_volume' : 'no_analisa_ref';
    if (item.total != null) {
      unexpandedCost += item.total;
      unexpandedRows++;
    }
  }

  rabItems.push(item);
}

const projectTotal = rabItems.reduce((s, x) => s + (x.total ?? 0), 0);
console.log(`\nRAB items: ${rabItems.length} (expanded: ${expandedRows}, unexpanded: ${unexpandedRows})`);
console.log(`Project total (sum of F col):       Rp ${projectTotal.toLocaleString('id-ID')}`);
console.log(`Workbook's own grand total:         Rp 5.431.518.399,87`);
console.log(`Cost captured via AHS expansion:    Rp ${expandedCost.toLocaleString('id-ID')}`);
console.log(`Cost in unexpanded rows (direct):   Rp ${unexpandedCost.toLocaleString('id-ID')}`);
console.log(`Materials discovered: ${materialAgg.size}`);
console.log(`Labor roles discovered: ${laborAgg.size}`);

// =========================================================================
// 3. Build the output workbook
// =========================================================================

const out = new ExcelJS.Workbook();
out.creator = 'SANO parser team';
out.created = new Date();

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const ALT_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
const HIGHLIGHT   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

function styleHeader(ws) {
  const h = ws.getRow(1);
  h.height = 22;
  h.eachCell({ includeEmpty: false }, c => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
}

// --- MaterialSchedule ---
const ms = out.addWorksheet('MaterialSchedule', { views: [{ state: 'frozen', ySplit: 1 }] });
ms.columns = [
  { header: 'Material',         key: 'name',       width: 38 },
  { header: 'Unit',             key: 'unit',       width: 10 },
  { header: 'Total Qty',        key: 'qty',        width: 14 },
  { header: 'Avg Unit Price',   key: 'price',      width: 14 },
  { header: 'Total Cost (Rp)',  key: 'cost',       width: 18 },
  { header: 'Used In (# items)',key: 'usedIn',     width: 16 },
];
styleHeader(ms);
const matSorted = [...materialAgg.values()].sort((a, b) => b.totalCost - a.totalCost);
let r = 2;
let totalMaterialCost = 0;
for (const m of matSorted) {
  const avgPrice = m.totalQty > 0 ? m.totalCost / m.totalQty : 0;
  const xl = ms.addRow({ name: m.name, unit: m.unit, qty: m.totalQty, price: avgPrice, cost: m.totalCost, usedIn: m.sources.length });
  xl.getCell('qty').numFmt = '#,##0.000';
  xl.getCell('price').numFmt = '#,##0';
  xl.getCell('cost').numFmt = '#,##0';
  if (r % 2 === 0) xl.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  totalMaterialCost += m.totalCost;
  r++;
}
const msFooter = ms.addRow({ name: 'TOTAL MATERIAL', cost: totalMaterialCost });
msFooter.font = { bold: true };
msFooter.getCell('cost').numFmt = '#,##0';
msFooter.eachCell({ includeEmpty: true }, c => { c.fill = HIGHLIGHT; });

// --- LaborSchedule ---
const ls = out.addWorksheet('LaborSchedule', { views: [{ state: 'frozen', ySplit: 1 }] });
ls.columns = [
  { header: 'Role',             key: 'name',  width: 28 },
  { header: 'Unit',             key: 'unit',  width: 12 },
  { header: 'Total Days/Hours', key: 'qty',   width: 16 },
  { header: 'Rate (Rp)',        key: 'price', width: 14 },
  { header: 'Total Cost (Rp)',  key: 'cost',  width: 18 },
  { header: 'Used In (# items)',key: 'usedIn',width: 16 },
];
styleHeader(ls);
const labSorted = [...laborAgg.values()].sort((a, b) => b.totalCost - a.totalCost);
let rL = 2;
let totalLaborCost = 0;
for (const l of labSorted) {
  const avg = l.totalQty > 0 ? l.totalCost / l.totalQty : 0;
  const xl = ls.addRow({ name: l.name, unit: l.unit, qty: l.totalQty, price: avg, cost: l.totalCost, usedIn: l.sources.length });
  xl.getCell('qty').numFmt = '#,##0.000';
  xl.getCell('price').numFmt = '#,##0';
  xl.getCell('cost').numFmt = '#,##0';
  if (rL % 2 === 0) xl.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  totalLaborCost += l.totalCost;
  rL++;
}
const lsFooter = ls.addRow({ name: 'TOTAL LABOR', cost: totalLaborCost });
lsFooter.font = { bold: true };
lsFooter.getCell('cost').numFmt = '#,##0';
lsFooter.eachCell({ includeEmpty: true }, c => { c.fill = HIGHLIGHT; });

// --- BoQ-Expansion ---
const ex = out.addWorksheet('BoQ-Expansion', { views: [{ state: 'frozen', ySplit: 1 }] });
ex.columns = [
  { header: 'BoQ Code',     key: 'boqCode',       width: 8  },
  { header: 'BoQ Item',     key: 'boqItem',       width: 42 },
  { header: 'BoQ Vol',      key: 'boqVolume',     width: 10 },
  { header: 'BoQ Unit',     key: 'boqUnit',       width: 8  },
  { header: 'AHS Recipe',   key: 'ahsTitle',      width: 38 },
  { header: 'Component',    key: 'componentName', width: 32 },
  { header: 'Type',         key: 'componentType', width: 10 },
  { header: 'Coef',         key: 'coefficient',   width: 10 },
  { header: 'Comp Unit',    key: 'componentUnit', width: 10 },
  { header: 'Consumed',     key: 'consumedQty',   width: 12 },
  { header: 'Unit Price',   key: 'unitPrice',     width: 12 },
  { header: 'Subtotal (Rp)',key: 'subtotal',      width: 16 },
];
styleHeader(ex);
let rE = 2;
let prevBoq = null;
for (const e of expansionLog) {
  const xl = ex.addRow(e);
  xl.getCell('boqVolume').numFmt = '#,##0.000';
  xl.getCell('coefficient').numFmt = '#,##0.0000';
  xl.getCell('consumedQty').numFmt = '#,##0.000';
  xl.getCell('unitPrice').numFmt = '#,##0';
  xl.getCell('subtotal').numFmt = '#,##0';
  if (prevBoq && e.boqCode !== prevBoq) {
    xl.eachCell({ includeEmpty: true }, c => {
      c.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });
  }
  if (rE % 2 === 0) xl.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  prevBoq = e.boqCode;
  rE++;
}

// --- RAB (flat untouched) ---
const rb = out.addWorksheet('RAB', { views: [{ state: 'frozen', ySplit: 1 }] });
rb.columns = [
  { header: 'Code',         key: 'code',       width: 8  },
  { header: 'Chapter',      key: 'chapter',    width: 28 },
  { header: 'Sub-chapter',  key: 'subchapter', width: 24 },
  { header: 'Item',         key: 'item',       width: 46 },
  { header: 'Unit',         key: 'unit',       width: 8  },
  { header: 'Volume',       key: 'volume',     width: 12 },
  { header: 'Unit Price',   key: 'unitPrice',  width: 14 },
  { header: 'Total',        key: 'total',      width: 16 },
  { header: 'Expanded?',    key: 'expanded',   width: 10 },
  { header: 'Note',         key: 'note',       width: 28 },
];
styleHeader(rb);
let rR = 2;
for (const it of rabItems) {
  const note = it.expanded
    ? `AHS: ${it.ahsTitle?.slice(0, 30)}…`
    : (it.expandReason === 'no_analisa_ref' ? 'No AHS recipe (direct cost)' : 'AHS found but no volume');
  const xl = rb.addRow({
    code: it.code, chapter: it.chapter, subchapter: it.subchapter,
    item: (it.pcCode ? `[${it.pcCode}] ` : '') + it.item,
    unit: it.unit, volume: it.volume, unitPrice: it.unitPrice, total: it.total,
    expanded: it.expanded ? 'YES' : 'NO',
    note,
  });
  xl.getCell('volume').numFmt = '#,##0.000';
  xl.getCell('unitPrice').numFmt = '#,##0';
  xl.getCell('total').numFmt = '#,##0';
  if (!it.expanded) xl.getCell('expanded').font = { color: { argb: 'FFD97706' } };
  else xl.getCell('expanded').font = { color: { argb: 'FF059669' } };
  if (rR % 2 === 0) xl.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  rR++;
}
const rabFooter = rb.addRow({ item: 'PROJECT TOTAL', total: projectTotal });
rabFooter.font = { bold: true };
rabFooter.getCell('total').numFmt = '#,##0';
rabFooter.eachCell({ includeEmpty: true }, c => { c.fill = HIGHLIGHT; });

// --- Reconciliation ---
const rc = out.addWorksheet('Reconciliation');
rc.columns = [{ width: 50 }, { width: 24 }];
const lines = [
  ['SANO Material Take-Off — Reconciliation', ''],
  ['Source workbook', SOURCE],
  ['', ''],
  ['Project totals', ''],
  ['  Sum of F column (data rows only)', projectTotal],
  ['  Workbook own grand total (row 340 col F)', 5_431_518_399.87],
  ['  Delta', projectTotal - 5_431_518_399.87],
  ['', ''],
  ['Breakdown by source', ''],
  ['  Cost captured via AHS expansion', expandedCost],
  ['  Cost in rows with NO AHS recipe (direct/lump-sum/subkon)', unexpandedCost],
  ['  Sum of the above', expandedCost + unexpandedCost],
  ['', ''],
  ['Aggregator totals', ''],
  ['  Materials discovered (unique)', materialAgg.size],
  ['  Sum of Material schedule cost', totalMaterialCost],
  ['  Labor roles discovered (unique)', laborAgg.size],
  ['  Sum of Labor schedule cost', totalLaborCost],
  ['', ''],
  ['BoQ row breakdown', ''],
  ['  Total BoQ data rows', rabItems.length],
  ['  Expanded via AHS', expandedRows],
  ['  Unexpanded (no AHS recipe in formula)', unexpandedRows],
  ['', ''],
  ['Notes', ''],
  ['  • "Expanded" rows are those whose Material formula points to a specific Analisa block.', ''],
  ['  • "Unexpanded" rows are lump-sum, subkontraktor, or use the AAL-5 AF-composite pattern', ''],
  ['    which can\'t be reliably broken into individual materials without running the parser', ''],
  ['    full formula evaluator. Their cost is preserved in the RAB Total column.', ''],
  ['  • The MaterialSchedule + LaborSchedule cover the EXPANDED rows. Items in the source', ''],
  ['    workbook that bypass AHS (subkon, direct) won\'t appear in those schedules — by design.', ''],
];
let rr = 1;
for (const [a, b] of lines) {
  const rowEl = rc.getRow(rr);
  rowEl.getCell(1).value = a;
  rowEl.getCell(2).value = b;
  if (rr === 1) rowEl.font = { bold: true, size: 14 };
  if (typeof b === 'number') {
    rowEl.getCell(2).numFmt = '#,##0';
    rowEl.getCell(2).alignment = { horizontal: 'right' };
  }
  if (a && a.endsWith('s') && b === '') rowEl.font = { bold: true };
  rr++;
}

await out.xlsx.writeFile(OUT);
console.log(`\nWrote ${OUT}`);

// Dump the top 20 materials to console for quick sanity check
console.log('\nTop 20 materials by total cost:');
for (const m of matSorted.slice(0, 20)) {
  console.log(`  ${m.name.padEnd(40)} ${m.unit.padEnd(8)} ${m.totalQty.toFixed(3).padStart(12)} × ${(m.totalCost / Math.max(m.totalQty, 1)).toFixed(0).padStart(10)}  = Rp ${m.totalCost.toLocaleString('id-ID')}`);
}
