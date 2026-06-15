import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./tmp_input_citraland.xlsx');
const result = await parseBoqV2(buf);
const counts = new Map();
for (const r of result.boqRows) {
  const key = `${r.code}`;
  if (!counts.has(key)) counts.set(key, []);
  counts.get(key).push(`${r.description||''} [srcRow ${r.sourceRow}]`);
}
let dupGroups=0, dupRows=0;
for (const [code, arr] of counts) {
  if (arr.length>1){ dupGroups++; dupRows+=arr.length; console.log('DUP', code, '=>', arr.join('  |  ')); }
}
console.log('---');
console.log('total boqRows:', result.boqRows.length, 'distinct codes:', counts.size, 'dup code-groups:', dupGroups, 'rows in collisions:', dupRows);
