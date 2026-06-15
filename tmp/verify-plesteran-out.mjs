import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const res = await runDeterministic({ inputPath: './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx', silent: true });
const matches = res.breakdowns.filter(b => /IX\.A\.[24]\b/.test(b.boqCode));
console.log('codes matching IX.A.2/4:', matches.map(b=>b.boqCode));
for (const b of matches) {
  console.log(`\n=== ${b.boqCode} ${b.description?.slice(0,38)} | vol=${b.volume} variance=${b.reconciliation.unitCostVariance.toFixed(4)} ===`);
  for (const c of b.components) {
    console.log(`  [${c.group.padEnd(9)}] ${c.materialName.slice(0,26).padEnd(26)} qty=${Number(c.qtyPerNativeUnit).toFixed(4)} ${(c.nativeUnit||'').padEnd(4)} × Rp ${c.unitPrice} = Rp ${c.costPerBoqUnit.toFixed(0)}`);
  }
}
