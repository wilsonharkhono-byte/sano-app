import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
const b = r.breakdowns;
const codes = b.map(x=>x.boqCode);
// which Kolom/Plat/Dinding codes exist
console.log('III.A.3.* present:', codes.filter(c=>c.startsWith('III.A.3.')).join(', '));
console.log('III.A.4.* present:', codes.filter(c=>c.startsWith('III.A.4.')).join(', '));
console.log('III.A.5.* present:', codes.filter(c=>c.startsWith('III.A.5.')).join(', '));
for (const code of ['III.A.3.2.1','III.A.4.1']){
  const row = b.find(x=>x.boqCode===code);
  if(!row){ console.log(`\n${code}: not found`); continue; }
  console.log(`\n=== ${code} "${row.description}" vol=${row.volume} reconciles=${row.reconciliation.reconciles} var=${row.reconciliation.unitCostVariance} — ${row.components.length} lines ===`);
  for(const l of row.components) console.log(`   [${l.group}] ${(l.componentGroup||'').slice(0,28).padEnd(28)} ${(l.materialName||'').slice(0,26).padEnd(26)} qty/boq=${l.qtyPerBoqUnit} ${l.nativeUnit} total=${l.totalQty}`);
}
