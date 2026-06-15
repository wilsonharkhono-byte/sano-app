// Inspect AAL-5 RAB (A) column headers
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sheet = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(sheet['!ref']);

// Print headers from rows 5-8 for cols S..AE
const cols = ['S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH'];
for (let r = 5; r <= 9; r++) {
  const vals = cols.map((c) => sheet[`${c}${r}`]?.v ?? '');
  console.log(`r${r}: ${cols.map((c,i)=>`${c}=${JSON.stringify(vals[i])}`).join('  ')}`);
}

// Now check rows that have AC > 0 in AAL-5
console.log('\n--- Rows with AC > 0 in AAL-5 ---');
let count = 0;
for (let r = 10; r <= range.e.r + 1; r++) {
  const AC = sheet[`AC${r}`]?.v;
  const AD = sheet[`AD${r}`]?.v;
  if (typeof AC === 'number' && AC > 0) {
    const labelB = sheet[`B${r}`]?.v;
    console.log(`  r${r}: AC=${AC} AD=${AD} B="${typeof labelB==='string'?labelB.slice(0,50):labelB}"`);
    count++;
    if (count > 10) break;
  }
}
console.log(`Total: ${count}`);
