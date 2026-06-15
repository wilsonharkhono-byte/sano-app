import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const getCell = (s, a) => lookup.get(`${s}!${a}`);

// Dinding rows: Z formula tells us which REKAP sheet
for (const code of ['(A) III.A.11.5.1', '(A) III.A.11.5.2', '(A) III.A.11.5.6', '(A) IV.A.5.1']) {
  const row = result.boqRows.find((r) => r.code === code);
  if (!row) continue;
  const r = row.sourceRow;
  console.log(`\n=== ${row.code} | ${row.label?.slice(0, 60)} (row ${r}) ===`);
  for (const col of ['V','W','X','Z','AA']) {
    const cell = getCell('RAB (A)', `${col}${r}`);
    if (!cell) continue;
    console.log(`  ${col}${r}: value=${cell.value}  formula=${cell.formula ?? '(none)'}`);
  }
}

// Dump Retaining Wall sheet rows 1..50
console.log('\n=== Retaining Wall ===');
const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
for (let r = 1; r <= 30; r++) {
  const vals = cols.map((c) => {
    const v = getCell('Retaining Wall', `${c}${r}`)?.value;
    return v == null || v === '' ? '' : `${c}=${String(v).slice(0,14)}`;
  }).filter(Boolean).join(' | ');
  if (vals) console.log(`r${r}: ${vals}`);
}
