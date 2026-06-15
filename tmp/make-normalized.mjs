import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const out = 'assets/BOQ/SANO Sonny Citraland Selat Golf - Normalized.xlsx';
const t0 = Date.now();
const r = await runDeterministic({
  inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx',
  outputPath: out,
  silent: true,
});
console.log(`reconciled ${r.breakdowns.length}/${r.totalCandidates} | unresolved ${r.unresolvedCount} | maxVar ${r.maxAbsVariance.toFixed(4)} Rp | ${((Date.now()-t0)/1000).toFixed(0)}s`);
