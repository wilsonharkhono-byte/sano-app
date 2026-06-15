// Look at columns Q..AB plus the section headers in row 6 + names in row 7
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const path = './assets/BOQ/RAB R2 Pakuwon Indah PD3 no. 23.xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
const sh = wb.Sheets['RAB (A)'];

const cols = ['Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO'];
console.log('Section banner (row 6) and column names (row 7):');
for (const c of cols) {
  const banner = sh[`${c}6`]?.v ?? '';
  const name = sh[`${c}7`]?.v ?? '';
  console.log(`  ${c.padEnd(4)} | banner=${String(banner).padEnd(20)} | name=${String(name)}`);
}

// Now find a known structural row, e.g. a row with V*W > 0 (bekisting present)
console.log('\nLooking for first row with non-empty R..AA:');
for (let r = 20; r <= 200; r++) {
  const has = ['R','S','T','V','W','X','Z','AA'].some((c) => {
    const v = sh[`${c}${r}`]?.v;
    return typeof v === 'number' && v > 0;
  });
  if (has) {
    const vals = {};
    for (const c of ['A','B','C','D','N','R','S','T','V','W','X','Y','Z','AA','AB']) {
      vals[c] = sh[`${c}${r}`]?.v ?? null;
    }
    console.log(`Row ${r}:`, JSON.stringify(vals));
    // Only print the first 5
    if (Object.keys(vals).length) {
      const ind = sh[`B${r}`]?.v ?? '';
      if (String(ind).slice(0, 5)) console.log(`     label: ${ind}`);
    }
    // Just first 3
    break;
  }
}

// Now scan rows 30..200 for at least a few structural rows
console.log('\n5 structural rows with V*W>0:');
let n = 0;
for (let r = 20; r <= 429 && n < 5; r++) {
  const V = sh[`V${r}`]?.v ?? 0;
  const W = sh[`W${r}`]?.v ?? 0;
  if (typeof V === 'number' && typeof W === 'number' && V > 0 && W > 0) {
    const A = sh[`A${r}`]?.v ?? '';
    const B = sh[`B${r}`]?.v ?? '';
    const D = sh[`D${r}`]?.v ?? '';
    const N = sh[`N${r}`]?.v ?? '';
    const R = sh[`R${r}`]?.v ?? '';
    const S = sh[`S${r}`]?.v ?? '';
    const T = sh[`T${r}`]?.v ?? '';
    const X = sh[`X${r}`]?.v ?? '';
    const Z = sh[`Z${r}`]?.v ?? '';
    const AA = sh[`AA${r}`]?.v ?? '';
    console.log(`  row ${r}: A=${A} label=${String(B).slice(0,30)} D(vol)=${D} N=${N} R=${R} S=${S} T=${T} V=${V} W=${W} X=${X} Z=${Z} AA=${AA}`);
    n++;
  }
}
