// Dump all AHS blocks detected on Analisa for I4-29.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = result.lookup;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const getC = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

console.log('=== All detected AHS blocks on Analisa ===');
console.log('title | titleRow..jumlahRow | F | G | H | Harga/m² (F at jumlah+1)');
for (const b of result.ahsBlocks) {
  const f = getC('Analisa', `F${b.jumlahRow}`);
  const g = getC('Analisa', `G${b.jumlahRow}`);
  const h = getC('Analisa', `H${b.jumlahRow}`);
  const harga = getC('Analisa', `F${b.jumlahRow + 1}`);
  console.log(`${b.title.padEnd(70)} | ${b.titleRow}..${b.jumlahRow} | F=${f} | G=${g} | H=${h} | Harga=${harga}`);
}

console.log('\n\n=== Pengecoran/Concrete blocks ===');
for (const b of result.ahsBlocks) {
  if (!/Pengecoran/i.test(b.title)) continue;
  const f = getC('Analisa', `F${b.jumlahRow}`);
  const g = getC('Analisa', `G${b.jumlahRow}`);
  const h = getC('Analisa', `H${b.jumlahRow}`);
  console.log(`  ${b.title.padEnd(70)} F=${f} G=${g} H=${h}`);
}

console.log('\n\n=== Bekisting blocks ===');
for (const b of result.ahsBlocks) {
  if (!/Bekisting/i.test(b.title)) continue;
  const f = getC('Analisa', `F${b.jumlahRow}`);
  const h = getC('Analisa', `H${b.jumlahRow}`);
  const harga = getC('Analisa', `F${b.jumlahRow + 1}`);
  const hargaH = getC('Analisa', `H${b.jumlahRow + 1}`);
  const cycle = harga > 0 ? Math.round(f / harga) : 'N/A';
  console.log(`  ${b.title.padEnd(70)} F=${f} H=${h} hargaF=${harga} hargaH=${hargaH} cycle=${cycle}`);
}

console.log('\n\n=== Pembesian blocks ===');
for (const b of result.ahsBlocks) {
  if (!/Pembesian/i.test(b.title)) continue;
  const f = getC('Analisa', `F${b.jumlahRow}`);
  console.log(`  ${b.title.padEnd(70)} F=${f}`);
  for (const r of b.componentRows) {
    const name = lookup.get(`Analisa!D${r}`)?.value;
    const qty = lookup.get(`Analisa!B${r}`)?.value;
    const unit = lookup.get(`Analisa!C${r}`)?.value;
    const price = lookup.get(`Analisa!E${r}`)?.value;
    console.log(`    r${r}: ${qty} ${unit} | ${name} | ${price}`);
  }
}
