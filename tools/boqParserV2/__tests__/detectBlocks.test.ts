import { detectAhsBlocks, isTitleRow, isHeaderRow } from '../detectBlocks';
import { harvestWorkbook } from '../harvest';
import { buildFixtureWorkbook } from './fixtures';

describe('isTitleRow', () => {
  it('matches "1 m3 Beton site mix"', () => {
    expect(isTitleRow('1 m3 Beton site mix')).toBe(true);
  });
  it('matches "1 m² Plesteran"', () => {
    expect(isTitleRow('1 m² Plesteran')).toBe(true);
  });
  it('matches "10 m3 Galian tanah"', () => {
    expect(isTitleRow('10 m3 Galian tanah')).toBe(true);
  });
  it('rejects non-titles', () => {
    expect(isTitleRow('Uraian')).toBe(false);
    expect(isTitleRow('Semen PC')).toBe(false);
    expect(isTitleRow('')).toBe(false);
  });
});

describe('isHeaderRow', () => {
  it('matches Uraian/Koefisien/Harga labels', () => {
    expect(isHeaderRow('Uraian')).toBe(true);
    expect(isHeaderRow('Koefisien')).toBe(true);
    expect(isHeaderRow('Harga')).toBe(true);
  });
  it('rejects component names', () => {
    expect(isHeaderRow('Semen PC')).toBe(false);
  });
});

describe('detectAhsBlocks', () => {
  it('detects one block with title, components, and Jumlah', async () => {
    const wb = await buildFixtureWorkbook([
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B143', value: 'Uraian' },           // header, skipped
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', value: 1500000 },
          { address: 'F144', value: 75000 },
          { address: 'B145', value: 'Pasir' },
          { address: 'E145', value: 200000 },
          { address: 'F145', value: 10000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 85000 },
          { address: 'I150', formula: 'F150', result: 85000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const blocks = detectAhsBlocks(cells, 'Analisa');
    expect(blocks.length).toBe(1);
    expect(blocks[0].title).toBe('1 m3 Lantai Kerja');
    expect(blocks[0].titleRow).toBe(142);
    expect(blocks[0].jumlahRow).toBe(150);
    expect(blocks[0].components.length).toBe(2); // header row skipped
    expect(blocks[0].jumlahCachedValue).toBe(85000);
  });

  it('returns empty when no title rows present', async () => {
    const wb = await buildFixtureWorkbook([
      { name: 'Analisa', cells: [{ address: 'B1', value: 'random' }] },
    ]);
    const { cells } = await harvestWorkbook(wb);
    expect(detectAhsBlocks(cells, 'Analisa')).toEqual([]);
  });
});
