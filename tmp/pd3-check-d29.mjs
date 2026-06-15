// Scan REKAP Balok column T to see if D29 weights exist.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['REKAP Balok'];
const ref = sh['!ref'];
const range = XLSX.utils.decode_range(ref);

console.log(`Range: ${ref}, scanning T column...`);
let count = 0;
for (let r = 13; r <= range.e.r + 1; r++) {
  const v = sh[`T${r}`]?.v;
  if (typeof v === 'number' && v > 0) {
    if (count < 10) console.log(`  T${r}=${v}, D${r}=${sh[`D${r}`]?.v}`);
    count++;
  }
}
console.log(`Total rows with T>0 (D29 used): ${count}`);
