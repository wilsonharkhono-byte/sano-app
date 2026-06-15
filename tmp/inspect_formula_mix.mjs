// Look for sibling rows where unit-price columns mix formula vs literal
import XLSX from 'xlsx';

const ROOT = '/Users/carissatjondro/Dropbox/AI/Claude Code/';

const TARGETS = [
  { file: 'assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', sheet: 'RAB (A)' },
  { file: 'assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx', sheet: 'RAB (A)' },
  { file: 'assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx', sheet: 'RAB (B)' },
];

// Inspect cells N (unit price) and I (Material unit price) and AF (computed material) for content rows
for (const t of TARGETS) {
  const wb = XLSX.readFile(ROOT + t.file, { cellFormula: true, cellNF: true });
  const sh = wb.Sheets[t.sheet];
  const range = XLSX.utils.decode_range(sh['!ref']);
  console.log(`\n========== ${t.file} :: ${t.sheet} ==========`);
  const stats = { N_formula: 0, N_literal: 0, N_empty: 0, I_formula: 0, I_literal: 0, I_empty: 0 };
  const literalRows = [];

  for (let r = 0; r <= range.e.r; r++) {
    const cellB = sh[XLSX.utils.encode_cell({ r, c: 1 })]; // B
    const cellC = sh[XLSX.utils.encode_cell({ r, c: 2 })]; // C (SAT)
    const cellN = sh[XLSX.utils.encode_cell({ r, c: 13 })]; // N
    const cellI = sh[XLSX.utils.encode_cell({ r, c: 8 })]; // I
    // Only look at content rows: must have B (label) and C (unit) — skip headers/blanks
    if (!cellB || !cellC) continue;
    const labelRaw = cellB.v ?? '';
    const sat = cellC.v ?? '';
    const label = String(labelRaw).slice(0, 40);

    // N stats
    if (!cellN) stats.N_empty++;
    else if (cellN.f) stats.N_formula++;
    else stats.N_literal++;
    // I stats
    if (!cellI) stats.I_empty++;
    else if (cellI.f) stats.I_formula++;
    else stats.I_literal++;

    // Flag rows where N or I is literal but C (unit) exists — possible parser confusion
    if (cellC.v && (cellN?.v != null && !cellN.f)) {
      literalRows.push({ r: r+1, label, sat, N: cellN.v, Nf: cellN.f, I: cellI?.v, If: cellI?.f });
    }
    if (cellC.v && cellI && !cellI.f && cellI.v != null) {
      const isAlreadyListed = literalRows.find(x => x.r === r+1);
      if (!isAlreadyListed) {
        literalRows.push({ r: r+1, label, sat, N: cellN?.v, Nf: cellN?.f, I: cellI.v, If: cellI.f, _src: 'I' });
      }
    }
  }
  console.log('  Stats:', stats);
  console.log('  Rows with literal N or I (C unit exists):');
  for (const x of literalRows.slice(0, 30)) {
    console.log(`    r${x.r} sat=${x.sat} | B="${x.label}" | I=${x.I ?? ''}${x.If ? ' [f:'+x.If+']':''} | N=${x.N ?? ''}${x.Nf ? ' [f:'+x.Nf+']':''}`);
  }
  console.log(`  total literal: ${literalRows.length}`);
}
