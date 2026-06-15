import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { evaluateFormula } from '../tools/boqParserV2/formulaEval/index.ts';
import { tokenize } from '../tools/boqParserV2/formulaEval/tokenize.ts';
import { parse } from '../tools/boqParserV2/formulaEval/parse.ts';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);
const { lookup } = result;

// Determine, for each BoQ row's recipe-feeding columns, whether the formula
// chain transitively reaches a SUMIF/SUMIFS. If so, the OLD evaluator (SUM* -> 0)
// would have zeroed that branch; the NEW one resolves it.
function chainHasSumif(startSheet, startAddr, depth, seen) {
  if (depth > 12) return false;
  const cell = lookup.get(`${startSheet}!${startAddr}`);
  if (!cell || !cell.formula) return false;
  if (/SUMIFS?\s*\(/i.test(cell.formula)) return true;
  const key = `${startSheet}!${startAddr}`;
  if (seen.has(key)) return false; seen.add(key);
  // extract refs from formula and recurse
  const refs = cell.formula.match(/(?:'[^']+'|[A-Za-z_][A-Za-z0-9_\- .]*)!\$?[A-Z]+\$?\d+|\$?[A-Z]+\$?\d+/g) || [];
  for (const raw of refs) {
    const m = raw.match(/^(?:'([^']+)'|([A-Za-z0-9_\- .]+))!(\$?[A-Z]+\$?\d+)$/);
    let sh, ad;
    if (m) { sh = m[1] ?? m[2]; ad = m[3].replace(/\$/g,''); }
    else { sh = startSheet; ad = raw.replace(/\$/g,''); }
    if (chainHasSumif(sh, ad, depth+1, seen)) return true;
  }
  return false;
}

const splitCols = ['I','J','K','L','M','R','S','T','V','W','Z','AA','AF'];
let beforeZeroRows = 0, recoveredRows = 0;
const recoveredEx = [];
for (const row of result.boqRows) {
  if (!row.recipe || !row.recipe.components.length) continue;
  const r = row.sourceRow, sheet = row.source_sheet;
  let touchesSumif = false, nowNonZero = false;
  for (const col of splitCols) {
    const cell = lookup.get(`${sheet}!${col}${r}`);
    if (!cell || !cell.formula) continue;
    if (chainHasSumif(sheet, `${col}${r}`, 0, new Set())) {
      touchesSumif = true;
      const ev = evaluateFormula(cell, lookup, { targetSheet: 'Analisa' });
      if (Number.isFinite(ev.evaluatedValue) && Math.abs(ev.evaluatedValue) > 1e-9) nowNonZero = true;
    }
  }
  if (touchesSumif) {
    beforeZeroRows++;
    if (nowNonZero) { recoveredRows++; if (recoveredEx.length<15) recoveredEx.push(row.code); }
  }
}
console.log('Rows whose recipe-feeding formulas transitively use SUMIF/SUMIFS (would be zeroed BEFORE):', beforeZeroRows);
console.log('  ...now resolving to a non-zero value AFTER the fix:', recoveredRows);
console.log('Examples recovered:', recoveredEx.join(', '));
