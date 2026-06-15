// Check if Wire Mesh (AC/AD) is populated and whether AF formula varies.
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });

for (const sheetName of ['RAB (B)', 'RAB (C)', 'RAB (D)', 'RAB (E)']) {
  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  console.log(`\n=== ${sheetName} ===`);

  let acCount = 0, adCount = 0, xCount = 0, vxCount = 0;
  const afFormulas = new Set();
  for (let r = 10; r <= range.e.r + 1; r++) {
    const AC = sheet[`AC${r}`]?.v;
    const AD = sheet[`AD${r}`]?.v;
    const X = sheet[`X${r}`]?.v;
    const V = sheet[`V${r}`]?.v;
    const AF = sheet[`AF${r}`]?.f;
    if (typeof AC === 'number' && AC > 0) acCount++;
    if (typeof AD === 'number' && AD > 0) adCount++;
    if (typeof X === 'number' && X > 0) xCount++;
    if (typeof X === 'number' && X > 0 && typeof V === 'number' && V > 0) vxCount++;
    if (AF) afFormulas.add(AF.replace(/\d+/g, '#'));
  }
  console.log(`  Rows with AC (wire mesh rasio) > 0: ${acCount}`);
  console.log(`  Rows with AD (wire mesh material) > 0: ${adCount}`);
  console.log(`  Rows with X (bekisting peralatan) > 0: ${xCount}`);
  console.log(`  Rows with V*X > 0: ${vxCount}`);
  console.log(`  Distinct AF formulas: ${[...afFormulas].join(' | ')}`);
}
