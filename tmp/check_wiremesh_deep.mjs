// Check whether AC/AD are populated via formula-evaluated values
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });

for (const sheetName of ['RAB (B)', 'RAB (C)', 'RAB (D)', 'RAB (E)']) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) continue;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  console.log(`\n=== ${sheetName} ===`);

  let rows = [];
  for (let r = 10; r <= range.e.r + 1; r++) {
    const AC = sheet[`AC${r}`];
    const AD = sheet[`AD${r}`];
    const N = sheet[`N${r}`];
    const AF = sheet[`AF${r}`];
    const labelB = sheet[`B${r}`]?.v;
    const labelA = sheet[`A${r}`]?.v;
    if ((AC?.v != null && Number(AC.v) > 0) || (AD?.v != null && Number(AD.v) > 0) || (AF?.f && AF.f.includes('AC'))) {
      rows.push({ r, AC_v: AC?.v, AC_f: AC?.f, AD_v: AD?.v, AD_f: AD?.f, N_v: N?.v, AF_f: AF?.f, A: labelA, B: typeof labelB === 'string' ? labelB.slice(0, 50) : labelB });
    }
  }
  console.log(`  Found ${rows.length} rows with AC/AD/wiremesh formula:`);
  rows.slice(0, 15).forEach((r) => console.log(`    r${r.r}: A=${r.A} B=${r.B} AC=${r.AC_v} AD=${r.AD_v} AF=${r.AF_f}`));
}
