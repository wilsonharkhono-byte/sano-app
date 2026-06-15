// Parse with boqSheet:'auto' so we get rows from all RAB (A..E) sheets.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });

// Group rows by source_sheet
const bySheet = new Map();
for (const r of result.boqRows) {
  if (!bySheet.has(r.source_sheet)) bySheet.set(r.source_sheet, []);
  bySheet.get(r.source_sheet).push(r);
}
console.log('Total BoQ rows (auto):', result.boqRows.length);
for (const [sheet, rows] of bySheet) {
  const expansion = rows.filter(needsExpansion);
  console.log(`  ${sheet}: total=${rows.length}  needsExpansion=${expansion.length}`);
}

console.log('\nAHS blocks detected:', result.ahsBlocks.length);
console.log('Cell count:', result.cells.length);
