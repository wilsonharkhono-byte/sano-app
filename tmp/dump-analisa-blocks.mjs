// Dump all AHS block titles + their rows so I can build per-chapter templates.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);

console.log('=== All detected AHS blocks on Analisa ===');
console.log('title | titleRow..jumlahRow | componentRows | grandTotalAddr');
for (const b of result.ahsBlocks) {
  console.log(`${b.title.padEnd(60)} | ${b.titleRow}..${b.jumlahRow} | [${b.componentRows.join(',')}] | ${b.grandTotalAddress ?? '-'}`);
}
