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

// A `Breakdown` sheet tagged to a building other than (A), e.g.
// "Breakdown (B) II.A.1.1". The namespace tag is only emitted by the normalizer
// when it parsed more than one RAB sheet, so its presence is a reliable marker
// of a multi-building workbook whose materials live outside `RAB (A)`.
const NON_A_BREAKDOWN_RE = /^Breakdown\s+\([B-Z]\)\s/i;

// Decide which BoQ sheet(s) SANO's upload should ingest.
//
// The default is the single sheet `RAB (A)` — correct and UNCHANGED for the
// common single-building workbook. The add-on rule covers a few multi-building
// workbooks (e.g. Nusa Golf) that split their BoQ across `RAB (A)`…`RAB (E)`:
// there `RAB (A)` holds only preliminaries (no materials) and every structural
// row plus its `Breakdown` sheet lives in `RAB (B)`…`RAB (E)`. The normalizer
// tags those breakdowns by source sheet (`Breakdown (B) …`). When any breakdown
// is tagged to a non-(A) sheet, the materials are spread across sheets and a
// single-sheet ingest would miss them entirely, so parse all RAB sheets.
//
// Purely additive: a workbook without non-(A)-tagged breakdowns is untouched.
export function detectBoqSheetOption(sheetNames: string[]): BoqSheetOption {
  const materialsSpanMultipleSheets = sheetNames.some(n => NON_A_BREAKDOWN_RE.test(n));
  return materialsSpanMultipleSheets ? 'auto' : 'RAB (A)';
}

// Same decision, reading only the sheet directory from the workbook buffer
// (`bookSheets: true` skips cell parsing — cheap).
export function detectBoqSheetOptionFromBuffer(buffer: Buffer | ArrayBuffer): BoqSheetOption {
  const wb = XLSX.read(buffer, { bookSheets: true });
  return detectBoqSheetOption(wb.SheetNames);
}
