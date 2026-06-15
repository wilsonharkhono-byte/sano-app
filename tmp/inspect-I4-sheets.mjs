import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });

console.log('Sheet names:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const range = sheet['!ref'];
  console.log(`  "${name}": range=${range}`);
}
