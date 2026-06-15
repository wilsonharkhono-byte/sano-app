import * as XLSX from 'xlsx';
import * as fs from 'fs';
const buf = fs.readFileSync('./assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
const rab = wb.Sheets['RAB (A)'];
const range = XLSX.utils.decode_range(rab['!ref']);
// Walk RAB (A), maintain code stack. Detect chapter markers in col A (roman / letter), and item numbers in col A.
const stack = [];
const rowByCode = {};
const rowMeta = {};
function isRoman(s) { return /^(?:M{0,3})(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(s) && s.length > 0; }
for (let r = 0; r < range.e.r + 1; r++) {
  const a = rab[XLSX.utils.encode_cell({ r, c: 0 })];
  const b = rab[XLSX.utils.encode_cell({ r, c: 1 })];
  const c = rab[XLSX.utils.encode_cell({ r, c: 2 })];
  const d = rab[XLSX.utils.encode_cell({ r, c: 3 })];
  const e = rab[XLSX.utils.encode_cell({ r, c: 4 })];
  const av = a ? String(a.v).trim() : '';
  const bv = b ? String(b.v).trim() : '';
  // Roman = chapter
  if (av && isRoman(av) && bv && !d && !e) {
    stack[0] = av;
    stack.length = 1;
    continue;
  }
  // Single letter = sub-chapter
  if (av && /^[A-Z]$/.test(av) && bv && !d) {
    stack[1] = av;
    stack.length = 2;
    continue;
  }
  // "1.", "2." or pure number = leaf item — has volume in D and unit price in E
  if (av && /^\d+$/.test(av) && d != null && e != null) {
    // could be 3-level or 4-level depending on whether we have sub-subgroup
    const code = [...stack, av].join('.');
    rowByCode[code] = r + 1;
    rowMeta[code] = { label: bv, vol: d.v, unit: c ? c.v : '', srcUnitPrice: e.v };
    continue;
  }
  // sub-sub-chapter — col B numeric like "1" with description in C, no volume
  // Check: B numeric, C non-empty, D empty, E empty
  if (bv && /^\d+$/.test(bv) && c && c.v && !d && !e) {
    stack[2] = bv;
    stack.length = 3;
    continue;
  }
}
const targets = ['III.A.1.1', 'III.A.2.1', 'III.A.3.1', 'III.A.4.1', 'III.A.4.2', 'V.A.2.6', 'V.A.3.1', 'VI.A.2.5', 'IV.A.2.7'];
for (const t of targets) {
  const r = rowByCode[t];
  if (r) console.log(`${t.padEnd(12)} -> row ${r} | ${rowMeta[t].label}`);
  else console.log(`${t.padEnd(12)} -> NOT FOUND`);
}
console.log('Total rows mapped:', Object.keys(rowByCode).length);
