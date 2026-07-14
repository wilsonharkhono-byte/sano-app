import * as XLSX from 'xlsx';
import type { StagingRowV2, ValidationReport } from '../boqParserV2/types';
import { parseTier1Sheet, TIER1_SHEET_NAME } from './tier1';
import { parseOthersSheet, OTHERS_SHEET_NAME } from './others';

export { TIER1_SHEET_NAME } from './tier1';
export { OTHERS_SHEET_NAME } from './others';

/** SheetJS read type mirrors the v2 parser's harvest step (ArrayBuffer → 'array'). */
function readType(buffer: Buffer | ArrayBuffer): 'array' | 'buffer' {
  return buffer instanceof ArrayBuffer ? 'array' : 'buffer';
}

/** True iff the workbook is the team's two-sheet "SANO Input" format. */
export function isSimplifiedInputWorkbook(buffer: Buffer | ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: readType(buffer), bookSheets: true });
    const names = new Set(wb.SheetNames);
    return names.has(TIER1_SHEET_NAME) && names.has(OTHERS_SHEET_NAME);
  } catch {
    return false;
  }
}

/**
 * Parse a simplified-input workbook into StagingRowV2[] — the same shape
 * parseBoqV2 returns — so the existing insert → review → publish pipeline
 * consumes it unchanged. Emits Tier-1 work-area boq rows followed by the single
 * Material Umum anchor, renumbered contiguously from 1. The validationReport is
 * empty-but-valid (no AHS blocks to reconcile) so baseline.ts can persist it
 * exactly as it does for the RAB path.
 */
export function parseSimplifiedInput(
  buffer: Buffer | ArrayBuffer,
): { stagingRows: StagingRowV2[]; validationReport: ValidationReport } {
  const wb = XLSX.read(buffer, { type: readType(buffer), cellFormula: false });
  const tier1Ws = wb.Sheets[TIER1_SHEET_NAME];
  const othersWs = wb.Sheets[OTHERS_SHEET_NAME];

  const rows: StagingRowV2[] = [];
  if (tier1Ws) rows.push(...parseTier1Sheet(tier1Ws));
  if (othersWs) {
    const anchor = parseOthersSheet(othersWs);
    if (anchor) rows.push(anchor);
  }
  rows.forEach((r, i) => {
    r.row_number = i + 1;
  });

  return {
    stagingRows: rows,
    validationReport: { blocks: [], generated_at: new Date().toISOString() },
  };
}
