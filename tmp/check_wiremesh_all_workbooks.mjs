// Check AC/AD usage across all three reference workbooks
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const files = [
  './assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx',
];

for (const path of files) {
  console.log(`\n========== ${path.split('/').pop()} ==========`);
  const buf = fs.readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
  for (const sheetName of wb.SheetNames) {
    if (!/^RAB/i.test(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    let acCount = 0, adCount = 0, bothCount = 0;
    const examples = [];
    for (let r = 8; r <= range.e.r + 1; r++) {
      const AC = sheet[`AC${r}`];
      const AD = sheet[`AD${r}`];
      const acNum = typeof AC?.v === 'number' ? AC.v : 0;
      const adNum = typeof AD?.v === 'number' ? AD.v : 0;
      if (acNum > 0) acCount++;
      if (adNum > 0) adCount++;
      if (acNum > 0 && adNum > 0) {
        bothCount++;
        if (examples.length < 5) {
          const labelB = sheet[`B${r}`]?.v;
          const A = sheet[`A${r}`]?.v;
          const N = sheet[`N${r}`]?.v;
          const Z = sheet[`Z${r}`]?.v;
          const AA = sheet[`AA${r}`]?.v;
          examples.push({ r, A, B: typeof labelB === 'string' ? labelB.slice(0, 50) : labelB, AC: acNum, AD: adNum, N, Z, AA });
        }
      }
    }
    console.log(`  ${sheetName}: AC>0=${acCount}, AD>0=${adCount}, both>0=${bothCount}`);
    examples.forEach((e) => console.log(`    r${e.r}: A=${e.A} B="${e.B}" AC=${e.AC} AD=${e.AD} Z=${e.Z} AA=${e.AA} N=${e.N}`));
  }
}
