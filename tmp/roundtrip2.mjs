import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
const wb = XLSX.read(fs.readFileSync('assets/BOQ/SANO Sonny Citraland Selat Golf - Normalized.xlsx'), { cellFormula:false });
const res = readBreakdownSheets(wb);
const rows = res.breakdowns;
console.log('breakdowns read back:', rows.length, '| warnings:', res.warnings.length);
console.log('reconciles=true:', rows.filter(r=>r.reconciliation?.reconciles).length, '/', rows.length);
const u = rows.flatMap(r=>r.components||[]).filter(c=>/U24|U40/.test(c.materialName||'')).length;
console.log('U24/U40 component lines:', u);
// distinct rebar diameters seen
const diam=new Set(); for(const r of rows) for(const c of r.components||[]) { const m=(c.materialName||'').match(/Besi beton (D\d+)/); if(m) diam.add(m[1]); }
console.log('rebar diameters present:', [...diam].sort().join(', '));
if(res.warnings.length) console.log('sample warnings:', res.warnings.slice(0,3));
