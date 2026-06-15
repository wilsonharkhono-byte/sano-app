// Check whether R + S + T + V*W + Z*AA = N within ±1 Rp for every structural row across
// all 5 RAB sheets in I4-29. Also test the candidate fuller invariant
// R + S + T + V*W + V*X + Z*AA + L + M + AC*AD = N.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = result.lookup;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

const candidates = result.boqRows.filter(needsExpansion);
console.log(`Candidates (needsExpansion): ${candidates.length}`);

let oldReconcile = 0;     // field guide invariant
let oldMismatch = 0;
let newReconcile = 0;     // candidate full invariant
let newMismatch = 0;
const oldMismatches = [];
const newMismatches = [];

for (const row of candidates) {
  const r = row.sourceRow;
  const sheet = row.source_sheet;
  const R = get(sheet, `R${r}`);
  const S = get(sheet, `S${r}`);
  const T = get(sheet, `T${r}`);
  const V = get(sheet, `V${r}`);
  const W = get(sheet, `W${r}`);
  const X = get(sheet, `X${r}`);
  const Z = get(sheet, `Z${r}`);
  const AA = get(sheet, `AA${r}`);
  const AC = get(sheet, `AC${r}`);
  const AD = get(sheet, `AD${r}`);
  const L = get(sheet, `L${r}`);
  const M = get(sheet, `M${r}`);
  const N = get(sheet, `N${r}`);

  const oldSum = R + S + T + V*W + Z*AA;
  const oldVar = Math.abs(oldSum - N);
  if (oldVar <= 1) oldReconcile++; else {
    oldMismatch++;
    if (oldMismatches.length < 10) oldMismatches.push({
      sheet, code: row.code, label: row.label.slice(0, 40),
      N, oldSum, oldVar, X, L, M, AC, AD,
    });
  }

  const newSum = R + S + T + V*W + V*X + Z*AA + L + M + AC*AD;
  const newVar = Math.abs(newSum - N);
  if (newVar <= 1) newReconcile++; else {
    newMismatch++;
    if (newMismatches.length < 10) newMismatches.push({
      sheet, code: row.code, label: row.label.slice(0, 40),
      N, newSum, newVar,
    });
  }
}

console.log('\n--- OLD invariant: R + S + T + V*W + Z*AA = N ---');
console.log(`  reconcile: ${oldReconcile}`);
console.log(`  mismatch:  ${oldMismatch}`);
if (oldMismatches.length > 0) {
  console.log('\nFirst old mismatches:');
  for (const m of oldMismatches) console.log(JSON.stringify(m));
}

console.log('\n--- NEW invariant: R + S + T + V*W + V*X + Z*AA + L + M + AC*AD = N ---');
console.log(`  reconcile: ${newReconcile}`);
console.log(`  mismatch:  ${newMismatch}`);
if (newMismatches.length > 0) {
  console.log('\nFirst new mismatches:');
  for (const m of newMismatches) console.log(JSON.stringify(m));
}
