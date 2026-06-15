// Dump a masonry (Pasangan dinding) row to see where N comes from.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets['RAB (B)'];

// VIII.A.1 — first masonry mismatch. Find row by label.
const range = XLSX.utils.decode_range(sheet['!ref']);
let foundRow = null;
for (let r = 1; r <= range.e.r + 1; r++) {
  const b = sheet[`B${r}`]?.v;
  if (b && String(b).includes('Pasangan dinding bata merah tebal 15 cm')) {
    foundRow = r;
    break;
  }
}
console.log('Found Pasangan row at:', foundRow);

const cols = [];
for (let c = 0; c <= 40; c++) cols.push(XLSX.utils.encode_col(c));
for (const c of cols) {
  const cell = sheet[`${c}${foundRow}`];
  if (!cell) continue;
  const v = cell.v;
  const f = cell.f;
  if (v == null && !f) continue;
  console.log(`  ${c}${foundRow} = ${JSON.stringify(v)}${f ? `  (formula: ${f})` : ''}`);
}
