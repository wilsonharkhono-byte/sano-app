import * as XLSX from 'xlsx';
import * as fs from 'fs';
const t0=Date.now();
const buf=fs.readFileSync('./tmp_input_citraland.xlsx');
console.log('readFile', ((Date.now()-t0)/1000).toFixed(1),'s', (buf.length/1e6).toFixed(1),'MB');
let t=Date.now();
const wb=XLSX.read(buf,{cellFormula:true,cellStyles:false});
console.log('XLSX.read', ((Date.now()-t)/1000).toFixed(1),'s');
// report per-sheet ref
for (const n of wb.SheetNames){ const r=wb.Sheets[n]['!ref']; console.log('  ',n,r); }
t=Date.now();
const out=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
console.log('XLSX.write', ((Date.now()-t)/1000).toFixed(1),'s', (out.length/1e6).toFixed(1),'MB');
