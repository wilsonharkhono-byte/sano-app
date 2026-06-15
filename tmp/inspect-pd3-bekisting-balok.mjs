// Show how PD3 Bekisting Balok embeds Perancah via column H.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (a) => lookup.get(`Analisa!${a}`)?.value;

console.log('=== All AhsBlocks named Bekisting on PD3 Analisa ===');
for (const b of result.ahsBlocks) {
  if (!/Bekisting/i.test(b.title)) continue;
  console.log(`  ${b.title}: rows ${b.titleRow}..${b.jumlahRow}, components=[${b.componentRows.join(',')}]`);
}

console.log('\n=== Dump Bekisting Balok block (find it dynamically) ===');
const balok = result.ahsBlocks.find((b) => /Bekisting Balok/i.test(b.title));
if (!balok) {
  console.log('  NOT FOUND');
} else {
  const start = balok.titleRow;
  const end = balok.jumlahRow + 2;
  console.log(`  rows ${start}..${end}`);
  console.log('row | B   | C    | D                       | E       | F       | G       | H       | I');
  for (let r = start; r <= end; r++) {
    const cols = ['B','C','D','E','F','G','H','I'];
    const vals = cols.map((c) => {
      const v = get(`${c}${r}`);
      return v == null || v === '' ? '·' : String(v).slice(0, 22);
    });
    console.log(`${String(r).padStart(3)} | ${vals.join(' | ')}`);
  }
}

console.log('\n=== Same for Bekisting Plat ===');
const plat = result.ahsBlocks.find((b) => /Bekisting plat/i.test(b.title));
if (!plat) {
  console.log('  NOT FOUND');
} else {
  const start = plat.titleRow;
  const end = plat.jumlahRow + 2;
  for (let r = start; r <= end; r++) {
    const cols = ['B','C','D','E','F','G','H','I'];
    const vals = cols.map((c) => {
      const v = get(`${c}${r}`);
      return v == null || v === '' ? '·' : String(v).slice(0, 22);
    });
    console.log(`${String(r).padStart(3)} | ${vals.join(' | ')}`);
  }
}
