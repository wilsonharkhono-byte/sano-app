import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5_normalized.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const sh = wb.Sheets['Unresolved'];
const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
const dataStart = rows.findIndex((r) => r[0] === 'Code') + 1;

// Classify reason into bucket
function bucket(reason) {
  if (/no bekisting template/i.test(reason)) return 'no_bekisting_template';
  if (/no concrete template/i.test(reason)) return 'no_concrete_template';
  if (/no pengecoran/i.test(reason)) return 'no_concrete_template';
  if (/no pembesian/i.test(reason)) return 'no_pembesian';
  if (/no rebar/i.test(reason)) return 'no_rebar_data';
  if (/no rekap/i.test(reason)) return 'no_rekap';
  if (/no element/i.test(reason)) return 'no_element';
  if (/^computed unit cost/i.test(reason)) return 'reconcile_fail';
  if (/no template/i.test(reason)) return 'no_template';
  return 'other:' + reason.slice(0, 60);
}

const buckets = new Map();
for (const r of rows.slice(dataStart)) {
  if (!r[0]) continue;
  const code = r[0];
  const label = r[1] || '';
  const reason = (r[2] || '').toString();
  const b = bucket(reason);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push({ code, label, reason });
}
console.log('BUCKETS (count, samples):');
for (const [b, items] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${b}] = ${items.length}`);
  // chapter distribution
  const chCount = {};
  for (const it of items) {
    const ch = it.code.split('.').slice(0, 2).join('.');
    chCount[ch] = (chCount[ch] || 0) + 1;
  }
  console.log('  chapters:', Object.entries(chCount).map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('  samples:');
  items.slice(0, 4).forEach((it) => console.log(`    ${it.code.padEnd(10)} | ${it.label.slice(0, 38).padEnd(38)} | ${it.reason.slice(0, 100)}`));
}
