import { extractBoqRows } from '../extractTakeoffs';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('Prelim column support', () => {
  it('captures M=Prelim value in cost_split.prelim', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'L7', value: 'Subkon' },
          { address: 'M7', value: 'Prelim' },
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Pagar pengaman' },
          { address: 'C11', value: 'm1' },
          { address: 'D11', value: 15 },
          { address: 'J11', value: 50000 },
          { address: 'M11', value: 150000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0].cost_split).toEqual({
      material: 0,
      labor: 50000,
      equipment: 0,
      prelim: 150000,
    });
  });
});
