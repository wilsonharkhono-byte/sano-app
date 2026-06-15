import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const r = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(r.cells.map(c=>[`${c.sheet}!${c.address}`,c]));
function check(code){
  const row = r.boqRows.find(x=>x.code===code);
  if(!row){console.log(code,'NF');return;}
  const Z = Number(lookup.get(`${row.source_sheet}!Z${row.sourceRow}`)?.value)||0;
  const besi = (row.recipe?.components||[]).filter(c=>/^Besi /i.test(c.materialName||''));
  const sumQ = besi.reduce((s,c)=>s+ (c.quantityPerUnit||0),0);
  console.log(`${code.padEnd(16)} vol=${String(row.planned).slice(0,7).padEnd(7)} Z(kg/m3)=${Z.toFixed(2).padStart(8)}  ΣbesiQtyPerUnit=${sumQ.toFixed(2).padStart(9)}  |diff|=${Math.abs(sumQ-Z).toFixed(2).padStart(8)}  ${Math.abs(sumQ-Z)<0.01?'OK->itemize':'FAIL->LUMP'}`);
  for(const c of besi) console.log(`     ${c.materialName.padEnd(16)} qtyPerUnit=${c.quantityPerUnit}`);
}
// Plat & Dinding & SW (lump) vs a working Kolom
['(A) III.A.4.1','(A) III.A.5.1','(A) III.A.3.2.14','(A) III.A.3.2.1'].forEach(check);
