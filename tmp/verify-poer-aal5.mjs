import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;

console.log('AAL-5 REKAP-PC layout check\n');
// Header row 6: J=6, K=8, L=10, M=13, N=16, O=19, P=22, Q=25
// PC.5 row 16: A="PC.5" B=1.7578 ... K=0 L=4.568 M=144.405 (so D10=4.568, D13=144.405)
// Total Besi col R: should be R=148.97 ≈ K+L+M+N+...
console.log('Row 6 (header):');
for (const c of 'IJKLMNOPQR'.split('')) {
  console.log(`  ${c}6 = ${get('REKAP-PC', `${c}6`)}`);
}
console.log('\nRow 16 (PC.5):');
for (const c of 'ABCDEFGHIJKLMNOPQR'.split('')) {
  console.log(`  ${c}16 = ${get('REKAP-PC', `${c}16`)}`);
}
const beton = Number(get('REKAP-PC', 'B16') ?? 0);
const totBesi = Number(get('REKAP-PC', 'R16') ?? 0);
console.log(`\nPC.5: Beton = ${beton} m3, Total Besi = ${totBesi} kg`);
console.log(`Per m3: ${totBesi/beton} kg/m3`);

// Find PC.5 BoQ row, read its Z (pembesian kg/m3)
const pc5Row = result.boqRows.find((r) => /^[\s\-–—]*Poer\s+PC\.?5\s*$/i.test(r.label) || /Poer\s+PC\.?5\b/i.test(r.label));
if (pc5Row) {
  const sheet = pc5Row.source_sheet;
  const r = pc5Row.sourceRow;
  console.log(`\nFound Poer PC.5 BoQ row in ${sheet} row ${r}:`);
  console.log(`  label: "${pc5Row.label}"`);
  console.log(`  volume: ${pc5Row.planned}`);
  console.log(`  Z (pembesian kg/m3): ${get(sheet, `Z${r}`)}`);
  console.log(`  AA: ${get(sheet, `AA${r}`)}`);
  console.log(`  R: ${get(sheet, `R${r}`)} S: ${get(sheet, `S${r}`)} T: ${get(sheet, `T${r}`)}`);
  console.log(`  V: ${get(sheet, `V${r}`)} W: ${get(sheet, `W${r}`)} X: ${get(sheet, `X${r}`)}`);
} else {
  console.log('\nPoer PC.5 BoQ row NOT FOUND with standard pattern. Trying broader search...');
  const poerRows = result.boqRows.filter((r) => /^[\s\-–—]*Poer\b/i.test(r.label));
  console.log(`Found ${poerRows.length} Poer rows:`);
  for (const pr of poerRows.slice(0, 20)) {
    console.log(`  ${pr.code}: "${pr.label}" vol=${pr.planned}`);
  }
}

// Also print PC.1 details for ground truth
console.log('\nRow 8 (PC.1):');
for (const c of 'ABCDEFGHIJKLMNOPQR'.split('')) {
  console.log(`  ${c}8 = ${get('REKAP-PC', `${c}8`)}`);
}
