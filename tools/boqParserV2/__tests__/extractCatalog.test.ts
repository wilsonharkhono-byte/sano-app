import { extractCatalogRows } from '../extractCatalog';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('extractCatalogRows', () => {
  it('pulls rows with code, name, unit, price from Material sheet', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Material',
        cells: [
          // Header row
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          // Data rows
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC 40 kg' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
          { address: 'A3', value: 'M002' },
          { address: 'B3', value: 'Pasir halus' },
          { address: 'C3', value: 'm3' },
          { address: 'D3', value: 200000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      code: 'M001',
      name: 'Semen PC 40 kg',
      unit: 'sak',
      reference_unit_price: 75000,
    });
  });

  it('skips rows without a code', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'B2', value: 'Orphan material' },
          { address: 'D2', value: 100 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(extractCatalogRows(cells, ['Material'])).toEqual([]);
  });
});
