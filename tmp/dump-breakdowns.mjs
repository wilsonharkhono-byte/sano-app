import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
const b = r.breakdowns;
console.log('total breakdowns:', b.length);
console.log('keys of a breakdown:', Object.keys(b[0]||{}).join(', '));
// find a Kolom Lantai 1 row (III.A.3.2.x) and a Plat (III.A.4.x) and dump component lines
for (const code of ['III.A.3.2.1','III.A.4.1','III.A.5.1','IV.A.2.1']){
  const row = b.find(x=>x.code===code);
  if(!row){ console.log(`\n${code}: NOT in breakdowns (maybe direct-ref/unresolved)`); continue; }
  const lines = row.components || row.lines || row.items || [];
  console.log(`\n=== ${code} "${row.label}" — ${lines.length} lines ===`);
  console.log('   line keys:', Object.keys(lines[0]||{}).join(', '));
  for(const l of lines.slice(0,8)) console.log('   ', JSON.stringify(l).slice(0,140));
}
