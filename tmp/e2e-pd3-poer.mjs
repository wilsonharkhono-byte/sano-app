import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

delete process.env.SANO_BOQ_RECIPE_DETAIL; // rely on auto-enable
const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
const result = await parseBoqV2(buf);

const poer = result.boqRows.filter(r => /^III\.B\.1\.\d+$/.test(r.code))
  .sort((a,b)=>a.code.localeCompare(b.code, undefined, {numeric:true}));
console.log('=== PD3 Poer rows AFTER parser fix (no env flag) ===');
for (const r of poer) {
  const comps = r.recipe?.components ?? [];
  const m = comps.filter(c=>c.lineType==='material').length;
  const u = comps.filter(c=>c.lineType==='labor').length;
  const a = comps.filter(c=>c.lineType==='equipment').length;
  const named = comps.filter(c=>c.materialName).length;
  console.log(`  ${r.code.padEnd(12)} comps=${String(comps.length).padStart(2)} (M:${m} U:${u} A:${a}) named=${named}`);
}
