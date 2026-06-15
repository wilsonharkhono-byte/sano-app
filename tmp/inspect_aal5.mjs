import XLSX from 'xlsx';
const wb = XLSX.readFile('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx', { cellFormula: true, cellNF: true });
console.log('SHEET NAMES:', JSON.stringify(wb.SheetNames));
