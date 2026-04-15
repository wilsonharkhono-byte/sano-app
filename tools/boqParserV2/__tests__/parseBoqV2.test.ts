import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2', () => {
  it('parses a minimal Analisa + Material + RAB workbook end-to-end', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', formula: 'Material!$D$2', result: 75000 },
          { address: 'F144', value: 75000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 75000 },
          { address: 'I150', formula: 'F150', result: 75000 },
        ],
      },
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B11', value: 'A.1' },
          { address: 'C11', value: 'Lantai Kerja' },
          { address: 'D11', value: 100 },
          { address: 'G11', value: 'm3' },
        ],
      },
    ]);

    const result = await parseBoqV2(buffer, { boqSheet: 'RAB (A)' });

    expect(result.materialRows.length).toBe(1);
    expect(result.ahsBlocks.length).toBe(1);
    expect(result.boqRows.length).toBe(1);
    expect(result.validationReport.blocks[0].status).toBe('ok');

    const component = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(component?.cost_basis).toBe('catalog');
  });
});
