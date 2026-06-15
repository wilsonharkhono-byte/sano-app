import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const candidates = result.boqRows.filter(needsExpansion);

console.log(`Total rows: ${result.boqRows.length}`);
console.log(`Eligible for expansion: ${candidates.length}`);
console.log('');
for (const row of candidates) {
  const sourceUnitCost = row.cost_split
    ? row.cost_split.material + row.cost_split.labor + row.cost_split.equipment + row.cost_split.prelim
    : 0;
  console.log(`${row.code.padEnd(12)} ${row.label.slice(0, 35).padEnd(35)} vol=${String(row.planned).padEnd(8)} unit=${row.unit.padEnd(4)} src_uc=${String(sourceUnitCost).padEnd(10)} src_lt=${row.total_cost}`);
}
