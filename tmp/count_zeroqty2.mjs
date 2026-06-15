import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);

const crit = {
  zeroQty: c => c.quantityPerUnit === 0,
  nullQty: c => c.quantityPerUnit == null,
  nanQty:  c => Number.isNaN(c.quantityPerUnit),
  zeroCost: c => c.costContribution === 0,
};
const counts = {};
const exZero = [];
for (const row of result.boqRows) {
  const comps = row.recipe?.components ?? [];
  if (!comps.length) continue;
  for (const k of Object.keys(crit)) {
    if (comps.some(crit[k])) counts[k] = (counts[k]||0)+1;
  }
  if (comps.some(c => c.quantityPerUnit === 0 || c.quantityPerUnit == null || Number.isNaN(c.quantityPerUnit))) {
    if (exZero.length < 15) exZero.push(row.code);
  }
}
console.log('Per-criterion row counts:', JSON.stringify(counts, null, 2));
console.log('zero/null/NaN-qty rows examples:', exZero.join(', '));

// SUMIF-specific: which rows reference cells whose formula contains SUMIF/SUMIFS?
