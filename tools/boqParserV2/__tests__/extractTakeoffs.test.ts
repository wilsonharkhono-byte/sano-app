import { extractBoqRows } from '../extractTakeoffs';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('extractBoqRows', () => {
  it('extracts BoQ rows with literal quantities', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B11', value: 'A.1' },
          { address: 'C11', value: 'Pekerjaan Galian' },
          { address: 'D11', value: 100, formula: 'H11', result: 100 },
          { address: 'E11', value: 50000, formula: 'N11', result: 50000 },
          { address: 'F11', value: 5000000, formula: 'D11*E11', result: 5000000 },
          { address: 'G11', value: 'm3' },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      code: 'A.1',
      label: 'Pekerjaan Galian',
      unit: 'm3',
      planned: 100,
    });
  });

  it('parses Indonesian-formatted string quantities (decimal comma)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B15', value: 'A.2' },
          { address: 'C15', value: 'Pekerjaan Beton' },
          { address: 'D15', value: '5.000,50' },
          { address: 'E15', value: 750000 },
          { address: 'F15', value: 937500000 },
          { address: 'G15', value: 'm3' },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0].planned).toBe(5000.5);
  });

  it('attaches takeoff_ref provenance when quantity is SUMIFS', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B20', value: 'B.1' },
          { address: 'C20', value: 'Besi tulangan' },
          {
            address: 'D20',
            value: 5000,
            formula: "SUM('REKAP Balok'!K526, 'REKAP-PC'!G21)",
            result: 5000,
          },
          { address: 'E20', value: 12000 },
          { address: 'F20', value: 60000000 },
          { address: 'G20', value: 'kg' },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows[0].cost_basis).toBe('takeoff_ref');
    expect(rows[0].ref_cells?.quantity?.length).toBeGreaterThan(0);
  });
});
