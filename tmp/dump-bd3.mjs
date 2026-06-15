import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
const b = r.breakdowns;
for (const code of ['(A) III.A.3.2.1','(A) VIII.A.1']){
  const row = b.find(x=>x.boqCode===code);
  if(!row){ console.log(`${code} not found`); continue; }
  console.log(`\n=== ${code} "${row.description.slice(0,40)}" vol=${row.volume} reconciles=${row.reconciliation.reconciles} ===`);
  for(const l of row.components) console.log(`  [${l.group.padEnd(9)}] ${(l.materialName||'').slice(0,30).padEnd(30)} qtyPerBoq=${String(l.qtyPerBoqUnit).slice(0,10).padEnd(10)} ${l.nativeUnit.padEnd(5)} totalQty=${l.totalQty}`);
}
// material-line stats across all breakdowns
let matLines=0, allLines=0; const units=new Set();
for(const row of b) for(const l of row.components){ allLines++; if(l.group==='material'){matLines++; units.add(l.nativeUnit);} }
console.log('\nmaterial lines:', matLines, '/ total lines:', allLines, '| distinct material units:', [...units].join(', '));
