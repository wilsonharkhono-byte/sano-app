// tools/boqParserV2/__tests__/fixtures.ts
// Programmatically builds tiny test XLSX buffers via exceljs so we can
// unit-test the parser without committing binary fixtures.

import ExcelJS from 'exceljs';

export interface FixtureCell {
  address: string;           // "B142"
  value?: unknown;
  formula?: string;
  result?: unknown;          // for formula cells, the cached value
}

export interface FixtureSheet {
  name: string;
  cells: FixtureCell[];
}

export async function buildFixtureWorkbook(
  sheets: FixtureSheet[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const c of s.cells) {
      const cell = ws.getCell(c.address);
      if (c.formula !== undefined) {
        cell.value = { formula: c.formula, result: c.result } as ExcelJS.CellValue;
      } else {
        cell.value = c.value as ExcelJS.CellValue;
      }
    }
  }
  return wb;
}

export async function buildFixtureBuffer(sheets: FixtureSheet[]): Promise<Buffer> {
  const wb = await buildFixtureWorkbook(sheets);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
