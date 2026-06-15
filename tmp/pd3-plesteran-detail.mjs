import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
delete process.env.SANO_BOQ_RECIPE_DETAIL;

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map(c => [`${c.sheet}!${c.address}`, c]));

// IX.A.2 plesteran detail
const r = result.boqRows.find(x => x.code === 'IX.A.2');
console.log(`=== ${r.code} ${r.label} (RAB row ${r.sourceRow}) unit=${r.unit} ===`);
console.log('recipe.perUnit:', JSON.stringify(r.recipe?.perUnit));
console.log('components:');
for (const c of r.recipe?.components ?? []) {
  console.log(`  [${c.lineType}] qty=${c.quantityPerUnit} × ${c.unitPrice} = ${c.costContribution} block="${c.referencedBlockTitle}" ref=${c.referencedCell?.sheet}!${c.referencedCell?.address}`);
}
// dump RAB row columns
const rr = r.sourceRow;
console.log('\nRAB columns:');
for (const col of ['I','J','K','L','M','N','R','S','T']) {
  const cell = lookup.get(`RAB (A)!${col}${rr}`);
  if (cell && cell.value) console.log(`  ${col}${rr}: ${cell.value}  formula=${cell.formula ?? ''}`);
}

// Find the Analisa plesteran block
console.log('\n=== Analisa rows 465-495 (PLESTERAN / Acian blocks) ===');
for (let i = 465; i <= 495; i++) {
  const b = lookup.get(`Analisa!B${i}`)?.value;
  const c = lookup.get(`Analisa!C${i}`)?.value;
  const d = lookup.get(`Analisa!D${i}`)?.value;
  const e = lookup.get(`Analisa!E${i}`)?.value;
  const f = lookup.get(`Analisa!F${i}`)?.value;
  const g = lookup.get(`Analisa!G${i}`)?.value;
  if (b||c||d||e||f||g) console.log(`  r${i}: B=${b??''} C=${c??''} D=${String(d??'').slice(0,38)} E=${e??''} F=${f??''} G=${g??''}`);
}
