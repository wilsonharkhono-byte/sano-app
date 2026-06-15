// Check REKAP Balok structure on PD3 — same columns (D=label, L..S=diameters)?
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });

for (const name of ['REKAP Balok','REKAP-PC','REKAP Plat','Hasil-Kolom']) {
  console.log(`\n=== ${name} ===`);
  const sh = wb.Sheets[name];
  if (!sh) { console.log('  (sheet missing)'); continue; }
  // Look at the first ~15 rows to find header
  for (let r = 1; r <= 12; r++) {
    const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U'];
    const line = cols.map((c) => {
      const v = sh[`${c}${r}`]?.v;
      return v == null ? '·' : String(v).slice(0,12).padEnd(12);
    });
    console.log(`R${String(r).padStart(2)} | ${line.join(' | ')}`);
  }
}
