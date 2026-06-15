import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(rab['!ref']);

function row(r) {
  const get = (c) => { const x = rab[XLSX.utils.encode_cell({ r: r - 1, c })]; return x ? x.v : 0; };
  return {
    label: get(1), vol: get(3), src_unit: get(13),
    R: get(17), S: get(18), T: get(19), V: get(21), W: get(22), Z: get(25), AA: get(26),
  };
}
function checkRow(r) {
  const d = row(r);
  if (!d.src_unit) return null;
  const c = (d.R || 0) + (d.S || 0) + (d.T || 0);
  const b = (d.V || 0) * (d.W || 0);
  const p = (d.Z || 0) * (d.AA || 0);
  const total = c + b + p;
  return { ...d, computed: total, var: total - d.src_unit, r };
}
// Walk all rows, find any structural row (has V, W or Z, AA set) and check
const fail = []; const pass = []; const noData = [];
for (let r = 11; r <= range.e.r + 1; r++) {
  const result = checkRow(r);
  if (!result) continue;
  // Only consider rows that look like structural items (has any of R,S,T,V,W,Z,AA)
  const hasData = result.R || result.S || result.T || result.V || result.W || result.Z;
  if (!hasData) continue;
  if (Math.abs(result.var) < 1) pass.push(result);
  else fail.push(result);
}
console.log(`Total structural rows with RAB columns: ${pass.length + fail.length}`);
console.log(`  RECONCILE via R+S+T+V*W+Z*AA: ${pass.length}`);
console.log(`  FAIL (|var| >= 1 Rp): ${fail.length}`);
if (fail.length > 0) {
  console.log('\nFailed rows:');
  fail.slice(0, 20).forEach((d) => console.log(`  r${d.r} ${String(d.label).slice(0,32).padEnd(32)} src=${d.src_unit.toFixed(2)} computed=${d.computed.toFixed(2)} var=${d.var.toFixed(2)}`));
}
