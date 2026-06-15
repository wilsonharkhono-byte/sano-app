import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(rab['!ref']);
console.log('RAB (A) range:', rab['!ref']);
// Find which column has the codes
for (let c = 0; c <= 5; c++) {
  let example = null;
  for (let r = range.s.r; r <= Math.min(range.e.r, 100); r++) {
    const cell = rab[XLSX.utils.encode_cell({ r, c })];
    if (cell && /^III\.A\./.test(String(cell.v))) {
      example = { row: r + 1, val: cell.v };
      break;
    }
  }
  console.log(`col ${c} (${XLSX.utils.encode_col(c)}):`, example);
}
// Print first 30 rows fully
console.log('\nFirst 30 rows, cols A-G:');
for (let r = 0; r < 30; r++) {
  const vals = [];
  for (let c = 0; c < 7; c++) {
    const cell = rab[XLSX.utils.encode_cell({ r, c })];
    vals.push(cell ? String(cell.v).slice(0, 25) : '');
  }
  console.log(`r${(r+1).toString().padStart(3)}: ${vals.join(' | ')}`);
}
