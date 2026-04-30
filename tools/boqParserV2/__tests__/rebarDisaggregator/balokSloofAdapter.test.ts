import { balokSloofAdapter } from '../../rebarDisaggregator/adapters/balokSloof';
import type { HarvestedCell } from '../../types';

function mkCells(rows: Array<{ row: number; cols: Record<string, unknown> }>): HarvestedCell[] {
  const out: HarvestedCell[] = [];
  for (const r of rows) {
    for (const [col, value] of Object.entries(r.cols)) {
      const colNum = col.charCodeAt(0) - 64;
      out.push({
        sheet: 'REKAP Balok',
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

describe('balokSloofAdapter.lookupBreakdown', () => {
  // Header row 264 declares diameter columns: L=D6, M=D8, N=D10, O=D13,
  // P=D16, Q=D19, R=D22, S=D25.
  const headers = mkCells([
    { row: 264, cols: { L: 6, M: 8, N: 10, O: 13, P: 16, Q: 19, R: 22, S: 25 } },
  ]);

  it('returns the diameters and weights for S24-1', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 267, cols: { D: 'S24-1', M: 404.365, O: 1057.148 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('S24-1', cells);
    expect(result).not.toBeNull();
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 404.365, sourceCell: 'REKAP Balok!M267' },
      { diameter: 'D13', weightKg: 1057.148, sourceCell: 'REKAP Balok!O267' },
    ]);
  });

  it('returns null when type code not found', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 267, cols: { D: 'S24-1', M: 404 } }]),
    ];
    expect(balokSloofAdapter.lookupBreakdown('S99-99', cells)).toBeNull();
  });

  it('returns null when REKAP Balok sheet has no cells', () => {
    expect(balokSloofAdapter.lookupBreakdown('S24-1', [])).toBeNull();
  });

  it('skips zero-weight diameters', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 267, cols: { D: 'S24-1', L: 0, M: 100, N: 0, O: 200 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('S24-1', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 100, sourceCell: 'REKAP Balok!M267' },
      { diameter: 'D13', weightKg: 200, sourceCell: 'REKAP Balok!O267' },
    ]);
  });

  it('returns empty array when row exists but all diameters are zero', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 267, cols: { D: 'S24-1', L: 0, M: 0 } }]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('S24-1', cells);
    expect(result).toEqual([]);
  });

  it('matches type code via Balok prefix too (B23-1)', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 281, cols: { D: 'B23-1', N: 50, O: 75 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('B23-1', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 50, sourceCell: 'REKAP Balok!N281' },
      { diameter: 'D13', weightKg: 75, sourceCell: 'REKAP Balok!O281' },
    ]);
  });
});
