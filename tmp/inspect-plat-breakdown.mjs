import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('/tmp/_ern_v3.xlsx');
const wb = XLSX.read(buf, { cellFormula: true, cellStyles: false });
const target = 'Breakdown (A) IV.A.1.1';
console.log('Sheet exists?', wb.SheetNames.includes(target));
const { breakdowns } = readBreakdownSheets(wb);
const code = '(A) IV.A.1.1';
const b = breakdowns.get(code);
console.log('Found?', !!b, 'available codes (first 5):', [...breakdowns.keys()].slice(0, 5));
if (b) {
  console.log(`\n=== ${b.boqCode} ${b.description.slice(0, 60)} ===`);
  console.log(`Volume=${b.volume} ${b.unit}, unitCost=${b.unitCost.toFixed(2)}, lineTotal=${b.lineTotal.toFixed(2)}`);
  console.log(`Reconciliation: source=${b.reconciliation.sourceUnitCost.toFixed(2)} computed=${b.reconciliation.computedUnitCost.toFixed(2)} variance=${b.reconciliation.unitCostVariance.toFixed(2)}`);
  console.log('\nComponents:');
  for (const c of b.components) {
    console.log(`  [${c.group}] ${c.componentGroup.slice(0, 50).padEnd(50)} | ${c.materialName.slice(0, 30).padEnd(30)} | qty/${c.nativeUnit}=${c.qtyPerNativeUnit.toFixed(3)} × Rp ${c.unitPrice.toFixed(0)} | ${c.costPerBoqUnit.toFixed(0)} Rp/m³`);
  }
}
