import * as XLSX from 'xlsx';
import * as fs from 'fs';
const wb=XLSX.read(fs.readFileSync('./tmp_input_citraland.xlsx'),{cellFormula:true,cellStyles:false});
for (const name of ['DATA BAJA','Hasil-PC','Besi Balok']){
  const ws=wb.Sheets[name];
  const decl=XLSX.utils.decode_range(ws['!ref']);
  let maxR=-1,maxC=-1,count=0;
  for (const addr in ws){
    if(addr[0]==='!') continue;
    const c=XLSX.utils.decode_cell(addr);
    if(c.r>maxR)maxR=c.r; if(c.c>maxC)maxC=c.c; count++;
  }
  console.log(name,'| declared rows',decl.e.r+1,'| TRUE last row',maxR+1,'| true last col',maxC,'| populated cells',count);
}
