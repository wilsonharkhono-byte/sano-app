// Quick inspector: dump the AAL-5 RAB workbook so we can pick representative
// rows for the simplified template.
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');

console.log('Sheets:');
for (const ws of wb.worksheets) {
  console.log(`  - ${ws.name}  (rows=${ws.rowCount}, cols=${ws.columnCount})`);
}

// Dump first 60 rows of "RAB (A)" if it exists
const rab = wb.getWorksheet('RAB (A)');
if (rab) {
  console.log('\n=== RAB (A) first 60 rows ===');
  for (let r = 1; r <= Math.min(60, rab.rowCount); r++) {
    const row = rab.getRow(r);
    const cells = [];
    for (let c = 1; c <= Math.min(14, rab.columnCount); c++) {
      const v = row.getCell(c).value;
      const s = v == null ? '' : typeof v === 'object' && 'result' in v ? `=${v.formula || v.result}` : String(v);
      cells.push(s.length > 30 ? s.slice(0, 27) + '...' : s);
    }
    console.log(`r${r}: ${cells.join(' | ')}`);
  }
}

// Dump first 50 rows of Analisa
const ana = wb.getWorksheet('Analisa');
if (ana) {
  console.log('\n=== Analisa first 80 rows ===');
  for (let r = 1; r <= Math.min(80, ana.rowCount); r++) {
    const row = ana.getRow(r);
    const cells = [];
    for (let c = 1; c <= Math.min(10, ana.columnCount); c++) {
      const v = row.getCell(c).value;
      const s = v == null ? '' : typeof v === 'object' && 'result' in v ? `=${v.formula || v.result}` : String(v);
      cells.push(s.length > 25 ? s.slice(0, 22) + '...' : s);
    }
    console.log(`r${r}: ${cells.join(' | ')}`);
  }
}
