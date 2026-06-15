// Carefully dump REKAP Plat columns K through R in rows 1, 2, 6.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['REKAP Plat'];

const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S'];
console.log('  col | row1 | row2 | row6 (S3=S4)');
for (const c of cols) {
  const r1 = sh[`${c}1`]?.v ?? '';
  const r2 = sh[`${c}2`]?.v ?? '';
  const r6 = sh[`${c}6`]?.v ?? '';
  console.log(`  ${c.padEnd(3)} | ${String(r1).slice(0,18).padEnd(18)} | ${String(r2).slice(0,18).padEnd(18)} | ${String(r6).slice(0,18)}`);
}

// Same drill for REKAP Balok
console.log('\nREKAP Balok rows 10, 11, 12, 13:');
const shB = wb.Sheets['REKAP Balok'];
for (const c of cols.concat(['T','U','V','W','X','Y','Z','AA','AB','AC'])) {
  const r10 = shB[`${c}10`]?.v ?? '';
  const r11 = shB[`${c}11`]?.v ?? '';
  const r12 = shB[`${c}12`]?.v ?? '';
  console.log(`  ${c.padEnd(3)} | r10=${String(r10).slice(0,12).padEnd(12)} | r11=${String(r11).slice(0,12).padEnd(12)} | r12=${String(r12).slice(0,12)}`);
}
