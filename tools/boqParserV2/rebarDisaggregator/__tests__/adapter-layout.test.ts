/**
 * Layout-aware adapter tests — exercises header detection with synthetic
 * fixtures that mirror real per-workbook REKAP layouts. The goal is to
 * confirm each adapter returns the correct diameter set for both:
 *   - AAL-5-shaped layouts (the historical baseline)
 *   - PD3-shaped layouts (different column letters, extra D29)
 *   - I4-29-shaped layouts (header columns shifted right by one)
 *
 * See `docs/boq-normalizer-field-guide.md` §13 and
 * `docs/boq-normalizer-validation-PD3-23.md` §7.5 for the per-workbook
 * column layouts these fixtures imitate.
 */

import type { HarvestedCell } from '../../types';
import { balokSloofAdapter } from '../adapters/balokSloof';
import { platAdapter } from '../adapters/plat';
import { poerAdapter } from '../adapters/poer';
import { kolomAdapter } from '../adapters/kolom';
import {
  parseDiameterMarker,
  detectDiameterHeader,
  findRowByLabel,
} from '../adapters/headerDetect';

function mkCells(
  sheet: string,
  rows: Array<{ row: number; cols: Record<string, unknown> }>,
): HarvestedCell[] {
  const out: HarvestedCell[] = [];
  for (const r of rows) {
    for (const [col, value] of Object.entries(r.cols)) {
      // Column letter -> 1-based index. Supports A..ZZ (sufficient).
      let colNum = 0;
      for (const ch of col) colNum = colNum * 26 + (ch.charCodeAt(0) - 64);
      out.push({ sheet, address: `${col}${r.row}`, row: r.row, col: colNum, value, formula: null });
    }
  }
  return out;
}

describe('parseDiameterMarker', () => {
  it('accepts integers in the canonical set', () => {
    expect(parseDiameterMarker(6)).toBe(6);
    expect(parseDiameterMarker(8)).toBe(8);
    expect(parseDiameterMarker(29)).toBe(29);
  });
  it('rejects integers outside the canonical set', () => {
    expect(parseDiameterMarker(7)).toBeNull();
    expect(parseDiameterMarker(100)).toBeNull();
  });
  it('parses string forms with optional D / Φ prefix', () => {
    expect(parseDiameterMarker('D8')).toBe(8);
    expect(parseDiameterMarker('8')).toBe(8);
    expect(parseDiameterMarker('Φ16')).toBe(16);
    expect(parseDiameterMarker('D 13')).toBe(13);
    expect(parseDiameterMarker('8 mm')).toBe(8);
    expect(parseDiameterMarker('D8 (kg)')).toBe(8);
  });
  it('rejects nonsense', () => {
    expect(parseDiameterMarker(null)).toBeNull();
    expect(parseDiameterMarker('')).toBeNull();
    expect(parseDiameterMarker('Type')).toBeNull();
    expect(parseDiameterMarker('mm')).toBeNull();
  });
});

describe('detectDiameterHeader', () => {
  it('picks the first row with at least 3 diameter markers', () => {
    const cells = [
      ...mkCells('REKAP X', [
        { row: 1, cols: { A: 'Title', B: 'irrelevant' } },
        { row: 5, cols: { L: 6, M: 8, N: 10, O: 13, P: 16 } }, // header
        { row: 6, cols: { D: 'B24-1', M: 100, O: 200 } },       // data
      ]),
    ];
    const h = detectDiameterHeader(cells, 'REKAP X', { rowMin: 1, rowMax: 30 });
    expect(h).not.toBeNull();
    expect(h!.row).toBe(5);
    expect(h!.map.get('D6')).toBe('L');
    expect(h!.map.get('D8')).toBe('M');
    expect(h!.map.get('D13')).toBe('O');
  });

  it('returns null when no row meets minMarkers', () => {
    const cells = mkCells('REKAP X', [
      { row: 1, cols: { A: 'Title' } },
      { row: 5, cols: { L: 'foo', M: 'bar' } },
    ]);
    expect(detectDiameterHeader(cells, 'REKAP X')).toBeNull();
  });

  it('respects rowMax to skip data rows that happen to contain diameter numbers', () => {
    const cells = mkCells('REKAP X', [
      { row: 100, cols: { L: 6, M: 8, N: 10, O: 13 } }, // outside default range
    ]);
    expect(detectDiameterHeader(cells, 'REKAP X', { rowMin: 1, rowMax: 30 })).toBeNull();
    expect(detectDiameterHeader(cells, 'REKAP X', { rowMin: 90, rowMax: 110 })).not.toBeNull();
  });
});

describe('findRowByLabel', () => {
  it('finds the row when the type code is in any candidate column', () => {
    const cells = mkCells('REKAP X', [
      { row: 10, cols: { D: 'PC.1' } },
      { row: 11, cols: { A: 'PC.5', B: 'note' } },
    ]);
    const a = findRowByLabel(cells, 'REKAP X', ['A', 'B', 'C', 'D'], 'PC.1');
    expect(a).toEqual({ row: 10, labelCol: 'D' });
    const b = findRowByLabel(cells, 'REKAP X', ['A', 'B', 'C', 'D'], 'PC.5');
    expect(b).toEqual({ row: 11, labelCol: 'A' });
  });

  it('is case-insensitive and trims whitespace', () => {
    const cells = mkCells('REKAP X', [
      { row: 10, cols: { D: ' pc.1 ' } },
    ]);
    expect(findRowByLabel(cells, 'REKAP X', ['D'], 'PC.1')).toEqual({ row: 10, labelCol: 'D' });
  });

  it('returns null when not found', () => {
    const cells = mkCells('REKAP X', [{ row: 10, cols: { D: 'PC.1' } }]);
    expect(findRowByLabel(cells, 'REKAP X', ['D'], 'PC.99')).toBeNull();
  });
});

describe('platAdapter — layout-aware', () => {
  // AAL-5 / PD3 shape: header row 2, K=D8 … O=D25, label in C.
  it('AAL-5/PD3 shape (K..O = D8..D25)', () => {
    const cells = [
      ...mkCells('REKAP Plat', [
        { row: 2, cols: { K: 8, L: 10, M: 13, N: 16, O: 25 } },
        { row: 6, cols: { B: 'Main', C: 'S3 = S4', K: 0, L: 3369.1, M: 0, N: 0, O: 0 } },
      ]),
    ];
    const result = platAdapter.lookupBreakdown('S3 = S4', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 3369.1, sourceCell: 'REKAP Plat!L6' },
    ]);
  });

  // ERNAWATI / older shape: header row 2, N=D8 … R=D19, label in C.
  it('ERNAWATI shape (N..R = D8..D19)', () => {
    const cells = [
      ...mkCells('REKAP Plat', [
        { row: 2, cols: { N: 8, O: 10, P: 13, Q: 16, R: 19 } },
        { row: 6, cols: { C: 'S2', N: 100, P: 415.69 } },
      ]),
    ];
    const result = platAdapter.lookupBreakdown('S2', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 100, sourceCell: 'REKAP Plat!N6' },
      { diameter: 'D13', weightKg: 415.69, sourceCell: 'REKAP Plat!P6' },
    ]);
  });

  it('returns null when no header row exists', () => {
    const cells = mkCells('REKAP Plat', [
      { row: 6, cols: { C: 'S2', K: 100 } },
    ]);
    expect(platAdapter.lookupBreakdown('S2', cells)).toBeNull();
  });
});

describe('balokSloofAdapter — layout-aware', () => {
  // AAL-5 / PD3 / I4-29 all share the same balok layout:
  // L=D6 … T=D29, label in D.
  it('full diameter set including D29', () => {
    const cells = [
      ...mkCells('REKAP Balok', [
        { row: 12, cols: { L: 6, M: 8, N: 10, O: 13, P: 16, Q: 19, R: 22, S: 25, T: 29 } },
        { row: 50, cols: { D: 'B36-1', M: 19.29, N: 6.25, P: 65.77, T: 12.5 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('B36-1', cells);
    expect(result).toEqual([
      { diameter: 'D8',  weightKg: 19.29, sourceCell: 'REKAP Balok!M50' },
      { diameter: 'D10', weightKg: 6.25,  sourceCell: 'REKAP Balok!N50' },
      { diameter: 'D16', weightKg: 65.77, sourceCell: 'REKAP Balok!P50' },
      { diameter: 'D29', weightKg: 12.5,  sourceCell: 'REKAP Balok!T50' },
    ]);
  });

  // Some workbooks use 5-diameter shorter headers (no D29 column).
  it('5-diameter shorter header still works', () => {
    const cells = [
      ...mkCells('REKAP Balok', [
        { row: 11, cols: { L: 6, M: 8, N: 10, O: 13, P: 16 } },
        // Type label lives in column D in the summary section. Column C
        // is the per-instance "Type" column in detail rows (e.g. "TB24-1"
        // on a single floor instance) and must NOT be read by the
        // adapter, otherwise it picks up per-instance weights instead of
        // the cross-floor aggregate the BoQ row needs.
        { row: 50, cols: { D: 'S24-1', M: 100, O: 200 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('S24-1', cells);
    expect(result).toEqual([
      { diameter: 'D8',  weightKg: 100, sourceCell: 'REKAP Balok!M50' },
      { diameter: 'D13', weightKg: 200, sourceCell: 'REKAP Balok!O50' },
    ]);
  });

  // Critical: column C in detail rows carries the per-instance Type
  // label. The adapter must skip those and only match in column D, where
  // summary rows store the cross-floor aggregate.
  it('ignores type code in column C (per-instance detail row) and matches D summary instead', () => {
    const cells = [
      ...mkCells('REKAP Balok', [
        { row: 12, cols: { L: 6, M: 8, N: 10, O: 13, P: 16 } },
        // Detail row at 15: C carries Type="S24-1", M/O have per-instance kg.
        { row: 15, cols: { C: 'S24-1', M: 10, O: 28 } },
        // Summary row at 267: D carries Type="S24-1", M/O have aggregated kg.
        { row: 267, cols: { D: 'S24-1', M: 404.365, O: 1057.148 } },
      ]),
    ];
    const result = balokSloofAdapter.lookupBreakdown('S24-1', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 404.365, sourceCell: 'REKAP Balok!M267' },
      { diameter: 'D13', weightKg: 1057.148, sourceCell: 'REKAP Balok!O267' },
    ]);
  });
});

describe('poerAdapter — layout-aware', () => {
  // AAL-5 / PD3 shape: header row 6, J=D6 … Q=D25, label in A.
  // This is what the old hardcoded mapping (H=D6 … O=D25) got wrong by 2 columns.
  it('AAL-5/PD3 shape (J..Q = D6..D25)', () => {
    const cells = [
      ...mkCells('REKAP-PC', [
        { row: 6, cols: { J: 6, K: 8, L: 10, M: 13, N: 16, O: 19, P: 22, Q: 25 } },
        // PC.5 from AAL-5: only D10 and D13 are non-zero.
        { row: 16, cols: { A: 'PC.5', I: 0.501 /* Lantai Kerja */, L: 4.568265, M: 144.405261 } },
      ]),
    ];
    const result = poerAdapter.lookupBreakdown('PC.5', cells);
    // Note: column I (Lantai Kerja = 0.501) used to be returned as D8 by
    // the old hardcoded mapping — that's the 0.76 kg/m³ Poer discrepancy
    // from field guide bottleneck #4. With layout-aware detection it is
    // correctly ignored because I is NOT a diameter column in the header.
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 4.568265,   sourceCell: 'REKAP-PC!L16' },
      { diameter: 'D13', weightKg: 144.405261, sourceCell: 'REKAP-PC!M16' },
    ]);
  });

  // I4-29 shape: header row 6, K=D6 … R=D25 (shifted right by 1 col).
  it('I4-29 shape (K..R = D6..D25)', () => {
    const cells = [
      ...mkCells('REKAP-PC', [
        { row: 6, cols: { K: 6, L: 8, M: 10, N: 13, O: 16, P: 19, Q: 22, R: 25 } },
        { row: 8, cols: { A: 'PC.1', M: 17.36, N: 59.98 } },
      ]),
    ];
    const result = poerAdapter.lookupBreakdown('PC.1', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 17.36, sourceCell: 'REKAP-PC!M8' },
      { diameter: 'D13', weightKg: 59.98, sourceCell: 'REKAP-PC!N8' },
    ]);
  });

  it('rejects Lantai Kerja column as a phantom D8 reading', () => {
    // Header explicitly assigns D8 to column K; Lantai Kerja sits in I
    // and is NOT in the header map. The old hardcoded adapter would have
    // read I as D8 — the new one ignores I entirely.
    const cells = [
      ...mkCells('REKAP-PC', [
        { row: 6, cols: { J: 6, K: 8, L: 10, M: 13 } },
        { row: 10, cols: { A: 'PC.X', I: 99.99 /* Lantai Kerja */, M: 200 } },
      ]),
    ];
    const result = poerAdapter.lookupBreakdown('PC.X', cells);
    expect(result).toEqual([
      { diameter: 'D13', weightKg: 200, sourceCell: 'REKAP-PC!M10' },
    ]);
  });
});

describe('kolomAdapter — layout-aware', () => {
  // AAL-5 shape: header row 177, stirrup H..K = D8..D16, main L..S = D10..D32.
  it('AAL-5 shape — combines stirrup and main weights', () => {
    const cells = [
      ...mkCells('Hasil-Kolom', [
        { row: 177, cols: { H: 8, I: 10, J: 13, K: 16, L: 10, M: 13, N: 16, O: 19 } },
        { row: 180, cols: { D: 'K24', H: 25, I: 50, L: 75, M: 100, O: 30 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D8',  weightKg: 25,  sourceCell: 'Hasil-Kolom!H180' },
      { diameter: 'D10', weightKg: 125, sourceCell: 'Hasil-Kolom!I180+L180' },
      { diameter: 'D13', weightKg: 100, sourceCell: 'Hasil-Kolom!M180' },
      { diameter: 'D19', weightKg: 30,  sourceCell: 'Hasil-Kolom!O180' },
    ]);
  });

  // PD3 shape: header row 213, stirrup H..K = D8..D16, main L..S = D8..D29.
  // Note PD3 has L=D8 (main), not L=D10 like AAL-5.
  it('PD3 shape — main group starts at D8 (L) rather than D10', () => {
    const cells = [
      ...mkCells('Hasil-Kolom', [
        { row: 213, cols: { H: 8, I: 10, J: 13, K: 16, L: 8, M: 10, N: 13, O: 16, P: 19, Q: 22, R: 25, S: 29 } },
        // K174-1 from PD3 REKAP VOLUME row 218: only H + N nonzero.
        { row: 218, cols: { D: 'K174-1', H: 89.17, N: 179.85 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K174-1', cells);
    expect(result).toEqual([
      { diameter: 'D8',  weightKg: 89.17,  sourceCell: 'Hasil-Kolom!H218' },
      { diameter: 'D13', weightKg: 179.85, sourceCell: 'Hasil-Kolom!N218' },
    ]);
  });

  it('combines D8 from stirrup H AND main L when both are non-zero (PD3 shape)', () => {
    const cells = [
      ...mkCells('Hasil-Kolom', [
        { row: 213, cols: { H: 8, I: 10, J: 13, K: 16, L: 8, M: 10, N: 13, O: 16 } },
        { row: 220, cols: { D: 'K-DUMMY', H: 10, L: 20 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K-DUMMY', cells);
    expect(result).toEqual([
      { diameter: 'D8', weightKg: 30, sourceCell: 'Hasil-Kolom!H220+L220' },
    ]);
  });

  it('returns null when header not detected', () => {
    const cells = mkCells('Hasil-Kolom', [
      { row: 180, cols: { D: 'K24', I: 100, L: 50 } },
    ]);
    expect(kolomAdapter.lookupBreakdown('K24', cells)).toBeNull();
  });

  it('ignores stray markers outside the summary range', () => {
    const cells = [
      ...mkCells('Hasil-Kolom', [
        // Metadata in early rows shouldn't be picked as header.
        { row: 5, cols: { H: 8, I: 10, J: 13, K: 16 } },
        { row: 177, cols: { H: 8, I: 10, J: 13, K: 16, L: 10, M: 13, N: 16, O: 19 } },
        { row: 180, cols: { D: 'K24', I: 100, L: 75 } },
      ]),
    ];
    const result = kolomAdapter.lookupBreakdown('K24', cells);
    expect(result).toEqual([
      { diameter: 'D10', weightKg: 175, sourceCell: 'Hasil-Kolom!I180+L180' },
    ]);
  });
});
