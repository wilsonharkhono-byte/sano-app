import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
delete process.env.SANO_BOQ_RECIPE_DETAIL;

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map(c => [`${c.sheet}!${c.address}`, c]));

// Find plesteran/acian BoQ rows
const rows = result.boqRows.filter(r => /plester|acian/i.test(r.label ?? ''));
console.log(`Plesteran/Acian BoQ rows: ${rows.length}\n`);
for (const r of rows) {
  const comps = r.recipe?.components ?? [];
  const named = comps.filter(c=>c.materialName).map(c=>c.materialName);
  console.log(`${(r.code??'?').padEnd(12)} ${(r.unit??'?').padEnd(4)} vol=${String(r.planned).padEnd(8)} ${(r.label??'').slice(0,42).padEnd(42)} comps=${comps.length} [${named.slice(0,6).join(', ')}]`);
}
