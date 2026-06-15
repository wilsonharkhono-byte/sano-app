import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));

// Look at family III.A.11.2 sub-rows
console.log('=== III.A.11.2.* sub-rows ===');
const codes = ['III.A.11.2.1', 'III.A.11.2.2', 'III.A.11.3.1', 'IV.A.1.1', 'IV.A.2.1'];
for (const code of codes) {
  const row = result.boqRows.find((r) => r.code === code);
  if (!row) { console.log(`NOT FOUND: ${code}`); continue; }
  const r = row.sourceRow;
  console.log(`\n${code} r${r} unit=${row.unit} vol=${row.planned} desc="${row.description ?? '?'}"`);
  const colsList = ['R','S','T','V','W','X','Z','AA','AC','AD','L','M','N'];
  for (const c of colsList) {
    const v = lookup.get(`RAB (A)!${c}${r}`)?.value;
    if (v !== undefined && v !== null && v !== '' && v !== 0) console.log(`  ${c}=${typeof v === 'number' ? v.toFixed(2) : v}`);
  }
}
