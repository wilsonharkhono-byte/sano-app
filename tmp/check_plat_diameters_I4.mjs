// Check if plat rows have Besi diameters extracted by the rebar disaggregator
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });

const platRows = result.boqRows.filter((r) => /Plat lantai/i.test(r.label || ''));
console.log(`Found ${platRows.length} plat rows.\n`);

for (const row of platRows.slice(0, 6)) {
  console.log(`\n--- ${row.source_sheet}!r${row.sourceRow} ${row.code} ${row.label} ---`);
  if (row.recipe) {
    const besis = row.recipe.components.filter((c) => c.materialName && /^Besi /i.test(c.materialName));
    console.log(`  Besi diameters: ${besis.length}`);
    besis.forEach((c) => console.log(`    ${c.materialName} qty=${c.quantityPerUnit} kg/m³`));
  } else {
    console.log('  NO recipe');
  }
}
