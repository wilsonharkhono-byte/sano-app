import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'RAB (A)', analisaSheet: 'Analisa' });

const sloof = result.boqRows.find((r) => r.label.includes('S24-1'));
if (!sloof) { console.log('not found'); process.exit(1); }
console.log('Sloof S24-1 label:', sloof.label, 'planned:', sloof.planned);
console.log('Recipe components:');
for (const c of sloof.recipe.components) {
  console.log(`  ${c.materialName ?? '?'} (block=${c.referencedBlockTitle ?? '?'}) qtyPerUnit=${c.quantityPerUnit} unitPrice=${c.unitPrice} cost=${c.costContribution}`);
}
console.log('perUnit:', sloof.recipe.perUnit);
console.log('sum of component costs:', sloof.recipe.components.reduce((s, c) => s + c.costContribution, 0));
