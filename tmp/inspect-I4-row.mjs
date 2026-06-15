// Pick row 25 (Poer PC.1) on RAB (B) and dump every populated column with formula.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });

const cols = [];
for (let c = 0; c <= 50; c++) cols.push(XLSX.utils.encode_col(c));

function dumpRow(sheetName, r) {
  const sheet = wb.Sheets[sheetName];
  console.log(`\n=== ${sheetName} row ${r} ===`);
  for (const c of cols) {
    const cell = sheet[`${c}${r}`];
    if (!cell) continue;
    const v = cell.v;
    const f = cell.f;
    if (v == null && !f) continue;
    console.log(`  ${c}${r} = ${JSON.stringify(v)}${f ? `  (formula: ${f})` : ''}`);
  }
}

dumpRow('RAB (B)', 25);  // Poer PC.1
dumpRow('RAB (B)', 53);  // Kolom K4-2
dumpRow('RAB (B)', 96);  // Balok B3-1
dumpRow('RAB (B)', 40);  // Sloof S24-1
dumpRow('RAB (B)', 72);  // Plat lantai
