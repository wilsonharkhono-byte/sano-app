import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
console.log('candidates:', r.totalCandidates, '| itemized:', r.itemizedCount, '| rolled:', r.rolledCount, '| direct:', r.rolledDirectCount, '| UNRESOLVED:', r.unresolvedCount, '| maxVar:', r.maxAbsVariance.toFixed(2));
// group unresolved by reason
const byReason = new Map();
for (const u of r.unresolved){ const k=u.reason.slice(0,60); byReason.set(k,(byReason.get(k)||0)+1); }
console.log('\n=== unresolved by reason ==='); for (const [k,n] of [...byReason.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${n}x  ${k}`);
console.log('\n=== unresolved rows (first 50) ===');
for (const u of r.unresolved.slice(0,50)) console.log(`  ${u.code.padEnd(13)} | ${u.label.slice(0,42).padEnd(42)} | ${u.reason.slice(0,55)}`);
