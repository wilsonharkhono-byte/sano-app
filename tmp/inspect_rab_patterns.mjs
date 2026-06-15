import XLSX from 'xlsx';

const TARGETS = [
  { file: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', sheet: 'RAB (A)' },
  { file: 'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx', sheet: 'RAB (A)' },
  { file: 'assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx', sheet: 'RAB (B)' },
];

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';

function dumpRow(sh, r, maxCol = 8) {
  const out = [];
  for (let c = 0; c <= maxCol; c++) {
    const cell = sh[XLSX.utils.encode_cell({ r, c })];
    if (!cell) { out.push(`${XLSX.utils.encode_col(c)}=`); continue; }
    const v = cell.f ? `=${cell.f}` : (cell.v == null ? '' : String(cell.v));
    out.push(`${XLSX.utils.encode_col(c)}=${v}`);
  }
  return out.join(' | ');
}

function findRows(sh, pattern, maxRow) {
  const matches = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= 6; c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) continue;
      const s = String(cell.v);
      if (pattern.test(s)) {
        matches.push({ r, c, addr: XLSX.utils.encode_cell({ r, c }), text: s.slice(0, 60) });
        break;
      }
    }
  }
  return matches;
}

for (const { file, sheet } of TARGETS) {
  console.log('\n\n############################################################');
  console.log(`FILE: ${file}  SHEET: ${sheet}`);
  console.log('############################################################');
  const wb = XLSX.readFile(ROOT + file, { cellFormula: true, cellNF: true, cellStyles: true });
  const sh = wb.Sheets[sheet];
  if (!sh || !sh['!ref']) { console.log('NO SHEET'); continue; }
  const range = XLSX.utils.decode_range(sh['!ref']);
  console.log(`range=${sh['!ref']}  rowsTotal=${range.e.r + 1}`);

  const PATTERNS = [
    /poer/i, /sloof\s*s/i, /balok\s*b/i, /kolom\s*k/i,
    /^[\s\-]*beton/i, /besi\s*d\s*\d/i, /bekisting/i,
  ];
  for (const p of PATTERNS) {
    const m = findRows(sh, p, range.e.r);
    if (m.length === 0) continue;
    console.log(`\n  pattern ${p}: ${m.length} matches`);
    for (const x of m.slice(0, 8)) {
      console.log(`    r${x.r+1} ${x.addr}: ${x.text}`);
    }
  }
}
