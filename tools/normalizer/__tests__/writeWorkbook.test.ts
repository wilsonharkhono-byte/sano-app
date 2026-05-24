import * as XLSX from 'xlsx';
import { writeBreakdownSheets } from '../writeWorkbook';
import { readBreakdownSheets } from '../../boqParserV2/breakdownSheetReader';
import type { RowBreakdown } from '../../boqParserV2/breakdownSheetReader.types';

const BREAKDOWN: RowBreakdown = {
  boqCode: 'IV.A.2.7',
  description: '- Balok B24-1',
  unit: 'm3',
  volume: 0.2646,
  unitCost: 6839679,
  lineTotal: 1809779,
  components: [
    {
      group: 'material', componentGroup: 'BETON READYMIX (Material)',
      materialName: 'Beton readymix K-350', specNote: 'slump',
      qtyPerNativeUnit: 1.05, nativeUnit: 'm3', nativeBasis: 'per m3 beton',
      unitPrice: 1043400, qtyPerBoqUnit: 1.05, costPerBoqUnit: 1095570,
      totalQty: 0.2778, totalCost: 289888,
    },
  ],
  reconciliation: { computedUnitCost: 1095570, sourceUnitCost: 6839679, unitCostVariance: 0, computedLineTotal: 289887, sourceLineTotal: 1809779, lineTotalVariance: 0, reconciles: true },
  sourceSheet: 'Breakdown IV.A.2.7',
};

describe('writeBreakdownSheets', () => {
  it('writes a valid workbook that round-trips through readBreakdownSheets', () => {
    const wb = XLSX.utils.book_new();
    writeBreakdownSheets(wb, [BREAKDOWN]);
    expect(wb.SheetNames).toContain('Breakdown IV.A.2.7');
    expect(wb.SheetNames).toContain('Recipe Index');

    // Round-trip
    const { breakdowns } = readBreakdownSheets(wb);
    expect(breakdowns.has('IV.A.2.7')).toBe(true);
    const bd = breakdowns.get('IV.A.2.7')!;
    expect(bd.volume).toBe(0.2646);
    expect(bd.components).toHaveLength(1);
    expect(bd.components[0].materialName).toBe('Beton readymix K-350');
  });

  it('truncates sheet name to 31 chars with hash suffix when needed', () => {
    const longCode = { ...BREAKDOWN, boqCode: 'A-VERY-LONG-CODE-SECTION-NAMING-CONVENTION', sourceSheet: '' };
    const wb = XLSX.utils.book_new();
    writeBreakdownSheets(wb, [longCode]);
    const sheetName = wb.SheetNames.find((n) => n.startsWith('Breakdown '))!;
    expect(sheetName.length).toBeLessThanOrEqual(31);
  });
});
