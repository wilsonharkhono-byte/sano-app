// Use parseBoqV2 to find sourceRow for our spot-check codes.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
const result = await parseBoqV2(buf);

const codes = ['III.B.1.8','III.B.2.6','IV.A.2.6','V.A.2.5','IV.A.4.1','IV.A.1.1','III.B.4.1'];
for (const c of codes) {
  const row = result.boqRows.find((r) => r.code === c);
  if (!row) { console.log(`${c} NOT FOUND`); continue; }
  console.log(`${c.padEnd(12)} sourceRow=${row.sourceRow} label="${row.label.slice(0,50)}"`);
}

// Also dump REKAP row for IV.A.2.6 (Balok B24-1) and a Poer row III.B.1.8 (Poer PC.5)
console.log('\nRebar disaggregated components for IV.A.2.6:');
const balok = result.boqRows.find((r) => r.code === 'IV.A.2.6');
if (balok) {
  for (const c of balok.recipe.components) {
    if (/Besi|Bendrat|Beton decking|Pembesian|besi/i.test(c.materialName ?? '')) {
      console.log(`  ${c.materialName} qty=${c.quantityPerUnit} unit=${c.unit} price=${c.unitPrice} ref=${c.referencedBlockTitle}`);
    }
  }
}
