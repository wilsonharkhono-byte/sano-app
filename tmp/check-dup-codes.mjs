import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const path = './assets/BOQ/SPH 4 Sonny Citraland Selat Golf - Normalized.xlsx';
const buf = fs.readFileSync(path);
const result = await parseBoqV2(buf);

const counts = new Map();
for (const row of result.boqRows ?? []) {
  const code = row.code ?? '(none)';
  if (!counts.has(code)) counts.set(code, []);
  counts.get(code).push(row.label ?? row.description ?? '');
}

const dups = [...counts.entries()].filter(([, v]) => v.length > 1);
console.log('Total BoQ rows:', result.boqRows?.length);
console.log('Distinct codes:', counts.size);
console.log('Duplicate codes:', dups.length);
for (const [code, labels] of dups) {
  console.log(`  ${code} (x${labels.length}):`);
  for (const l of labels) console.log(`      - ${l}`);
}
