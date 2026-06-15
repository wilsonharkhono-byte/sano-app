// Identify which 51 ERNAWATI rows are stuck in rolled tier and why.
// Re-runs the deterministic CLI logic in-process so we can capture per-row
// variance and the columns that drove the row into rolled.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0;
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

// Recreate readRowCols to know which columns drive each row's classification
function cols(r, s) {
  return {
    R: get(s, `R${r}`), S: get(s, `S${r}`), T: get(s, `T${r}`),
    V: get(s, `V${r}`), W: get(s, `W${r}`), X: get(s, `X${r}`),
    Z: get(s, `Z${r}`), AA: get(s, `AA${r}`),
    AC: get(s, `AC${r}`), AD: get(s, `AD${r}`),
    L: get(s, `L${r}`), M: get(s, `M${r}`),
  };
}

console.log('# Rows that needed expansion but had W>0 (would have wanted bekisting itemized)\n');
console.log('Code           | Label                                    | W          | X          | V*W        | V*X        | Z*AA       | N (per-unit)');
console.log('-'.repeat(150));
for (const row of result.boqRows) {
  if (!row.recipe) continue;
  const c = cols(row.sourceRow, row.source_sheet);
  if (c.W <= 0) continue;  // skip rows with no bekisting at all
  const VW = c.V * c.W;
  const VX = c.V * c.X;
  const ZAA = c.Z * c.AA;
  const N = c.R + c.S + c.T + VW + VX + ZAA + c.AC * c.AD + c.L + c.M;
  console.log(
    row.code.padEnd(14) + ' | ' +
    (row.label ?? '').slice(0, 40).padEnd(40) + ' | ' +
    c.W.toFixed(0).padStart(10) + ' | ' +
    c.X.toFixed(0).padStart(10) + ' | ' +
    VW.toFixed(0).padStart(10) + ' | ' +
    VX.toFixed(0).padStart(10) + ' | ' +
    ZAA.toFixed(0).padStart(10) + ' | ' +
    N.toFixed(0).padStart(12),
  );
}
