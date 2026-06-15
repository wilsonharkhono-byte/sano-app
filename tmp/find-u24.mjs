import { runDeterministic } from '../tools/normalizer/cli-deterministic.ts';
const r = await runDeterministic({ inputPath: '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx', silent: true });
const hits = [];
for (const b of r.breakdowns){
  const lump = b.components.find(c=>/U24|U40|Pembesian/i.test(c.materialName||''));
  if(lump){
    const diam = b.components.filter(c=>/Besi beton D\d/i.test(c.materialName||'')).map(c=>c.materialName.replace('Besi beton ',''));
    hits.push({code:b.boqCode, label:b.description.slice(0,32), lump:lump.materialName.slice(0,34), hasDiam:diam.join('/')||'NONE', ncomp:b.components.length});
  }
}
console.log('breakdowns with a Pembesian/U24/U40 lump line:', hits.length, 'of', r.breakdowns.length);
console.log('=== sample (code | label | lump line | itemized-diameters-present | #comp) ===');
for(const h of hits.slice(0,30)) console.log(`  ${h.code.padEnd(15)} ${h.label.padEnd(33)} | ${h.lump.padEnd(34)} | diam=${h.hasDiam.padEnd(14)} | ${h.ncomp}`);
// chapter histogram of hits
const hist=new Map(); for(const h of hits){const p=h.code.split('.').slice(0,2).join('.'); hist.set(p,(hist.get(p)||0)+1);}
console.log('\n=== lump rows by chapter ==='); for(const [k,n] of [...hist.entries()].sort()) console.log(`  ${k.padEnd(12)} ${n}`);
