import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const r = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(r.cells.map(c=>[`${c.sheet}!${c.address}`, c]));
const want = ['(A) III.A.4.1','(A) III.A.5.1','(A) III.A.3.2.14','(A) III.A.4.3'];
for(const code of want){
  const row = r.boqRows.find(x=>x.code===code);
  if(!row){console.log(code,'not found');continue;}
  const sh=row.source_sheet, rr=row.sourceRow;
  const z=lookup.get(`${sh}!Z${rr}`); const aa=lookup.get(`${sh}!AA${rr}`);
  const ac=lookup.get(`${sh}!AC${rr}`); const ad=lookup.get(`${sh}!AD${rr}`);
  console.log(`\n=== ${code} "${row.label.slice(0,38)}" @ ${sh}!row${rr} ===`);
  console.log(`  Z(kg/m3)=${z?.value}  formula=${z?.formula||'(none)'}`);
  console.log(`  AA(price)=${aa?.value}  AC(wiremesh)=${ac?.value} AD=${ad?.value}`);
}
