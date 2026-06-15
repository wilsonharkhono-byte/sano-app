import XLSX from 'xlsx';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const wb = XLSX.read(buf, { cellFormula: true });
let count = 0, samples = [];
const fnSet = {};
for (const sheet of wb.SheetNames) {
  const ws = wb.Sheets[sheet];
  for (const addr in ws) {
    if (addr[0] === '!') continue;
    const cell = ws[addr];
    if (cell.f) {
      const f = cell.f;
      if (/SUMIFS?/i.test(f)) {
        count++;
        if (samples.length < 30) samples.push(`${sheet}!${addr}: =${f}`);
      }
      const fns = f.match(/[A-Z][A-Z0-9]*(?=\()/g) || [];
      for (const fn of fns) fnSet[fn] = (fnSet[fn]||0)+1;
    }
  }
}
console.log('SUMIF/SUMIFS count:', count);
console.log('--- samples ---');
samples.forEach(s => console.log(s));
console.log('--- all functions used ---');
console.log(JSON.stringify(fnSet, null, 2));
