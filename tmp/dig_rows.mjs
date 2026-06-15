import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellNF: false });
const rab = wb.Sheets['RAB (A)'];
const analisa = wb.Sheets['Analisa'];

// Helper: read a cell value
function get(sheet, addr) {
  const c = sheet[addr];
  if (!c) return null;
  return c.v;
}

// Step 1: find each target row in RAB (A) by code in col B
const targets = ['III.A.1.1', 'III.A.2.1', 'III.A.3.1', 'III.A.4.1', 'III.A.4.2', 'V.A.2.6', 'V.A.3.1', 'VI.A.2.5'];
const range = XLSX.utils.decode_range(rab['!ref']);
const targetRows = {};
for (let r = range.s.r; r <= range.e.r; r++) {
  const codeCell = rab[XLSX.utils.encode_cell({ r, c: 1 })]; // col B
  if (codeCell && targets.includes(String(codeCell.v).trim())) {
    targetRows[String(codeCell.v).trim()] = r + 1; // 1-based
  }
}
console.log('Target row numbers:', targetRows);

// Step 2: for each target, dump key columns
console.log('\n=== RAB (A) row dumps ===');
console.log('cols: D=vol, E=unit_price, N=at_cost_unit, R=mat/m3, S=labor/m3, T=equip/m3, V=m2/m3, W=cost/m2, Z=kg/m3, AA=blend Rp/kg');
for (const [code, rownum] of Object.entries(targetRows)) {
  const r0 = rownum - 1;
  const cols = { D: 3, E: 4, N: 13, R: 17, S: 18, T: 19, V: 21, W: 22, Z: 25, AA: 26 };
  const vals = {};
  for (const [k, c] of Object.entries(cols)) {
    vals[k] = get(rab, XLSX.utils.encode_cell({ r: r0, c }));
  }
  // Also get label from col C
  const label = get(rab, XLSX.utils.encode_cell({ r: r0, c: 2 }));
  console.log(`\n${code} (row ${rownum}) ${label}`);
  for (const [k, v] of Object.entries(vals)) console.log(`  ${k} = ${v}`);
}
