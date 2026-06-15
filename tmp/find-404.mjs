import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const wb = XLSX.read(buf, { cellFormula: true });
const ws = wb.Sheets['REKAP Balok'];
const range = XLSX.utils.decode_range(ws['!ref']);
for (let r = 0; r <= range.e.r; r++) {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r, c});
    const cell = ws[addr];
    if (cell && typeof cell.v === 'number' && Math.abs(cell.v - 404.365) < 1) {
      console.log(`Found 404.365-ish at ${addr} (r${r+1}): ${cell.v}`);
      // Print neighboring cells
      for (let cc = 0; cc < 20; cc++) {
        const a = XLSX.utils.encode_cell({r, c: cc});
        const v = ws[a]?.v;
        if (v != null && v !== '') console.log(`  ${a} = ${v}`);
      }
    }
  }
}
