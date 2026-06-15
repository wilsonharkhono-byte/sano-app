import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const getCell = (s, a) => lookup.get(`${s}!${a}`);

// Inspect V.A.1.1 Plat lantai row 178
for (const code of ['(A) III.A.11.4.1', '(A) IV.A.1.1', '(A) V.A.1.1', '(A) VI.A.1.1']) {
  const row = result.boqRows.find((r) => r.code === code);
  if (!row) { console.log(`NOT FOUND: ${code}`); continue; }
  const r = row.sourceRow;
  console.log(`\n=== ${row.code} | ${row.label?.slice(0,70)} (row ${r}) ===`);
  for (const col of ['I','J','K','V','W','X','Z','AA']) {
    const cell = getCell('RAB (A)', `${col}${r}`);
    if (!cell) continue;
    console.log(`  ${col}${r}: value=${typeof cell.value === 'number' ? cell.value.toFixed(2) : cell.value}  formula=${cell.formula ?? '(none)'}`);
  }
}

// Dump REKAP Plat headers
console.log('\n=== REKAP Plat header rows ===');
const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
for (let r = 1; r <= 8; r++) {
  const vals = cols.map((c) => {
    const v = getCell('REKAP Plat', `${c}${r}`)?.value;
    return v == null || v === '' ? '' : `${c}=${String(v).slice(0,14)}`;
  }).filter(Boolean).join(' | ');
  if (vals) console.log(`r${r}: ${vals}`);
}

// Find rows in REKAP Plat that could match "Plat lantai 15 cm"
console.log('\n=== REKAP Plat rows ===');
for (let r = 1; r <= 50; r++) {
  const v = getCell('REKAP Plat', `D${r}`)?.value ?? getCell('REKAP Plat', `C${r}`)?.value;
  if (v == null || v === '') continue;
  // Dump full row for debugging
  const dump = cols.map((c) => {
    const x = getCell('REKAP Plat', `${c}${r}`)?.value;
    return x == null || x === '' ? '' : `${c}=${String(x).slice(0,12)}`;
  }).filter(Boolean).join(' | ');
  console.log(`r${r}: ${dump}`);
}
