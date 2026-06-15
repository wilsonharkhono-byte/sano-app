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
  const sheets = Array.from(new Set(result.cells.map((c) => c.sheet)));

  for (const sheet of ['REKAP Balok', 'REKAP-PC', 'REKAP Plat', 'Hasil-Kolom']) {
    if (!sheets.includes(sheet)) {
      console.log(`\n[${sheet}] -- not present`);
      continue;
    }
    console.log(`\n--- ${sheet} ---`);
    // Find max row used
    const rowsForSheet = result.cells.filter((c) => c.sheet === sheet);
    const maxRow = Math.max(...rowsForSheet.map((c) => c.row));
    // Print first 30 rows for columns A..U
    console.log(`Max row: ${maxRow}; printing rows 1..30`);
    for (let r = 1; r <= Math.min(30, maxRow); r++) {
      const cellRow = [];
      for (const col of 'ABCDEFGHIJKLMNOPQRST'.split('')) {
        const v = get(sheet, `${col}${r}`);
        if (v != null && v !== '') {
          cellRow.push(`${col}=${typeof v === 'number' ? v : `"${String(v).slice(0,18)}"`}`);
        }
      }
      if (cellRow.length > 0) {
        console.log(`  r${String(r).padStart(2)}: ${cellRow.join(' | ')}`);
      }
    }
  }
}

await inspect('AAL-5', './assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
await inspect('PD3-23', './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
await inspect('I4-29', './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
