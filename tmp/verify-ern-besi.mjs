import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

// Write output then read back the Besi D13 sheet
const outPath = '/tmp/_ern_besi.xlsx';
await runDeterministic({
  inputPath: './assets/BOQ/RAB ERNAWATI edit.xlsx',
  outputPath: outPath,
  silent: true,
});

const buf = fs.readFileSync(outPath);
const wb = XLSX.read(buf, { cellFormula: true, cellStyles: false });
const { breakdowns } = readBreakdownSheets(wb);

// Look up III.A.1.2 (Besi D13, vol 558.24 kg)
const codes = ['(A) III.A.1.2', '(A) III.A.1.3', '(A) III.A.10.4'];
for (const code of codes) {
  const b = breakdowns.get(code);
  if (!b) { console.log(`NOT FOUND: ${code}`); continue; }
  console.log(`\n=== ${b.boqCode} ${b.description?.slice(0, 60)} ===`);
  console.log(`unit=${b.unit} vol=${b.volume} unitCost=${b.unitCost} lineTotal=${b.lineTotal}`);
  console.log(`Reconciles: ${b.reconciliation.reconciles} variance=${b.reconciliation.unitCostVariance.toFixed(2)} Rp`);
  console.log(`Components (${b.components.length}):`);
  for (const c of b.components) {
    console.log(`  [${c.group}] ${c.componentGroup.padEnd(45)} | ${c.materialName.padEnd(25)} | qty/${c.nativeUnit}=${c.qtyPerNativeUnit} × Rp ${c.unitPrice} = Rp ${c.costPerBoqUnit.toFixed(2)} | total=Rp ${c.totalCost.toFixed(0)}`);
  }
}
