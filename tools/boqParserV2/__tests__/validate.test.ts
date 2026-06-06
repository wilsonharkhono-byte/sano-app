import { validateBlocks, validateBreakdowns } from '../validate';
import type { AhsBlock } from '../detectBlocks';

function mockBlock(
  title: string,
  jumlah: number,
  componentFValues: number[],
): AhsBlock {
  return {
    title,
    titleRow: 1,
    titleAddress: 'B1',
    jumlahRow: 10,
    jumlahCachedValue: jumlah,
    grandTotalAddress: null,
    components: componentFValues.map((_v, i) => ({
      sheet: 'Analisa',
      address: `E${i + 2}`,
      row: i + 2,
      col: 5,
      value: 0,              // unit prices don't influence validator anymore
      formula: null,
    })),
    componentRows: componentFValues.map((_, i) => i + 2),
    componentSubtotals: componentFValues,
  };
}

describe('validateBlocks', () => {
  it('flags balanced block as ok', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [40, 30, 30])]);
    expect(r.blocks[0].status).toBe('ok');
  });

  it('flags imbalanced block with delta', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [40, 30, 20])]);
    expect(r.blocks[0].status).toBe('imbalanced');
    expect(r.blocks[0].delta).toBe(-10);
  });

  it('tolerates ±1 rounding', () => {
    const r = validateBlocks([mockBlock('1m3 Beton', 100, [33, 33, 33])]);
    expect(r.blocks[0].status).toBe('ok'); // 99 vs 100, within ±1
  });
});

describe('validateBreakdowns', () => {
  it('warns when breakdown sheets present but flag is off', () => {
    const warnings = validateBreakdowns({
      breakdownsFound: 5,
      flagEnabled: false,
      readerWarnings: [],
    });
    expect(warnings.some((w) => w.code === 'BREAKDOWN_SHEETS_PRESENT_BUT_FLAG_OFF')).toBe(true);
  });

  it('passes through reader warnings', () => {
    const warnings = validateBreakdowns({
      breakdownsFound: 2,
      flagEnabled: true,
      readerWarnings: [{ sheet: 'Breakdown X', code: 'COST_MISMATCH', message: 'foo' }],
    });
    expect(warnings.some((w) => w.code === 'COST_MISMATCH' && w.sheet === 'Breakdown X')).toBe(true);
  });

  it('no warnings when flag on and no reader issues', () => {
    const warnings = validateBreakdowns({
      breakdownsFound: 3,
      flagEnabled: true,
      readerWarnings: [],
    });
    expect(warnings).toEqual([]);
  });
});
