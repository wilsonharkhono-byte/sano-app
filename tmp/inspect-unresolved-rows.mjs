import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const path = process.argv[2] ?? './assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx';
const buf = fs.readFileSync(path);
const result = await parseBoqV2(buf, { boqSheet: 'auto' });

// Unresolved rows in AAL-5 from latest run:
//   VIII.A.1, VIII.B.1, VIII.C.1, VIII.D.1, and maybe Strong band (planter box?)
const ofInterest = ['VIII.A.1', 'VIII.B.1', 'VIII.C.1', 'VIII.D.1', 'II.B.3', '(A) IX.D.1', '(A) IX.C.2', '(A) IX.C.3'];

for (const row of result.boqRows) {
  if (!ofInterest.some(c => row.code === c || row.label?.includes('Strong band'))) continue;
  if (!ofInterest.includes(row.code)) continue;
  console.log(`\n=== ${row.code} | ${row.label?.slice(0, 80)} ===`);
  console.log(`  sheet=${row.source_sheet}, row=${row.sourceRow}, unit=${row.unit}, planned=${row.planned}, N=${row.total_cost}, subkon=${row.subkon_cost_per_unit}`);
  console.log(`  cost_split=`, row.cost_split);
  if (!row.recipe) {
    console.log('  recipe = null');
    continue;
  }
  console.log(`  recipe.totalCached=${row.recipe.totalCached}, components=${row.recipe.components.length}`);
  for (const c of row.recipe.components) {
    console.log(`    [${c.lineType}] ${c.sourceCell.sheet}!${c.sourceCell.address} -> ${c.referencedCell.sheet}!${c.referencedCell.address} (block: ${c.referencedBlockTitle ?? 'NULL'} @row ${c.referencedBlockRow ?? 'NULL'}) qty=${c.quantityPerUnit} price=${c.unitPrice} cost=${c.costContribution}`);
  }
}
