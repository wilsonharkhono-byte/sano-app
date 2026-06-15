import XLSX from 'xlsx';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const wb = XLSX.read(buf, { cellFormula: true });
const quoted = new Set(), withOp = new Set();
for (const sheet of wb.SheetNames) {
  const ws = wb.Sheets[sheet];
  for (const addr in ws) {
    if (addr[0] === '!') continue;
    const f = ws[addr].f;
    if (!f || !/SUMIFS?/i.test(f)) continue;
    // find quoted-string criteria
    const qs = f.match(/"[^"]*"/g) || [];
    for (const q of qs) quoted.add(q);
    // detect operators inside the criteria args (string forms)
    if (/[<>]=?|<>/.test(f.replace(/[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/g,''))) {
      if (withOp.size < 5) withOp.add(f.slice(0,120));
    }
  }
}
console.log('quoted criteria strings (sample up to 40):');
console.log([...quoted].slice(0,40).join('\n'));
console.log('--- formulas containing comparison ops (sample) ---');
console.log([...withOp].join('\n'));
