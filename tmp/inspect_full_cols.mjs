// Look at ALL columns A-AO for Poer / Balok rows to see the unit-price column N
import XLSX from 'xlsx';

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';
const wb = XLSX.readFile(ROOT + 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  { cellFormula: true, cellNF: true, cellStyles: true });

const sh = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(sh['!ref']);
console.log(`AAL5 RAB (A) range=${sh['!ref']} maxCol=${range.e.c} (${XLSX.utils.encode_col(range.e.c)})`);

// Show header rows 1..10 and a few content rows full-width
const SHOW_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50, 51, 59, 64, 65, 78, 80, 81, 125, 126, 131, 139];
for (const oneBased of SHOW_ROWS) {
  const r = oneBased - 1;
  const row = [];
  for (let c = 0; c <= range.e.c; c++) {
    const cell = sh[XLSX.utils.encode_cell({ r, c })];
    if (!cell) continue;
    let v;
    if (cell.f) v = `=${cell.f}`;
    else if (cell.v == null) v = '';
    else v = String(cell.v);
    row.push(`${XLSX.utils.encode_col(c)}=${v.slice(0, 50)}`);
  }
  console.log(`\n--- r${oneBased} ---`);
  for (const x of row) console.log(`  ${x}`);
}
