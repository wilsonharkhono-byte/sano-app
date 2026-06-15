// Dump the first ~20 rows of RAB (A) plus the header row to learn column layout.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['RAB (A)'];
const ref = sh['!ref'];
const range = XLSX.utils.decode_range(ref);

console.log(`Range: ${ref}, rows 1..${range.e.r + 1}`);
console.log('\n--- Rows 1..15 ---');
for (let r = 1; r <= 15; r++) {
  const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB'];
  const line = cols.map((c) => {
    const cell = sh[`${c}${r}`];
    if (!cell) return '·';
    const v = cell.v;
    return String(v).slice(0, 14).padEnd(14);
  });
  console.log(`R${String(r).padStart(3)} | ${line.join(' | ')}`);
}
