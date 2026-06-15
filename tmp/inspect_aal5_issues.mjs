import XLSX from 'xlsx';
const wb = XLSX.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', { cellFormula: true, cellNF: true });

// 1) Full Material sheet — check how many rows + names + parallel col I-J catalog
const mat = wb.Sheets['Material'];
const matRange = XLSX.utils.decode_range(mat['!ref']);
console.log(`Material sheet: ${matRange.e.r + 1} rows\n`);
console.log('Rows with content in col I or J (secondary catalog?):');
for (let r = 0; r <= matRange.e.r; r++) {
  const i = mat[XLSX.utils.encode_cell({ r, c: 8 })];
  const j = mat[XLSX.utils.encode_cell({ r, c: 9 })];
  if ((i?.v || j?.v) && r > 4) {
    const b = mat[XLSX.utils.encode_cell({ r, c: 1 })];
    console.log(`  r${r+1}: B="${String(b?.v ?? '').slice(0,30)}" I="${String(i?.v ?? '').slice(0,35)}" J="${String(j?.v ?? '').slice(0,15)}"`);
  }
}

// 2) RAB (A) — which items have NO formula in col I (inline material price)?
const rab = wb.Sheets['RAB (A)'];
const rabRange = XLSX.utils.decode_range(rab['!ref']);
let total = 0, noFormula = 0, analisaRef = 0, otherFormula = 0, weirdUnit = 0;
const weirdUnitSamples = [];
const noFormulaSamples = [];
for (let r = 7; r <= rabRange.e.r; r++) {
  const b = rab[XLSX.utils.encode_cell({ r, c: 1 })];
  const c = rab[XLSX.utils.encode_cell({ r, c: 2 })];
  const h = rab[XLSX.utils.encode_cell({ r, c: 7 })];
  const i = rab[XLSX.utils.encode_cell({ r, c: 8 })];
  if (!b?.v || !c?.v || !h?.v) continue;
  total++;
  const unit = String(c.v ?? '').trim();
  if (/['`´]/.test(unit) || unit === 'm³' || unit === 'm²') {
    weirdUnit++;
    if (weirdUnitSamples.length < 6) weirdUnitSamples.push(`r${r+1}: unit="${unit}" (codepoints: ${[...unit].map(ch => ch.charCodeAt(0)).join(',')}) label="${String(b.v).slice(0,40)}"`);
  }
  if (!i) { noFormula++; if (noFormulaSamples.length<5) noFormulaSamples.push(`r${r+1}: "${String(b.v).slice(0,40)}"`); continue; }
  if (i.f) {
    const f = String(i.f);
    if (/Analisa/i.test(f)) analisaRef++;
    else otherFormula++;
  } else {
    noFormula++;
    if (noFormulaSamples.length<5) noFormulaSamples.push(`r${r+1}: "${String(b.v).slice(0,40)}" I=${i.v}`);
  }
}
console.log(`\nRAB (A): total=${total} itemlike rows`);
console.log(`  → col I has =Analisa! formula: ${analisaRef}`);
console.log(`  → col I has OTHER formula (inline calc, no AHS link): ${otherFormula}`);
console.log(`  → col I empty or static value (no material link): ${noFormula}`);
console.log(`  → weird unit cells (apostrophe / superscript): ${weirdUnit}`);
console.log(`\nWeird unit samples:`);
weirdUnitSamples.forEach(s => console.log(`  ${s}`));
console.log(`\nRows with NO material formula samples:`);
noFormulaSamples.forEach(s => console.log(`  ${s}`));
