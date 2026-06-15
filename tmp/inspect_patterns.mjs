import XLSX from 'xlsx';
import fs from 'fs';

const FILES = [
  'assets/BOQ/CONTOH_Template_Parser.xlsx',
  'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  'assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx',
];

const PATTERN_A_KEYWORDS = [
  /poer/i, /beton/i, /besi\s*d/i, /bekisting/i, /sloof/i, /balok/i, /kolom/i,
];

function rowToCols(sh, r, maxCol = 8) {
  const range = XLSX.utils.decode_range(sh['!ref'] ?? 'A1');
  const lim = Math.min(maxCol, range.e.c);
  const out = [];
  for (let c = 0; c <= lim; c++) {
    const cell = sh[XLSX.utils.encode_cell({ r, c })];
    if (!cell) { out.push({ a: XLSX.utils.encode_col(c), v: '', f: '', t: '', s: undefined }); continue; }
    out.push({
      a: XLSX.utils.encode_col(c),
      v: cell.v,
      f: cell.f ?? '',
      t: cell.t,
      s: cell.s, // style index, may or may not be populated
    });
  }
  return out;
}

function fmtRow(r, cols) {
  return `r${r+1}: ` + cols.map(c => {
    const val = c.f ? `=${c.f}` : (c.v === undefined || c.v === null ? '' : String(c.v));
    return `${c.a}=${val}`.slice(0, 40).padEnd(42);
  }).join(' | ');
}

for (const file of FILES) {
  const path = `/Users/carissatjondro/Dropbox/AI/Claude Code/${file}`;
  if (!fs.existsSync(path)) { console.log(`SKIP missing ${file}`); continue; }
  console.log('\n\n############################################################');
  console.log(`FILE: ${file}`);
  console.log('############################################################');
  const wb = XLSX.readFile(path, { cellFormula: true, cellNF: true, cellStyles: true });
  console.log('SHEETS:', wb.SheetNames.join(', '));
  for (const sn of wb.SheetNames) {
    const sh = wb.Sheets[sn];
    if (!sh || !sh['!ref']) continue;
    const range = XLSX.utils.decode_range(sh['!ref']);
    console.log(`  - ${sn}: ${sh['!ref']}  rows=${range.e.r+1} cols=${range.e.c+1}`);
  }
}
