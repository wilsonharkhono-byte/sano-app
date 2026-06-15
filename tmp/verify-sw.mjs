import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
console.log(`reconciled ${r.breakdowns.length}/${r.totalCandidates} | unresolved ${r.unresolvedCount} | maxVar ${r.maxAbsVariance.toFixed(4)} Rp`);
let lumps=0; const ex=[];
for(const b of r.breakdowns){ if(b.components.some(c=>/U24|U40|Pembesian/i.test(c.materialName||''))){lumps++; if(ex.length<22)ex.push(b.boqCode+' '+b.description.slice(0,24));} }
console.log('remaining U24/U40 lumps:', lumps, '(was 28; after Fix1 21)');
ex.forEach(e=>console.log('   ',e));
const sw = r.breakdowns.find(b=>b.boqCode==='(A) III.A.3.2.14');
console.log(`\nSW1 (A) III.A.3.2.14 reconciles=${sw.reconciliation.reconciles} var=${sw.reconciliation.unitCostVariance.toFixed(4)}`);
for(const c of sw.components.filter(c=>/besi|decking|bendrat|pembesian/i.test(c.materialName||''))) console.log(`   ${c.materialName.padEnd(28)} qty/m3=${c.qtyPerBoqUnit.toFixed(2).padStart(9)} ${c.nativeUnit}`);
