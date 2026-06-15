import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
console.log(`reconciled ${r.breakdowns.length}/${r.totalCandidates} | unresolved ${r.unresolvedCount} | maxVar ${r.maxAbsVariance.toFixed(4)} Rp`);
let lumps=0; const byCh=new Map();
for(const b of r.breakdowns){ if(b.components.some(c=>/U24|U40|Pembesian/i.test(c.materialName||''))){lumps++; const p=b.boqCode.split('.').slice(0,2).join('.'); byCh.set(p,(byCh.get(p)||0)+1);} }
console.log('remaining U24/U40 lump rows:', lumps, '(was 28)'); for(const [k,n] of [...byCh].sort()) console.log('   ',k,n);
const plat = r.breakdowns.find(b=>b.boqCode==='(A) III.A.4.1');
console.log(`\nPlat (A) III.A.4.1 vol=${plat.volume.toFixed(3)} reconciles=${plat.reconciliation.reconciles} var=${plat.reconciliation.unitCostVariance.toFixed(4)}`);
for(const c of plat.components.filter(c=>/besi|decking|bendrat|pembesian/i.test(c.materialName||''))) console.log(`   ${c.materialName.padEnd(28)} qty/m3=${c.qtyPerBoqUnit.toFixed(2).padStart(9)} ${c.nativeUnit} note=${c.specNote||''}`);
