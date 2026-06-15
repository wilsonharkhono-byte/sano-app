// Dump raw cell values for the Bekisting blocks so I can see the sub-items.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['Analisa'];

function dump(label, r0, r1) {
  console.log(`\n=== ${label} (rows ${r0}..${r1}) ===`);
  const cols = ['B','C','D','E','F','G','H','I','J'];
  for (let r = r0; r <= r1; r++) {
    const line = cols.map((c) => {
      const cell = sh[`${c}${r}`];
      if (!cell) return '·';
      const v = cell.v;
      return String(v).slice(0, 30).padEnd(30);
    });
    console.log(`${String(r).padStart(3)} | ${line.join(' | ')}`);
  }
}

dump('Bekisting Bata Merah', 100, 108);
dump('Bekisting Batako Berdiri', 108, 116);
dump('Bekisting Batako Tidur', 116, 124);
dump('Bekisting Kolom', 123, 132);
dump('Bekisting Balok', 133, 143);
dump('Bekisting plat', 144, 153);
dump('Bekisting dinding beton', 154, 162);
dump('Pengecoran POER', 170, 177);
dump('Pengecoran BALOK LT ATAS RATA-RATA', 191, 198);
dump('Pengecoran BALOK TANPA PLAT', 198, 205);
dump('Pembesian U24 & U40', 227, 234);
dump('Wiremesh M6', 234, 240);
dump('PEKERJAAN PERANCAH PELAT', 37, 50);
dump('PEKERJAAN PERANCAH BALOK', 68, 81);
