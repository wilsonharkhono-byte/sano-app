import { kolomAdapter } from '../../rebarDisaggregator/adapters/kolom';
import type { HarvestedCell } from '../../types';

function mkCells(rows: Array<{ row: number; cols: Record<string, unknown> }>): HarvestedCell[] {
  const out: HarvestedCell[] = [];
  for (const r of rows) {
    for (const [col, value] of Object.entries(r.cols)) {
      const colNum = col.charCodeAt(0) - 64;
      out.push({
        sheet: 'Hasil-Kolom',
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

describe('kolomAdapter.lookupBreakdown', () => {
  // Hasil-Kolom column layout (rows 145-250 are summary):
  //   D = type label (K24, K25, etc.)
  //   H = D8 stirrup, I = D10 stirrup, J = D13 stirrup, K = D16 stirrup
  //   L = D10 main,    M = D13 main,    N = D16 main,    O = D19 main
  // Combined emission: D10 = I + L, D13 = J + M, D16 = K + N.
  // D8 only from stirrup col H, D19 only from main col O.

  it('returns combined diameters for K24 (D10 stirrup + main)', () => {
    const cells = mkCells([
      { row: 152, cols: { D: 'K24', I: 105.42, L: 150.11 } },
    ]);
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      {
        diameter: 'D10',
        weightKg: expect.closeTo(255.53, 2),
        sourceCell: 'Hasil-Kolom!I152+L152',
      },
    ]);
  });

  it('combines all overlapping diameters', () => {
    const cells = mkCells([
      { row: 154, cols: { D: 'K26', H: 50, I: 100, J: 200, K: 30, L: 150, M: 300, N: 70, O: 80 } },
    ]);
    const result = kolomAdapter.lookupBreakdown('K26', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 50, sourceCell: 'Hasil-Kolom!H154' },
      { diameter: 'D10', weightKg: 250, sourceCell: 'Hasil-Kolom!I154+L154' },
      { diameter: 'D13', weightKg: 500, sourceCell: 'Hasil-Kolom!J154+M154' },
      { diameter: 'D16', weightKg: 100, sourceCell: 'Hasil-Kolom!K154+N154' },
      { diameter: 'D19', weightKg: 80, sourceCell: 'Hasil-Kolom!O154' },
    ]);
  });

  it('emits a single-source diameter when only one role is non-zero', () => {
    const cells = mkCells([
      { row: 152, cols: { D: 'K24', I: 100, L: 0 } }, // stirrup only
    ]);
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 100, sourceCell: 'Hasil-Kolom!I152' },
    ]);
  });

  it('returns null when type code not found', () => {
    const cells = mkCells([
      { row: 152, cols: { D: 'K24', I: 100 } },
    ]);
    expect(kolomAdapter.lookupBreakdown('K99', cells)).toBeNull();
  });

  it('only scans Hasil-Kolom rows 145-250 (skips earlier metadata rows)', () => {
    const cells = mkCells([
      { row: 50, cols: { D: 'K24', I: 999 } },     // metadata zone — should be ignored
      { row: 152, cols: { D: 'K24', I: 100 } },
    ]);
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 100, sourceCell: 'Hasil-Kolom!I152' },
    ]);
  });
});
