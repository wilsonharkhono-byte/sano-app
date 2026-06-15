// Dump the FULL column layout of one AHS block to understand where components live.
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const ana = wb.getWorksheet('Analisa');

function val(cell) {
  if (cell?.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v != null) {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('text' in v) return v.text;
    if ('formula' in v) return v.formula;
  }
  return v;
}
function str(cell) { const v = val(cell); return v == null ? '' : String(v).trim(); }

// Print rows 13-50 in full column dump (cols A-K)
console.log('Analisa rows 13-60 (cols A-K):');
console.log(' r | A          | B                              | C        | D       | E       | F           | G       | H       | I       | J       | K');
console.log('---+------------+--------------------------------+----------+---------+---------+-------------+---------+---------+---------+---------+----------');
for (let r = 13; r <= 60; r++) {
  const cells = [];
  for (let c = 1; c <= 11; c++) {
    const s = str(ana.getCell(r, c));
    cells.push(s);
  }
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 2) + '..' : s.padEnd(n));
  const row = [
    String(r).padStart(2),
    trunc(cells[0], 10),
    trunc(cells[1], 30),
    trunc(cells[2], 8),
    trunc(cells[3], 7),
    trunc(cells[4], 7),
    trunc(cells[5], 11),
    trunc(cells[6], 7),
    trunc(cells[7], 7),
    trunc(cells[8], 7),
    trunc(cells[9], 7),
    trunc(cells[10], 8),
  ];
  console.log(row.join(' | '));
}
