// Find rows where AC*AD > 0 (wire mesh used).
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['RAB (A)'];

function n(addr) { const v = sh[addr]?.v; return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function v(addr) { return sh[addr]?.v ?? null; }

console.log('Rows with AC*AD > 0 (wiremesh):');
for (let r = 1; r <= 429; r++) {
  const AC = n(`AC${r}`), AD = n(`AD${r}`);
  if (AC > 0 || AD > 0) {
    console.log(`  row ${r}: A=${v(`A${r}`)} B=${String(v(`B${r}`)).slice(0,40)} AC=${AC} AD=${AD}`);
  }
}

console.log('\nRows with X>0:');
let n_count = 0;
for (let r = 1; r <= 429; r++) {
  const X = n(`X${r}`);
  if (X > 0) {
    if (n_count < 5) console.log(`  row ${r}: B=${String(v(`B${r}`)).slice(0,40)} X=${X}`);
    n_count++;
  }
}
console.log(`Total rows with X>0: ${n_count}`);
