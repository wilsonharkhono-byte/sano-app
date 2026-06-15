import * as XLSX from 'xlsx';
import * as fs from 'fs';
const wb = XLSX.read(fs.readFileSync('/sessions/optimistic-jolly-cannon/mnt/uploads/SANO Sonny Citraland Selat Golf.xlsx'), {cellFormula:false});
const ws=wb.Sheets['REKAP BETON BESI BEKISTING'];
const range=XLSX.utils.decode_range(ws['!ref']);
console.log('range rows', range.s.r+1,'..',range.e.r+1);
for(let r=range.s.r; r<=Math.min(range.e.r, range.s.r+40); r++){
  const cells=[];
  for(let c=0;c<20;c++){ const a=XLSX.utils.encode_cell({r,c}); const v=ws[a]?.v; if(v!=null&&String(v).trim()!=='') cells.push(`${XLSX.utils.encode_col(c)}=${String(v).slice(0,13)}`); }
  if(cells.length) console.log(`r${r+1}: ${cells.join(' ')}`);
}
