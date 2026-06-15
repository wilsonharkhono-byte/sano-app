import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';

const res = await runDeterministic({
  inputPath: './assets/BOQ/RAB ERNAWATI edit.xlsx',
  silent: true,
});

console.log(`Total: ${res.totalCandidates}`);
console.log(`Itemized: ${res.itemizedCount}, Rolled: ${res.rolledCount}, Direct-ref: ${res.rolledDirectCount}, Unresolved: ${res.unresolvedCount}`);
console.log(`breakdowns.length=${res.breakdowns.length}`);
console.log('');

// Show all unique levels
const levels = new Map();
for (const b of res.breakdowns) {
  levels.set(b.level, (levels.get(b.level) ?? 0) + 1);
}
console.log('Levels found:', [...levels.entries()]);

const rolled = res.breakdowns.filter((b) => b.level !== 'itemized' && b.level !== 'rolled-direct');
console.log(`\n=== ${rolled.length} NON-ITEMIZED/NON-DIRECT ROWS ===`);
for (const b of rolled.slice(0, 50)) {
  console.log(`${(b.boqCode ?? '?').padEnd(20)} | level=${b.level} | unit=${(b.unit ?? '?').padEnd(4)} | vol=${String(b.volume ?? '?').padEnd(10)} | ${(b.description ?? '').slice(0, 70)}`);
}
