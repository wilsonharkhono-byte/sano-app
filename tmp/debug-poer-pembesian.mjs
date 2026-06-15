import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;

// Find the REKAP-PC row for PC.1
console.log('Looking for PC.1 in REKAP-PC...');
for (let r = 1; r <= 100; r++) {
  const d = get('REKAP-PC', `D${r}`);
  if (typeof d === 'string' && d.includes('PC.1')) {
    console.log(`  Row ${r}: D=${d}`);
    for (const col of ['B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U']) {
      const v = get('REKAP-PC', `${col}${r}`);
      if (v != null && v !== '' && v !== 0) console.log(`    ${col}${r} = ${v}`);
    }
  }
}

// Also find PC.1's exact row
console.log('\n=== Full row scan with key columns ===');
for (let r = 1; r <= 50; r++) {
  const c = get('REKAP-PC', `C${r}`);
  const d = get('REKAP-PC', `D${r}`);
  if (c === 'PC.1' || d === 'PC.1') {
    console.log(`Found PC.1 at REKAP-PC row ${r} (C=${c}, D=${d})`);
    for (const col of 'ABCDEFGHIJKLMNOPQRSTU'.split('')) {
      const v = get('REKAP-PC', `${col}${r}`);
      if (v != null && v !== '' && v !== 0) console.log(`  ${col}${r} = ${v}`);
    }
  }
}
