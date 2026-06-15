// Compare a rolled Balok row vs an itemized Balok row in ERNAWATI to find
// what blocks itemization for IV.A.*/V.A.*/VI.A.* rows.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (sheet, addr) => lookup.get(`${sheet}!${addr}`)?.value;

// Pick two Balok B24-1 rows: one itemized (III.A.11.2.6), one rolled (IV.A.2.3).
const codes = ['(A) III.A.11.2.6', '(A) IV.A.2.3', '(A) V.A.2.3'];
for (const target of codes) {
  const row = result.boqRows.find((r) => r.code === target);
  if (!row) { console.log(`NOT FOUND: ${target}`); continue; }
  console.log(`\n=== ${row.code} | ${row.label?.slice(0, 60)} (sheet ${row.source_sheet} row ${row.sourceRow}) ===`);
  const s = row.source_sheet;
  const r = row.sourceRow;
  console.log(`  D=${get(s, `D${r}`)} (volume), N=${get(s, `N${r}`)}, planned=${row.planned}`);
  console.log(`  R(mat/m³)=${get(s, `R${r}`)}, S(lab/m³)=${get(s, `S${r}`)}, T(equip/m³)=${get(s, `T${r}`)}`);
  console.log(`  V(m²/m³)=${get(s, `V${r}`)}, W(bek/m²)=${get(s, `W${r}`)}, X(peralatan/m²)=${get(s, `X${r}`)}`);
  console.log(`  Z(kg/m³)=${get(s, `Z${r}`)}, AA(blend price)=${get(s, `AA${r}`)}, AC=${get(s, `AC${r}`)}, AD=${get(s, `AD${r}`)}`);
  console.log(`  L(subkon)=${get(s, `L${r}`)}, M(prelim)=${get(s, `M${r}`)}`);
}

// Show all Bekisting block headers in Analisa so we can see which one matches W.
console.log('\n=== Bekisting blocks in Analisa ===');
for (const b of result.ahsBlocks) {
  if (!/Bekisting/i.test(b.title)) continue;
  const hargaRow = b.jumlahRow + 1;
  const hargaF = get('Analisa', `F${hargaRow}`);
  const jumlahF = get('Analisa', `F${b.jumlahRow}`);
  const jumlahH = get('Analisa', `H${b.jumlahRow}`);
  console.log(`  rows ${b.titleRow}..${b.jumlahRow}: "${b.title}"`);
  console.log(`    Jumlah F=${jumlahF}, H=${jumlahH}; Harga per m² F=${hargaF}`);
}
