import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const r = await parseBoqV2(buf);
let badRows=0, nanRows=0; const ex=[];
for (const row of r.boqRows){
  if(!row.recipe) continue;
  let bad=false, nan=false;
  for(const c of (row.recipe.components||[])){
    const q=c.quantityPerUnit;
    if(!c.materialName || q===0 || q==null) bad=true;
    if(typeof q==='number' && Number.isNaN(q)) {bad=true; nan=true;}
  }
  if(bad){badRows++; if(nan)nanRows++; if(ex.length<14)ex.push(`${row.code} nan=${nan} | ${row.label.slice(0,40)}`);}
}
console.log('rows with 0/null/NaN/undefined-name component:', badRows, '(of which NaN/unresolved:', nanRows, ')  [before fix: 26]');
ex.forEach(e=>console.log('  ',e));
