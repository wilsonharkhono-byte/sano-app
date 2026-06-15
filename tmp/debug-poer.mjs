// Why are Poer rows still going to rolled instead of itemized?
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => Number(lookup.get(`${s}!${a}`)?.value) || 0;

// Pick the first Poer row.
const row = result.boqRows.find((r) => r.code === 'III.A.1.1');
console.log(`${row.code} ${row.label} (sourceRow=${row.sourceRow})`);
const r = row.sourceRow;
const cols = {
  V: get('RAB (A)', `V${r}`),
  W: get('RAB (A)', `W${r}`),
  X: get('RAB (A)', `X${r}`),
  R: get('RAB (A)', `R${r}`),
  S: get('RAB (A)', `S${r}`),
  T: get('RAB (A)', `T${r}`),
  Z: get('RAB (A)', `Z${r}`),
  AA: get('RAB (A)', `AA${r}`),
};
console.log('Row cols:', cols);

console.log('\nBekisting blocks Harga per m² values:');
for (const b of result.ahsBlocks) {
  if (!/Bekisting/i.test(b.title)) continue;
  const f = get('Analisa', `F${b.jumlahRow}`);
  const i = get('Analisa', `I${b.jumlahRow}`);
  const hargaRow = get('Analisa', `F${b.jumlahRow + 1}`);
  const harga = hargaRow > 0 ? hargaRow : (f > 0 ? f : i);
  console.log(`  ${b.title.slice(0,55).padEnd(55)} → harga=${harga} (W matches? ${Math.abs(harga - cols.W) < 5})`);
}

console.log('\nConcrete blocks F/G/H:');
for (const b of result.ahsBlocks) {
  if (!/Pengecoran Beton/i.test(b.title)) continue;
  const f = get('Analisa', `F${b.jumlahRow}`);
  const g = get('Analisa', `G${b.jumlahRow}`);
  const h = get('Analisa', `H${b.jumlahRow}`);
  const matches = Math.abs(f - cols.R) < 5 && Math.abs(g - cols.S) < 5 && Math.abs(h - cols.T) < 5;
  console.log(`  ${b.title.slice(0,55).padEnd(55)} → F=${f} G=${g} H=${h} (match? ${matches})`);
}

// Also check the recipe components for Poer to see what diameters are there
console.log('\nRecipe components for', row.code);
for (const c of (row.recipe?.components ?? [])) {
  console.log(`  ${c.materialName ?? '(no name)'} | qty=${c.quantityPerUnit} | price=${c.unitPrice} | block=${c.referencedBlockTitle}`);
}
