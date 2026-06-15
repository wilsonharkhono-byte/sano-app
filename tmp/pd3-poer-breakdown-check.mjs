import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');

// 1. Which Breakdown sheets exist for Poer rows?
const wb = XLSX.read(buf, { bookSheets: true });
const poerBreakdowns = wb.SheetNames.filter((n) => /Breakdown.*III\.B\.1\./i.test(n));
console.log(`Breakdown sheets for III.B.1.* (Poer family): ${poerBreakdowns.length}`);
for (const n of poerBreakdowns) console.log(`  ${n}`);

console.log('\n=== parseBoqV2 recipe.components for Poer rows ===');
const result = await parseBoqV2(buf);
const poerRows = result.boqRows.filter((r) => /^III\.B\.1\./.test(r.code ?? ''));
for (const r of poerRows) {
  const comps = r.recipe?.components ?? [];
  const groups = {};
  for (const c of comps) groups[c.group ?? c.lineType ?? '?'] = (groups[c.group ?? c.lineType ?? '?'] ?? 0) + 1;
  console.log(`  ${(r.code ?? '?').padEnd(12)} ${(r.label ?? '').slice(0,18).padEnd(18)} components=${comps.length} ${JSON.stringify(groups)}`);
}
