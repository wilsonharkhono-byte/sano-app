import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { readBreakdownSheets } from '../tools/boqParserV2/breakdownSheetReader.ts';
const wb = XLSX.read(fs.readFileSync('assets/BOQ/SANO Sonny Citraland Selat Golf - Normalized.xlsx'), { cellFormula:false });
const res = readBreakdownSheets(wb);
const rows = Array.from(res.breakdowns.values());
console.log('breakdowns read back:', rows.length, '| reader warnings:', res.warnings.length);
console.log('reconciles=true:', rows.filter(r=>r.reconciliation?.reconciles).length, '/', rows.length);
console.log('U24/U40 component lines:', rows.flatMap(r=>r.components||[]).filter(c=>/U24|U40/.test(c.materialName||'')).length);
const diam=new Set(); for(const r of rows) for(const c of r.components||[]){const m=(c.materialName||'').match(/Besi beton (D\d+)/); if(m)diam.add(m[1]);}
console.log('rebar diameters present:', [...diam].sort((a,b)=>+a.slice(1)-+b.slice(1)).join(', '));
