import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./tmp_input_citraland.xlsx');
const result = await parseBoqV2(buf);
const counts = new Map();
for (const r of result.boqRows) counts.set(r.code, (counts.get(r.code)??0)+1);
const dups=[...counts].filter(([,n])=>n>1);
console.log('DUP CODE GROUPS NOW:', dups.length, dups);
// show the Sloof/Kolom region codes
for (const r of result.boqRows.filter(r=>r.sourceRow>=35 && r.sourceRow<=95)) {
  console.log(r.code.padEnd(14), '| row', String(r.sourceRow).padEnd(4), '|', r.label);
}
// show disambiguated
const flagged = result.boqRows.filter(r=>r.code_note);
console.log('--- FLAGGED ---');
for (const r of flagged) console.log(r.code, '::', r.code_note);
