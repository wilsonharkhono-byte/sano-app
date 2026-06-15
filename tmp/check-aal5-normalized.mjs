import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5_normalized.xlsx');
const wb = XLSX.read(buf, { cellFormula: true, cellStyles: false });
const { breakdowns } = readBreakdownSheets(wb);
console.log(`Breakdown sheets: ${breakdowns.size}`);
let mismatches = 0, maxVar = 0;
const bad = [];
for (const [code, bd] of breakdowns) {
  const v = Math.abs(bd.reconciliation?.unitCostVariance ?? 0);
  if (v > maxVar) maxVar = v;
  if (!bd.reconciliation?.reconciles || v > 1) { mismatches++; if (bad.length<8) bad.push(`${code} var=${v.toFixed(2)}`); }
}
console.log(`Mismatched breakdowns (var>1 or reconciles=false): ${mismatches}`);
console.log(`Max abs unitCost variance: ${maxVar.toFixed(4)} Rp`);
if (bad.length) console.log('Sample bad:', bad.join(' | '));
// Check for VI.A.2.* specifically (the ones in the screenshot)
const vi = [...breakdowns.keys()].filter(k=>/VI\.A\.2\./.test(k));
console.log(`VI.A.2.* sheets present: ${vi.length} ->`, vi.slice(0,5));
