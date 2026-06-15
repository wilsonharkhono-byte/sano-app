import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const getCell = (s, a) => lookup.get(`${s}!${a}`);

const rowsToInspect = [108, 150, 183]; // III.A.11.2.6, IV.A.2.3, V.A.2.3
for (const r of rowsToInspect) {
  console.log(`\n=== RAB (A) row ${r} ===`);
  for (const col of ['B','C','D','E','I','J','K','L','M','N','R','S','T','V','W','X','Z','AA']) {
    const cell = getCell('RAB (A)', `${col}${r}`);
    if (!cell) continue;
    const val = cell.value;
    const formula = cell.formula;
    console.log(`  ${col}${r}: value=${val}${formula ? ` formula=${formula.slice(0, 100)}` : ''}`);
  }
}
