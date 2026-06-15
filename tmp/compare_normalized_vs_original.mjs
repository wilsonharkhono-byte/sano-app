import * as XLSX from 'xlsx';
import * as fs from 'fs';

const orig = XLSX.read(fs.readFileSync('./assets/BOQ/SPH 4 Sonny Citraland Selat Golf.xlsx'), { cellFormula: true });
const norm = XLSX.read(fs.readFileSync('./assets/BOQ/SPH 4 Sonny Citraland Selat Golf - Normalized.xlsx'), { cellFormula: true });

console.log('ORIG sheets:', orig.SheetNames.length, JSON.stringify(orig.SheetNames.slice(0, 12)));
console.log('NORM sheets:', norm.SheetNames.length, '(first 12)', JSON.stringify(norm.SheetNames.slice(0, 12)));
console.log('NORM-only sheets:', norm.SheetNames.filter(s => !orig.SheetNames.includes(s)).slice(0, 8), '...');

function analisaName(wb){ return wb.SheetNames.find(s => /analisa/i.test(s)); }
const oA = orig.Sheets[analisaName(orig)], nA = norm.Sheets[analisaName(norm)];
console.log('\nAnalisa !ref  ORIG:', oA['!ref'], ' NORM:', nA['!ref']);

// Compare every cell on the Analisa sheet between the two files
let compared = 0, mismatches = 0; const examples = [];
const addrs = new Set([...Object.keys(oA), ...Object.keys(nA)].filter(a => !a.startsWith('!')));
for (const a of addrs) {
  const ov = oA[a]?.v, nv = nA[a]?.v;
  compared++;
  if (String(ov ?? '') !== String(nv ?? '')) { mismatches++; if (examples.length < 5) examples.push({ a, orig: ov, norm: nv }); }
}
console.log(`Analisa cells compared: ${compared}, mismatches: ${mismatches}`);
if (examples.length) console.log('mismatch examples:', JSON.stringify(examples, null, 2));

// Where does "PAGAR SENG" sit in each?
function findCell(sheet, needle){ for (const a of Object.keys(sheet)) { if (a.startsWith('!')) continue; if (typeof sheet[a].v === 'string' && sheet[a].v.includes(needle)) return a; } return null; }
console.log('\n"PAGAR SENG" cell  ORIG:', findCell(oA, 'PAGAR SENG'), ' NORM:', findCell(nA, 'PAGAR SENG'));
