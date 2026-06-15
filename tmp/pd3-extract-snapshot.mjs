import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
const result = await parseBoqV2(buf);

console.log(`BoQ rows: ${result.boqRows.length}`);
console.log(`AHS blocks: ${result.ahsBlocks.length}`);
console.log(`Cells: ${result.cells.length}`);

// Count how many BoQ rows have linked recipes
let linked = 0, unlinked = 0;
for (const r of result.boqRows) {
  if (r.recipe?.components?.length > 0) linked++;
  else unlinked++;
}
console.log(`BoQ rows with recipe: ${linked}, without: ${unlinked}`);

// Count AHS blocks: which ones are referenced by any BoQ row?
const refdBlockTitles = new Set();
for (const r of result.boqRows) {
  for (const c of r.recipe?.components ?? []) {
    if (c.referencedBlockTitle) refdBlockTitles.add(c.referencedBlockTitle);
  }
}
const orphanBlocks = result.ahsBlocks.filter((b) => !refdBlockTitles.has(b.title));
console.log(`\nAHS blocks total: ${result.ahsBlocks.length}`);
console.log(`AHS blocks referenced by ≥1 BoQ row: ${refdBlockTitles.size}`);
console.log(`AHS blocks orphan (not referenced): ${orphanBlocks.length}`);

// Show orphan blocks
console.log('\n=== ORPHAN AHS BLOCKS (no BoQ row references them) ===');
for (const b of orphanBlocks.slice(0, 30)) {
  console.log(`  Analisa row ${b.titleRow}-${b.jumlahRow}: ${b.title}`);
}
