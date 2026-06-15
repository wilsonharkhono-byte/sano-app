import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
import { buildRollupFromBreakdowns, writeTakeoffWorkbook } from '../tools/materialTakeoff.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
console.log(`reconciled ${r.breakdowns.length}/${r.totalCandidates} | unresolved ${r.unresolvedCount} | maxVar ${r.maxAbsVariance.toFixed(4)} Rp`);
let lumps=0; for(const b of r.breakdowns) if(b.components.some(c=>/U24|U40|Pembesian/i.test(c.materialName||''))) lumps++;
console.log('remaining U24/U40 lumps:', lumps, '(was 28)');
const d = r.breakdowns.find(b=>b.boqCode==='(A) III.A.5.1');
console.log(`\nDinding (A) III.A.5.1 "${d.description.slice(0,24)}" vol=${d.volume.toFixed(3)} reconciles=${d.reconciliation.reconciles} var=${d.reconciliation.unitCostVariance.toFixed(4)}`);
for(const c of d.components.filter(c=>/besi|decking|bendrat|pembesian/i.test(c.materialName||''))) console.log(`   ${c.materialName.padEnd(26)} qty/m3=${c.qtyPerBoqUnit.toFixed(2).padStart(9)} ${c.nativeUnit} note=${c.specNote||''}`);
// regenerate take-off and check order list has no U24/U40
const groups = buildRollupFromBreakdowns(r.breakdowns, r.boqRows);
writeTakeoffWorkbook(groups, 'assets/BOQ/SANO Sonny Citraland Selat Golf - Material Takeoff.xlsx');
const allMat = new Set(); for(const g of groups) for(const m of g.materials) allMat.add(m.materialName);
console.log('\norder-list materials with U24/U40/Pembesian:', [...allMat].filter(m=>/U24|U40|Pembesian/i.test(m)).join(', ')||'NONE ✓');
console.log('rebar diameters in order list:', [...allMat].filter(m=>/^Besi beton D/i.test(m)).sort().join(', '));
