import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'RAB (A)', analisaSheet: 'Analisa' });
const sloof = result.boqRows.find((r) => r.label.includes('S24-1'));
console.log('NEW output:');
for (const c of sloof.recipe.components) {
  console.log(`  ${c.materialName ?? '?'} qtyPerUnit=${c.quantityPerUnit} unitPrice=${c.unitPrice} cost=${c.costContribution}`);
}
console.log('perUnit:', sloof.recipe.perUnit);
const total = sloof.recipe.components.reduce((s, c) => s + c.costContribution, 0);
console.log('sum:', total);
const ps = sloof.recipe.perUnit.material + sloof.recipe.perUnit.labor + sloof.recipe.perUnit.equipment + sloof.recipe.perUnit.prelim;
console.log('perUnitSum:', ps);
console.log('diff:', Math.abs(total - ps));
