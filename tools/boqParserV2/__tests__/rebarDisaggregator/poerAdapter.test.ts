import { poerAdapter } from '../../rebarDisaggregator/adapters/poer';
import type { HarvestedCell } from '../../types';

function mkCells(rows: Array<{ row: number; cols: Record<string, unknown> }>): HarvestedCell[] {
  const out: HarvestedCell[] = [];
  for (const r of rows) {
    for (const [col, value] of Object.entries(r.cols)) {
      const colNum = col.charCodeAt(0) - 64;
      out.push({
        sheet: 'REKAP-PC',
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

describe('poerAdapter.lookupBreakdown', () => {
  // Header row 9 declares diameters: H=6, I=8, J=10, K=13, L=16, M=19, N=22, O=25.
  const headers = mkCells([
    { row: 9, cols: { H: 6, I: 8, J: 10, K: 13, L: 16, M: 19, N: 22, O: 25 } },
  ]);

  it('returns diameters for PC.1 (label in column A)', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 11, cols: { A: 'PC.1', K: 558.24 } },
      ]),
    ];
    const result = poerAdapter.lookupBreakdown('PC.1', cells);
    expect(result).toEqual([
      { diameter: 'D13', weightKg: 558.24, sourceCell: 'REKAP-PC!K11' },
    ]);
  });

  it('returns multiple diameters for PC.3', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 13, cols: { A: 'PC.3', K: 265.17, L: 389.72 } },
      ]),
    ];
    const result = poerAdapter.lookupBreakdown('PC.3', cells);
    expect(result).toEqual([
      { diameter: 'D13', weightKg: 265.17, sourceCell: 'REKAP-PC!K13' },
      { diameter: 'D16', weightKg: 389.72, sourceCell: 'REKAP-PC!L13' },
    ]);
  });

  it('returns null when type code not found', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 11, cols: { A: 'PC.1', K: 100 } }]),
    ];
    expect(poerAdapter.lookupBreakdown('PC.99', cells)).toBeNull();
  });

  it('returns null when REKAP-PC sheet absent', () => {
    expect(poerAdapter.lookupBreakdown('PC.1', [])).toBeNull();
  });
});
