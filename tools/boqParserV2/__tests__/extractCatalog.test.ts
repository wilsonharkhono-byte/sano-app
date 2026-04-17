import { extractCatalogRows } from '../extractCatalog';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('extractCatalogRows', () => {
  it('auto-detects columns from header row (B=name, F=unit, G=price)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'B5', value: 'M A T E R I A L S' },
          { address: 'F5', value: 'SAT' },
          { address: 'G5', value: 'HARGA NET' },
          { address: 'B8', value: 'Pasir Pasang' },
          { address: 'F8', value: 'm3' },
          { address: 'G8', value: 350000 },
          { address: 'B9', value: 'Semen PC' },
          { address: 'F9', value: 'sak' },
          { address: 'G9', value: 65000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      name: 'Pasir Pasang',
      unit: 'm3',
      reference_unit_price: 350000,
    });
    expect(rows[1]).toMatchObject({
      name: 'Semen PC',
      unit: 'sak',
      reference_unit_price: 65000,
    });
  });

  it('detects simple A/B/C/D layout with explicit code', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Bahan' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC 40 kg' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      name: 'Semen PC 40 kg',
      unit: 'sak',
      reference_unit_price: 75000,
    });
  });

  it('parses Indonesian-formatted string prices (thousands dot)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'B1', value: 'Material' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'B2', value: 'Besi tulangan' },
          { address: 'C2', value: 'kg' },
          { address: 'D2', value: '1.662.746' },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const rows = extractCatalogRows(cells, ['Material']);
    expect(rows.length).toBe(1);
    expect(rows[0].reference_unit_price).toBe(1662746);
  });

  it('skips rows without a name', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'B1', value: 'Material' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'D2', value: 100 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(extractCatalogRows(cells, ['Material'])).toEqual([]);
  });

  it('returns empty when no header row detected', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'random data' },
          { address: 'A2', value: 'more random' },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(extractCatalogRows(cells, ['Material'])).toEqual([]);
  });
});
