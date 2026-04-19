// tools/boqParserV2/harvest.ts
//
// Reads an Excel workbook buffer into flat `HarvestedCell[]` for the v2
// parser. Uses SheetJS (`xlsx`) — the same library v1 uses — because
// ExcelJS blows React Native's native stack depth at module init.
//
// Downstream extractors expect formula strings to start with `=`; SheetJS
// stores `f` without the prefix, so we normalize on the way out.

import * as XLSX from 'xlsx';
import type { HarvestedCell, HarvestLookup } from './types';

export interface HarvestResult {
  cells: HarvestedCell[];
  lookup: HarvestLookup;
  sheetNames: string[];
  workbook: XLSX.WorkBook;
}

export async function harvestWorkbook(
  input: Buffer | ArrayBuffer | XLSX.WorkBook,
): Promise<HarvestResult> {
  const workbook: XLSX.WorkBook =
    input && typeof input === 'object' && 'SheetNames' in input
      ? (input as XLSX.WorkBook)
      : XLSX.read(input as Buffer | ArrayBuffer, {
          type: input instanceof ArrayBuffer ? 'array' : 'buffer',
          cellFormula: true,
          cellNF: true,
        });

  const cells: HarvestedCell[] = [];
  const lookup: HarvestLookup = new Map();

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = ws[addr] as XLSX.CellObject;
      if (cell == null) continue;
      const { r, c } = XLSX.utils.decode_cell(addr);

      let formula: string | null = null;
      if (typeof cell.f === 'string' && cell.f.length > 0) {
        formula = cell.f.startsWith('=') ? cell.f : `=${cell.f}`;
      }

      const harvested: HarvestedCell = {
        sheet: sheetName,
        address: addr,
        row: r + 1,
        col: c + 1,
        value: cell.v ?? null,
        formula,
      };
      cells.push(harvested);
      lookup.set(`${sheetName}!${addr}`, harvested);
    }
  }

  return { cells, lookup, sheetNames: workbook.SheetNames, workbook };
}
