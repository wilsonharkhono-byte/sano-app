import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;
const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
for (let r = 285; r <= 315; r++) {
  console.log(`r${r}:`, cols.map((c) => {
    const v = get('REKAP Balok', `${c}${r}`);
    return v == null || v === '' ? '' : `${c}=${String(v).slice(0,14)}`;
  }).filter(Boolean).join(' | '));
}
