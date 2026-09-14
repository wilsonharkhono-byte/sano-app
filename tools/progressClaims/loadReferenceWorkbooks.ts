// tools/progressClaims/loadReferenceWorkbooks.ts
// Node-only: reads the reference RAB workbooks for deriveReferenceWeights.ts
// and its golden test. Never import this from app code (it uses fs and xlsx).
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { REFERENCE_WORKBOOKS, type WorkbookSheets } from './referenceStageWeights';

export function referenceWorkbookPaths(boqDir: string): string[] {
  return REFERENCE_WORKBOOKS.map((file) => path.join(boqDir, file));
}

export function referenceWorkbooksAvailable(boqDir: string): boolean {
  return referenceWorkbookPaths(boqDir).every((p) => fs.existsSync(p));
}

/** The only sheets the derivation reads; parsing just these is about 4x faster and yields identical rows. */
const RAB_SHEETS = ['RAB (A)', 'RAB (B)'];

/** Every `RAB (A)` / `RAB (B)` sheet of each reference workbook, as raw cell rows. */
export function loadReferenceWorkbooks(boqDir: string): WorkbookSheets[] {
  return REFERENCE_WORKBOOKS.map((file) => {
    const wb = XLSX.readFile(path.join(boqDir, file), { cellFormula: false, sheets: RAB_SHEETS });
    return {
      name: file,
      sheets: wb.SheetNames
        .filter((n) => /^RAB \((?:A|B)\)$/.test(n))
        .map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: '' })),
    };
  });
}
