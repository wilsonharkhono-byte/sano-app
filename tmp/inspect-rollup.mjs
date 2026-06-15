import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);

// Rollup key = code with the final (bullet) segment dropped.
function rollupKey(code){ const p=code.split('.'); return p.length>1? p.slice(0,-1).join('.') : code; }

const groups = new Map();
for (const r of result.boqRows){
  if (!r.is_sub_item) continue;            // only bullet line-items roll up
  const key = rollupKey(r.code);
  if(!groups.has(key)) groups.set(key, {label:r.sub_chapter, chapter:r.chapter, rows:[]});
  groups.get(key).rows.push(r);
}
// Show the Kolom groups specifically
console.log('=== Rollup groups whose label mentions Kolom ===');
for (const [key,g] of groups){
  if(!/kolom/i.test(g.label||'')) continue;
  const vol = g.rows.reduce((s,r)=>s+(r.planned||0),0);
  let reconcilable=0, needsReview=0;
  for(const r of g.rows){
    const comps=r.recipe?.components||[];
    const bad=comps.some(c=>!c.materialName||c.quantityPerUnit===0||c.quantityPerUnit==null);
    if(comps.length>0 && !bad) reconcilable++; else needsReview++;
  }
  console.log(`\n${key}  "${g.label}"  [${g.chapter}]`);
  console.log(`   bullets=${g.rows.length}  totalVol=${vol.toFixed(3)} m³  recipeOK=${reconcilable}  needsReview=${needsReview}`);
  console.log('   element codes: '+g.rows.map(r=>r.label.replace(/^[-–—]\s*/,'')).join(', '));
}
