// Verify source_sheet on AAL-5 rows
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
console.log('Total rows:', result.boqRows.length);
const sheets = new Set();
for (const r of result.boqRows) sheets.add(r.source_sheet);
console.log('Distinct source sheets:', [...sheets]);
// Check a few rows
result.boqRows.slice(0, 3).forEach((r) => {
  console.log(`  ${r.source_sheet}!r${r.sourceRow} ${r.code}`);
});
