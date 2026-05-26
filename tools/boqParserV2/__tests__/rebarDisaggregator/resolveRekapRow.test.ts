import { resolveRekapRowFromBoqFormula } from '../../rebarDisaggregator/resolveRekapRow';
import type { HarvestedCell } from '../../types';

function cell(sheet: string, address: string, value: unknown, formula: string | null = null): HarvestedCell {
  const m = address.match(/^([A-Z]+)(\d+)$/)!;
  const colStr = m[1];
  const col = colStr.split('').reduce((s, ch) => s * 26 + (ch.charCodeAt(0) - 64), 0);
  return { sheet, address, row: parseInt(m[2], 10), col, value, formula };
}

describe('resolveRekapRowFromBoqFormula', () => {
  it('extracts the row from a quoted-sheet formula reference', () => {
    const cells = [cell('RAB (A)', 'Z150', 206.83, `='REKAP Balok'!X291`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 150, 'REKAP Balok')).toBe(291);
  });

  it('extracts the row from an unquoted-sheet formula reference', () => {
    const cells = [cell('RAB (A)', 'Z42', 100, `=Analisa!F133`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 42, 'Analisa')).toBe(133);
  });

  it('handles absolute column / row references with $', () => {
    const cells = [cell('RAB (A)', 'Z108', 240.4, `='REKAP Balok'!$X$274`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 108, 'REKAP Balok')).toBe(274);
  });

  it('handles hyphenated sheet names (REKAP-PC)', () => {
    const cells = [cell('RAB (A)', 'Z59', 84.75, `='REKAP-PC'!K35`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 59, 'REKAP-PC')).toBe(35);
  });

  it('returns null when the formula does not cite the requested sheet', () => {
    const cells = [cell('RAB (A)', 'Z150', 206.83, `='REKAP Plat'!X10`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 150, 'REKAP Balok')).toBeNull();
  });

  it('returns null when the cell has a literal value (no formula)', () => {
    const cells = [cell('RAB (A)', 'Z150', 206.83)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 150, 'REKAP Balok')).toBeNull();
  });

  it('returns null when the cell is missing entirely', () => {
    expect(resolveRekapRowFromBoqFormula([], 'RAB (A)', 150, 'REKAP Balok')).toBeNull();
  });

  it('does not match a sheet whose name is a substring of another', () => {
    // "REKAP Balok L1" should NOT satisfy a lookup for "REKAP Balok" since
    // they are distinct sheets. The `!` anchor immediately after the sheet
    // name forces an exact end-of-name match.
    const cells = [cell('RAB (A)', 'Z150', 200, `='REKAP Balok L1'!X10`)];
    expect(resolveRekapRowFromBoqFormula(cells, 'RAB (A)', 150, 'REKAP Balok')).toBeNull();
  });
});
