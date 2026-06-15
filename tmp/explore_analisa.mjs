// Inspect the Analisa sheet structure: how many AHS blocks, what columns
// they use, what BoQ rows reference them via formulas.
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');

function val(cell) {
  if (cell?.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v != null) {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('text' in v) return v.text;
    if ('formula' in v) return v.formula;
  }
  return v;
}
function str(cell) { const v = val(cell); return v == null ? '' : String(v).trim(); }
function num(cell) {
  const v = val(cell);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}
function formula(cell) {
  if (cell?.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v != null && 'formula' in v) return v.formula;
  return null;
}

const ana = wb.getWorksheet('Analisa');
console.log(`Analisa: rows=${ana.rowCount}, cols=${ana.columnCount}\n`);

// Show header row first
console.log('Row 1-7 contents (looking for header):');
for (let r = 1; r <= Math.min(7, ana.rowCount); r++) {
  const cells = [];
  for (let c = 1; c <= 10; c++) {
    const s = str(ana.getCell(r, c));
    cells.push(s.length > 15 ? s.slice(0, 12) + '..' : s);
  }
  console.log(`  r${r}: ${cells.join(' | ')}`);
}

// Detect AHS block titles by scanning for unit-prefixed rows
const TITLE_RE = /^\s*\d+\s+(m[123²³]|kg|ls|bh|pcs|titik|set|unit)\s+\S/i;
const blocks = [];
let inBlock = null;
const components = [];

for (let r = 1; r <= ana.rowCount; r++) {
  const a = str(ana.getCell(r, 1));
  const b = str(ana.getCell(r, 2));
  // Title can be in col A or col B
  const t = TITLE_RE.test(a) ? a : (TITLE_RE.test(b) ? b : null);

  if (t) {
    if (inBlock) blocks.push(inBlock);
    inBlock = { row: r, title: t, components: [], jumlahRow: null };
    continue;
  }
  if (inBlock && /^\s*jumlah\b/i.test(a + ' ' + b)) {
    inBlock.jumlahRow = r;
    blocks.push(inBlock);
    inBlock = null;
    continue;
  }
  if (inBlock) {
    // potential component row — capture name in B, unit in C, coef in D, price in E or F
    const name = b;
    const unit = str(ana.getCell(r, 3));
    const coef = num(ana.getCell(r, 4));
    const price = num(ana.getCell(r, 5)) ?? num(ana.getCell(r, 6));
    if (name && coef != null && coef > 0) {
      inBlock.components.push({ row: r, name, unit, coef, price });
    }
  }
}
if (inBlock) blocks.push(inBlock);

console.log(`\nDetected ${blocks.length} AHS blocks. First 5:`);
for (const b of blocks.slice(0, 5)) {
  console.log(`  • r${b.row}: ${b.title}  (jumlah r${b.jumlahRow}, ${b.components.length} components)`);
  for (const c of b.components.slice(0, 4)) {
    console.log(`      - r${c.row}: ${c.name} | ${c.unit} | coef=${c.coef} | price=${c.price}`);
  }
  if (b.components.length > 4) console.log(`      ... ${b.components.length - 4} more`);
}

// Now scan the RAB sheet — for each data row, look at its column I formula
// (Material per-unit cost) to find the Analisa cell reference.
const rab = wb.getWorksheet('RAB (A)');
console.log(`\n\nRAB (A) formula analysis — how do rows reference Analisa?`);
let counts = { analisaCellRef: 0, AFcomposite: 0, plain: 0, none: 0, other: 0 };
let exampleRefs = [];
for (let r = 8; r <= rab.rowCount; r++) {
  for (const col of [9, 14]) {  // I or N
    const f = formula(rab.getCell(r, col));
    if (!f) continue;
    if (/Analisa!?\$?[A-Z]+\$?\d+/.test(f)) {
      counts.analisaCellRef++;
      if (exampleRefs.length < 5) exampleRefs.push({ r, col, f });
    } else if (/^AF\d+|^=AF/.test(f)) {
      counts.AFcomposite++;
    } else {
      counts.other++;
    }
    break; // only count the row once
  }
}
console.log(`  Analisa cell ref:  ${counts.analisaCellRef}`);
console.log(`  AF composite:      ${counts.AFcomposite}`);
console.log(`  other:             ${counts.other}`);
console.log('  Example refs:');
for (const e of exampleRefs) console.log(`    r${e.r} col${e.col}: ${e.f}`);
