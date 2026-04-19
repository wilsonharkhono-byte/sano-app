import * as XLSX from 'xlsx';

export type BoqSheetOption = string | string[] | 'auto';

// A sheet is "plausible RAB" when it matches RAB (X) / RAB naming AND has
// at least one row below row 7 with text in B and a unit/volume in C/D.
export function isPlausibleRabSheet(wb: XLSX.WorkBook, sheetName: string): boolean {
  if (!/^RAB(\s*\([A-Z]\))?$/i.test(sheetName)) return false;
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return false;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 7; r <= Math.min(range.e.r, 40); r++) {
    const b = ws['B' + (r + 1)];
    const c = ws['C' + (r + 1)];
    const d = ws['D' + (r + 1)];
    if (b?.v && c?.v && (d?.v != null)) return true;
  }
  return false;
}

export function resolveBoqSheets(wb: XLSX.WorkBook, option: BoqSheetOption): string[] {
  if (Array.isArray(option)) return option;
  if (option !== 'auto') return [option];
  return wb.SheetNames.filter(n => isPlausibleRabSheet(wb, n));
}
