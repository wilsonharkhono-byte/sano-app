import XLSX from 'xlsx';

const wb = XLSX.readFile(
  '/Users/carissatjondro/Dropbox/AI/Claude Code/assets/BOQ/CONTOH_Template_Parser.xlsx',
  { cellFormula: true, cellNF: true, cellStyles: true }
);

function dumpSheet(name, maxCol = 10) {
  const sh = wb.Sheets[name];
  if (!sh || !sh['!ref']) { console.log(`-- ${name}: MISSING`); return; }
  const range = XLSX.utils.decode_range(sh['!ref']);
  console.log(`\n=== Sheet: ${name}  range=${sh['!ref']} ===`);
  for (let r = 0; r <= range.e.r; r++) {
    const cells = [];
    for (let c = 0; c <= Math.min(maxCol, range.e.c); c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (!cell) { cells.push(''); continue; }
      const v = cell.f ? `=${cell.f}` : (cell.v == null ? '' : String(cell.v));
      cells.push(`${XLSX.utils.encode_col(c)}:${v}`);
    }
    console.log(`r${r+1}: ` + cells.map(s => s.slice(0, 35).padEnd(36)).join('|'));
  }
}

for (const sn of wb.SheetNames) dumpSheet(sn);
