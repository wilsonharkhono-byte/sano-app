// Inspect sub-item order in a PD3 Pengecoran block — POER and BALOK.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['Analisa'];

function dump(label, r0, r1) {
  console.log(`\n=== ${label} ===`);
  const cols = ['A','B','C','D','E','F','G','H','I'];
  for (let r = r0; r <= r1; r++) {
    const line = cols.map((c) => {
      const v = sh[`${c}${r}`]?.v;
      return v == null ? '·' : String(v).slice(0,30).padEnd(30);
    });
    console.log(`${String(r).padStart(3)} | ${line.join(' | ')}`);
  }
}
dump('POER block', 170, 178);
dump('SLOOF block', 177, 185);
dump('KOLOM RATA-RATA', 184, 192);
dump('BALOK LT ATAS', 191, 198);
dump('BALOK TANPA PLAT', 198, 205);
dump('PLAT LT ATAS', 212, 220);
dump('DINDING BETON', 219, 227);
