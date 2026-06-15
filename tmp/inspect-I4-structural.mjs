// Find a row that has bekisting + concrete + besi all populated so I can see the full invariant.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });

const cols = [];
for (let c = 0; c <= 40; c++) cols.push(XLSX.utils.encode_col(c));

for (const sheetName of ['RAB (B)', 'RAB (C)', 'RAB (D)', 'RAB (E)']) {
  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  console.log(`\n\n=== ${sheetName} (last row ${range.e.r + 1}) ===`);

  for (let r = 10; r <= range.e.r + 1; r++) {
    const W = sheet[`W${r}`]?.v;
    const AA = sheet[`AA${r}`]?.v;
    const R = sheet[`R${r}`]?.v;
    // Find any row with both bekisting (W>0) and besi (AA>0) — i.e., a structural balok/kolom row
    if (typeof W === 'number' && W > 0 && typeof AA === 'number' && AA > 0 && typeof R === 'number' && R > 0) {
      const label = sheet[`B${r}`]?.v || '';
      const code = sheet[`A${r}`]?.v || '';
      console.log(`  r${r} ${code} ${String(label).slice(0, 50)}: R=${R}  W=${W}  AA=${AA}`);
    }
  }
}
