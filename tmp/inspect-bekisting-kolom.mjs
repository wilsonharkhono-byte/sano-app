// Dump the Bekisting Kolom block in detail to find the bug.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (a) => lookup.get(`Analisa!${a}`)?.value;

console.log('=== Bekisting Kolom block (rows 36-44, all 8 columns) ===');
for (let r = 36; r <= 44; r++) {
  const cols = ['B','C','D','E','F','G','H','I'];
  const vals = cols.map((c) => {
    const v = get(`${c}${r}`);
    return v == null || v === '' ? '·' : String(v).slice(0, 30);
  });
  console.log(`${String(r).padStart(3)} | ${vals.join(' | ')}`);
}

console.log('\n=== AhsBlock for Bekisting Kolom (from parser) ===');
const kolom = result.ahsBlocks.find((b) => /^Bekisting Kolom/.test(b.title));
console.log(JSON.stringify(kolom, null, 2));

console.log('\n=== Manual Kolom math for K177-1 (IV.A.3.8, vol=1.6404999..., V=11.76, W=116217) ===');
// Compute what each subitem SHOULD contribute per m³ using factor = V/cycle = 11.76/9 = 1.307
const factor = 11.76 / 9;
console.log(`factor = 11.76 / 9 = ${factor}`);
console.log('subitem | qty | unit | price | qty_per_m3 | cost_per_m3');
for (const r of kolom.componentRows) {
  const b = get(`B${r}`);
  const c = get(`C${r}`);
  const d = get(`D${r}`);
  const e = get(`E${r}`);
  const f = get(`F${r}`);
  const qtyPerM3 = (Number(b) || 0) * factor;
  const costPerM3 = qtyPerM3 * (Number(e) || 0);
  console.log(`${r} | qty=${b} | unit=${c} | name=${d?.toString().slice(0,25)} | price=${e} | f_total=${f} | qty/m³=${qtyPerM3.toFixed(3)} | cost/m³=${costPerM3.toFixed(0)}`);
}

console.log('\n=== Sum check ===');
let sumCostPerM3 = 0;
for (const r of kolom.componentRows) {
  const b = Number(get(`B${r}`)) || 0;
  const e = Number(get(`E${r}`)) || 0;
  const f = Number(get(`F${r}`)) || 0;
  // includedInTotal: cli-deterministic checks f > 0
  if (f > 0) {
    sumCostPerM3 += b * factor * e;
  }
}
console.log(`Sum of cost/m³ (only F>0 sub-items): ${sumCostPerM3.toFixed(0)}`);
console.log(`Expected (V × W): ${(11.76 * 116217).toFixed(0)}`);
console.log(`Match? ${Math.abs(sumCostPerM3 - 11.76 * 116217) < 10}`);
