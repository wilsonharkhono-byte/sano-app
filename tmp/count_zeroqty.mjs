import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import fs from 'fs';

const path = '/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx';
const buf = fs.readFileSync(path);
const result = await parseBoqV2(buf);

let badRows = 0;
const examples = [];
for (const row of result.boqRows) {
  const comps = row.recipe?.components ?? [];
  if (comps.length === 0) continue; // rows with no recipe components are not the SUMIF symptom
  const hasBad = comps.some(c =>
    c.quantityPerUnit === 0 || c.quantityPerUnit == null || Number.isNaN(c.quantityPerUnit) ||
    !c.materialName
  );
  if (hasBad) {
    badRows++;
    if (examples.length < 12) examples.push(row.code);
  }
}
console.log('Total BoQ rows:', result.boqRows.length);
console.log('Rows with a zero/null/NaN-qty OR missing-materialName component:', badRows);
console.log('Examples:', examples.join(', '));

// Additional, more targeted: rows whose qty got NaN (genuinely unresolved now)
let nanRows = 0; const nanEx = [];
for (const row of result.boqRows) {
  const comps = row.recipe?.components ?? [];
  if (comps.some(c => Number.isNaN(c.quantityPerUnit) || Number.isNaN(c.costContribution))) {
    nanRows++; if (nanEx.length < 8) nanEx.push(row.code);
  }
}
console.log('Rows with NaN (visibly unresolved) component:', nanRows, nanEx.join(', '));
