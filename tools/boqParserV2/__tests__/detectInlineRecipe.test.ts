import { detectInlineRecipes } from '../detectInlineRecipe';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('detectInlineRecipes', () => {
  it('detects a parent with 4 material children', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'E7', value: 'HARGA SATUAN' },
          { address: 'F7', value: 'TOTAL HARGA' },
          // Parent: label-only, no unit/qty
          { address: 'B10', value: '- Poer PC.5' },
          // Children: material-typed, with values
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 2.55 },
          { address: 'E11', value: 2631890 },
          { address: 'F11', value: 6711319.5 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' },
          { address: 'D12', value: 105.62 },
          { address: 'E12', value: 12009 },
          { address: 'F12', value: 1268391 },
          { address: 'B13', value: '- Besi D16' },
          { address: 'C13', value: 'kg' },
          { address: 'D13', value: 146.02 },
          { address: 'E13', value: 12009 },
          { address: 'F13', value: 1753554 },
          { address: 'B14', value: '- Bekisting Batako' },
          { address: 'C14', value: 'm2' },
          { address: 'D14', value: 7.56 },
          { address: 'E14', value: 100188 },
          { address: 'F14', value: 757421 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);

    const groups = detectInlineRecipes(cells, 'RAB (A)');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      parentRow: 10,
      parentLabel: 'Poer PC.5',
      childRows: [
        { sourceRow: 11, materialName: 'Beton', unit: 'm3', coefficient: 2.55, unitPrice: 2631890 },
        { sourceRow: 12, materialName: 'Besi D13', unit: 'kg', coefficient: 105.62, unitPrice: 12009 },
        { sourceRow: 13, materialName: 'Besi D16', unit: 'kg', coefficient: 146.02, unitPrice: 12009 },
        { sourceRow: 14, materialName: 'Bekisting Batako', unit: 'm2', coefficient: 7.56, unitPrice: 100188 },
      ],
    });
    expect(groups[0].parentTotalCost).toBeCloseTo(6711319.5 + 1268391 + 1753554 + 757421, 0);
    expect(groups[0].consumedRows.has(10)).toBe(true);
    expect(groups[0].consumedRows.has(14)).toBe(true);
  });

  it('rejects a parent whose label ends with ":" (sub-sub-chapter divider)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Poer (Readymix fc\' 30 MPa) :' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' },
          { address: 'D12', value: 1 },
          { address: 'E12', value: 1000 },
          { address: 'F12', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('rejects a parent that has unit or quantity values', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          // Has C and D — this is a leaf BoQ row, not a recipe parent
          { address: 'B10', value: '- Sloof S36-1' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 6.939 },
          { address: 'E10', value: 4626604 },
          { address: 'F10', value: 32104003 },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('rejects a parent with only one material child', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 1 },
          { address: 'E11', value: 1000 },
          { address: 'F11', value: 1000 },
          // Only one child — group should be rejected
          { address: 'B12', value: '- Sloof S36-1' },
          { address: 'C12', value: 'm3' },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(0);
  });

  it('stops collecting at the next inline-recipe parent', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 1 }, { address: 'E11', value: 1000 }, { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 1 }, { address: 'E12', value: 1000 }, { address: 'F12', value: 1000 },
          // Next parent — first group ends here
          { address: 'B13', value: '- Poer PC.9' },
          { address: 'B14', value: '- Beton' },
          { address: 'C14', value: 'm3' }, { address: 'D14', value: 1 }, { address: 'E14', value: 1000 }, { address: 'F14', value: 1000 },
          { address: 'B15', value: '- Bekisting Batako' },
          { address: 'C15', value: 'm2' }, { address: 'D15', value: 1 }, { address: 'E15', value: 1000 }, { address: 'F15', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(2);
    expect(groups[0].parentLabel).toBe('Poer PC.5');
    expect(groups[0].childRows).toHaveLength(2);
    expect(groups[1].parentLabel).toBe('Poer PC.9');
    expect(groups[1].childRows).toHaveLength(2);
  });

  it('stops collecting at a chapter heading', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 1 }, { address: 'E11', value: 1000 }, { address: 'F11', value: 1000 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 1 }, { address: 'E12', value: 1000 }, { address: 'F12', value: 1000 },
          // Roman numeral in column A → chapter heading; recipe ends
          { address: 'A13', value: 'IV' },
          { address: 'B13', value: 'PEKERJAAN ATAP' },
          { address: 'B14', value: '- Bekisting Kayu' },
          { address: 'C14', value: 'm2' }, { address: 'D14', value: 1 }, { address: 'E14', value: 1000 }, { address: 'F14', value: 1000 },
        ],
      },
    ]);
    const { cells } = await harvestWorkbook(wb);
    const groups = detectInlineRecipes(cells, 'RAB (A)');
    expect(groups).toHaveLength(1);
    expect(groups[0].childRows).toHaveLength(2);
  });
});
