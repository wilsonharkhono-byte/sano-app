import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const r = await parseBoqV2(fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx'));
const codes = r.boqRows.map(x=>`${x.sourceRow}\t${x.code}`).join('\n');
fs.writeFileSync(process.env.OUT||'tmp/aal5_codes.txt', codes);
const set=new Set(r.boqRows.map(x=>x.code));
console.log('rows',r.boqRows.length,'distinct codes',set.size,'dups',r.boqRows.length-set.size);
