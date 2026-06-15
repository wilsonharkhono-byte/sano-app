// Diagnose why non-Balok chapters fail to match templates.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const getC = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

console.log('=== Bekisting Harga per m² (block.jumlahRow + 1, col F) ===');
for (const b of result.ahsBlocks) {
  if (!/Bekisting/i.test(b.title)) continue;
  const harga = getC('Analisa', `F${b.jumlahRow + 1}`);
  const jumlah = getC('Analisa', `F${b.jumlahRow}`);
  const cycle = harga > 0 ? Math.round(jumlah / harga) : 'N/A';
  console.log(`  ${b.title.padEnd(60)} → Harga F${b.jumlahRow + 1}=${harga}  Jumlah=${jumlah}  cycle=${cycle}`);
}

console.log('\n=== Pengecoran cost totals (F/G/H at jumlahRow) ===');
for (const b of result.ahsBlocks) {
  if (!/Pengecoran Beton/i.test(b.title)) continue;
  const f = getC('Analisa', `F${b.jumlahRow}`);
  const g = getC('Analisa', `G${b.jumlahRow}`);
  const h = getC('Analisa', `H${b.jumlahRow}`);
  console.log(`  ${b.title.padEnd(60)} → F=${f}  G=${g}  H=${h}`);
}

console.log('\n=== Failing rows — V.A.2.6 and IV.A.3.8 ===');
const interesting = result.boqRows.filter((r) => r.code === 'V.A.2.6' || r.code === 'IV.A.3.8' || r.code === 'IV.A.3.1');
for (const row of interesting) {
  const r = row.sourceRow;
  console.log(`\n  ${row.code} (sourceRow=${r}) — ${row.label}`);
  console.log(`    V (bekisting ratio) = ${getC('RAB (A)', `V${r}`)}`);
  console.log(`    W (bekisting cost/m²) = ${getC('RAB (A)', `W${r}`)}`);
  console.log(`    R (concrete mat/m³) = ${getC('RAB (A)', `R${r}`)}`);
  console.log(`    S (concrete labor/m³) = ${getC('RAB (A)', `S${r}`)}`);
  console.log(`    T (concrete equip/m³) = ${getC('RAB (A)', `T${r}`)}`);
  console.log(`    Z (pembesian kg/m³) = ${getC('RAB (A)', `Z${r}`)}`);
}
