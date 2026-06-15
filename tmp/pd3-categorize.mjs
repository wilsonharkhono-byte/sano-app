// Categorize all expansion rows by which invariant they satisfy.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const g = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

const candidates = result.boqRows.filter(needsExpansion);
let pureNonStruct = 0;
let baseOk = 0;
let needsX = 0;
let stillFail = 0;
const stillFailRows = [];

for (const row of candidates) {
  const r = row.sourceRow;
  const R = g('RAB (A)', `R${r}`), S = g('RAB (A)', `S${r}`), T = g('RAB (A)', `T${r}`);
  const V = g('RAB (A)', `V${r}`), W = g('RAB (A)', `W${r}`), X = g('RAB (A)', `X${r}`);
  const Z = g('RAB (A)', `Z${r}`), AA = g('RAB (A)', `AA${r}`);
  const AC = g('RAB (A)', `AC${r}`), AD = g('RAB (A)', `AD${r}`);
  const N = g('RAB (A)', `N${r}`);

  // Pure non-structural: all structural columns 0 and N>0
  const allCostsZero = R === 0 && S === 0 && T === 0 && (V*W) === 0 && (Z*AA) === 0 && (V*X) === 0 && (AC*AD) === 0;
  if (allCostsZero) { pureNonStruct++; continue; }

  const base = R + S + T + V * W + Z * AA;
  const wX = base + V * X + AC * AD;
  if (Math.abs(base - N) <= 1) baseOk++;
  else if (Math.abs(wX - N) <= 1) needsX++;
  else { stillFail++; if (stillFailRows.length < 10) stillFailRows.push({ code: row.code, label: row.label.slice(0,30), N, base, wX, X, AC, AD }); }
}

console.log(`Total candidates: ${candidates.length}`);
console.log(`Pure non-structural (R=S=T=V=W=X=Z=AA=AC=AD=0): ${pureNonStruct}`);
console.log(`Base invariant R+S+T+V*W+Z*AA = N: ${baseOk}`);
console.log(`Needs V*X (and/or AC*AD): ${needsX}`);
console.log(`Still fails: ${stillFail}`);
if (stillFailRows.length) console.log('\nStill failing:', JSON.stringify(stillFailRows, null, 2));
