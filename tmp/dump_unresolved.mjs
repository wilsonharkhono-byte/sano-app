import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5_normalized.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const sh = wb.Sheets['Unresolved'];
const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
const dataStart = rows.findIndex((r) => r[0] === 'Code') + 1;
console.log('data starts at index', dataStart);
const groups = new Map();
for (const r of rows.slice(dataStart)) {
  if (!r[0]) continue;
  const reason = (r[2] || '').toString();
  const key = reason.split(/[:(]/)[0].trim().slice(0, 80);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ code: r[0], label: r[1], reason });
}
console.log('\nGrouped by reason root:');
for (const [k, v] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n=== "${k}" (${v.length} rows) ===`);
  // show 3 examples
  v.slice(0, 3).forEach((x) => console.log(`  ${x.code.padEnd(10)} | ${x.label.slice(0, 35).padEnd(35)} | ${x.reason.slice(0, 90)}`));
}
