import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
import { buildRollupFromBreakdowns, writeTakeoffWorkbook, buildOrderList } from '../tools/materialTakeoff.ts';
const SONNY='/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx';
const det = await runDeterministic({ inputPath: SONNY, silent: true });
const groups = buildRollupFromBreakdowns(det.breakdowns, det.boqRows);
writeTakeoffWorkbook(groups, 'tmp/sonny_takeoff.xlsx');
const order = buildOrderList(groups);
console.log('blocks:', groups.length, '| order-list materials:', order.length,
  '| total summed bullets:', groups.reduce((n,g)=>n+g.reconciledCount,0),
  '| excluded:', groups.reduce((n,g)=>n+g.excluded.length,0));

// Pick the Kolom Lantai 1 block and cross-check its readymix total
const kolom = groups.find(g => (g.label||'')==='Kolom Lantai 1' && g.reconciledCount>0);
console.log(`\nBLOCK ${kolom.key} "${kolom.label}"  ${kolom.reconciledCount}/${kolom.bulletCount} bullets  vol=${kolom.totalVolume.toFixed(3)}`);
for(const m of kolom.materials) console.log(`   ${m.materialName.slice(0,30).padEnd(30)} ${m.unit.padEnd(5)} ${m.totalQty.toFixed(3)}`);

// independent cross-check: sum readymix totalQty from raw breakdowns in this group
const want = kolom.key; // e.g. "(A) III.A.3.2"
let manual=0, n=0;
for(const b of det.breakdowns){
  const grp = b.boqCode.slice(0, b.boqCode.lastIndexOf('.'));
  if(grp!==want || !b.reconciliation.reconciles) continue;
  n++;
  for(const c of b.components) if(c.group==='material' && /readymix/i.test(c.materialName)) manual += c.totalQty;
}
const rolled = (kolom.materials.find(m=>/readymix/i.test(m.materialName))||{}).totalQty || 0;
console.log(`\nCROSS-CHECK readymix: rollup=${rolled.toFixed(4)}  manual(sum of ${n} bullets' totalQty)=${manual.toFixed(4)}  diff=${Math.abs(rolled-manual).toExponential(2)}`);

console.log('\nTop 8 order-list lines:');
for(const m of order.slice(0,8)) console.log(`   ${m.materialName.slice(0,30).padEnd(30)} ${m.unit.padEnd(5)} ${m.totalQty.toFixed(2)}`);
