import { analyzeBlockWithOpus } from '../blockAnalyzer';
import type { CellContext } from '../blockAnalyzer';

const CTX: CellContext = {
  sheet: 'Analisa',
  anchorRow: 55,
  rows: [
    { row: 46, cells: [{ sheet: 'Analisa', address: 'D46', row: 46, col: 3, value: 'Bekisting Balok', formula: null }] },
    { row: 47, cells: [
      { sheet: 'Analisa', address: 'B47', row: 47, col: 1, value: 2.0, formula: null },
      { sheet: 'Analisa', address: 'D47', row: 47, col: 3, value: 'Multipleks 15 mm', formula: null },
    ] },
  ],
};

describe('analyzeBlockWithOpus', () => {
  it('parses a valid JSON response into a BlockSchema', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              blockType: 'bekisting',
              elementHint: 'Balok',
              cycleFactor: 4,
              ratioBasis: 'per_m2_form_per_cycle',
              rolledUpTotalPerNativeUnit: 251113,
              confidence: 'high',
              notes: null,
              subItems: [{ materialName: 'Multipleks 15 mm', specNote: null, qtyPerNativeUnit: 2.0, nativeUnit: 'lbr', unitPrice: 200000, includedInRolledUpTotal: true }],
            }),
          }],
        }),
      },
    };
    const schema = await analyzeBlockWithOpus('Analisa!F55', CTX, fakeClient as any);
    expect(schema.blockType).toBe('bekisting');
    expect(schema.cycleFactor).toBe(4);
    expect(schema.subItems).toHaveLength(1);
    expect(schema.blockId).toBe('Analisa!F55');
    expect(fakeClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it('retries once on invalid JSON, then throws', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }] }),
      },
    };
    await expect(analyzeBlockWithOpus('Analisa!F55', CTX, fakeClient as any)).rejects.toThrow(/parse/i);
    expect(fakeClient.messages.create).toHaveBeenCalledTimes(2);
  });
});
