// Why does our sum=10.8B but workbook total=5.4B?
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const rab = wb.getWorksheet('RAB (A)');

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

// Print EVERY row from RAB (A) where F > 100_000_000 to see big-money rows.
console.log('All rows where F > 100M:');
let sumF = 0;
let countDataRows = 0;
let sumDataF = 0;

for (let r = 8; r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const a = str(row.getCell(1));
  const b = str(row.getCell(2));
  const f = num(row.getCell(6));
  if (f == null) continue;
  sumF += f;

  const isSubtotalA = /subtotal|total/i.test(a);
  const isSubtotalB = /subtotal|total/i.test(b);
  const tag = isSubtotalA || isSubtotalB ? 'SUBTOTAL' : 'data';
  if (tag === 'data') {
    countDataRows++;
    sumDataF += f;
  }
  if (f > 100_000_000) {
    console.log(`  r${r} [${tag}] A="${a.slice(0,20)}" B="${b.slice(0,30)}"  F=${f.toLocaleString('id-ID')}`);
  }
}

console.log(`\nSum of ALL F values: ${sumF.toLocaleString('id-ID')}`);
console.log(`Sum of F where A/B does NOT match /subtotal|total/: ${sumDataF.toLocaleString('id-ID')}`);
console.log(`Count of those data rows: ${countDataRows}`);

// Also print every row whose A starts with the literal "Subtotal"
console.log('\nAll Subtotal/TOTAL rows:');
for (let r = 8; r <= rab.rowCount; r++) {
  const row = rab.getRow(r);
  const a = str(row.getCell(1));
  const b = str(row.getCell(2));
  if (/subtotal|total/i.test(a) || /subtotal|total/i.test(b)) {
    const f = num(row.getCell(6));
    console.log(`  r${r}: A="${a.slice(0,40)}" B="${b.slice(0,40)}" F=${f?.toLocaleString('id-ID')}`);
  }
}
