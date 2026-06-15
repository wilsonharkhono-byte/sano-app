// Verify the claim that R + S + T + V*W + Z*AA = RAB!N for every structural
// row, including the ones currently in Unresolved. If true, the deterministic
// CLI is leaving correct totals on the floor.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

const candidates = result.boqRows.filter(needsExpansion);
let reconcileCount = 0;
let mismatchCount = 0;
const mismatches = [];

for (const row of candidates) {
  const r = row.sourceRow;
  const R = get('RAB (A)', `R${r}`);
  const S = get('RAB (A)', `S${r}`);
  const T = get('RAB (A)', `T${r}`);
  const V = get('RAB (A)', `V${r}`);
  const W = get('RAB (A)', `W${r}`);
  const Z = get('RAB (A)', `Z${r}`);
  const AA = get('RAB (A)', `AA${r}`);
  const N = get('RAB (A)', `N${r}`);

  const computed = R + S + T + V * W + Z * AA;
  const variance = Math.abs(computed - N);

  if (variance <= 1) {
    reconcileCount++;
  } else {
    mismatchCount++;
    if (mismatches.length < 10) {
      mismatches.push({
        code: row.code,
        label: row.label.slice(0, 35),
        N, computed, variance,
        R, S, T, V, W, Z, AA,
      });
    }
  }
}

console.log(`Rows checked: ${candidates.length}`);
console.log(`R+S+T+V*W+Z*AA = N within ±1 Rp: ${reconcileCount}`);
console.log(`Mismatches: ${mismatchCount}`);
if (mismatches.length > 0) {
  console.log('\nFirst mismatches:');
  for (const m of mismatches) console.log(JSON.stringify(m, null, 2));
}
