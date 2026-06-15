import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));

// Dump Analisa rows 220-240 to find the Pembesian block
console.log('=== Analisa rows 220-240 (looking for Pembesian) ===');
for (let r = 220; r <= 240; r++) {
  const a = lookup.get(`Analisa!A${r}`)?.value;
  const b = lookup.get(`Analisa!B${r}`)?.value;
  const c = lookup.get(`Analisa!C${r}`)?.value;
  const d = lookup.get(`Analisa!D${r}`)?.value;
  const e = lookup.get(`Analisa!E${r}`)?.value;
  const f = lookup.get(`Analisa!F${r}`)?.value;
  const g = lookup.get(`Analisa!G${r}`)?.value;
  const h = lookup.get(`Analisa!H${r}`)?.value;
  console.log(`r${r}: A=${a||''} B=${b||''} C=${c||''} D=${(d||'').toString().slice(0,40)} E=${e||''} F=${f||''} G=${g||''} H=${h||''}`);
}
