import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./tmp_input_citraland.xlsx');
const result = await parseBoqV2(buf);
// inspect shape of a row
const sample = result.boqRows[0];
console.log('ROW KEYS:', Object.keys(sample));
const counts = new Map();
for (const r of result.boqRows) {
  if (!counts.has(r.code)) counts.set(r.code, []);
  counts.get(r.code).push(r);
}
for (const [code, arr] of counts) {
  if (arr.length>1){
    for (const r of arr) console.log('DUP', code, '| srcRow', r.sourceRow, '|', (r.label||r.name||r.description||r.itemName||'?'));
    console.log('');
  }
}
