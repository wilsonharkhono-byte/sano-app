// Comprehensive check: dump ALL rows that have any value in AC or AD on every RAB sheet
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });

for (const sheetName of ['RAB (A)', 'RAB (B)', 'RAB (C)', 'RAB (D)', 'RAB (E)']) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) continue;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  console.log(`\n=== ${sheetName} (range ${sheet['!ref']}) ===`);
  let any = 0;
  for (let r = 1; r <= range.e.r + 1; r++) {
    const AC = sheet[`AC${r}`];
    const AD = sheet[`AD${r}`];
    if (AC?.v != null || AD?.v != null || AC?.f || AD?.f) {
      const labelB = sheet[`B${r}`]?.v;
      const N = sheet[`N${r}`]?.v;
      const V = sheet[`V${r}`]?.v;
      console.log(`  r${r}: AC.v=${JSON.stringify(AC?.v)} AC.f=${AC?.f} AD.v=${JSON.stringify(AD?.v)} AD.f=${AD?.f} V=${V} N=${N} B=${typeof labelB==='string' ? labelB.slice(0,40) : labelB}`);
      any++;
      if (any > 30) break;
    }
  }
  console.log(`  total with AC/AD signal: ${any}`);
}
