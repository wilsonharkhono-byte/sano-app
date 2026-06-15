import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

async function inspect(label, path) {
  console.log('\n==========================');
  console.log(`Workbook: ${label}`);
  console.log('==========================');
  const buf = fs.readFileSync(path);
  const result = await parseBoqV2(buf, { boqSheet: 'auto' });
  const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
  const get = (s, a) => lookup.get(`${s}!${a}`)?.value;
  const sheet = 'Hasil-Kolom';
  const rowsForSheet = result.cells.filter((c) => c.sheet === sheet);
  if (rowsForSheet.length === 0) {
    console.log('sheet not found');
    return;
  }
  const maxRow = Math.max(...rowsForSheet.map((c) => c.row));
  console.log(`Max row: ${maxRow}`);
  // Print rows 140..200
  for (let r = 140; r <= Math.min(250, maxRow); r++) {
    const cellRow = [];
    for (const col of 'ABCDEFGHIJKLMNOPQRSTU'.split('')) {
      const v = get(sheet, `${col}${r}`);
      if (v != null && v !== '') {
        cellRow.push(`${col}=${typeof v === 'number' ? v.toFixed(2) : `"${String(v).slice(0,15)}"`}`);
      }
    }
    if (cellRow.length > 0) {
      console.log(`  r${String(r).padStart(3)}: ${cellRow.join(' | ')}`);
    }
  }
}

await inspect('AAL-5', './assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
console.log('\n');
await inspect('PD3-23', './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
console.log('\n');
await inspect('I4-29', './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
