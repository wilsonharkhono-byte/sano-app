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
  // Hasil-Kolom layout (AAL-5-style):
  //   D = type label (K24, K25, etc.)
  //   Diameter header row at 177 (REKAP VOLUME section) carries:
  //     Stirrup group: H=8, I=10, J=13, K=16
  //     Main group:    L=10, M=13, N=16, O=19
  // Combined emission: D10 = I + L, D13 = J + M, D16 = K + N.
  // D8 only from stirrup col H, D19 only from main col O.
  const headers = mkCells([
    { row: 177, cols: { H: 8, I: 10, J: 13, K: 16, L: 10, M: 13, N: 16, O: 19 } },
  ]);

  it('returns combined diameters for K24 (D10 stirrup + main)', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 180, cols: { D: 'K24', I: 105.42, L: 150.11 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      {
        diameter: 'D10',
        weightKg: expect.closeTo(255.53, 2),
        sourceCell: 'Hasil-Kolom!I180+L180',
      },
    ]);
  });

  it('combines all overlapping diameters', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 182, cols: { D: 'K26', H: 50, I: 100, J: 200, K: 30, L: 150, M: 300, N: 70, O: 80 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K26', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 50, sourceCell: 'Hasil-Kolom!H182' },
      { diameter: 'D10', weightKg: 250, sourceCell: 'Hasil-Kolom!I182+L182' },
      { diameter: 'D13', weightKg: 500, sourceCell: 'Hasil-Kolom!J182+M182' },
      { diameter: 'D16', weightKg: 100, sourceCell: 'Hasil-Kolom!K182+N182' },
      { diameter: 'D19', weightKg: 80, sourceCell: 'Hasil-Kolom!O182' },
    ]);
  });

  it('emits a single-source diameter when only one role is non-zero', () => {
    const cells = [
      ...headers,
      ...mkCells([
        { row: 180, cols: { D: 'K24', I: 100, L: 0 } }, // stirrup only
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 100, sourceCell: 'Hasil-Kolom!I180' },
    ]);
  });

  it('returns null when type code not found', () => {
    const cells = [
      ...headers,
      ...mkCells([{ row: 180, cols: { D: 'K24', I: 100 } }]),
    ];
    expect(kolomAdapter.lookupBreakdown('K99', cells)).toBeNull();
  });

  it('only scans Hasil-Kolom summary rows (skips earlier metadata rows)', () => {
    const cells = [
      ...headers,
      ...mkCells([
        // Metadata "K24" in column D at row 50 — outside the summary range.
        { row: 50, cols: { D: 'K24', I: 999 } },
        { row: 180, cols: { D: 'K24', I: 100 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 100, sourceCell: 'Hasil-Kolom!I180' },
    ]);
  });
});
