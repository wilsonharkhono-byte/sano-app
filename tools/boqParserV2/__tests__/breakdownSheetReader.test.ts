import * as XLSX from 'xlsx';
import { readBreakdownHeader } from '../breakdownSheetReader';

function makeSheet(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe('readBreakdownHeader', () => {
  it('parses the header block of a well-formed Breakdown sheet', () => {
    const sheet = makeSheet([
      ['BREAKDOWN — IV.A.2.7 Balok B24-1 (At-Cost)'],
      ['Source: RAB (A)!132 + Analisa AHS blocks'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      ['Unit cost (Rp/m³)', 6839679],
      ['Line total at-cost (Rp)', 1809779],
    ]);

    const header = readBreakdownHeader(sheet, 'Breakdown IV.A.2.7');

    expect(header).toEqual({
      boqCode: 'IV.A.2.7',
      description: '- Balok B24-1',
      unit: 'm3',
      volume: 0.2646,
      unitCost: 6839679,
      lineTotal: 1809779,
    });
  });

  it('throws on missing volume row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN — IV.A.2.7 Balok B24-1 (At-Cost)'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*volume/i);
  });

  it('throws on missing Unit cost row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      // Unit cost row absent
      ['Line total at-cost (Rp)', 1809779],
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*unit cost/i);
  });

  it('throws on missing Line total row', () => {
    const sheet = makeSheet([
      ['BREAKDOWN'],
      [],
      ['Description', '- Balok B24-1'],
      ['Unit', 'm3'],
      ['Volume', 0.2646],
      ['Unit cost (Rp/m³)', 6839679],
      // Line total row absent
    ]);
    expect(() => readBreakdownHeader(sheet, 'Breakdown IV.A.2.7')).toThrow(/missing.*line total/i);
  });
});
