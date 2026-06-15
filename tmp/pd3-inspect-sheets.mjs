// Inspect raw sheet structure of PD3 workbook using SheetJS directly to learn
// which sheets exist and whether they have the same names as AAL-5.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });
console.log('Sheet names:');
for (const name of wb.SheetNames) {
  const sh = wb.Sheets[name];
  const range = sh['!ref'] ?? '';
  console.log(`  ${JSON.stringify(name).padEnd(35)} range=${range}`);
}
