import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const path='/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx';
const r = await runDeterministic({ inputPath: path, silent: true });
const codes = r.breakdowns.map(x=>x.boqCode);
// chapter prefix histogram (first 2 segments)
const hist=new Map();
for(const c of codes){ const p=c.split('.').slice(0,2).join('.'); hist.set(p,(hist.get(p)||0)+1); }
console.log('=== breakdown codes by chapter.subchapter ==='); for(const [k,n] of [...hist.entries()].sort()) console.log(`  ${k.padEnd(10)} ${n}`);
console.log('\n sample III.* codes:', codes.filter(c=>c.startsWith('III.')).slice(0,20).join(', '));
// what sheet did auto pick?
const buf=fs.readFileSync(path);
const auto=await parseBoqV2(buf,{boqSheet:'auto'});
const def=await parseBoqV2(buf);
console.log('\nauto boqRows:', auto.boqRows.length, '| default boqRows:', def.boqRows.length);
console.log('auto source_sheets:', [...new Set(auto.boqRows.map(x=>x.source_sheet))].join(', '));
console.log('default source_sheets:', [...new Set(def.boqRows.map(x=>x.source_sheet))].join(', '));
console.log('auto sample Kolom-area codes:', auto.boqRows.filter(x=>/kolom|sloof|plat|dinding/i.test(x.label)).slice(0,12).map(x=>x.code+":"+x.label.slice(0,18)).join(' | '));
