// Spot check rows by hand using sourceRows from parseBoqV2.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['RAB (A)'];

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function cell(addr) { return sh[addr]?.v ?? null; }
function n(addr) { return num(cell(addr)); }

const cases = [
  { code: 'III.B.1.8',  row: 58,  note: 'Poer PC.5' },
  { code: 'III.B.2.6',  row: 73,  note: 'Sloof TB25-1' },
  { code: 'IV.A.2.6',   row: 140, note: 'Balok B24-1 IV chapter (mirrors AAL-5 working)' },
  { code: 'V.A.2.5',    row: 201, note: 'Balok B24-1 V chapter (mirrors AAL-5 failing)' },
  { code: 'IV.A.4.1',   row: 166, note: 'Kolom K12 IV chapter' },
  { code: 'III.B.4.1',  row: 93,  note: 'Kolom K174-1 III chapter' },
  { code: 'IV.A.1.1',   row: 131, note: 'Plat lt 13cm IV chapter' },
];

for (const cas of cases) {
  const r = cas.row;
  const B = cell(`B${r}`);
  const D = n(`D${r}`), N = n(`N${r}`);
  const R = n(`R${r}`), S = n(`S${r}`), T = n(`T${r}`);
  const V = n(`V${r}`), W = n(`W${r}`), X = n(`X${r}`);
  const Z = n(`Z${r}`), AA = n(`AA${r}`);
  const AC = n(`AC${r}`), AD = n(`AD${r}`);
  const base = R + S + T + V * W + Z * AA;
  const wX = base + V * X;
  const wAll = wX + AC * AD;
  console.log(`\n=== ${cas.code} (row ${r}) — ${cas.note}: ${String(B).slice(0,40)} ===`);
  console.log(`  D=${D} (volume m³)`);
  console.log(`  N=${N} (source unit cost)`);
  console.log(`  R=${R} S=${S} T=${T}`);
  console.log(`  V=${V} W=${W} X=${X}`);
  console.log(`  Z=${Z} AA=${AA}`);
  console.log(`  AC=${AC} AD=${AD}`);
  console.log(`  R+S+T+V*W+Z*AA          = ${base.toFixed(2)}  Δ=${(base-N).toFixed(2)}`);
  console.log(`  +V*X                    = ${wX.toFixed(2)}  Δ=${(wX-N).toFixed(2)}`);
  console.log(`  +V*X +AC*AD             = ${wAll.toFixed(2)}  Δ=${(wAll-N).toFixed(2)}`);
}
