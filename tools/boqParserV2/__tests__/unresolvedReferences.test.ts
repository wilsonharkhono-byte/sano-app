import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 unresolved-reference diagnostic', () => {
  it('flags formulas that point at Analisa cells outside any detected block', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'B10', value: 'Pekerjaan Mystery' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 100 },
          // E points at Analisa!F999 which is outside any detected block
          { address: 'E10', value: 50000, formula: 'Analisa!$F$999', result: 50000 },
          { address: 'F10', value: 5000000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          // One small block: title at row 10, jumlah at row 14
          { address: 'B10', value: '1 m3 Beton' },
          { address: 'B11', value: 'Semen' }, { address: 'C11', value: 'sak' }, { address: 'D11', value: 'Semen PC' }, { address: 'E11', value: 65000 }, { address: 'B12', value: 0.22 }, { address: 'F12', value: 14300 },
          { address: 'B13', value: '' }, { address: 'D13', value: '' },
          { address: 'B14', value: 'Jumlah' },
          { address: 'F14', value: 14300, formula: 'SUM(F11:F13)', result: 14300 },
          // F999 exists but is far from any block range
          { address: 'F999', value: 50000 },
        ],
      },
    ]);

    const result = await parseBoqV2(buf);

    const unresolved = result.validationReport.unresolved_references;
    expect(unresolved.length).toBeGreaterThan(0);
    const hit = unresolved.find((u) => u.target.cell === 'F999');
    expect(hit).toBeDefined();
    expect(hit!.target.sheet).toBe('Analisa');
    expect(hit!.formula).toContain('F$999');
    expect(hit!.message).toContain('hand-priced');
  });

  it('does not flag references that point inside a detected block range', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Plesteran dinding' },
          { address: 'C10', value: 'm2' },
          { address: 'D10', value: 100 },
          { address: 'E10', value: 14300, formula: 'Analisa!$F$14', result: 14300 },
          { address: 'F10', value: 1430000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Beton' },
          { address: 'B11', value: 'Semen' }, { address: 'C11', value: 'sak' }, { address: 'D11', value: 'Semen PC' }, { address: 'E11', value: 65000 }, { address: 'B12', value: 0.22 }, { address: 'F12', value: 14300 },
          { address: 'B14', value: 'Jumlah' },
          { address: 'F14', value: 14300, formula: 'SUM(F11:F13)', result: 14300 },
        ],
      },
    ]);

    const result = await parseBoqV2(buf);
    expect(result.validationReport.unresolved_references).toHaveLength(0);
  });
});
