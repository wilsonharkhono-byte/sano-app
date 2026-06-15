import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(rab['!ref']);
// Print rows that have "III" in col A or any chapter marker
for (let r = 0; r < range.e.r + 1; r++) {
  const cells = [];
  let hasAny = false;
  for (let c = 0; c < 6; c++) {
    const cell = rab[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.v != null) hasAny = true;
    cells.push(cell ? String(cell.v).slice(0, 40) : '');
  }
  if (!hasAny) continue;
  // Filter: show rows around "Poer PC.1" (one of our targets)
  if (/Poer PC\.1$|Poer PC\.1E|Sloof TB24|Plat lantai.*tebal.*13|Kolom K174-1|Kolom K174-2|Balok B24-1/.test(cells.join(''))) {
    console.log(`r${(r+1).toString().padStart(3)}: ${cells.map(s => s.padEnd(20)).join('| ')}`);
  }
}
