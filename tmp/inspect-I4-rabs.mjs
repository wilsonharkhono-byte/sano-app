// Inspect each RAB sheet — what does the top look like (column headers), row count, etc.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });

const rabSheets = ['RAB (A)', 'RAB (B)', 'RAB (C)', 'RAB (D)', 'RAB (E)'];

for (const name of rabSheets) {
  const sheet = wb.Sheets[name];
  console.log(`\n\n=== ${name} (range: ${sheet['!ref']}) ===`);
  // Print rows 1-20 with all columns up through AO
  const cols = [
    'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO',
  ];
  for (let r = 1; r <= 20; r++) {
    const row = cols
      .map((c) => {
        const cell = sheet[`${c}${r}`];
        if (!cell) return '';
        const v = cell.v;
        if (v == null) return '';
        const s = String(v);
        return s.length > 18 ? s.slice(0, 15) + '...' : s;
      })
      .filter((v) => v !== '');
    if (row.length === 0) continue;
    console.log(`r${r}:`, row.join(' | '));
  }
}
