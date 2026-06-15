import XLSX from 'xlsx';

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';

const TARGETS = [
  // AAL-5 RAB (A): around Poer (50-78), Sloof, Balok (~120-180)
  { file: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', sheet: 'RAB (A)', from: 48, to: 80, label: 'AAL5 Poer area' },
  { file: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', sheet: 'RAB (A)', from: 78, to: 120, label: 'AAL5 Kolom area' },
  { file: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', sheet: 'RAB (A)', from: 124, to: 175, label: 'AAL5 Balok area (B173..B25)' },
  { file: 'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx', sheet: 'RAB (A)', from: 48, to: 90, label: 'PD3 Poer area' },
  { file: 'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx', sheet: 'RAB (A)', from: 130, to: 195, label: 'PD3 Balok area' },
  { file: 'assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx', sheet: 'RAB (B)', from: 22, to: 75, label: 'NGI4 Poer/Sloof' },
];

function rowText(sh, r, maxCol = 8) {
  const out = [];
  for (let c = 0; c <= maxCol; c++) {
    const cell = sh[XLSX.utils.encode_cell({ r, c })];
    if (!cell) { out.push(`${XLSX.utils.encode_col(c)}=`); continue; }
    let v;
    if (cell.f) v = `=${cell.f}`;
    else if (cell.v == null) v = '';
    else v = String(cell.v);
    out.push(`${XLSX.utils.encode_col(c)}=${v}`);
  }
  return out.map(s => s.slice(0, 40).padEnd(41)).join('|');
}

for (const t of TARGETS) {
  console.log('\n\n############################################################');
  console.log(`${t.label}: ${t.file} :: ${t.sheet}  rows ${t.from}..${t.to}`);
  console.log('############################################################');
  const wb = XLSX.readFile(ROOT + t.file, { cellFormula: true, cellNF: true, cellStyles: true });
  const sh = wb.Sheets[t.sheet];
  if (!sh) { console.log('NO SHEET'); continue; }
  for (let r = t.from - 1; r <= t.to - 1; r++) {
    console.log(`r${r+1}: ${rowText(sh, r)}`);
  }
}
