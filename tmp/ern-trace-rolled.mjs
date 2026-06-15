import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';

// Suppress stdout from runDeterministic but capture the icon lines
const orig = console.log;
const lines = [];
console.log = (...args) => lines.push(args.join(' '));
const res = await runDeterministic({
  inputPath: './assets/BOQ/RAB ERNAWATI edit.xlsx',
});
console.log = orig;

const rolled = lines.filter((l) => l.includes('~ rolled'));
console.log(`=== ${rolled.length} rolled lines ===`);
for (const l of rolled) console.log(l.trim());
