import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const r = await parseBoqV2(buf);
// EXACT same predicate as the original before-count (gave 26)
let bad=0, nan=0;
for (const row of r.boqRows){
  if(!row.recipe) continue;
  for(const c of (row.recipe.components||[])){
    if(c.quantityPerUnit===0 || c.quantityPerUnit==null || c.unitPrice==null){ bad++; break; }
  }
  for(const c of (row.recipe.components||[])){
    if(typeof c.quantityPerUnit==='number' && Number.isNaN(c.quantityPerUnit)){ nan++; break; }
  }
}
console.log('apples-to-apples (orig predicate): rows with 0/null component =', bad, ' [before fix: 26]');
console.log('rows with a NaN (unresolved) component =', nan);
