import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', silent: true });
console.log(`AAL-5: reconciled ${r.breakdowns.length}/${r.totalCandidates} | unresolved ${r.unresolvedCount} | maxVar ${r.maxAbsVariance.toFixed(4)} Rp`);
let lumps=0; for(const b of r.breakdowns) if(b.components.some(c=>/U24|U40|Pembesian/i.test(c.materialName||''))) lumps++;
console.log('AAL-5 pembesian lumps:', lumps);
