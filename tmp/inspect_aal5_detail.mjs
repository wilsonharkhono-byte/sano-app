import XLSX from 'xlsx';
const wb = XLSX.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', { cellFormula: true, cellNF: true });

function dumpSheet(name, maxRow = 30) {
  const sh = wb.Sheets[name];
  if (!sh) { console.log(`-- ${name}: MISSING`); return; }
  const range = XLSX.utils.decode_range(sh['!ref'] ?? 'A1');
  console.log(`\n=== ${name} (range ${sh['!ref']}) ===`);
  for (let r = 0; r <= Math.min(maxRow, range.e.r); r++) {
    const row = [];
    for (let c = 0; c <= Math.min(15, range.e.c); c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (!cell) { row.push(''); continue; }
      const val = cell.f ? `=${cell.f}` : String(cell.v ?? '');
      row.push(val.slice(0, 30));
    }
    console.log(`r${r+1}: ${row.map(v => v.padEnd(12)).join('|')}`);
  }
}

dumpSheet('Material', 25);
dumpSheet('Analisa', 35);
dumpSheet('Upah', 20);
dumpSheet('RAB (A)', 25);
