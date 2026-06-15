// Read EVERY data row from the AAL-5 RAB (A) sheet and dump a structured
// JSON so we can build the simplified workbook from real numbers.
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const rab = wb.getWorksheet('RAB (A)');

// Helper: get the cached/computed value of a cell.
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
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(cell) {
  const v = val(cell);
  return v == null ? '' : String(v).trim();
}

// Chapter / sub-chapter detection from col A
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;
const SUB   = /^[A-Z]$/;

let chapter = '';
let subchapter = '';
const items = [];
let grandTotal = 0;

// Walk every row (header is row 7; data starts row 8)
for (let r = 8; r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const aText = str(row.getCell(1));        // NO
  const bText = str(row.getCell(2));        // Description
  const cText = str(row.getCell(3));        // Unit
  const dNum  = num(row.getCell(4));        // Volume
  const eNum  = num(row.getCell(5));        // Unit price
  const fNum  = num(row.getCell(6));        // Total
  const iNum  = num(row.getCell(9));        // Material
  const jNum  = num(row.getCell(10));       // Upah
  const kNum  = num(row.getCell(11));       // Peralatan
  const lNum  = num(row.getCell(12));       // Subkon
  const mNum  = num(row.getCell(13));       // Prelim

  // Chapter header? (roman in A, B has uppercase title, no numeric vol)
  if (ROMAN.test(aText)) {
    chapter = `${aText}. ${bText}`;
    subchapter = '';
    continue;
  }
  // Sub-chapter header? (single letter in A)
  if (SUB.test(aText)) {
    subchapter = `${aText}. ${bText}`;
    continue;
  }
  // Subtotal row?
  if (/^subtotal/i.test(bText) || /^subtotal/i.test(aText)) {
    continue;
  }
  // Empty row?
  if (!bText && !cText && dNum == null && eNum == null && fNum == null) {
    continue;
  }
  // Header-like row inside (sometimes happens)
  if (/^uraian|^satuan|^volume$/i.test(bText)) continue;

  // Data row — keep it
  items.push({
    rowNum: r,
    code: aText,
    chapter,
    subchapter,
    item: bText.replace(/\s+/g, ' '),
    unit: cText,
    volume: dNum,
    unitPrice: eNum,
    total: fNum,
    material: iNum,
    upah: jNum,
    peralatan: kNum,
    subkon: lNum,
    prelim: mNum,
  });

  if (fNum != null) grandTotal += fNum;
}

console.log(`Items extracted: ${items.length}`);
console.log(`Grand total (sum of F column data rows): Rp ${grandTotal.toLocaleString('id-ID')}`);

// Also try to read the workbook's own grand total if present.
// In AAL-5 there's often a "Jumlah Total" or similar near the bottom of RAB
// or in REKAP RAB. Scan the last 20 rows for a labeled total.
console.log('\nLast 25 rows scan for totals:');
for (let r = Math.max(8, rab.rowCount - 25); r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const cells = [];
  for (let c = 1; c <= 8; c++) {
    cells.push(str(row.getCell(c)).slice(0, 30));
  }
  const f = num(row.getCell(6));
  if (cells.some(s => /jumlah|total|grand/i.test(s)) || (f != null && f > 0)) {
    console.log(`  r${r}: ${cells.join(' | ')}  F=${f}`);
  }
}

// Save the extracted data to JSON so the next script can use it.
import { writeFileSync } from 'node:fs';
writeFileSync('tmp/aal5_extracted.json', JSON.stringify({ items, grandTotal }, null, 2));
console.log('\nWrote tmp/aal5_extracted.json');
