import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
const wb = XLSX.read(buf, { cellFormula: true, cellStyles: false });
const { breakdowns, warnings } = readBreakdownSheets(wb);
console.log(`Breakdowns read: ${breakdowns.size}`);
console.log(`First 8 keys:`, [...breakdowns.keys()].slice(0, 8));
console.log(`Has "III.B.1.14"? ${breakdowns.has('III.B.1.14')}`);
console.log(`Has "(A) III.B.1.14"? ${breakdowns.has('(A) III.B.1.14')}`);

// What does the III.B.1.14 breakdown contain (full itemization)?
const key = [...breakdowns.keys()].find(k => k.includes('III.B.1.14'));
const bd = breakdowns.get(key);
if (bd) {
  console.log(`\n=== ${key}: ${bd.components.length} components ===`);
  for (const c of bd.components) {
    console.log(`  [${c.group}] ${(c.materialName ?? '?').slice(0,32).padEnd(32)} qty/${c.nativeUnit}=${c.qtyPerNativeUnit} × Rp ${c.unitPrice} = Rp ${Math.round(c.costPerBoqUnit)}`);
  }
}
