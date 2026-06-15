// Inspect Bekisting Balok + Pengecoran BALOK LT ATAS + Pembesian U24 & U40
// blocks so I can build the per-m³ breakdown template for IV.A.2.* rows.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);

function getCell(sheet, addr) {
  return result.lookup.get(`${sheet}!${addr}`)?.value ?? null;
}

function dumpBlock(label, titleRow, jumlahRow) {
  console.log(`\n=== ${label} (rows ${titleRow}..${jumlahRow}) ===`);
  for (let r = titleRow; r <= jumlahRow + 1; r++) {
    const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const vals = cols.map((c) => {
      const v = getCell('Analisa', `${c}${r}`);
      return v == null ? '·' : String(v).slice(0, 30);
    });
    console.log(`${String(r).padStart(3)} | ${vals.join(' | ')}`);
  }
}

dumpBlock('Bekisting Balok', 46, 55);
dumpBlock('Pengecoran BALOK LT ATAS', 98, 103);
dumpBlock('Pembesian U24 & U40', 127, 132);

// REKAP Balok for B24-1 → row 369 per earlier inspection
console.log('\n=== REKAP Balok row 369 (B24-1 diameter weights) ===');
const cols = ['D', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'];
for (const c of cols) {
  const v = getCell('REKAP Balok', `${c}369`);
  console.log(`  ${c}369 = ${v}`);
}

// Header row 264 to see what diameters L..S correspond to
console.log('\n=== REKAP Balok header (row 264) ===');
for (const c of cols) {
  const v = getCell('REKAP Balok', `${c}264`);
  console.log(`  ${c}264 = ${v}`);
}

// RAB(A) row 132 to see the V (ratio) and Z (kg/m³) columns
console.log('\n=== RAB(A) row 132 (IV.A.2.7 - Balok B24-1) ===');
const rabCols = ['B', 'C', 'D', 'E', 'F', 'N', 'O', 'V', 'W', 'X', 'Z', 'AA'];
for (const c of rabCols) {
  const v = getCell('RAB (A)', `${c}132`);
  console.log(`  ${c}132 = ${v}`);
}
