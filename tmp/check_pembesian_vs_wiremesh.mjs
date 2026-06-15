// Verify AC*AD is disjoint from Z*AA: dump the Pembesian U24 & U40 and Wire Mesh AHS blocks
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sheet = wb.Sheets['Analisa'];

console.log('--- Analisa rows 226..245 ---');
for (let r = 226; r <= 245; r++) {
  const A = sheet[`A${r}`]?.v;
  const B = sheet[`B${r}`]?.v;
  const C = sheet[`C${r}`]?.v;
  const D = sheet[`D${r}`]?.v;
  const E = sheet[`E${r}`]?.v;
  const F = sheet[`F${r}`]?.v;
  const G = sheet[`G${r}`]?.v;
  const H = sheet[`H${r}`]?.v;
  console.log(`r${r}: A=${A} B=${B} C=${C} D=${typeof D === 'string' ? D.slice(0, 40) : D} E=${E} F=${F} G=${G} H=${H}`);
}
