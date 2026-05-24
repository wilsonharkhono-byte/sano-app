// tools/normalizer/__tests__/needsExpansion.test.ts
import { needsExpansion } from '../needsExpansion';
import type { BoqRowV2 } from '../../boqParserV2/extractTakeoffs';

function makeRow(components: Array<{ block: string | null; mat: string | null; qty: number; price: number }>): BoqRowV2 {
  return {
    code: 'X', label: '', unit: 'm3', planned: 1, sourceRow: 1, source_sheet: 'RAB (A)',
    cost_basis: 'inline_split', ref_cells: null, cost_split: null, subkon_cost_per_unit: null,
    total_cost: null, chapter: null, chapter_index: null, sub_chapter: null,
    sub_chapter_letter: null, is_sub_item: true,
    recipe: { perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 }, subkonPerUnit: 0, totalCached: 0, markup: null,
      components: components.map((c) => ({
        sourceCell: { sheet: 'RAB (A)', address: 'X1' },
        referencedCell: { sheet: 'Analisa', address: 'X1' },
        referencedBlockTitle: c.block, referencedBlockRow: null,
        quantityPerUnit: c.qty, unitPrice: c.price, costContribution: c.qty * c.price,
        lineType: 'material', confidence: 1, materialName: c.mat ?? undefined,
      })),
    },
  };
}

describe('needsExpansion', () => {
  it('returns true when a Bekisting component is present', () => {
    expect(needsExpansion(makeRow([{ block: 'Bekisting Balok', mat: null, qty: 10, price: 251113 }]))).toBe(true);
  });
  it('returns true when a Pembesian component is present', () => {
    expect(needsExpansion(makeRow([{ block: 'Pembesian U24 & U40', mat: 'Besi D8', qty: 75, price: 9918 }]))).toBe(true);
  });
  it('returns true when a Pengecoran Beton component is present', () => {
    expect(needsExpansion(makeRow([{ block: 'Pengecoran Beton Readymix', mat: 'Beton', qty: 1, price: 1095570 }]))).toBe(true);
  });
  it('returns true on spurious zero-priced rows', () => {
    expect(needsExpansion(makeRow([{ block: null, mat: null, qty: 10, price: 0 }]))).toBe(true);
  });
  it('returns false on rows whose components do not match any pattern', () => {
    expect(needsExpansion(makeRow([{ block: 'Pengadaan Pintu', mat: 'Pintu kayu', qty: 1, price: 500000 }]))).toBe(false);
  });
  it('returns false when recipe is null', () => {
    const r = makeRow([]);
    r.recipe = null;
    expect(needsExpansion(r)).toBe(false);
  });
});
