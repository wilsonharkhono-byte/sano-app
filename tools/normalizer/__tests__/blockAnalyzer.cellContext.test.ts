import { extractBlockCellContext } from '../blockAnalyzer';
import type { HarvestedCell } from '../../boqParserV2/types';

function cell(sheet: string, address: string, row: number, col: number, value: unknown, formula: string | null = null): HarvestedCell {
  return { sheet, address, row, col, value, formula };
}

describe('extractBlockCellContext', () => {
  it('returns cells from anchor.row-3 to anchor.row+15 in the same sheet', () => {
    const cells: HarvestedCell[] = [];
    for (let i = 40; i <= 60; i++) {
      for (let c = 0; c < 5; c++) {
        cells.push(cell('Analisa', `${String.fromCharCode(65 + c)}${i}`, i, c, `r${i}c${c}`));
      }
    }
    cells.push(cell('OtherSheet', 'A55', 55, 0, 'unrelated'));

    const ctx = extractBlockCellContext('Analisa!F55', cells);
    expect(ctx.sheet).toBe('Analisa');
    expect(ctx.anchorRow).toBe(55);
    expect(ctx.rows[0].row).toBe(52);
    expect(ctx.rows[ctx.rows.length - 1].row).toBe(60);
    expect(ctx.rows.every((r) => r.cells.length > 0)).toBe(true);
    expect(ctx.rows.every((r) => r.cells.every((c) => c.sheet === 'Analisa'))).toBe(true);
  });

  it('throws on invalid blockId', () => {
    expect(() => extractBlockCellContext('NoBang', [])).toThrow();
  });
});
