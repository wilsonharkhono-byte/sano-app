import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];

function row(r) {
  const get = (c) => { const x = rab[XLSX.utils.encode_cell({ r: r - 1, c })]; return x ? x.v : 0; };
  return {
    label: get(1),
    vol: get(3),
    src_unit: get(13),       // N
    R: get(17), S: get(18), T: get(19),
    V: get(21), W: get(22),
    Z: get(25), AA: get(26),
  };
}

function check(code, r) {
  const d = row(r);
  const concrete = (d.R || 0) + (d.S || 0) + (d.T || 0);
  const bekisting = (d.V || 0) * (d.W || 0);
  const pembesian = (d.Z || 0) * (d.AA || 0);
  const total = concrete + bekisting + pembesian;
  const variance = total - d.src_unit;
  console.log(`${code.padEnd(12)} | ${d.label.padEnd(28)} | src=${d.src_unit.toFixed(2).padStart(14)} | computed=${total.toFixed(2).padStart(14)} | var=${variance.toFixed(2).padStart(10)} Rp`);
  console.log(`             |  concrete=${concrete.toFixed(0).padStart(10)}  bek=${bekisting.toFixed(0).padStart(10)} (V=${d.V?.toFixed(3)}×W=${d.W?.toFixed(2)})  pemb=${pembesian.toFixed(0).padStart(10)} (Z=${d.Z?.toFixed(2)}×AA=${d.AA})`);
}

// Targets across patterns
const cases = [
  ['III.A.1.1 Poer PC.1', 51],
  ['III.A.2.1 Sloof TB24-1', 65],
  ['III.A.3.1 Plat lt bwh', 78],
  ['III.A.4.1 K174-1', 81],
  ['III.A.4.2 K174-2', 82],
  ['III.A.4.3 K175-1', 83],
  ['III.A.4.4 K176-1', 84],
];
cases.forEach(([n, r]) => check(n, r));
