import * as XLSX from 'xlsx';
import * as fs from 'fs';
const wb = XLSX.read(fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx'), {cellFormula:false});
function rowCells(name, rownum, label){
  const ws=wb.Sheets[name]; if(!ws){console.log(`[${name}] MISSING`);return;}
  const out=[];
  for(let c=0;c<40;c++){ const a=XLSX.utils.encode_cell({r:rownum-1,c}); const v=ws[a]?.v; if(v!=null && String(v).trim()!=='') out.push(`${XLSX.utils.encode_col(c)}=${String(v).slice(0,14)}`); }
  console.log(`  ${label} ${name}!row${rownum}: ${out.join('  ')}`);
}
console.log('=== REKAP Plat: header rows 1-3, then ref row 24 & a data row 6 ===');
rowCells('REKAP Plat',1,'hdr1'); rowCells('REKAP Plat',2,'hdr2'); rowCells('REKAP Plat',24,'REF '); rowCells('REKAP Plat',6,'data');
console.log('\n=== Retaining Wall: header rows 1-3, then ref row 271 ===');
rowCells('Retaining Wall',1,'hdr1'); rowCells('Retaining Wall',2,'hdr2'); rowCells('Retaining Wall',3,'hdr3'); rowCells('Retaining Wall',271,'REF ');
console.log('\n=== Hasil-Kolom: header rows 1-4, then ref row 298 ===');
rowCells('Hasil-Kolom',1,'hdr1'); rowCells('Hasil-Kolom',2,'hdr2'); rowCells('Hasil-Kolom',3,'hdr3'); rowCells('Hasil-Kolom',298,'REF ');
