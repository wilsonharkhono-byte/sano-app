import * as XLSX from 'xlsx';
import * as fs from 'fs';
const wb = XLSX.read(fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx'), {cellFormula:false});
console.log('sheets:', wb.SheetNames.join(' | '));
function dump(name, maxRow=14){
  const ws=wb.Sheets[name]; if(!ws){console.log(`\n[${name}] MISSING`);return;}
  console.log(`\n=== ${name} (first ${maxRow} rows, cols A..T) ===`);
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let r=range.s.r; r<=Math.min(range.s.r+maxRow, range.e.r); r++){
    const cells=[];
    for(let c=0;c<=19;c++){ const a=XLSX.utils.encode_cell({r,c}); const v=ws[a]?.v; if(v!=null&&String(v).trim()!=='') cells.push(`${XLSX.utils.encode_col(c)}${r+1}=${String(v).slice(0,16)}`); }
    if(cells.length) console.log('  '+cells.join('  '));
  }
}
dump('REKAP Plat', 16);
dump('REKAP BETON BESI BEKISTING', 10);
