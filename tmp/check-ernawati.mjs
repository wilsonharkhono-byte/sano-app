import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const wb = XLSX.read(buf, { cellFormula: true });
for (const sn of wb.SheetNames) {
  if (!/REKAP|Hasil/i.test(sn)) continue;
  console.log(`\nSheet: ${sn}`);
  const ws = wb.Sheets[sn];
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 0; r <= Math.min(20, range.e.r); r++) {
    const row = [];
    for (let c = range.s.c; c <= Math.min(15, range.e.c); c++) {
      const addr = XLSX.utils.encode_cell({r, c});
      const cell = ws[addr];
      if (cell && cell.v != null && cell.v !== '') {
        const col = XLSX.utils.encode_col(c);
        row.push(`${col}=${typeof cell.v === 'number' ? cell.v : `"${String(cell.v).slice(0,18)}"`}`);
      }
    }
    if (row.length) console.log(`r${r+1}: ${row.join(' | ')}`);
  }
}
