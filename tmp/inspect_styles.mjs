// Look for style/formatting differences between parent label rows and child rows
import XLSX from 'xlsx';

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';
const wb = XLSX.readFile(ROOT + 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx',
  { cellFormula: true, cellNF: true, cellStyles: true, bookVBA: false });

const sh = wb.Sheets['RAB (A)'];

const ROWS_OF_INTEREST = [
  { r: 50, label: 'PARENT: Poer (Readymix...) :' },
  { r: 51, label: 'CHILD:  - Poer PC.1' },
  { r: 59, label: 'CHILD:  - Poer PC.5' },
  { r: 64, label: 'PARENT: Sloof (Readymix...) :' },
  { r: 65, label: 'CHILD:  - Sloof TB24-1' },
  { r: 80, label: 'PARENT: Kolom (Readymix...) :' },
  { r: 81, label: 'CHILD:  - Kolom K174-1' },
  { r: 125, label: 'PARENT: Balok (Readymix...) :' },
  { r: 126, label: 'CHILD: Balok B173-1' },
];

console.log('Style index s for col A and B (cell-level), only what xlsx exposes in non-pro:');
for (const x of ROWS_OF_INTEREST) {
  const r = x.r - 1;
  const a = sh[XLSX.utils.encode_cell({ r, c: 0 })];
  const b = sh[XLSX.utils.encode_cell({ r, c: 1 })];
  console.log(`r${x.r} ${x.label}`);
  console.log(`  A: v=${JSON.stringify(a?.v)} t=${a?.t} s=${JSON.stringify(a?.s)}`);
  console.log(`  B: v=${JSON.stringify(b?.v).slice(0, 60)} t=${b?.t} s=${JSON.stringify(b?.s)}`);
}

// Try also row-level styles
console.log('\n!rows (height/styles, may indicate row-level fmt):');
const rows = sh['!rows'];
if (rows) {
  for (const x of ROWS_OF_INTEREST) {
    console.log(`  r${x.r}: ${JSON.stringify(rows[x.r - 1])}`);
  }
} else {
  console.log('  no !rows array on sheet');
}

// Merged cells could indicate parent rows
console.log('\n!merges count =', (sh['!merges'] ?? []).length);
const merges = sh['!merges'] ?? [];
for (const m of merges.slice(0, 20)) {
  console.log(`  merge: ${XLSX.utils.encode_range(m)}`);
}
