import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('staging flag_reason', () => {
  it('stamps orphan_ahs_block on an orphan AHS block (not referenced by any BoQ)', async () => {
    const wb = await buildFixtureBuffer([
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
    expect(block!.needs_review).toBe(true);
    expect((block!.raw_data as any).flag_reason).toBe('orphan_ahs_block');
  });

  it('stamps literal_component on an AHS component whose price cell has no formula', async () => {
    const wb = await buildFixtureBuffer([
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
    const comp = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(comp!.needs_review).toBe(true);
    expect((comp!.raw_data as any).flag_reason).toBe('literal_component');
  });

  it('does NOT stamp flag_reason on an AHS component whose price cell has a catalog formula', async () => {
    // E12 has a cross-sheet formula referencing Material!$F$12 → classifies as
    // 'catalog' (non-literal), so needs_review must be false and flag_reason absent.
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Lantai Kerja' },
          { address: 'B12', value: 'Semen PC' }, { address: 'C12', value: 'zak' },
          { address: 'D12', value: 'Semen PC' },
          { address: 'E12', formula: 'Material!$F$12', result: 65000 },
          { address: 'F12', value: 6825 },
          { address: 'B15', value: 'Jumlah' }, { address: 'F15', value: 6825 },
        ],
      },
      {
        name: 'Material',
        cells: [
          { address: 'F12', value: 65000 },
        ],
      },
    ]);
    const result = await parseBoqV2(wb);
    const comp = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(comp!.needs_review).toBe(false);
    expect((comp!.raw_data as any).flag_reason).toBeUndefined();
  });
});
