import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);
// Which BoQ rows have a recipe with components that failed to resolve (qty 0 / null price)?
let withRecipe=0, zeroQty=0, examples=[];
for (const r of result.boqRows) {
  if (!r.recipe) continue;
  withRecipe++;
  for (const c of (r.recipe.components||[])) {
    if (c.quantityPerUnit===0 || c.quantityPerUnit==null || c.unitPrice==null) {
      zeroQty++;
      if (examples.length<25) examples.push(`${r.code} | ${c.materialName} | qty=${c.quantityPerUnit} price=${c.unitPrice} | block=${c.referencedBlockTitle}`);
      break;
    }
  }
}
console.log('boqRows with recipe:', withRecipe, ' | rows with a zero/null component:', zeroQty);
console.log('--- examples ---'); examples.forEach(e=>console.log(' ', e));
