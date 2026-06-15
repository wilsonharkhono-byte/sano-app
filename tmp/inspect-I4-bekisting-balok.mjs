// Inspect the Bekisting Balok block in detail — rows 134..142+1 with F, G, H sub-totals.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets['Analisa'];

function dump(label, fromRow, toRow) {
  console.log(`\n=== ${label} (rows ${fromRow}..${toRow}) ===`);
  const cols = ['A','B','C','D','E','F','G','H','I'];
  for (let r = fromRow; r <= toRow; r++) {
    const row = cols.map((c) => {
      const cell = sheet[`${c}${r}`];
      if (!cell) return '·';
      const v = cell.v;
      const f = cell.f;
      const s = v == null ? '' : String(v);
      return f ? `${s}[=${f}]` : s;
    });
    console.log(`r${String(r).padStart(3)} | ${row.join(' | ')}`);
  }
}

dump('Bekisting Kolom', 124, 132);
dump('Bekisting Balok', 134, 143);
dump('Bekisting plat', 145, 153);
dump('Bekisting dinding beton', 155, 162);
dump('1 m2 Bekisting Bata Merah Poer/Sloof', 101, 108);
dump('1 m2 Bekisting Batako BERDIRI', 109, 116);
dump('1 m2 Bekisting Batako TIDUR', 117, 124);
dump('Pengecoran Balok LT ATAS', 195, 202);
dump('Pengecoran Poer', 171, 178);
dump('Pengecoran Kolom', 187, 194);
dump('Pembesian', 228, 233);
