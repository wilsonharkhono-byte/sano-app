import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { extractBoqRows, detectCostSplitColumns, findHeaderRow } from '../tools/boqParserV2/extractTakeoffs.ts';
import { evaluateFormula as evalNEW } from '../tools/boqParserV2/formulaEval/index.ts';
import { evaluateFormula as evalOLD } from './evaluate_OLD.ts';
import fs from 'fs';
const buf = fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx');
const result = await parseBoqV2(buf);
const { lookup, cells } = result;

// Rebuild split column config exactly as index.ts does (single sheet 'RAB (A)').
const byRow = new Map();
for (const c of cells) {
  if (c.sheet !== 'RAB (A)') continue;
  if (!byRow.has(c.row)) byRow.set(c.row, new Map());
  byRow.get(c.row).set(c.address.replace(/\d+$/,''), c);
}
const headerRow = findHeaderRow(byRow);
const splitCols = detectCostSplitColumns(byRow, headerRow);
const cols = [splitCols.material, splitCols.labor, splitCols.equipment, splitCols.subkon, splitCols.prelim].filter(Boolean);

function rowComps(evalFn, row) {
  const comps = [];
  for (const col of cols) {
    const cell = lookup.get(`RAB (A)!${col}${row.sourceRow}`);
    if (!cell) continue;
    const res = evalFn(cell, lookup, { targetSheet: 'Analisa' });
    for (const c of res.components) comps.push(c);
  }
  return comps;
}
function badCount(comps) {
  // zero/null/undefined/NaN quantity (the SUMIF zeroing symptom)
  return comps.some(c => c.coefficient === 0 || c.coefficient == null || Number.isNaN(c.coefficient));
}

let beforeBad = 0, afterBad = 0, improvedEx = [];
for (const row of result.boqRows) {
  if (row.source_sheet !== 'RAB (A)') continue;
  const oldC = rowComps(evalOLD, row);
  const newC = rowComps(evalNEW, row);
  if (!oldC.length && !newC.length) continue;
  const ob = badCount(oldC), nb = badCount(newC);
  if (ob) beforeBad++;
  if (nb) afterBad++;
  if (ob && !nb && improvedEx.length < 15) improvedEx.push(row.code);
}
console.log('BEFORE (old evaluator) rows with zero/null/NaN-qty component:', beforeBad);
console.log('AFTER  (new evaluator) rows with zero/null/NaN-qty component:', afterBad);
console.log('Improved (was bad, now good) examples:', improvedEx.join(', '));
