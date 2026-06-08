import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('staging raw_data provenance', () => {
  it('stamps source_sheet/source_row/source_cell per row type', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' }, { address: 'B1', value: 'Uraian' },
          { address: 'C1', value: 'Satuan' }, { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' }, { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'zak' }, { address: 'D2', value: 65000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Lantai Kerja' },
          { address: 'B12', value: 'Semen PC' }, { address: 'C12', value: 'zak' },
          { address: 'D12', value: 'Semen PC' }, { address: 'E12', value: 65000 },
          { address: 'F12', value: 6825 },
          { address: 'B15', value: 'Jumlah' }, { address: 'F15', value: 6825 },
        ],
      },
    ]);
    const result = await parseBoqV2(wb);

    const block = result.stagingRows.find(r => r.row_type === 'ahs_block');
    expect((block!.raw_data as any).source_sheet).toBe('Analisa');
    expect((block!.raw_data as any).source_cell).toBe('B10');

    const comp = result.stagingRows.find(r => r.row_type === 'ahs');
    expect((comp!.raw_data as any).source_sheet).toBe('Analisa');
    expect((comp!.raw_data as any).source_row).toBe(12);
    expect((comp!.raw_data as any).source_cell).toBe('D12');

    const material = result.stagingRows.find(r => r.row_type === 'material');
    expect((material!.raw_data as any).source_sheet).toBe('Material');
    expect((material!.raw_data as any).source_cell).toBe('B2');
  });
});
