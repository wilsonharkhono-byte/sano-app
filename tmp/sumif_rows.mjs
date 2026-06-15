import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { evaluateFormula } from '../tools/boqParserV2/formulaEval/index.ts';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);
const { lookup } = result;

// For each BoQ row, look at the cells feeding its recipe (split columns) and the
// quantity cells; detect SUMIF/SUMIFS in any formula on that row, then evaluate
// it and report whether it resolves non-zero now.
let rowsWithSumif = 0, resolvedNonZero = 0;
const examples = [];
for (const row of result.boqRows) {
  const r = row.sourceRow;
  const sheet = row.source_sheet;
  // scan all columns A..AZ on this row for SUMIF formulas
  let hasSumif = false, anyNonZero = false, allZeroBefore = true;
  for (const [key, cell] of lookup) {
    if (cell.sheet !== sheet || cell.row !== r) continue;
    if (cell.formula && /SUMIFS?/i.test(cell.formula)) {
      hasSumif = true;
      const ev = evaluateFormula(cell, lookup, { targetSheet: 'Analisa' });
      if (Number.isFinite(ev.evaluatedValue) && ev.evaluatedValue !== 0) anyNonZero = true;
    }
  }
  if (hasSumif) {
    rowsWithSumif++;
    if (anyNonZero) resolvedNonZero++;
    if (examples.length < 12) examples.push(`${row.code} (nonzero=${anyNonZero})`);
  }
}
console.log('BoQ rows with a SUMIF/SUMIFS formula on the row:', rowsWithSumif);
console.log('  ...of which now evaluate to a non-zero value:', resolvedNonZero);
console.log('Examples:', examples.join(', '));
