// tools/boqParserV2/harvest.ts
import type ExcelJS from 'exceljs';
import type { HarvestedCell, HarvestLookup } from './types';

export interface HarvestResult {
  cells: HarvestedCell[];
  lookup: HarvestLookup;
}

export async function harvestWorkbook(
  workbook: ExcelJS.Workbook,
): Promise<HarvestResult> {
  const cells: HarvestedCell[] = [];
  const lookup: HarvestLookup = new Map();

  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const raw = cell.value;
        let formula: string | null = null;
        let value: unknown = raw;

        if (raw && typeof raw === 'object' && 'formula' in raw) {
          const fc = raw as { formula: string; result?: unknown };
          formula = fc.formula.startsWith('=') ? fc.formula : `=${fc.formula}`;
          value = fc.result ?? null;
        }

        const harvested: HarvestedCell = {
          sheet: sheet.name,
          address: cell.address,
          row: rowNumber,
          col: colNumber,
          value,
          formula,
        };
        cells.push(harvested);
        lookup.set(`${sheet.name}!${cell.address}`, harvested);
      });
    });
  });

  return { cells, lookup };
}
