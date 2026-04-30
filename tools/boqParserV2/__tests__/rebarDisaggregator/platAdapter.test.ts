import { platAdapter } from '../../rebarDisaggregator/adapters/plat';
import type { HarvestedCell } from '../../types';

function mkCells(rows: Array<{ row: number; cols: Record<string, unknown> }>): HarvestedCell[] {
  const out: HarvestedCell[] = [];
  for (const r of rows) {
    for (const [col, value] of Object.entries(r.cols)) {
      const colNum = col.charCodeAt(0) - 64;
      out.push({
        sheet: 'REKAP Plat',
        address: `${col}${r.row}`,
        row: r.row,
        col: colNum,
        value,
        formula: null,
      });
    }
  }
  return out;
}

describe('platAdapter.lookupBreakdown', () => {
  // Header row 2: N=8, O=10, P=13, Q=16, R=19. NO D6, D22, D25.
  const headers = mkCells([
    { row: 2, cols: { N: 8, O: 10, P: 13, Q: 16, R: 19 } },
  ]);

  it('returns diameters for S2 (label in column C)', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 6, cols: { C: 'S2', N: 100, P: 415.69 } },
      ]),
    ];
    const result = platAdapter.lookupBreakdown('S2', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 100, sourceCell: 'REKAP Plat!N6' },
      { diameter: 'D13', weightKg: 415.69, sourceCell: 'REKAP Plat!P6' },
    ]);
  });

  it('returns null when type code not found', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 6, cols: { C: 'S2', N: 100 } }]),
    ];
    expect(platAdapter.lookupBreakdown('S99', cells)).toBeNull();
  });

  it('returns empty array when row exists but all diameters zero', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 6, cols: { C: 'S2', N: 0, O: 0, P: 0, Q: 0, R: 0 } }]),
    ];
    expect(platAdapter.lookupBreakdown('S2', cells)).toEqual([]);
  });
});
