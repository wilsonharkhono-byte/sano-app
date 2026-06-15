import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const WBS = [
  './assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx',
  './assets/BOQ/RAB ERNAWATI edit.xlsx',
];
for (const path of WBS) {
  const buf = fs.readFileSync(path);
  const result = await parseBoqV2(buf);
  let count = 0;
  for (const r of result.boqRows) {
    if (r.unit === 'kg' && /Besi\s+D\d+/i.test(r.label ?? r.description ?? '')) count++;
  }
  console.log(`${path.split('/').pop()}: ${count} besi-only rows (unit=kg, label has "Besi D\\d+")`);
}
