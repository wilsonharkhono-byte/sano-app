// Dump all AHS block titles in PD3 + their key totals
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

console.log('=== Detected AHS blocks on Analisa ===');
console.log('title | titleRow..jumlahRow | componentRows | F/G/H@jumlah | Harga@jumlah+1');
for (const b of result.ahsBlocks) {
  const F = get('Analisa', `F${b.jumlahRow}`);
  const G = get('Analisa', `G${b.jumlahRow}`);
  const H = get('Analisa', `H${b.jumlahRow}`);
  const I = get('Analisa', `I${b.jumlahRow}`);
  const harga = get('Analisa', `F${b.jumlahRow + 1}`);
  const cycle = harga > 0 ? (F / harga) : 0;
  console.log(`${b.title.padEnd(70)} | ${b.titleRow}..${b.jumlahRow} | [${b.componentRows.join(',')}] | F=${F} G=${G} H=${H} I=${I} | Harga=${harga} cycle=${cycle.toFixed(2)}`);
}

console.log('\n=== Grouped by category ===');
const bek = result.ahsBlocks.filter(b => /Bekisting/i.test(b.title));
const beton = result.ahsBlocks.filter(b => /Pengecoran/i.test(b.title));
const pem = result.ahsBlocks.filter(b => /Pembesian/i.test(b.title));
console.log(`Bekisting: ${bek.length}, Pengecoran: ${beton.length}, Pembesian: ${pem.length}`);
console.log(`Total blocks: ${result.ahsBlocks.length}`);
