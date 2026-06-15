// Verify R + S + T + V*W + Z*AA = N for PD3 structural rows.
// Also test alternative invariants that include X (Bekisting Peralatan) and
// AC*AD (Wire Mesh) since PD3 has those extra columns.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

const candidates = result.boqRows.filter(needsExpansion);
let okRST_VW_ZAA = 0;
let okIncludingX = 0;
let okIncludingXAndWM = 0;
let mismatchAll = 0;
const mismatches = [];

for (const row of candidates) {
  const r = row.sourceRow;
  const R = get('RAB (A)', `R${r}`);
  const S = get('RAB (A)', `S${r}`);
  const T = get('RAB (A)', `T${r}`);
  const V = get('RAB (A)', `V${r}`);
  const W = get('RAB (A)', `W${r}`);
  const X = get('RAB (A)', `X${r}`);
  const Z = get('RAB (A)', `Z${r}`);
  const AA = get('RAB (A)', `AA${r}`);
  const AC = get('RAB (A)', `AC${r}`);
  const AD = get('RAB (A)', `AD${r}`);
  const N = get('RAB (A)', `N${r}`);

  const base = R + S + T + V * W + Z * AA;
  const withX = base + V * X;
  const withWM = withX + AC * AD;

  const vBase = Math.abs(base - N);
  const vX = Math.abs(withX - N);
  const vWM = Math.abs(withWM - N);

  if (vBase <= 1) okRST_VW_ZAA++;
  if (vX <= 1) okIncludingX++;
  if (vWM <= 1) okIncludingXAndWM++;

  if (vBase > 1 && vX > 1 && vWM > 1) {
    mismatchAll++;
    if (mismatches.length < 10) {
      mismatches.push({
        code: row.code,
        label: row.label.slice(0, 40),
        N, base, vBase, withX, vX, withWM, vWM,
        R, S, T, V, W, X, Z, AA, AC, AD,
      });
    }
  }
}

console.log(`Rows checked: ${candidates.length}`);
console.log(`R+S+T+V*W+Z*AA == N within ±1: ${okRST_VW_ZAA}`);
console.log(`adding V*X: ${okIncludingX}`);
console.log(`adding V*X + AC*AD: ${okIncludingXAndWM}`);
console.log(`mismatch with all three formulas: ${mismatchAll}`);
if (mismatches.length > 0) {
  console.log('\nFirst mismatches:');
  for (const m of mismatches) console.log(JSON.stringify(m, null, 2));
}
