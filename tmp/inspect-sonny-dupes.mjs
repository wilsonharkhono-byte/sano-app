import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);
const rows = result.boqRows;
console.log('TOTAL boqRows:', rows.length);

// Duplicate code detection
const byCode = new Map();
for (const r of rows) {
  if (!byCode.has(r.code)) byCode.set(r.code, []);
  byCode.get(r.code).push(r);
}
const dupes = [...byCode.entries()].filter(([,v]) => v.length > 1);
console.log('\n=== DUPLICATE CODES (current parser):', dupes.length, '===');
for (const [code, list] of dupes) {
  console.log(`  ${code}  x${list.length}`);
  for (const r of list) console.log(`     row ${r.sourceRow}: ${r.label}`);
}

// Dump the Sloof / Balok area (chapter where the colored blocks are)
console.log('\n=== Rows with label containing Sloof/Balok ===');
for (const r of rows) {
  if (/sloof|balok/i.test(r.label)) {
    console.log(`  ${r.code.padEnd(14)} row${r.sourceRow}  sub_chapter="${r.sub_chapter}"  | ${r.label}`);
  }
}
