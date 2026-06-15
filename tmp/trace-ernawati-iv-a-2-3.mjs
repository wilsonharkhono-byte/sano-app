// Trace why IV.A.2.3 (ERNAWATI Balok B24-1) doesn't itemize.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;

console.log('=== Pengecoran blocks ===');
for (const b of result.ahsBlocks) {
  if (!/Pengecoran/i.test(b.title)) continue;
  const F = get('Analisa', `F${b.jumlahRow}`);
  const G = get('Analisa', `G${b.jumlahRow}`);
  const H = get('Analisa', `H${b.jumlahRow}`);
  console.log(`  rows ${b.titleRow}..${b.jumlahRow}: "${b.title}"`);
  console.log(`    Jumlah F=${F} G=${G} H=${H}`);
}

console.log('\n=== Pembesian block ===');
for (const b of result.ahsBlocks) {
  if (!/Pembesian/i.test(b.title)) continue;
  console.log(`  rows ${b.titleRow}..${b.jumlahRow}: "${b.title}"`);
  for (const r of b.componentRows) {
    console.log(`    B${r}=${get('Analisa', `B${r}`)} C=${get('Analisa', `C${r}`)} D=${get('Analisa', `D${r}`)} E=${get('Analisa', `E${r}`)} F=${get('Analisa', `F${r}`)}`);
  }
  console.log(`    Jumlah F=${get('Analisa', `F${b.jumlahRow}`)}`);
}

const row = result.boqRows.find((r) => r.code === '(A) IV.A.2.3');
console.log(`\n=== (A) IV.A.2.3 cost split ===`);
console.log(`  cost_split=`, row.cost_split);
console.log(`  subkon=${row.subkon_cost_per_unit}, total_cost=${row.total_cost}, planned=${row.planned}`);
console.log(`  sourceUnitCost = ${(row.cost_split.material+row.cost_split.labor+row.cost_split.equipment+row.cost_split.prelim+(row.subkon_cost_per_unit??0))}`);

// Show the row's recipe components (these come from parser's I/J/K formula eval)
console.log(`  recipe components (${row.recipe?.components.length ?? 0}):`);
if (row.recipe) {
  for (const c of row.recipe.components) {
    console.log(`    [${c.lineType}] ${c.sourceCell.address} -> ${c.referencedCell.sheet}!${c.referencedCell.address} (block: ${c.referencedBlockTitle ?? '?'}) qty=${c.quantityPerUnit} price=${c.unitPrice} cost=${c.costContribution}${c.materialName ? ' name=' + c.materialName : ''}`);
  }
}
