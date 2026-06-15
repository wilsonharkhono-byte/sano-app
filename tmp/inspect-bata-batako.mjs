import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (a) => lookup.get(`Analisa!${a}`)?.value;

console.log('=== Bata/Batako Poer/Sloof bekisting blocks ===');
for (let r = 13; r <= 36; r++) {
  const cols = ['B','C','D','E','F','G','H','I'];
  const vals = cols.map((c) => {
    const v = get(`${c}${r}`);
    return v == null || v === '' ? '·' : String(v).slice(0, 28);
  });
  console.log(`${String(r).padStart(3)} | ${vals.join(' | ')}`);
}

console.log('\n=== Which AhsBlocks did the parser detect for rows 13-35? ===');
for (const b of result.ahsBlocks) {
  if (b.titleRow >= 13 && b.titleRow <= 35) {
    console.log(`${b.titleRow}..${b.jumlahRow}: ${b.title}`);
    console.log(`  componentRows: ${b.componentRows.join(',')}`);
    console.log(`  componentSubtotals (col F): ${b.componentSubtotals.join(',')}`);
  }
}
