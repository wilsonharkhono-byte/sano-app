// Show REKAP Balok layout in ERNAWATI to confirm header detection.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;

const sheets = [...new Set(result.cells.map((c) => c.sheet))];
console.log('Sheets:', sheets.join(' | '));

const rekapSheet = sheets.find((s) => /REKAP Balok/i.test(s));
console.log('Using rekap sheet:', rekapSheet);

// Look at first 10 rows of REKAP Balok across all columns A..AB
for (let r = 1; r <= 10; r++) {
  const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
  const cells = cols.map((c) => {
    const v = get(rekapSheet, `${c}${r}`);
    return v == null || v === '' ? '' : String(v).slice(0, 10);
  });
  if (cells.every((c) => c === '')) continue;
  console.log(`r${r}: `, cols.map((c, i) => cells[i] ? `${c}=${cells[i]}` : '').filter(Boolean).join(' | '));
}

// Find the row labeled "B24-1"
console.log('\nLooking for B24-1 label...');
for (let r = 1; r <= 320; r++) {
  for (const col of ['B','C','D','E']) {
    const v = get(rekapSheet, `${col}${r}`);
    if (typeof v === 'string' && /^B24-1\b/.test(v.trim())) {
      console.log(`Found at ${col}${r}: "${v}"`);
      // Dump entire row
      const cols = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
      const cells = cols.map((c) => `${c}=${get(rekapSheet, `${c}${r}`) ?? ''}`).join(' | ');
      console.log(`  row ${r}: ${cells}`);
    }
  }
}
