// Hand-verify three rows: one Balok lt atas, one Kolom, one Poer/Sloof.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = result.lookup;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

function dump(label, sheet, r) {
  console.log(`\n=== ${label}  ${sheet}!row ${r} ===`);
  const R = get(sheet, `R${r}`);
  const S = get(sheet, `S${r}`);
  const T = get(sheet, `T${r}`);
  const V = get(sheet, `V${r}`);
  const W = get(sheet, `W${r}`);
  const X = get(sheet, `X${r}`);
  const Z = get(sheet, `Z${r}`);
  const AA = get(sheet, `AA${r}`);
  const N = get(sheet, `N${r}`);
  const D = get(sheet, `D${r}`);
  const Bcell = lookup.get(`${sheet}!B${r}`)?.value;

  console.log(`  label: ${Bcell}`);
  console.log(`  D (volume) = ${D}`);
  console.log(`  N (unit cost) = ${N}`);
  console.log(`  R = ${R}  S = ${S}  T = ${T}`);
  console.log(`  V = ${V}  W = ${W}  X = ${X}`);
  console.log(`  Z = ${Z}  AA = ${AA}`);
  const oldSum = R + S + T + V*W + Z*AA;
  const newSum = R + S + T + V*W + V*X + Z*AA;
  console.log(`  OLD (field guide) R+S+T+V*W+Z*AA = ${oldSum}`);
  console.log(`    variance from N = ${oldSum - N}`);
  console.log(`  NEW including V*X = ${newSum}`);
  console.log(`    variance from N = ${newSum - N}`);
}

// 1. Balok lt atas — V chapter (B25 series), pick (B) IV.A.5 (Balok B25-3) at row 113
// Actually let me find balok row by label
let balokRow = null, kolomRow = null, sloofRow = null;
const sheet = 'RAB (B)';
const range = result.cells.filter((c) => c.sheet === sheet);
const byRow = new Map();
for (const c of range) {
  if (!byRow.has(c.row)) byRow.set(c.row, {});
  byRow.get(c.row)[c.address.replace(/\d+/g, '')] = c.value;
}

for (const [row, cells] of byRow) {
  const b = cells.B;
  if (typeof b === 'string') {
    if (!balokRow && b.includes('Balok B24-1') && row > 90) balokRow = row;
    if (!kolomRow && b.includes('Kolom K4-2')) kolomRow = row;
    if (!sloofRow && b.includes('Sloof S24-1')) sloofRow = row;
  }
}
console.log('Found rows:', { balokRow, kolomRow, sloofRow });

if (balokRow) dump('Balok B24-1 (lt atas)', sheet, balokRow);
if (kolomRow) dump('Kolom K4-2', sheet, kolomRow);
if (sloofRow) dump('Sloof S24-1', sheet, sloofRow);
