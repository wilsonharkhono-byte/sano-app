import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const result = await parseBoqV2(ab);
const target = result.boqRows.find(b => /Poer PC\.5$/.test(b.label));
const canonical = JSON.parse(JSON.stringify(target.recipe, (_k, v) =>
  typeof v === 'number' ? Number(v.toFixed(2)) : v
));
console.log(JSON.stringify(canonical, null, 2));
