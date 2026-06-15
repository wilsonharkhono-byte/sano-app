import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';

const orig = console.log;
const lines = [];
console.log = (...args) => lines.push(args.join(' '));
await runDeterministic({ inputPath: './assets/BOQ/RAB ERNAWATI edit.xlsx' });
console.log = orig;

// First 5 itemized lines (raw)
const itemized = lines.filter(l => l.includes('✓ itemized'));
const rolled   = lines.filter(l => l.includes('~ rolled'));
console.log(`Itemized: ${itemized.length}, Rolled: ${rolled.length}`);
console.log('Sample itemized lines:');
itemized.slice(0, 5).forEach(l => console.log('  ', l.trim()));

// Count itemized rows by description type
let beton = 0, bekisting = 0, balok = 0, plat = 0, kolom = 0, dinding = 0, sloof = 0, poer = 0, other = 0;
for (const l of itemized) {
  if (/- Beton(?!\sRetaining)/i.test(l)) beton++;
  else if (/- Bekisting/i.test(l)) bekisting++;
  else if (/Balok\s/i.test(l)) balok++;
  else if (/Plat\s/i.test(l)) plat++;
  else if (/Kolom/i.test(l)) kolom++;
  else if (/Dinding/i.test(l)) dinding++;
  else if (/Sloof/i.test(l)) sloof++;
  else if (/Poer\s|Pile|Bored|PC\./i.test(l)) poer++;
  else { other++; if (other < 10) console.log('  OTHER:', l.trim()); }
}
console.log('\nItemized buckets:');
console.log(`  Beton (.1):       ${beton}`);
console.log(`  Bekisting (.5):   ${bekisting}`);
console.log(`  Balok rows:       ${balok}`);
console.log(`  Plat rows:        ${plat}`);
console.log(`  Kolom rows:       ${kolom}`);
console.log(`  Dinding rows:     ${dinding}`);
console.log(`  Sloof rows:       ${sloof}`);
console.log(`  Poer rows:        ${poer}`);
console.log(`  Other:            ${other}`);
