// tools/boqParserV2/__tests__/harvest.test.ts
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('harvestWorkbook', () => {
  it('reads literal cells from every sheet', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B2', value: 'Semen' },
          { address: 'E2', value: 150000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    expect(cells.length).toBe(2);
    expect(lookup.get('Analisa!B2')?.value).toBe('Semen');
    expect(lookup.get('Analisa!E2')?.value).toBe(150000);
  });

  it('distinguishes formula cells and stores both .f and .v', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'F150', formula: 'SUM(F142:F149)', result: 785220 },
        ],
      },
    ]);
    const { lookup } = await harvestWorkbook(wb);
    const cell = lookup.get('Analisa!F150');
    expect(cell?.formula).toBe('=SUM(F142:F149)');
    expect(cell?.value).toBe(785220);
  });

  it('returns empty harvest for empty workbook', async () => {
    const wb = await buildFixtureBuffer([{ name: 'Empty', cells: [] }]);

    const { cells } = await harvestWorkbook(wb);
    expect(cells).toEqual([]);
  });
});
