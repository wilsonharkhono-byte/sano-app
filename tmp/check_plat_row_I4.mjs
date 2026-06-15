// Inspect a plat row from I4-29 - why is it not itemized?
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
import * as XLSX from 'xlsx';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => typeof v === 'number' ? v : Number(v) || 0;
const get = (sheet, addr) => num(lookup.get(`${sheet}!${addr}`)?.value);

// Find plat rows
const platRows = result.boqRows.filter((r) => /Plat lantai/i.test(r.label || ''));
console.log(`Found ${platRows.length} plat rows.\n`);

// Look at first 3
for (const row of platRows.slice(0, 3)) {
  const r = row.sourceRow;
  const s = row.source_sheet;
  console.log(`\n--- ${s}!r${r} ${row.code} ${row.label} ---`);
  console.log(`  V=${get(s, `V${r}`)}, W=${get(s, `W${r}`)}, X=${get(s, `X${r}`)}`);
  console.log(`  Z=${get(s, `Z${r}`)}, AA=${get(s, `AA${r}`)}`);
  console.log(`  AC=${get(s, `AC${r}`)}, AD=${get(s, `AD${r}`)}`);
  console.log(`  R=${get(s, `R${r}`)}, S=${get(s, `S${r}`)}, T=${get(s, `T${r}`)}`);
  console.log(`  L=${get(s, `L${r}`)}, M=${get(s, `M${r}`)}`);
  console.log(`  N=${get(s, `N${r}`)}`);
  // Compute invariants
  const V = get(s, `V${r}`); const W = get(s, `W${r}`); const X = get(s, `X${r}`);
  const Z = get(s, `Z${r}`); const AA = get(s, `AA${r}`);
  const AC = get(s, `AC${r}`); const AD = get(s, `AD${r}`);
  const R = get(s, `R${r}`); const S = get(s, `S${r}`); const T = get(s, `T${r}`);
  const L = get(s, `L${r}`); const M = get(s, `M${r}`);
  const N = get(s, `N${r}`);
  const sum = R+S+T+V*W+V*X+Z*AA+AC*AD+L+M;
  console.log(`  invariant sum = ${sum.toFixed(2)}, N = ${N.toFixed(2)}, variance = ${(sum-N).toFixed(2)}`);
  console.log(`  recipe components:`);
  if (row.recipe) {
    for (const c of row.recipe.components) {
      console.log(`    - "${c.materialName}" qty=${c.quantityPerUnit} price=${c.unitPrice}`);
    }
  }
}
