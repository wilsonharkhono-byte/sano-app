import * as fs from 'fs';
import { createRequire } from 'node:module';
const require2 = createRequire(import.meta.url);
const XLSX = require2('xlsx');
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf);

for (const sheet of ['REKAP-PC', 'Hasil-PC']) {
  console.log(`\n=== ${sheet} (first 60 rows, first 8 cols) ===`);
  const ws = wb.Sheets[sheet];
  if (!ws) { console.log('  (sheet missing)'); continue; }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i] ?? [];
    const slice = r.slice(0, 10).map((v) => v == null || v === '' ? '·' : String(v).slice(0, 22));
    if (slice.some((s) => s !== '·' && s.length > 0)) {
      console.log(`${String(i+1).padStart(3)} | ${slice.join(' | ')}`);
    }
  }
}
