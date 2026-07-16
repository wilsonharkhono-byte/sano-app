import * as XLSX from 'xlsx';
import { isSimplifiedInputWorkbook, parseSimplifiedInput } from '../index';

function workbookBuffer(sheets: Record<string, (string | number | null)[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const tier1Aoa = [
  ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
  [null, null, 8, 10, 13, 16, 19, 22],
  [],
  ['Bunker; Tangga', 2.76, 7, 9, 19, 0, 0, 0],
];
const othersAoa = [
  ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
  [],
  ['Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
];

describe('isSimplifiedInputWorkbook', () => {
  it('is true when both simplified sheets are present', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    expect(isSimplifiedInputWorkbook(buf)).toBe(true);
  });
  it('is false for a RAB-shaped workbook', () => {
    const buf = workbookBuffer({ 'RAB (A)': [['x']], Analisa: [['y']] });
    expect(isSimplifiedInputWorkbook(buf)).toBe(false);
  });
});

describe('parseSimplifiedInput', () => {
  it('emits Tier-1 boq rows plus project-level Others material rows, contiguously numbered', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    const { stagingRows } = parseSimplifiedInput(buf);
    expect(stagingRows).toHaveLength(2); // 1 Tier-1 boq + 1 Others material
    expect(stagingRows.map((r) => r.row_type)).toEqual(['boq', 'material']);
    expect(stagingRows.map((r) => r.row_number)).toEqual([1, 2]);
    expect(stagingRows.map((r) => r.parsed_data.code)).toEqual(['T1-001', 'OTH-001']);
    expect((stagingRows[1].parsed_data as any).project_material).toBe(true);
  });

  it('returns an empty-but-valid validation report', () => {
    const buf = workbookBuffer({ 'SANO Input Tier 1': tier1Aoa, 'SANO Input Others': othersAoa });
    const { validationReport } = parseSimplifiedInput(buf);
    expect(validationReport.blocks).toEqual([]);
    expect(typeof validationReport.generated_at).toBe('string');
  });
});
