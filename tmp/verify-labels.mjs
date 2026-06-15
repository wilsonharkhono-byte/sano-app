import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const r = await parseBoqV2(buf);
// dup check
const seen=new Map(); for(const x of r.boqRows) seen.set(x.code,(seen.get(x.code)||0)+1);
const dup=[...seen.entries()].filter(([,n])=>n>1);
console.log('duplicate codes:', dup.length);
// label check for III.A.4 / III.A.5 groups
const want=['III.A.3.2.1','III.A.4.1','III.A.5.1'];
for(const code of want){ const row=r.boqRows.find(x=>x.code===code); if(row) console.log(`${code}  sub_chapter="${row.sub_chapter}"  | ${row.label}`); }
