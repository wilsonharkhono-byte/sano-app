// Pattern C: follow the cross-sheet chain from RAB → REKAP-PC → Analisa
import XLSX from 'xlsx';

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';
const wb = XLSX.readFile(ROOT + 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  { cellFormula: true, cellNF: true });

function dumpRangeCols(sheetName, fromRow, toRow, fromCol = 0, toCol = 9) {
  const sh = wb.Sheets[sheetName];
  if (!sh) { console.log(`MISSING sheet ${sheetName}`); return; }
  console.log(`\n=== ${sheetName} rows ${fromRow}..${toRow} ===`);
  for (let r = fromRow - 1; r <= toRow - 1; r++) {
    const cells = [];
    for (let c = fromCol; c <= toCol; c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (!cell) { cells.push(`${XLSX.utils.encode_col(c)}=`); continue; }
      const v = cell.f ? `=${cell.f}` : (cell.v == null ? '' : String(cell.v));
      cells.push(`${XLSX.utils.encode_col(c)}=${v.slice(0, 32)}`);
    }
    console.log(`r${r+1}: ${cells.join(' | ')}`);
  }
}

// Step 1: RAB row 51 has H='REKAP-PC'!B8.  Visit REKAP-PC row 8 area.
console.log('\n#### Step 1: REKAP-PC sheet, around B8 (target of RAB!H51) ####');
dumpRangeCols('REKAP-PC', 1, 23, 0, 21);

// Step 2: RAB row 51 R cell is =Analisa!F82, AA cell is =Analisa!F132. Look at Analisa sheet around 30-140.
console.log('\n\n#### Step 2: Analisa sheet near rows 25-140 (referenced) ####');
dumpRangeCols('Analisa', 25, 50, 0, 9);
dumpRangeCols('Analisa', 75, 110, 0, 9);
dumpRangeCols('Analisa', 125, 140, 0, 9);

// Step 3: REKAP Balok G363 (target of B173-1), G376 (target of B25-1)
console.log('\n\n#### Step 3: REKAP Balok rows around G348..G408 ####');
dumpRangeCols('REKAP Balok', 345, 410, 0, 25);
