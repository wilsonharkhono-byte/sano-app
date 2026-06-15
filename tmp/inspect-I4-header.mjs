// Dump headers row 6+7 of RAB (B) cell-by-cell to map every column.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets['RAB (B)'];

const colLetters = [];
for (let c = 0; c <= 40; c++) {
  colLetters.push(XLSX.utils.encode_col(c));
}

console.log('--- Row 6 (group headers) ---');
for (const c of colLetters) {
  const v = sheet[`${c}6`]?.v;
  if (v != null) console.log(`  ${c}6 = ${JSON.stringify(v)}`);
}

console.log('\n--- Row 7 (column headers) ---');
for (const c of colLetters) {
  const v = sheet[`${c}7`]?.v;
  if (v != null) console.log(`  ${c}7 = ${JSON.stringify(v)}`);
}

console.log('\n--- Row 8 (subheaders if any) ---');
for (const c of colLetters) {
  const v = sheet[`${c}8`]?.v;
  if (v != null) console.log(`  ${c}8 = ${JSON.stringify(v)}`);
}

// Pick a structural row (lantai kerja r15 had concrete data) and dump every column
console.log('\n--- Row 15 (Lantai kerja di bawah poer, has concrete-like data) ---');
for (const c of colLetters) {
  const cell = sheet[`${c}15`];
  if (!cell) continue;
  const v = cell.v;
  const f = cell.f;
  console.log(`  ${c}15 = ${JSON.stringify(v)}${f ? `  (formula: ${f})` : ''}`);
}
