import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5_normalized.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const sh = wb.Sheets['Unresolved'];
const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
// print header + first data row
console.log('HEADERS:');
console.log(rows[0]);
console.log('TOTAL DATA ROWS:', rows.length - 1);
console.log('\nFIRST 3 DATA ROWS:');
rows.slice(1, 4).forEach((r) => console.log(JSON.stringify(r)));

// Group by chapter prefix (first 2 segments)
const counts = {};
const reasons = {};
for (const r of rows.slice(1)) {
  const code = (r[0] || '').toString();
  if (!code) continue;
  const parts = code.split('.');
  const key = parts.slice(0, 2).join('.');
  counts[key] = (counts[key] || 0) + 1;
  // find reason column
}
console.log('\nBy chapter prefix:');
Object.entries(counts).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(8)} ${v}`));
